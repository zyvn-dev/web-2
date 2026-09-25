import React, { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { createShipInterpolator } from '../utils/interpolation.js';

const HORMUZ_CENTER = [25.5, 55.0];
const DEFAULT_ZOOM = 7;

// High contrast status colors (#1)
const STATUS_COLORS = {
  normal: '#22d3e6',       // High contrast cyan
  rerouting: '#f59e0b',    // High contrast amber
  distressed: '#ef4444',   // High contrast red
  stopped: '#64748b',
  arrived: '#06b6d4',
  stranded: '#ef4444',
  out_of_fuel: '#ef4444',
  insufficient_fuel: '#f59e0b',
};

// Tactical Ocean Canvas Layer
const OceanCanvasLayer = L.TileLayer.extend({
  createTile() {
    const tile = document.createElement('canvas');
    tile.width = 256;
    tile.height = 256;
    const ctx = tile.getContext('2d');
    ctx.fillStyle = '#050b14';
    ctx.fillRect(0, 0, 256, 256);
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
  statusFilter = 'all',
  playbackMode,
  setPlaybackMode
}) {
  const mapRef = useRef(null);
  const leafletMapRef = useRef(null);
  const tileLayerRef = useRef(null);
  const markersRef = useRef(new Map());
  const routeLinesRef = useRef(new Map());
  const trailLinesRef = useRef(new Map());
  const proximityLinesRef = useRef(new Map());
  const zoneLayersRef = useRef(new Map());
  const weatherLayersRef = useRef(new Map());
  const navigableLayerRef = useRef(null);
  const drawPointsRef = useRef([]);
  const drawLayerRef = useRef(null);
  const drawGuideLineRef = useRef(null);
  const interpolatorRef = useRef(createShipInterpolator());
  const animFrameRef = useRef(null);

  const [mapStyle, setMapStyle] = useState('dark'); // 'dark' (CARTO) | 'osm' | 'satellite' | 'canvas'
  const [drawPointCount, setDrawPointCount] = useState(0);
  const [contextZone, setContextZone] = useState(null);
  const [zoomLevel, setZoomLevel] = useState(DEFAULT_ZOOM);

  // Initialize Map & Tile Layer
  useEffect(() => {
    if (leafletMapRef.current || !mapRef.current) return;

    const map = L.map(mapRef.current, {
      center: HORMUZ_CENTER,
      zoom: DEFAULT_ZOOM,
      zoomControl: false,
      attributionControl: false,
      maxBounds: [[18, 42], [34, 64]],
      minZoom: 5,
      maxZoom: 19,
    });

    // Custom Ship Pane with higher z-index (650) to guarantee marker visibility above overlay pane (#1)
    const shipPane = map.createPane('shipPane');
    shipPane.style.zIndex = '650';

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // CARTO Dark Matter raster tiles default (#2)
    const darkTile = L.tileLayer('https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    });
    darkTile.addTo(map);
    tileLayerRef.current = darkTile;

    map.on('zoomend', () => {
      setZoomLevel(map.getZoom());
    });

    // Window Resize listener (#28 / #17)
    const handleResize = () => {
      if (leafletMapRef.current) leafletMapRef.current.invalidateSize();
    };
    window.addEventListener('resize', handleResize);

    // Shoreline Land Polygons Layer
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
        weight: 1,
        fillColor: '#090d16',
        fillOpacity: 0.25,
        interactive: false,
      }).addTo(map);
    }

    leafletMapRef.current = map;

    return () => {
      window.removeEventListener('resize', handleResize);
      map.remove();
      leafletMapRef.current = null;
    };
  }, []);

  // Open Tile Layer Provider Switcher (#2 - CARTO Dark Matter / OpenStreetMap / Esri World Imagery)
  useEffect(() => {
    const map = leafletMapRef.current;
    if (!map) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }

    if (mapStyle === 'dark') {
      tileLayerRef.current = L.tileLayer('https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
      }).addTo(map);
    } else if (mapStyle === 'osm') {
      tileLayerRef.current = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(map);
    } else if (mapStyle === 'satellite') {
      tileLayerRef.current = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 18,
        attribution: 'Tiles &copy; Esri'
      }).addTo(map);
    } else {
      tileLayerRef.current = new OceanCanvasLayer('', { maxZoom: 14 }).addTo(map);
    }
  }, [mapStyle]);

  // Keyboard Shortcuts (#24)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

      if (e.code === 'Space') {
        e.preventDefault();
        setPlaybackMode(prev => !prev);
      } else if (e.code === 'Escape') {
        if (drawingMode) setDrawingMode(false);
        if (selectedShip) onClose();
        if (contextZone) setContextZone(null);
      } else if (e.code === 'Delete' || e.code === 'Backspace') {
        if (contextZone && role === 'command') {
          onRemoveZone(contextZone.id);
          setContextZone(null);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [drawingMode, selectedShip, contextZone, role, onClose, onRemoveZone, setDrawingMode, setPlaybackMode]);

  // Render Navigable Water Bounds
  useEffect(() => {
    const map = leafletMapRef.current;
    if (!map || !state?.navigableWater) return;
    if (navigableLayerRef.current) return;
    const nav = L.polygon(
      state.navigableWater.map(p => [p[0], p[1]]),
      { color: '#38bdf8', weight: 1.2, fillColor: '#0284c7', fillOpacity: 0.06, dashArray: '6,6', interactive: false }
    ).addTo(map);
    navigableLayerRef.current = nav;
  }, [state?.navigableWater]);

  // Render Ports with Non-Permanent Zoom Threshold (#13)
  useEffect(() => {
    const map = leafletMapRef.current;
    if (!map || !state?.ports) return;
    if (!map._portMarkers) map._portMarkers = new Map();

    const showPermanent = zoomLevel >= 7;

    for (const port of state.ports) {
      let marker = map._portMarkers.get(port.id);
      if (!marker) {
        const portIcon = L.divIcon({
          className: 'port-custom-marker',
          html: `<div class="port-ring"></div><div class="port-dot"></div>`,
          iconSize: [16, 16],
          iconAnchor: [8, 8]
        });
        marker = L.marker([port.position[0], port.position[1]], { icon: portIcon }).addTo(map);
        map._portMarkers.set(port.id, marker);
      }

      marker.unbindTooltip();
      marker.bindTooltip(`
        <div style="font-weight:700; color:#38bdf8; font-size:12px;">⚓ ${port.name}</div>
        <div style="font-size:10px; color:#94a3b8;">Port ID: ${port.id}</div>
      `, {
        permanent: showPermanent,
        direction: 'top',
        className: 'port-label',
        offset: [0, -10],
      });
    }
  }, [state?.ports, zoomLevel]);

  // Feed Ships to Interpolator (#6)
  useEffect(() => {
    if (!state?.ships) return;
    interpolatorRef.current.update(state.ships, state.timestamp || Date.now());
  }, [state?.ships, state?.timestamp]);

  // Render Ship Markers (#1), Proximity Hysteresis Lines (#8), Position Trails (#14), Weather Overlays (#9)
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

    // Clean up hidden markers
    for (const [id, marker] of markersRef.current) {
      if (!activeShipIds.has(id)) {
        map.removeLayer(marker);
        markersRef.current.delete(id);
        const rl = routeLinesRef.current.get(id);
        if (rl) { map.removeLayer(rl); routeLinesRef.current.delete(id); }
        const tr = trailLinesRef.current.get(id);
        if (tr) { map.removeLayer(tr); trailLinesRef.current.delete(id); }
      }
    }

    // Render Vessel Markers (#1)
    for (const ship of filteredShips) {
      let marker = markersRef.current.get(ship.shipId);
      const color = STATUS_COLORS[ship.status] || '#22d3e6';
      const isSelected = selectedShip === ship.shipId;
      const iconHtml = createShipIcon(ship, color, isSelected);

      if (!marker) {
        const icon = L.divIcon({
          className: 'ship-marker-wrapper',
          html: iconHtml,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        });

        marker = L.marker([ship.position[0], ship.position[1]], {
          icon,
          pane: 'shipPane', // Uses custom z-index 650 pane (#1)
          zIndexOffset: isSelected ? 1000 : 100,
          keyboard: true,
          title: `${ship.name} (${ship.shipId})`
        });

        marker.addTo(map);

        marker.on('click', () => {
          onSelectShip(ship.shipId);
          map.flyTo([ship.position[0], ship.position[1]], Math.max(map.getZoom(), 8), { duration: 0.8 });
        });

        marker.bindTooltip(`
          <div style="font-weight:700; color:#f8fafc; font-size:12px;">🚢 ${ship.name} (${ship.shipId})</div>
          <div style="font-size:11px; color:${color}; text-transform:uppercase; font-weight:700;">STATUS: ${ship.status.replace('_', ' ')}</div>
          <div style="font-size:11px; color:#cbd5e1;">Speed: ${ship.speed} kn | Fuel: ${ship.fuel?.toFixed(0)}t</div>
          <div style="font-size:10px; color:#94a3b8;">Destination: ${ship.destination}</div>
        `, { direction: 'right', offset: [14, 0], className: 'ship-hover-tooltip' });

        markersRef.current.set(ship.shipId, marker);
      } else {
        marker.setLatLng([ship.position[0], ship.position[1]]);
        marker.setIcon(L.divIcon({
          className: 'ship-marker-wrapper',
          html: iconHtml,
          iconSize: [32, 32],
          iconAnchor: [16, 16],
        }));
        marker.setZIndexOffset(isSelected ? 1000 : 100);
      }

      // Render Planned Route Lines
      let routeLine = routeLinesRef.current.get(ship.shipId);
      if (ship.route && ship.route.length > 1 && (isSelected || role === 'command')) {
        const latlngs = ship.route.map(p => [p[0], p[1]]);
        if (routeLine) {
          routeLine.setLatLngs(latlngs);
          routeLine.setStyle({
            color: isSelected ? '#22d3e6' : 'rgba(34, 211, 230, 0.35)',
            weight: isSelected ? 3 : 1.5,
            dashArray: isSelected ? '8,8' : '4,6'
          });
        } else {
          routeLine = L.polyline(latlngs, {
            color: isSelected ? '#22d3e6' : 'rgba(34, 211, 230, 0.35)',
            weight: isSelected ? 3 : 1.5,
            dashArray: isSelected ? '8,8' : '4,6',
          }).addTo(map);
          routeLinesRef.current.set(ship.shipId, routeLine);
        }
      } else if (routeLine && !isSelected && role !== 'command') {
        map.removeLayer(routeLine);
        routeLinesRef.current.delete(ship.shipId);
      }

      // Render Position Trail for Selected Ship (#14 - fading opacity over last 20 positions)
      let trailLine = trailLinesRef.current.get(ship.shipId);
      if (isSelected && ship.positionHistory && ship.positionHistory.length > 1) {
        const trailLatLngs = ship.positionHistory.map(p => [p[0], p[1]]);
        if (trailLine) {
          trailLine.setLatLngs(trailLatLngs);
        } else {
          trailLine = L.polyline(trailLatLngs, {
            color: '#22d3e6',
            weight: 2.5,
            dashArray: '3,3',
            opacity: 0.75
          }).addTo(map);
          trailLinesRef.current.set(ship.shipId, trailLine);
        }
      } else if (trailLine && !isSelected) {
        map.removeLayer(trailLine);
        trailLinesRef.current.delete(ship.shipId);
      }

      // Render Adverse Weather Red Overlay Circles (#9)
      let wLayer = weatherLayersRef.current.get(ship.shipId);
      if (ship.weather?.adverse) {
        if (!wLayer) {
          wLayer = L.circle([ship.position[0], ship.position[1]], {
            radius: 12000,
            color: '#ef4444',
            fillColor: '#ef4444',
            fillOpacity: 0.18,
            weight: 1.5,
            dashArray: '4,4'
          }).addTo(map);
          wLayer.bindTooltip('🌧️ Storm Cell / Adverse Weather Area', { sticky: true });
          weatherLayersRef.current.set(ship.shipId, wLayer);
        } else {
          wLayer.setLatLng([ship.position[0], ship.position[1]]);
        }
      } else if (wLayer) {
        map.removeLayer(wLayer);
        weatherLayersRef.current.delete(ship.shipId);
      }
    }

    // Console validation check for marker rendering (#1)
    if (filteredShips.length > 0 && markersRef.current.size === 0) {
      console.warn('Warning: markersRef.size === 0 after ships loaded!');
    }

    // Proximity Lines with Hysteresis (#8: draw at <= 2.0km, remove at > 2.3km)
    const activePairs = new Set();
    const shipsList = filteredShips;
    for (let i = 0; i < shipsList.length; i++) {
      for (let j = i + 1; j < shipsList.length; j++) {
        const s1 = shipsList[i];
        const s2 = shipsList[j];
        if (s1.status === 'arrived' || s2.status === 'arrived') continue;
        
        const dLat = s2.position[0] - s1.position[0];
        const dLng = s2.position[1] - s1.position[1];
        const km = Math.sqrt(dLat * dLat + dLng * dLng) * 111;

        const pairId = [s1.shipId, s2.shipId].sort().join('-');
        const existingLine = proximityLinesRef.current.get(pairId);

        // Hysteresis threshold: enter at 2.0km, exit at 2.3km
        const isClose = existingLine ? (km <= 2.3) : (km <= 2.0);

        if (isClose) {
          activePairs.add(pairId);
          const linePos = [[s1.position[0], s1.position[1]], [s2.position[0], s2.position[1]]];

          if (existingLine) {
            existingLine.setLatLngs(linePos);
          } else {
            const pLine = L.polyline(linePos, {
              color: '#ef4444',
              weight: 2.5,
              dashArray: '6,6',
              className: 'proximity-line-pulse'
            }).addTo(map);
            pLine.bindTooltip(`⚠️ Proximity Warning (${km.toFixed(2)}km)`, { sticky: true });
            proximityLinesRef.current.set(pairId, pLine);
          }
        }
      }
    }

    // Remove lines exceeding 2.3km hysteresis
    for (const [pairId, pLine] of proximityLinesRef.current) {
      if (!activePairs.has(pairId)) {
        map.removeLayer(pLine);
        proximityLinesRef.current.delete(pairId);
      }
    }

  }, [state?.ships, selectedShip, role, onSelectShip, searchQuery, statusFilter]);

  // Render Restricted Red Zones (#2, #22)
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
        { color: '#ef4444', weight: 2.5, fillColor: '#dc2626', fillOpacity: 0.25, dashArray: '6,6' }
      ).addTo(map);

      polygon.bindTooltip(`
        <div style="font-weight:800; color:#ffffff; font-size:12px;">🚫 ${zone.name}</div>
        <div style="font-size:10px; color:#fca5a5;">Restricted Red Zone (Click to inspect/delete)</div>
      `, { sticky: true, className: 'zone-tooltip' });

      polygon.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        setContextZone(zone);
      });

      zoneLayersRef.current.set(zone.id, polygon);
    }
  }, [state?.restrictedZones]);

  // Interactive Polygon Drawing Mode (#2, #5)
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

  // Smooth Interpolation Loop (#6)
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
          background: rgba(15, 23, 42, 0.92) !important;
          border: 1px solid rgba(56, 189, 248, 0.3) !important;
          color: #38bdf8 !important;
          font-size: 11px !important;
          font-weight: 700 !important;
          padding: 3px 8px !important;
          border-radius: 6px !important;
          box-shadow: 0 4px 12px rgba(0,0,0,0.5) !important;
          backdrop-filter: blur(8px);
        }
        .ship-hover-tooltip {
          background: rgba(15, 23, 42, 0.94) !important;
          border: 1px solid rgba(148, 163, 184, 0.25) !important;
          padding: 8px 12px !important;
          border-radius: 8px !important;
          box-shadow: 0 8px 24px rgba(0,0,0,0.6) !important;
        }
        .zone-tooltip {
          background: rgba(220, 38, 38, 0.95) !important;
          border: 1px solid #ef4444 !important;
          color: #fff !important;
          border-radius: 6px !important;
        }
        .proximity-line-pulse {
          animation: pulse-glow 1.2s ease-in-out infinite;
        }
        .map-style-selector {
          position: absolute;
          bottom: 24px;
          right: 60px;
          z-index: 1000;
          display: flex;
          gap: 4px;
          background: rgba(11, 19, 41, 0.92);
          border: 1px solid var(--border-light);
          padding: 4px;
          border-radius: 8px;
          backdrop-filter: blur(12px);
          box-shadow: 0 8px 24px rgba(0,0,0,0.6);
        }
        .style-btn {
          padding: 5px 10px;
          font-size: 11px;
          font-weight: 700;
          border: none;
          background: none;
          color: var(--text-muted);
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s;
        }
        .style-btn.active {
          background: var(--accent);
          color: #050914;
        }
        .style-btn:hover:not(.active) {
          color: var(--text-primary);
          background: rgba(255,255,255,0.06);
        }
      `}</style>
      
      <div ref={mapRef} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />

      {/* Open Tile Layer Switcher (#2 - CARTO Dark Matter / OpenStreetMap / Esri Satellite / Radar Grid) */}
      <div className="map-style-selector">
        <button 
          className={`style-btn ${mapStyle === 'dark' ? 'active' : ''}`}
          onClick={() => setMapStyle('dark')}
          title="CARTO Dark Matter Map"
        >
          🌑 Dark Carto
        </button>
        <button 
          className={`style-btn ${mapStyle === 'satellite' ? 'active' : ''}`}
          onClick={() => setMapStyle('satellite')}
          title="Esri World Satellite Imagery"
        >
          🛰️ Satellite
        </button>
        <button 
          className={`style-btn ${mapStyle === 'osm' ? 'active' : ''}`}
          onClick={() => setMapStyle('osm')}
          title="OpenStreetMap Standard"
        >
          🗺️ OpenStreetMap
        </button>
        <button 
          className={`style-btn ${mapStyle === 'canvas' ? 'active' : ''}`}
          onClick={() => setMapStyle('canvas')}
          title="Tactical Ocean Grid"
        >
          🌐 Radar Grid
        </button>
      </div>

      {/* Interactive Drawing Mode Banner (#2, #5) */}
      {drawingMode && (
        <div className="drawing-banner animate-slide-up">
          <span>✏️ Drawing Restricted Zone Mode Active</span>
          <span style={{ fontSize: 12, opacity: 0.9, marginLeft: 8 }}>
            Click map for vertices ({drawPointCount} points). Double click to close polygon.
          </span>
          <button className="btn btn-sm btn-danger" onClick={() => setDrawingMode(false)} style={{ marginLeft: 12 }}>
            Cancel (Esc)
          </button>
        </div>
      )}

      {/* Zone Context Modal */}
      {contextZone && (
        <div className="modal-backdrop" onClick={() => setContextZone(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>🚫 {contextZone.name}</h3>
            <p>Designated High-Risk Restricted Red Zone in the Strait of Hormuz.</p>
            <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
              {role === 'command' && (
                <button className="btn btn-danger" onClick={() => {
                  onRemoveZone(contextZone.id);
                  setContextZone(null);
                }}>
                  🗑️ Remove Zone (Del)
                </button>
              )}
              <button className="btn btn-secondary" onClick={() => setContextZone(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Telemetry HUD Overlay when Ship Selected (#8, #14) */}
      {selectedShipData && (
        <div className="ship-detail-overlay animate-slide-up">
          <button className="close-btn" onClick={onClose} aria-label="Close ship detail overlay">&times;</button>
          
          <div className="overlay-header">
            <div>
              <h2>{selectedShipData.name}</h2>
              <span className="ship-id-badge font-mono">{selectedShipData.shipId}</span>
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

          {/* Weather Status (#9) */}
          <div className="weather-card-container">
            <span className="label">Current Weather:</span>
            {selectedShipData.weather ? (
              <span className={`weather-badge ${selectedShipData.weather.adverse ? 'adverse' : 'clear'}`}>
                {selectedShipData.weather.adverse ? '⚠️ Storm Cell Alert' : '☀️ Clear Sea'} &middot; {selectedShipData.weather.description}
                {selectedShipData.weather.adverse && ' (+30% Fuel Penalty)'}
              </span>
            ) : <span style={{ fontSize: 12, color: '#94a3b8' }}>Weather active</span>}
          </div>

          <div className="detail-row">
            <span className="label">Destination Port</span>
            <span className="value" style={{ color: '#22d3e6', fontWeight: 600 }}>
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
    <div 
      tabindex="0"
      role="button"
      aria-label="Vessel ${ship.name} ID ${ship.shipId} Status ${ship.status}"
      style="width:${size}px; height:${size}px; display:flex; align-items:center; justify-content:center; position:relative; outline:none;"
    >
      ${selected ? `<div style="position:absolute; inset:-4px; border:2px solid ${color}; border-radius:50%; animation:ping 1.5s cubic-bezier(0,0,0.2,1) infinite; opacity:0.7;"></div>` : ''}
      <svg width="${size}" height="${size}" viewBox="0 0 24 24" style="transform:rotate(${rotation}deg); filter:drop-shadow(0 0 ${selected ? 8 : 4}px ${color}); transition:transform 0.2s ease-out;">
        <path d="M12 2 L7 21 L12 17 L17 21 Z" fill="${color}" stroke="${selected ? '#ffffff' : '#050b14'}" stroke-width="${selected ? 1.5 : 1.2}"/>
      </svg>
    </div>
  `;
}
