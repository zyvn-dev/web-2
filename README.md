# Fleet Command - Strait of Hormuz Crisis Operations

Real-time fleet tracking and crisis operations system for monitoring 15 commercial cargo ships transiting the Strait of Hormuz during geopolitical instability.

## Quick Start

```bash
docker compose up --build
```

Then open http://localhost:3001

## Development

```bash
# Install dependencies
cd client && npm install && cd ..
cd server && npm install && cd ..

# Build client
cd client && npm run build && cd ..

# Start server (serves built client)
cd server && npm start
```

## Architecture

### Backend (Node.js + Express + WebSocket)
- **Simulation Engine** (`server/src/simulation.js`): 1Hz tick-based fleet simulator advancing 15 ships along computed routes
- **Routing** (`server/src/routing.js`): A* pathfinding on a dynamically generated grid, respecting navigable water boundaries and restricted zones
- **Weather** (`server/src/weather.js`): Real-time weather from Open-Meteo API with caching. Adverse weather applies 30% fuel burn penalty
- **AI/NLP** (`server/src/ai.js`): Distress message analysis extracting severity, categories, injury counts, damage estimates, and required assistance
- **Geospatial** (`server/src/geo.js`): Haversine distance, bearing calculation, point-in-polygon, segment intersection

### Frontend (React + Leaflet)
- **Interactive Map**: Custom canvas tile layer (no external tile server needed), ship markers with heading indicators, route lines, port markers
- **Real-time Sync**: WebSocket connection with < 500ms state propagation
- **Smooth Interpolation**: Hermite interpolation between 1Hz updates for fluid ship movement
- **Zone Drawing**: Click to add polygon vertices, double-click to finish
- **Playback**: Timeline scrubber for last hour of fleet history at 30-second snapshots

### Real-time Communication
- WebSocket at `/ws` with role-based filtering
- Command role: full fleet visibility, zone management, directive issuance
- Captain role: single-ship view, directive response (ACCEPT / ESCALATE_DISTRESS)

## Features

### Ship Tracking
- 15 ships with position, speed, heading, fuel, cargo, destination
- Ships follow computed routes through navigable water
- Automatic rerouting when restricted zones intersect paths

### Restricted Zones
- Command draws polygonal zones on the map
- Ships inside a new zone trigger geofence breach alerts
- Automatic reroute computation avoiding all active zones
- Right-click a zone to remove it

### Alerts
- **Geofence breach**: Ship enters restricted zone (critical)
- **Proximity warning**: Two ships within 2km (high)
- **Fuel warnings**: Insufficient fuel for destination (high), out of fuel (critical)
- **Stranded**: No valid route exists (critical)
- **Distress**: AI-analyzed captain messages with severity classification
- Audible alerts for critical/high severity
- Alert acknowledgment system

### Directives (Command → Captain)
- **Reroute**: Change destination port
- **Hold Position**: Stop ship
- **Resume**: Restart movement
- **Change Speed**: Adjust ship speed
- Captain responds: ACCEPT (immediate compliance) or ESCALATE_DISTRESS (sends distress message)

### AI/NLP Distress Analysis
- Severity classification: critical, high, medium, low
- Category detection: fire, flooding, mechanical, medical, navigation, security, cargo, weather
- Quantifiable impact extraction: injury counts, damage estimates
- Assistance recommendation: medical evacuation, firefighting, towing, fuel transfer
- Urgency detection from keywords
- Feeds into alert prioritization

### Weather Integration
- Open-Meteo API for real-time weather at ship positions
- 10-minute cache to avoid rate limits
- Adverse weather detection (high wind, precipitation, storm codes)
- 30% fuel burn penalty in adverse conditions
- Weather badges on ship cards

### Playback
- State snapshots every 30 seconds
- Last hour of history retained (120 snapshots)
- Timeline scrubber in the map view

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/state` | Current fleet state |
| `GET /api/history` | Historical snapshots |
| `GET /api/ship/:id` | Single ship details |
| `GET /api/ports` | Port list |
| `GET /api/zones` | Active restricted zones |

## WebSocket Messages

### Client → Server
- `add_zone` (Command): `{ polygon, name }`
- `remove_zone` (Command): `{ id }`
- `send_directive` (Command): `{ shipId, directive: { type, data } }`
- `respond_directive` (Captain): `{ directiveId, response: { action, message? } }`
- `acknowledge_alert`: `{ alertId }`
- `distress_message` (Captain): `{ shipId, message }`

### Server → Client
- `init`: Full state on connection
- `state_update`: 1Hz fleet state
- `alerts`: New alerts
- `zone_added` / `zone_removed`: Zone changes
- `directive` / `directive_response`: Directive flow
- `distress`: AI-analyzed distress with alert

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3001` | Server port |

No API keys required. Open-Meteo is free and keyless. If the Open-Meteo API is unreachable (e.g. network restrictions), the system falls back to default clear weather conditions.

## Assumptions

- Ships burn fuel at a constant rate per km, proportional to distance traveled (0.15 tons/km base rate)
- Adverse weather is determined by wind speed > 40 km/h, gusts > 60 km/h, precipitation > 5mm, or severe weather codes
- The navigable water polygon from fleet.json defines the operational boundary
- Ships arrive when within 2km of the destination port
- Proximity warnings trigger at 2km between any two active ships
- A* routing uses a 0.3-degree grid step with 120km maximum edge length
- Weather is cached per 0.1-degree grid cell for 10 minutes
- The map uses a custom canvas tile layer since no external tile CDN is required
