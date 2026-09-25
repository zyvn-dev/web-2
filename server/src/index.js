import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import cors from 'cors';
import { FleetSimulation } from './simulation.js';
import { analyzeDistressMessage } from './ai.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;
const fleetPath = join(__dirname, '../../fleet.json');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, '../../client/dist')));

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const sim = new FleetSimulation(fleetPath);

const clients = new Map();

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const role = url.searchParams.get('role') || 'command';
  const shipId = url.searchParams.get('shipId') || null;
  const clientId = `client-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  clients.set(clientId, { ws, role, shipId, id: clientId });
  console.log(`Client connected: ${clientId} role=${role} shipId=${shipId}`);

  ws.send(JSON.stringify({ type: 'init', data: { clientId, role, shipId, ...sim.getState() } }));

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      handleMessage(clientId, msg);
    } catch (e) {
      console.error('Bad message:', e.message);
    }
  });

  ws.on('close', () => {
    clients.delete(clientId);
    console.log(`Client disconnected: ${clientId}`);
  });
});

function handleMessage(clientId, msg) {
  const client = clients.get(clientId);
  if (!client) return;

  switch (msg.type) {
    case 'add_zone': {
      if (client.role !== 'command') return;
      sim.addRestrictedZone(msg.data);
      break;
    }
    case 'remove_zone': {
      if (client.role !== 'command') return;
      sim.removeRestrictedZone(msg.data.id);
      break;
    }
    case 'send_directive': {
      if (client.role !== 'command') return;
      sim.sendDirective(msg.data.shipId, msg.data.directive);
      break;
    }
    case 'respond_directive': {
      if (client.role !== 'captain') return;
      sim.respondToDirective(msg.data.directiveId, msg.data.response);
      break;
    }
    case 'acknowledge_alert': {
      sim.acknowledgeAlert(msg.data.alertId);
      break;
    }
    case 'distress_message': {
      if (client.role !== 'captain') return;
      const ship = sim.ships.get(msg.data.shipId);
      if (!ship) return;
      const analysis = analyzeDistressMessage(msg.data.message, ship);
      ship.status = 'distressed';
      const alert = sim.createAlert('distress', analysis.severity, ship.shipId,
        analysis.summary, { analysis });
      sim.alerts.push(alert);
      sim.broadcast({ type: 'distress', data: { alert, analysis } });
      break;
    }
  }
}

sim.addListener((event) => {
  const msg = JSON.stringify(event);
  for (const [id, client] of clients) {
    if (client.ws.readyState !== 1) continue;
    if (client.role === 'captain' && client.shipId) {
      if (event.type === 'state_update') {
        const filtered = {
          type: 'state_update',
          data: {
            ...event.data,
            ships: event.data.ships.filter(s => s.shipId === client.shipId),
            directives: event.data.directives.filter(d => d.shipId === client.shipId),
            alerts: event.data.alerts.filter(a => a.shipId === client.shipId || a.type === 'proximity'),
          },
        };
        client.ws.send(JSON.stringify(filtered));
        continue;
      }
    }
    client.ws.send(msg);
  }
});

app.get('/api/state', (req, res) => res.json(sim.getState()));
app.get('/api/history', (req, res) => res.json(sim.getHistory()));
app.get('/api/ship/:id', (req, res) => {
  const ship = sim.ships.get(req.params.id);
  if (!ship) return res.status(404).json({ error: 'Ship not found' });
  res.json(ship);
});
app.get('/api/ports', (req, res) => res.json(sim.ports));
app.get('/api/zones', (req, res) => res.json(sim.restrictedZones));

app.get('*', (req, res) => {
  res.sendFile(join(__dirname, '../../client/dist/index.html'));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Fleet Tracking Server running on port ${PORT}`);
  sim.start();
});
