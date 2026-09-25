import { haversineDistance, bearing, movePoint, knotsToKmPerSecond, pointInPolygon } from './geo.js';
import { computeRoute } from './routing.js';
import { analyzeDistressMessage, prioritizeAlerts } from './ai.js';
import fleetData from '../data/fleet.json';

const ARRIVAL_THRESHOLD_KM = 2;
const PROXIMITY_WARNING_KM = 2;
const FUEL_BURN_PER_KM = 0.15;
const ADVERSE_WEATHER_PENALTY = 0.3;

export class ClientSimulation {
  constructor() {
    this.navigableWater = fleetData.navigableWater;
    this.ports = fleetData.ports;
    this.boundingBox = fleetData.boundingBox;
    this.ships = new Map();
    this.restrictedZones = [];
    this.alerts = [];
    this.alertIdCounter = 0;
    this.history = [];
    this.maxHistorySize = 120;
    this.tickCount = 0;
    this.directives = [];
    this.running = false;
    this.tickInterval = null;
    this.lastTick = Date.now();
    this._proximityActive = new Set();
    this.listeners = new Set();

    for (const ship of fleetData.fleet) {
      const dest = this.ports.find(p => p.id === ship.destination);
      const route = dest ? computeRoute(
        ship.position[0], ship.position[1],
        dest.position[0], dest.position[1],
        this.navigableWater, this.restrictedZones
      ) : null;

      this.ships.set(ship.shipId, {
        ...ship,
        position: [...ship.position],
        route: route || [ship.position],
        routeIndex: 0,
        weather: { description: 'Clear', adverse: false },
        fuelWarning: false,
        arrived: false,
        _inZone: new Set(),
      });
    }
  }

  addListener(fn) { this.listeners.add(fn); }
  removeListener(fn) { this.listeners.delete(fn); }

  broadcast(event) {
    for (const fn of this.listeners) {
      try { fn(event); } catch {}
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.lastTick = Date.now();
    this.tickInterval = setInterval(() => this.tick(), 1000);
  }

  stop() {
    this.running = false;
    if (this.tickInterval) clearInterval(this.tickInterval);
  }

  tick() {
    const now = Date.now();
    const dt = (now - this.lastTick) / 1000;
    this.lastTick = now;
    this.tickCount++;
    const newAlerts = [];

    for (const ship of this.ships.values()) {
      if (ship.status === 'arrived' || ship.status === 'stopped' || ship.status === 'stranded') continue;
      if (ship.fuel <= 0) {
        if (ship.status !== 'out_of_fuel') {
          ship.status = 'out_of_fuel';
          ship.speed = 0;
          newAlerts.push(this.createAlert('fuel', 'critical', ship.shipId,
            `${ship.name} has run out of fuel at position ${ship.position[0].toFixed(3)}, ${ship.position[1].toFixed(3)}`));
        }
        continue;
      }

      const adverseWeather = ship.weather?.adverse || false;
      const speedKmS = knotsToKmPerSecond(ship.speed);
      const distThisTick = speedKmS * dt;
      let fuelMultiplier = 1;
      if (adverseWeather) fuelMultiplier = 1 + ADVERSE_WEATHER_PENALTY;

      const fuelBurn = distThisTick * FUEL_BURN_PER_KM * fuelMultiplier;
      ship.fuel = Math.max(0, ship.fuel - fuelBurn);

      if (ship.route && ship.routeIndex < ship.route.length - 1) {
        const nextWaypoint = ship.route[ship.routeIndex + 1];
        const distToWaypoint = haversineDistance(
          ship.position[0], ship.position[1],
          nextWaypoint[0], nextWaypoint[1]
        );

        ship.heading = bearing(ship.position[0], ship.position[1], nextWaypoint[0], nextWaypoint[1]);

        if (distToWaypoint <= distThisTick) {
          ship.position = [...nextWaypoint];
          ship.routeIndex++;
          if (ship.routeIndex >= ship.route.length - 1) {
            const dest = this.ports.find(p => p.id === ship.destination);
            if (dest) {
              const distToDest = haversineDistance(
                ship.position[0], ship.position[1],
                dest.position[0], dest.position[1]
              );
              if (distToDest < ARRIVAL_THRESHOLD_KM) {
                ship.status = 'arrived';
                ship.speed = 0;
                newAlerts.push(this.createAlert('arrival', 'low', ship.shipId,
                  `${ship.name} has arrived at ${dest.name}`));
              }
            }
          }
        } else {
          const newPos = movePoint(ship.position[0], ship.position[1], ship.heading, distThisTick);
          ship.position = newPos;
        }
      } else {
        const newPos = movePoint(ship.position[0], ship.position[1], ship.heading, distThisTick);
        ship.position = newPos;
      }

      const dest = this.ports.find(p => p.id === ship.destination);
      if (dest && ship.status !== 'arrived') {
        const remainingRoute = this.getRemainingRouteDistance(ship);
        const fuelNeeded = remainingRoute * FUEL_BURN_PER_KM;
        if (ship.fuel < fuelNeeded && !ship.fuelWarning) {
          ship.fuelWarning = true;
          ship.status = 'insufficient_fuel';
          newAlerts.push(this.createAlert('fuel', 'high', ship.shipId,
            `${ship.name} has insufficient fuel to reach ${dest.name}. Fuel: ${ship.fuel.toFixed(0)}t, Need: ${fuelNeeded.toFixed(0)}t`));
        }
      }

      for (const zone of this.restrictedZones) {
        if (pointInPolygon(ship.position[0], ship.position[1], zone.polygon)) {
          if (!ship._inZone.has(zone.id)) {
            ship._inZone.add(zone.id);
            newAlerts.push(this.createAlert('geofence', 'critical', ship.shipId,
              `${ship.name} has entered restricted zone "${zone.name}"`, { zoneId: zone.id }));
            this.rerouteShip(ship);
          }
        } else {
          ship._inZone.delete(zone.id);
        }
      }
    }

    const shipList = [...this.ships.values()];
    for (let i = 0; i < shipList.length; i++) {
      for (let j = i + 1; j < shipList.length; j++) {
        const a = shipList[i];
        const b = shipList[j];
        if (a.status === 'arrived' || b.status === 'arrived') continue;
        const d = haversineDistance(a.position[0], a.position[1], b.position[0], b.position[1]);
        if (d < PROXIMITY_WARNING_KM) {
          const pairKey = [a.shipId, b.shipId].sort().join('-');
          if (!this._proximityActive.has(pairKey)) {
            this._proximityActive.add(pairKey);
            newAlerts.push(this.createAlert('proximity', 'high', a.shipId,
              `${a.name} and ${b.name} are within ${d.toFixed(2)}km of each other`,
              { otherShipId: b.shipId, distance: d }));
          }
        } else {
          const pairKey = [a.shipId, b.shipId].sort().join('-');
          this._proximityActive.delete(pairKey);
        }
      }
    }

    if (newAlerts.length > 0) {
      this.alerts.push(...newAlerts);
      this.alerts = prioritizeAlerts(this.alerts);
    }

    if (this.tickCount % 30 === 0) {
      this.saveSnapshot();
    }

    const state = this.getState();
    this.broadcast({ type: 'state_update', data: state });

    if (newAlerts.length > 0) {
      this.broadcast({ type: 'alerts', data: newAlerts });
    }
  }

  getRemainingRouteDistance(ship) {
    if (!ship.route || ship.routeIndex >= ship.route.length - 1) {
      const dest = this.ports.find(p => p.id === ship.destination);
      if (!dest) return 0;
      return haversineDistance(ship.position[0], ship.position[1], dest.position[0], dest.position[1]);
    }
    let dist = haversineDistance(
      ship.position[0], ship.position[1],
      ship.route[ship.routeIndex + 1][0], ship.route[ship.routeIndex + 1][1]
    );
    for (let i = ship.routeIndex + 1; i < ship.route.length - 1; i++) {
      dist += haversineDistance(ship.route[i][0], ship.route[i][1], ship.route[i + 1][0], ship.route[i + 1][1]);
    }
    return dist;
  }

  rerouteShip(ship) {
    const dest = this.ports.find(p => p.id === ship.destination);
    if (!dest) return;
    ship.status = 'rerouting';
    const route = computeRoute(
      ship.position[0], ship.position[1],
      dest.position[0], dest.position[1],
      this.navigableWater, this.restrictedZones
    );
    if (route) {
      ship.route = route;
      ship.routeIndex = 0;
      setTimeout(() => {
        if (ship.status === 'rerouting') ship.status = 'normal';
      }, 5000);
    } else {
      ship.status = 'stranded';
      const alert = this.createAlert('stranded', 'critical', ship.shipId,
        `${ship.name} is stranded - no valid route to ${dest.name}`);
      this.alerts.push(alert);
      this.broadcast({ type: 'alerts', data: [alert] });
    }
  }

  addRestrictedZone(zone) {
    const id = `zone-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const closedPolygon = [...zone.polygon];
    if (closedPolygon.length > 0 &&
        (closedPolygon[0][0] !== closedPolygon[closedPolygon.length - 1][0] ||
         closedPolygon[0][1] !== closedPolygon[closedPolygon.length - 1][1])) {
      closedPolygon.push([...closedPolygon[0]]);
    }
    const newZone = { id, name: zone.name || `Zone ${this.restrictedZones.length + 1}`, polygon: closedPolygon, createdAt: Date.now() };
    this.restrictedZones.push(newZone);

    for (const ship of this.ships.values()) {
      if (ship.status === 'arrived' || ship.status === 'stopped' || ship.status === 'stranded') continue;
      if (pointInPolygon(ship.position[0], ship.position[1], closedPolygon)) {
        this.alerts.push(this.createAlert('geofence', 'critical', ship.shipId,
          `${ship.name} is inside newly created restricted zone "${newZone.name}"`, { zoneId: id }));
        ship._inZone.add(id);
        this.rerouteShip(ship);
      } else if (ship.route) {
        const remainingRoute = ship.route.slice(ship.routeIndex);
        let intersects = false;
        for (let i = 0; i < remainingRoute.length - 1; i++) {
          if (pointInPolygon(remainingRoute[i][0], remainingRoute[i][1], closedPolygon)) { intersects = true; break; }
        }
        if (intersects) this.rerouteShip(ship);
      }
    }

    this.broadcast({ type: 'zone_added', data: newZone });
    return newZone;
  }

  removeRestrictedZone(zoneId) {
    this.restrictedZones = this.restrictedZones.filter(z => z.id !== zoneId);
    for (const ship of this.ships.values()) {
      ship._inZone.delete(zoneId);
      if (ship.status === 'stranded') this.rerouteShip(ship);
    }
    this.broadcast({ type: 'zone_removed', data: { id: zoneId } });
  }

  sendDirective(shipId, directive) {
    const ship = this.ships.get(shipId);
    if (!ship) return null;
    const id = `dir-${Date.now()}`;
    const d = {
      id,
      shipId,
      type: directive.type,
      data: directive.data,
      status: 'pending',
      timestamp: Date.now(),
    };
    this.directives.push(d);
    this.broadcast({ type: 'directive', data: d });
    return d;
  }

  respondToDirective(directiveId, response) {
    const directive = this.directives.find(d => d.id === directiveId);
    if (!directive) return null;

    directive.status = response.action;
    directive.response = response;

    if (response.action === 'ACCEPT') {
      const ship = this.ships.get(directive.shipId);
      if (ship) {
        if (directive.type === 'reroute' && directive.data?.destination) {
          ship.destination = directive.data.destination;
          this.rerouteShip(ship);
        } else if (directive.type === 'hold_position') {
          ship.status = 'stopped';
          ship.speed = 0;
        } else if (directive.type === 'resume') {
          ship.status = 'normal';
          ship.speed = directive.data?.speed || 12;
          this.rerouteShip(ship);
        } else if (directive.type === 'change_speed') {
          ship.speed = directive.data?.speed || ship.speed;
        }
      }
    } else if (response.action === 'ESCALATE_DISTRESS') {
      const ship = this.ships.get(directive.shipId);
      const analysis = analyzeDistressMessage(response.message || '', ship || {});
      if (ship) ship.status = 'distressed';
      const alert = this.createAlert('distress', analysis.severity, directive.shipId,
        analysis.summary, { analysis, directiveId });
      this.alerts.push(alert);
      this.alerts = prioritizeAlerts(this.alerts);
      this.broadcast({ type: 'distress', data: { alert, analysis, directive } });
    }

    this.broadcast({ type: 'directive_response', data: directive });
    return directive;
  }

  handleDistressMessage(shipId, message) {
    const ship = this.ships.get(shipId);
    if (!ship) return;
    const analysis = analyzeDistressMessage(message, ship);
    ship.status = 'distressed';
    const alert = this.createAlert('distress', analysis.severity, shipId,
      analysis.summary, { analysis });
    this.alerts.push(alert);
    this.alerts = prioritizeAlerts(this.alerts);
    this.broadcast({ type: 'alerts', data: [alert] });
  }

  acknowledgeAlert(alertId) {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.acknowledged = true;
      alert.acknowledgedAt = Date.now();
    }
    return alert;
  }

  createAlert(type, severity, shipId, message, extra = {}) {
    return {
      id: `alert-${++this.alertIdCounter}`,
      type,
      severity,
      shipId,
      message,
      timestamp: Date.now(),
      acknowledged: false,
      ...extra,
    };
  }

  saveSnapshot() {
    const snapshot = {
      timestamp: Date.now(),
      ships: [...this.ships.values()].map(s => ({
        shipId: s.shipId,
        position: [...s.position],
        speed: s.speed,
        heading: s.heading,
        status: s.status,
        fuel: s.fuel,
        destination: s.destination,
      })),
    };
    this.history.push(snapshot);
    if (this.history.length > this.maxHistorySize) {
      this.history.shift();
    }
  }

  getHistory() {
    return this.history;
  }

  getState() {
    return {
      timestamp: Date.now(),
      navigableWater: this.navigableWater,
      boundingBox: this.boundingBox,
      ships: [...this.ships.values()].map(s => ({
        shipId: s.shipId,
        name: s.name,
        position: [...s.position],
        speed: s.speed,
        heading: s.heading,
        destination: s.destination,
        fuel: Math.round(s.fuel * 10) / 10,
        cargo: s.cargo,
        status: s.status,
        weather: s.weather,
        route: s.route,
        fuelWarning: s.fuelWarning,
      })),
      restrictedZones: this.restrictedZones,
      ports: this.ports,
      alerts: this.alerts.slice(-50),
      directives: this.directives.slice(-20),
    };
  }
}
