import { useState, useEffect, useRef, useCallback } from 'react';

export function useWebSocket(role, shipId) {
  const [connected, setConnected] = useState(false);
  const [state, setState] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [directives, setDirectives] = useState([]);
  const wsRef = useRef(null);
  const reconnectRef = useRef(null);

  const connect = useCallback(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host = window.location.host;
    let url = `${protocol}://${host}/ws?role=${role}`;
    if (shipId) url += `&shipId=${shipId}`;

    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current);
        reconnectRef.current = null;
      }
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case 'init':
          setState(msg.data);
          setAlerts(msg.data.alerts || []);
          setDirectives(msg.data.directives || []);
          break;
        case 'state_update':
          setState(prev => ({
            ...prev,
            ...msg.data,
          }));
          break;
        case 'alerts':
          setAlerts(prev => {
            const existing = new Set(prev.map(a => a.id));
            const newAlerts = msg.data.filter(a => !existing.has(a.id));
            return [...prev, ...newAlerts].slice(-100);
          });
          playAlertSound(msg.data);
          break;
        case 'zone_added':
          setState(prev => ({
            ...prev,
            restrictedZones: [...(prev?.restrictedZones || []), msg.data],
          }));
          break;
        case 'zone_removed':
          setState(prev => ({
            ...prev,
            restrictedZones: (prev?.restrictedZones || []).filter(z => z.id !== msg.data.id),
          }));
          break;
        case 'directive':
          setDirectives(prev => [...prev, msg.data]);
          break;
        case 'directive_response':
          setDirectives(prev => prev.map(d => d.id === msg.data.id ? msg.data : d));
          break;
        case 'distress':
          setAlerts(prev => [...prev, msg.data.alert].slice(-100));
          playAlertSound([msg.data.alert]);
          break;
        case 'alert_acknowledged':
          setAlerts(prev => prev.map(a => a.id === msg.data.id ? { ...a, acknowledged: true } : a));
          break;
      }
    };

    ws.onclose = () => {
      setConnected(false);
      reconnectRef.current = setTimeout(connect, 2000);
    };

    ws.onerror = () => ws.close();

    return ws;
  }, [role, shipId]);

  useEffect(() => {
    const ws = connect();
    return () => {
      ws.close();
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
    };
  }, [connect]);

  const send = useCallback((msg) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  return { connected, state, alerts, directives, send };
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
