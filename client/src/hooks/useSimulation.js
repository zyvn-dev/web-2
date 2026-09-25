import { useState, useEffect, useRef, useCallback } from 'react';
import { ClientSimulation } from '../engine/simulation.js';

let sharedSim = null;

function getSimulation() {
  if (!sharedSim) {
    sharedSim = new ClientSimulation();
    sharedSim.start();
    window.__fleetSim = sharedSim;
  }
  return sharedSim;
}

export function useSimulation(role, shipId) {
  const simRef = useRef(null);
  const [state, setState] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [directives, setDirectives] = useState([]);

  useEffect(() => {
    const sim = getSimulation();
    simRef.current = sim;

    setState(sim.getState());
    setAlerts(sim.alerts.slice());
    setDirectives(sim.directives.slice());

    const listener = (event) => {
      switch (event.type) {
        case 'state_update': {
          let s = event.data;
          if (role === 'captain' && shipId) {
            s = { ...s, ships: s.ships.filter(sh => sh.shipId === shipId) };
          }
          setState(s);
          break;
        }
        case 'alerts':
          setAlerts(prev => {
            const existing = new Set(prev.map(a => a.id));
            const newAlerts = event.data.filter(a => !existing.has(a.id));
            if (newAlerts.length === 0) return prev;
            const combined = [...prev, ...newAlerts].slice(-100);
            playAlertSound(newAlerts);
            return combined;
          });
          break;
        case 'zone_added':
          setState(prev => prev ? {
            ...prev,
            restrictedZones: [...(prev.restrictedZones || []), event.data],
          } : prev);
          break;
        case 'zone_removed':
          setState(prev => prev ? {
            ...prev,
            restrictedZones: (prev.restrictedZones || []).filter(z => z.id !== event.data.id),
          } : prev);
          break;
        case 'directive':
          setDirectives(prev => [...prev, event.data]);
          break;
        case 'directive_response':
          setDirectives(prev => prev.map(d => d.id === event.data.id ? event.data : d));
          break;
        case 'distress':
          setAlerts(prev => {
            playAlertSound([event.data.alert]);
            return [...prev, event.data.alert].slice(-100);
          });
          break;
      }
    };

    sim.addListener(listener);
    return () => sim.removeListener(listener);
  }, [role, shipId]);

  const send = useCallback((msg) => {
    const sim = simRef.current;
    if (!sim) return;
    switch (msg.type) {
      case 'add_zone':
        sim.addRestrictedZone(msg.data);
        break;
      case 'remove_zone':
        sim.removeRestrictedZone(msg.data.id);
        break;
      case 'send_directive':
        sim.sendDirective(msg.data.shipId, msg.data.directive);
        break;
      case 'respond_directive':
        sim.respondToDirective(msg.data.directiveId, msg.data.response);
        break;
      case 'acknowledge_alert':
        sim.acknowledgeAlert(msg.data.alertId);
        setAlerts(prev => prev.map(a => a.id === msg.data.alertId ? { ...a, acknowledged: true } : a));
        break;
      case 'distress_message':
        sim.handleDistressMessage(msg.data.shipId, msg.data.message);
        break;
    }
  }, []);

  return { connected: true, state, alerts, directives, send };
}

let audioCtx;
function playAlertSound(alerts) {
  const hasCritical = alerts.some(a => a.severity === 'critical');
  const hasHigh = alerts.some(a => a.severity === 'high');
  if (!hasCritical && !hasHigh) return;
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.frequency.value = hasCritical ? 880 : 660;
    gain.gain.value = 0.1;
    osc.start();
    osc.stop(audioCtx.currentTime + 0.2);
  } catch {}
}
