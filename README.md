# Fleet Command - Strait of Hormuz Crisis Operations

🌐 **Live Deployment URL**: [https://web-hackathon-kohl.vercel.app/](https://web-hackathon-kohl.vercel.app/)  
📦 **Source Repository**: [https://github.com/zyvn-dev/web-2](https://github.com/zyvn-dev/web-2)

Real-time fleet tracking and crisis operations system for monitoring 15 commercial cargo ships transiting the Strait of Hormuz during geopolitical instability.

---

## 📸 Interface Screenshots & Overview

| Tactical Dark Map & Fleet Overview | Emergency Alerts & AI NLP Analysis | Command Directive & Vessel Control |
|---|---|---|
| Real-world CartoDB dark map with 15 animated vessel icons, route polylines, and port markers. | AI-driven distress analysis extracting severity, injury counts, damage estimates, and required aid. | Full Fleet Command HQ & Vessel Captain role views with instant directive transmission. |

---

## Quick Start

```bash
# Clone & install dependencies
cd client && npm install && cd ..
cd server && npm install && cd ..

# Build client SPA
cd client && npm run build && cd ..

# Start Node.js server (serves build & WebSocket server at port 3001)
cd server && npm start
```

Or run locally via Docker:
```bash
docker compose up --build
```

---

## Architecture

### Backend (Node.js + Express + WebSocket)
- **Simulation Engine** (`server/src/simulation.js`): 1Hz tick-based fleet simulator advancing 15 ships along computed routes.
- **Routing** (`server/src/routing.js`): A* pathfinding on a 0.3° grid respecting navigable water boundaries and restricted red zones.
- **Weather Integration** (`server/src/weather.js`): Real-time weather from Open-Meteo API with 10-minute caching. Adverse weather applies a 30% fuel burn penalty.
- **AI/NLP Engine** (`server/src/ai.js`): Natural language distress analysis extracting severity, categories, injury counts, damage estimates, and required assistance.
- **Geospatial Utilities** (`server/src/geo.js`): Haversine distance, bearing calculation, point-in-polygon, and segment intersection checks.

### Frontend (React + Leaflet + Real-World Map Tiles)
- **Real-World Dark & Satellite Map**: Toggle between CartoDB Dark Matter, Esri Satellite Imagery, and Tactical Radar Grid.
- **Hybrid Sync Hook (`useFleetSync`)**: Automatically connects to Node WebSocket server when available, or seamlessly runs client-side simulation when deployed on Vercel.
- **Smooth 60FPS Interpolation**: `requestAnimationFrame` loop interpolating position and heading with speed clamping.
- **Proximity Warnings**: Draws red dashed lines on the map between vessels within 2km of each other.
- **Interactive Zone Drawing**: Click to place polygon vertices, double-click to finalize zone. Triggers instant geofence breach alerts & automatic vessel rerouting.
- **Timeline Playback**: Interactive scrubber and Play/Pause control for historical snapshot playback.

---

## Features

### 🚢 Ship Tracking & Telemetry
- 15 commercial vessels with position, speed, heading, fuel level, cargo type, and destination.
- Visual fuel reserve progress bars (Good / Warning / Critical).
- Position breadcrumb trails showing recent vessel path.

### 🚫 Restricted Red Zones
- Interactive polygon drawer on map.
- Automatic rerouting around active zones using A* pathfinding.
- Right-click or click zone to inspect and remove.

### 🚨 Real-time Alerts System
- **Geofence Breach**: Vessel enters restricted zone (Critical).
- **Proximity Warning**: Vessels within 2km separation (High).
- **Fuel Reserve Warnings**: Insufficient fuel (High) or Out of Fuel (Critical).
- **Stranded**: No valid route available (Critical).
- **Predictive Alert**: 5-minute dead-reckoning lookahead warning (High).
- **Distress Calls**: AI-classified captain emergency reports.
- **WebAudio Beeps**: Audible alert tones for critical/high severity with mute toggle.

### 📜 Command Directives Flow
- **Command HQ**: Issue Reroute, Hold Position, Resume, or Change Speed orders.
- **Vessel Captain**: View pending directives, 1-click Accept & Comply or Escalate Emergency.

---

## Operational Assumptions & Parameters

- **Fuel Burn Rate**: 0.15 tons / km base rate per vessel.
- **Adverse Weather Penalty**: +30% fuel burn rate during severe weather.
- **Arrival Threshold**: 2.0 km radius from destination port.
- **Proximity Threshold**: 2.0 km separation between active vessels.
- **Routing Grid Step**: 0.3° grid resolution with 120km maximum edge distance.
- **Simulation Frequency**: 1 Hz (1 update per second).

---

## License

MIT License - see [LICENSE](LICENSE) for details.
