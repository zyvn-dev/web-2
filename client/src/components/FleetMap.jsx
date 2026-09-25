import React, { useEffect, useRef, useMemo, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { createShipInterpolator } from '../utils/interpolation.js';

const HORMUZ_CENTER = [25.5, 55.0];
const DEFAULT_ZOOM = 7;

const STATUS_COLORS = {
  normal: '#10b981',
  rerouting: '#f59e0b',
  distressed: '#ef4444',
  stopped: '#64748b',
  arrived: '#06b6d4',
  stranded: '#dc2626',
  out_of_fuel: '#b91c1c',
  insufficient_fuel: '#f97316',
};

const OceanTileLayer = L.TileLayer.extend({
  createTile(coords) {
    const tile = document.createElement('canvas');
    tile.width = 256;
    tile.height = 256;
    const ctx = tile.getContext('2d');
    
    // Deep Ocean Slate background
    ctx.fillStyle = '#050b14';
    ctx.fillRect(0, 0, 256, 256);
    
    // Subtle tactical grid lines
    ctx.strokeStyle = 'rgba(30, 58, 110, 0.25)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i < 256; i += 32) {
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(256, i);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 256);
      ctx.stroke();
    }
    
    // Subtle latitude/longitude crosshairs
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.08)';
    ctx.beginPath();
    ctx.arc(128, 128, 2, 0, Math.PI * 2);
    ctx.stroke();
    
    return tile;
  },
});

export default function FleetMap({
  state,
  selectedShip,
  onSelectShip,
  role,
  drawingMode,
  setDrawingMode,
  onAddZone,
  onRemoveZone,
  onClose,
  onSendDirective,
  onDistress,
  searchQuery = '',
  statusFilter = 'all'
}) {
  const mapRef = useRef(null);
  const leafletMapRef = useRef(null);
  const markersRef = useRef(new Map());
  const routeLinesRef = useRef(new Map());
  const zoneLayersRef = useRef(new Map());
  const navigableLayerRef = useRef(null);
  const drawPointsRef = useRef([]);
  const drawLayerRef = useRef(null);
  const drawGuideLineRef = useRef(null);
  const interpolatorRef = useRef(createShipInterpolator());
  const animFrameRef = useRef(null);

  const [drawPointCount, setDrawPointCount] = useState(0);
  const [contextZone, setContextZone] = useState(null);

  // Initialize Map
  useEffect(() => {
    if (leafletMapRef.current || !mapRef.current) return;

    const map = L.map(mapRef.current, {
      center: HORMUZ_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: false,
      attributionControl: false,
      maxBounds: [[18, 42], [34, 64]],
      minZoom: 5,
      maxZoom: 14,
    });

    // Custom Zoom Control at bottom right
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    new OceanTileLayer('', { maxZoom: 14 }).addTo(map);

    // Realistic Persian Gulf & Strait of Hormuz Shoreline Land Polygons
    const landPolygons = [
      [[30.5, 47.5], [30.5, 48.5], [29.8, 48.6], [29.5, 48.3], [28.5, 49.0], [27.5, 49.8],
       [26.5, 50.3], [26.4, 51.5], [25.3, 52.0], [24.8, 53.0], [25.3, 54.5], [26.0, 55.5],
       [26.3, 55.9], [26.45, 56.45], [25.2, 56.5], [24.5, 57.2], [23.8, 58.8], [22.5, 60.0],
       [22.0, 60.0], [22.0, 62.0], [30.5, 62.0], [30.5, 47.5]],
      [[30.5, 47.5], [29.8, 48.6], [29.5, 50.0], [28.8, 50.8], [27.8, 52.0], [26.7, 53.5],
       [26.3, 55.0], [26.65, 56.1], [26.5, 56.4], [26.0, 56.8], [25.5, 57.5], [25.5, 58.5],
       [25.0, 60.0], [30.5, 60.0], [30.5, 47.5]],
    ];

    for (const poly of landPolygons) {
      L.polygon(poly, {
        color: '#0f172a',
        weight: 1.5,
        fillColor: '#090d16',
        fillOpacity: 0.95,
        interactive: false,
      }).addTo(map);
    }

    leafletMapRef.current = map;

    return () => {
      map.remove();
      leafletMapRef.current = null;
    };
  }, []);

  // Render Navigable Water Bounds
  useEffect(() => {
    const map = leafletMapRef.current;
    if (!map || !state?.navigableWater) return;
    if (navigableLayerRef.current) return;
    const nav = L.polygon(
      state.navigableWater.map(p => [p[0], p[1]]),
      { color: '#38bdf8', weight: 1.2, fillColor: '#0284c7', fillOpacity: 0.08, dashArray: '6,6', interactive: false }
    ).addTo(map);
    navigableLayerRef.current = nav;
  }, [state?.navigableWater]);

  // Render Port Markers
  useEffect(() => {
    const map = leafletMapRef.current;
    if (!map || !state?.ports) return;
    if (!map._portMarkers) map._portMarkers = new Map();
    for (const port of state.ports) {
      if (map._portMarkers.has(port.id)) continue;
      
      const portIcon = L.divIcon({
        className: 'port-custom-marker',
        html: `
          <div class="port-ring"></div>
          <div class="port-dot"></div>
        `,
        iconSize: [16, 16],
        iconAnchor: [8, 8]
      });

      const marker = L.marker([port.position[0], port.position[1]], { icon: portIcon }).addTo(map);
      marker.bindTooltip(`
        <div style="font-weight:700; color:#38bdf8; font-size:12px;">${port.name}</div>
        <div style="font-size:10px; color:#94a3b8;">Port ID: ${port.id}</div>
      `, {
        permanent: true,
        direction: 'top',
        className: 'port-label',
        offset: [0, -10],
      });
      map._portMarkers.set(port.id, marker);
    }
  }, [state?.ports]);

  // Feed Ship Updates to Interpolator
  useEffect(() => {
    if (!state?.ships) return;
    interpolatorRef.current.update(state.ships, state.timestamp || Date.now());
  }, [state?.ships, state?.timestamp]);

  // Render Ship Markers & Routes
  useEffect(() => {
    const map = leafletMapRef.current;
    if (!map || !state?.ships) return;

    const filteredShips = state.ships.filter(ship => {
      const matchesSearch = !searchQuery || 
        ship.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ship.shipId.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ship.cargo.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesStatus = statusFilter === 'all' || 
        (statusFilter === 'distressed' && (ship.status === 'distressed' || ship.status === 'stranded')) ||
        (statusFilter === 'rerouting' && ship.status === 'rerouting') ||
        (statusFilter === 'fuel' && (ship.status === 'insufficient_fuel' || ship.status === 'out_of_fuel' || ship.fuelWarning)) ||
        (statusFilter === 'arrived' && ship.status === 'arrived') ||
        (statusFilter === 'normal' && ship.status === 'normal');

      return matchesSearch && matchesStatus;
    });

    const activeShipIds = new Set(filteredShips.map(s => s.shipId));

    // Remove hidden markers
    for (const [id, marker] of markersRef.current) {
      if (!activeShipIds.has(id)) {
        map.removeLayer(marker);
        markersRef.current.delete(id);
        const rl = routeLinesRef.current.get(id);
        if (rl) {
          map.removeLayer(rl);
          routeLinesRef.current.delete(id);
        }
      }
    }

    for (const ship of filteredShips) {
      let marker = markersRef.current.get(ship.shipId);
      const color = STATUS_COLORS[ship.status] || '#10b981';
      const isSelected = selectedShip === ship.shipId;

      const iconHtml = createShipIcon(ship, color, isSelected);

      if (!marker) {
        const icon = L.divIcon({
          className: 'ship-marker-wrapper',
          html: iconHtml,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        });
        marker = L.marker([ship.position[0], ship.position[1]], { icon, zIndexOffset: isSelected ? 1000 : 100 });
        marker.addTo(map);
        marker.on('click', () => {
          onSelectShip(ship.shipId);
          map.flyTo([ship.position[0], ship.position[1]], Math.max(map.getZoom(), 8), { duration: 0.8 });
        });
        
        // Tooltip on Hover
        marker.bindTooltip(`
          <div style="font-weight:700; color:#f8fafc; font-size:12px;">${ship.name} (${ship.shipId})</div>
          <div style="font-size:11px; color:${color}; text-transform:uppercase; font-weight:600;">STATUS: ${ship.status}</div>
          <div style="font-size:11px; color:#cbd5e1;">Speed: ${ship.speed} kn | Fuel: ${ship.fuel?.toFixed(0)}t</div>
        `, { direction: 'right', offset: [14, 0], className: 'ship-hover-tooltip' });

        markersRef.current.set(ship.shipId, marker);
      } else {
        marker.setIcon(L.divIcon({
          className: 'ship-marker-wrapper',
          html: iconHtml,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        }));
        marker.setZIndexOffset(isSelected ? 1000 : 100);
      }

      // Render Route Lines
      let routeLine = routeLinesRef.current.get(ship.shipId);
      if (ship.route && ship.route.length > 1 && (isSelected || role === 'command')) {
        const latlngs = ship.route.map(p => [p[0], p[1]]);
        if (routeLine) {
          routeLine.setLatLngs(latlngs);
          routeLine.setStyle({
            color: isSelected ? '#38bdf8' : 'rgba(56, 189, 248, 0.35)',
            weight: isSelected ? 3 : 1.5,
            dashArray: isSelected ? '8,8' : '4,6'
          });
        } else {
          routeLine = L.polyline(latlngs, {
            color: isSelected ? '#38bdf8' : 'rgba(56, 189, 248, 0.35)',
            weight: isSelected ? 3 : 1.5,
            dashArray: isSelected ? '8,8' : '4,6',
          }).addTo(map);
          routeLinesRef.current.set(ship.shipId, routeLine);
        }
      } else if (routeLine && !isSelected && role !== 'command') {
        map.removeLayer(routeLine);
        routeLinesRef.current.delete(ship.shipId);
      }
    }
  }, [state?.ships, selectedShip, role, onSelectShip, searchQuery, statusFilter]);

  // Render Restricted Zones
  useEffect(() => {
    const map = leafletMapRef.current;
    if (!map) return;
    const zones = state?.restrictedZones || [];
    const currentIds = new Set(zones.map(z => z.id));

    for (const [id, layer] of zoneLayersRef.current) {
      if (!currentIds.has(id)) {
        map.removeLayer(layer);
        zoneLayersRef.current.delete(id);
      }
    }

    for (const zone of zones) {
      if (zoneLayersRef.current.has(zone.id)) continue;
      const polygon = L.polygon(
        zone.polygon.map(p => [p[0], p[1]]),
        { color: '#ef4444', weight: 2, fillColor: '#ef4444', fillOpacity: 0.22, dashArray: '6,6' }
      ).addTo(map);
      
      polygon.bindTooltip(`
        <div style="font-weight:700; color:#f8fafc; font-size:12px;">🚫 ${zone.name}</div>
        <div style="font-size:10px; color:#fca5a5;">Restricted Red Zone</div>
      `, { sticky: true, className: 'zone-tooltip' });

      polygon.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        if (role === 'command') {
          setContextZone(zone);
        }
      });

      zoneLayersRef.current.set(zone.id, polygon);
    }
  }, [state?.restrictedZones, role]);

  // Handle Interactive Polygon Drawing Mode
  useEffect(() => {
    const map = leafletMapRef.current;
    if (!map) return;

    if (drawingMode) {
      map.doubleClickZoom.disable();
    } else {
      map.doubleClickZoom.enable();
    }

    const onClick = (e) => {
      if (!drawingMode) return;
      const point = [e.latlng.lat, e.latlng.lng];
      drawPointsRef.current.push(point);
      setDrawPointCount(drawPointsRef.current.length);

      if (!drawLayerRef.current) {
        drawLayerRef.current = L.polygon(drawPointsRef.current, {
          color: '#f59e0b',
          weight: 2.5,
          fillColor: '#f59e0b',
          fillOpacity: 0.25,
          dashArray: '5,5'
        }).addTo(map);
      } else {
        drawLayerRef.current.setLatLngs(drawPointsRef.current);
      }
    };

    const onDblClick = (e) => {
      if (!drawingMode) return;
      L.DomEvent.stopPropagation(e);
      if (drawPointsRef.current.length >= 3) {
        const name = prompt('Enter Zone Name for Crisis Area:', `Restricted Zone Alpha-${Math.floor(Math.random()*100)}`) || 'Restricted Area';
        onAddZone(drawPointsRef.current, name);
      }
      if (drawLayerRef.current) {
        map.removeLayer(drawLayerRef.current);
        drawLayerRef.current = null;
      }
      drawPointsRef.current = [];
      setDrawPointCount(0);
      setDrawingMode(false);
    };

    const onMouseMove = (e) => {
      if (!drawingMode || drawPointsRef.current.length === 0) return;
      const lastPoint = drawPointsRef.current[drawPointsRef.current.length - 1];
      const mousePoint = [e.latlng.lat, e.latlng.lng];

      if (!drawGuideLineRef.current) {
        drawGuideLineRef.current = L.polyline([lastPoint, mousePoint], {
          color: '#f59e0b',
          weight: 1.5,
          dashArray: '4,4'
        }).addTo(map);
      } else {
        drawGuideLineRef.current.setLatLngs([lastPoint, mousePoint]);
      }
    };

    map.on('click', onClick);
    map.on('dblclick', onDblClick);
    map.on('mousemove', onMouseMove);

    if (!drawingMode) {
      if (drawLayerRef.current) {
        map.removeLayer(drawLayerRef.current);
        drawLayerRef.current = null;
      }
      if (drawGuideLineRef.current) {
        map.removeLayer(drawGuideLineRef.current);
        drawGuideLineRef.current = null;
      }
      drawPointsRef.current = [];
      setDrawPointCount(0);
    }

    return () => {
      map.off('click', onClick);
      map.off('dblclick', onDblClick);
      map.off('mousemove', onMouseMove);
    };
  }, [drawingMode, onAddZone, setDrawingMode]);

  // Smooth Interpolation Animation Loop (Position + Heading)
  useEffect(() => {
    const animate = () => {
      const now = Date.now();
      for (const [id, marker] of markersRef.current) {
        const interpolated = interpolatorRef.current.getState(id, now);
        if (interpolated) {
          marker.setLatLng([interpolated.pos[0], interpolated.pos[1]]);
          const svgEl = marker.getElement()?.querySelector('svg');
          if (svgEl) {
            svgEl.style.transform = `rotate(${interpolated.heading}deg)`;
          }
        }
      }
      animFrameRef.current = requestAnimationFrame(animate);
    };
    animFrameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, []);

  const selectedShipData = useMemo(
    () => state?.ships?.find(s => s.shipId === selectedShip),
    [state?.ships, selectedShip]
  );

  const destPort = useMemo(
    () => selectedShipData ? state?.ports?.find(p => p.id === selectedShipData.destination) : null,
    [selectedShipData, state?.ports]
  );

  return (
    <>
      <style>{`
        .ship-marker-wrapper { background: none !important; border: none !important; }
        .port-custom-marker {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .port-dot {
          width: 8px;
          height: 8px;
          background: #38bdf8;
          border-radius: 50%;
          box-shadow: 0 0 10px #38bdf8;
        }
        .port-ring {
          position: absolute;
          width: 16px;
          height: 16px;
          border: 1.5px solid rgba(56, 189, 248, 0.6);
          border-radius: 50%;
          animation: port-pulse 2s infinite ease-out;
        }
        @keyframes port-pulse {
          0% { transform: scale(0.6); opacity: 1; }
          100% { transform: scale(1.8); opacity: 0; }
        }
        .port-label {
          background: rgba(15, 23, 42, 0.9) !important;
          border: 1px solid rgba(56, 189, 248, 0.3) !important;
          color: #38bdf8 !important;
          font-size: 11px !important;
          font-weight: 600 !important;
          padding: 3px 8px !important;
          border-radius: 6px !important;
          box-shadow: 0 4px 12px rgba(0,0,0,0.5) !important;
          backdrop-filter: blur(8px);
        }
        .ship-hover-tooltip {
          background: rgba(15, 23, 42, 0.92) !important;
          border: 1px solid rgba(148, 163, 184, 0.2) !important;
          padding: 8px 12px !important;
          border-radius: 8px !important;
          box-shadow: 0 8px 24px rgba(0,0,0,0.6) !important;
        }
        .zone-tooltip {
          background: rgba(239, 68, 68, 0.9) !important;
          border: 1px solid #ef4444 !important;
          color: #fff !important;
          border-radius: 6px !important;
        }
      `}</style>
      
      <div ref={mapRef} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />

      {/* Interactive Drawing Banner */}
      {drawingMode && (
        <div className="drawing-banner">
          <span>✏️ Drawing Restricted Zone Mode Active</span>
          <span style={{ fontSize: 12, opacity: 0.8, marginLeft: 8 }}>
            Click map to add points ({drawPointCount} points). Double click to complete.
          </span>
          <button className="btn btn-sm btn-danger" onClick={() => setDrawingMode(false)} style={{ marginLeft: 12 }}>
            Cancel
          </button>
        </div>
      )}

      {/* Zone Context Modal */}
      {contextZone && (
        <div className="modal-backdrop" onClick={() => setContextZone(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>🚫 {contextZone.name}</h3>
            <p>This is an active restricted red zone in the Strait of Hormuz.</p>
            <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
              <button className="btn btn-danger" onClick={() => {
                onRemoveZone(contextZone.id);
                setContextZone(null);
              }}>
                Remove Restricted Zone
              </button>
              <button className="btn btn-secondary" onClick={() => setContextZone(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Telemetry HUD Overlay when Ship Selected */}
      {selectedShipData && (
        <div className="ship-detail-overlay animate-slide-up">
          <button className="close-btn" onClick={onClose}>&times;</button>
          
          <div className="overlay-header">
            <div>
              <h2>{selectedShipData.name}</h2>
              <span className="ship-id-badge">{selectedShipData.shipId}</span>
            </div>
            <span className={`status-badge status-${selectedShipData.status}`}>
              {selectedShipData.status.replace('_', ' ')}
            </span>
          </div>

          <div className="telemetry-grid">
            <div className="telemetry-card">
              <span className="telemetry-label">Speed</span>
              <span className="telemetry-val">{selectedShipData.speed} <small>knots</small></span>
            </div>
            <div className="telemetry-card">
              <span className="telemetry-label">Heading</span>
              <span className="telemetry-val">{selectedShipData.heading?.toFixed(0)}&deg;</span>
            </div>
            <div className="telemetry-card">
              <span className="telemetry-label">Fuel Level</span>
              <span className="telemetry-val">{selectedShipData.fuel?.toFixed(0)} <small>tons</small></span>
            </div>
            <div className="telemetry-card">
              <span className="telemetry-label">Cargo Type</span>
              <span className="telemetry-val" style={{ fontSize: 13, textTransform: 'capitalize' }}>{selectedShipData.cargo}</span>
            </div>
          </div>

          {/* Fuel Progress Bar */}
          <div className="fuel-progress-container">
            <div className="fuel-label-row">
              <span>Fuel Reserve</span>
              <span>{Math.round((selectedShipData.fuel / 10000) * 100)}%</span>
            </div>
            <div className="fuel-track">
              <div 
                className={`fuel-bar ${selectedShipData.fuel < 1000 ? 'critical' : selectedShipData.fuel < 3000 ? 'warning' : 'good'}`}
                style={{ width: `${Math.min(100, Math.max(0, (selectedShipData.fuel / 10000) * 100))}%` }}
              />
            </div>
          </div>

          {/* Weather Status */}
          <div className="weather-card-container">
            <span className="label">Current Weather:</span>
            {selectedShipData.weather ? (
              <span className={`weather-badge ${selectedShipData.weather.adverse ? 'adverse' : 'clear'}`}>
                {selectedShipData.weather.adverse ? '⚠️ Storm Warning' : '☀️ Clear Water'} &middot; {selectedShipData.weather.description}
                {selectedShipData.weather.adverse && ' (+30% Fuel Penalty)'}
              </span>
            ) : <span style={{ fontSize: 12, color: '#94a3b8' }}>Weather data active</span>}
          </div>

          <div className="detail-row">
            <span className="label">Destination Port</span>
            <span className="value" style={{ color: '#38bdf8', fontWeight: 600 }}>
              {destPort?.name || selectedShipData.destination}
            </span>
          </div>

          <div className="detail-row">
            <span className="label">Position Coordinates</span>
            <span className="value font-mono">
              {selectedShipData.position[0].toFixed(4)}&deg;N, {selectedShipData.position[1].toFixed(4)}&deg;E
            </span>
          </div>

          {/* Quick Command Actions */}
          {role === 'command' && (
            <div className="overlay-actions">
              <button 
                className="btn btn-sm btn-primary"
                onClick={() => {
                  const p = prompt(`Enter new destination port ID for ${selectedShipData.name} (e.g. MCT-1, DXB-1, SOH-1):`);
                  if (p) onSendDirective(selectedShipData.shipId, { type: 'reroute', data: { destination: p } });
                }}
              >
                Reroute
              </button>
              <button 
                className="btn btn-sm btn-warning"
                onClick={() => onSendDirective(selectedShipData.shipId, { type: 'hold_position' })}
              >
                Hold Position
              </button>
              <button 
                className="btn btn-sm btn-success"
                onClick={() => onSendDirective(selectedShipData.shipId, { type: 'resume', data: { speed: 14 } })}
              >
                Resume
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function createShipIcon(ship, color, selected) {
  const size = selected ? 32 : 24;
  const rotation = ship.heading || 0;
  return `
    <div style="width:${size}px; height:${size}px; display:flex; align-items:center; justify-content:center; position:relative;">
      ${selected ? `<div style="position:absolute; inset:-4px; border:2px solid ${color}; border-radius:50%; animation:ping 1.5s cubic-bezier(0,0,0.2,1) infinite; opacity:0.7;"></div>` : ''}
      <svg width="${size}" height="${size}" viewBox="0 0 24 24" style="transform:rotate(${rotation}deg); filter:drop-shadow(0 0 ${selected ? 8 : 4}px ${color}); transition:transform 0.2s ease-out;">
        <path d="M12 2 L7 21 L12 17 L17 21 Z" fill="${color}" stroke="${selected ? '#ffffff' : '#0f172a'}" stroke-width="${selected ? 1.5 : 1}"/>
      </svg>
    </div>
  `;
}
