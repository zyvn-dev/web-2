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

let audioCtx = null;
let userHasInteracted = false;

if (typeof window !== 'undefined') {
  const registerGesture = () => {
    userHasInteracted = true;
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    window.removeEventListener('click', registerGesture);
    window.removeEventListener('keydown', registerGesture);
  };
  window.addEventListener('click', registerGesture);
  window.addEventListener('keydown', registerGesture);
}

export function playAlertSound(alerts, muted = false) {
  if (muted || !userHasInteracted) return;
  const alertArr = Array.isArray(alerts) ? alerts : [alerts];
  const hasCritical = alertArr.some(a => a.severity === 'critical');
  const hasHigh = alertArr.some(a => a.severity === 'high');
  if (!hasCritical && !hasHigh) return;

  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (hasCritical) {
      // Critical: 880 Hz, 0.2s duration (#7)
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.2);
    } else if (hasHigh) {
      // High: 660 Hz, 0.15s duration (#7)
      osc.type = 'sine';
      osc.frequency.setValueAtTime(660, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.15);
    }
  } catch (e) {
    console.warn('Audio play error:', e);
  }
}

export function useFleetSync(role, shipId, muted = false) {
  const [connected, setConnected] = useState(false);
  const [isLocalEngine, setIsLocalEngine] = useState(false);
  const [state, setState] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [directives, setDirectives] = useState([]);
  
  const wsRef = useRef(null);
  const simRef = useRef(null);
  const fallbackTimerRef = useRef(null);

  useEffect(() => {
    let ws = null;
    let isSubscribed = true;

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host = window.location.host;
    let url = `${protocol}://${host}/ws?role=${role}`;
    if (shipId) url += `&shipId=${shipId}`;

    try {
      ws = new WebSocket(url);
      wsRef.current = ws;

      fallbackTimerRef.current = setTimeout(() => {
        if (!isSubscribed) return;
        if (ws.readyState !== WebSocket.OPEN) {
          activateLocalEngine();
        }
      }, 1500);

      ws.onopen = () => {
        if (!isSubscribed) return;
        if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
        setConnected(true);
        setIsLocalEngine(false);
      };

      ws.onmessage = (event) => {
        if (!isSubscribed) return;
        try {
          const msg = JSON.parse(event.data);
          handleMessage(msg);
        } catch (e) {
          console.error('WS parse error:', e);
        }
      };

      ws.onerror = () => {
        if (!isSubscribed) return;
        activateLocalEngine();
      };

      ws.onclose = () => {
        if (!isSubscribed) return;
        activateLocalEngine();
      };
    } catch {
      activateLocalEngine();
    }

    function activateLocalEngine() {
      if (!isSubscribed) return;
      if (wsRef.current) {
        try { wsRef.current.close(); } catch {}
        wsRef.current = null;
      }
      setIsLocalEngine(true);
      setConnected(true);
      const sim = getSimulation();
      simRef.current = sim;

      let initialState = sim.getState();
      if (role === 'captain' && shipId) {
        initialState = { ...initialState, ships: initialState.ships.filter(s => s.shipId === shipId) };
      }
      setState(initialState);
      setAlerts(sim.alerts.slice());
      setDirectives(sim.directives.slice());

      const listener = (event) => {
        if (!isSubscribed) return;
        handleMessage(event);
      };

      sim.addListener(listener);
      return () => sim.removeListener(listener);
    }

    function handleMessage(msg) {
      switch (msg.type) {
        case 'init': {
          let s = msg.data;
          if (role === 'captain' && shipId && s.ships) {
            s = { ...s, ships: s.ships.filter(sh => sh.shipId === shipId) };
          }
          setState(s);
          if (msg.data.alerts) setAlerts(msg.data.alerts);
          if (msg.data.directives) setDirectives(msg.data.directives);
          break;
        }
        case 'state_update': {
          let s = msg.data;
          if (role === 'captain' && shipId && s.ships) {
            s = { ...s, ships: s.ships.filter(sh => sh.shipId === shipId) };
          }
          setState(prev => ({ ...prev, ...s }));
          break;
        }
        case 'alerts': {
          const newAlertsData = msg.data || [];
          setAlerts(prev => {
            const existing = new Set(prev.map(a => a.id));
            const newAlerts = newAlertsData.filter(a => !existing.has(a.id));
            if (newAlerts.length === 0) return prev;
            playAlertSound(newAlerts, muted);
            return [...prev, ...newAlerts].slice(-100);
          });
          break;
        }
        case 'zone_added': {
          setState(prev => prev ? {
            ...prev,
            restrictedZones: [...(prev.restrictedZones || []), msg.data],
          } : prev);
          break;
        }
        case 'zone_removed': {
          setState(prev => prev ? {
            ...prev,
            restrictedZones: (prev.restrictedZones || []).filter(z => z.id !== msg.data.id),
          } : prev);
          break;
        }
        case 'directive': {
          setDirectives(prev => [...prev, msg.data]);
          break;
        }
        case 'directive_response': {
          setDirectives(prev => prev.map(d => d.id === msg.data.id ? msg.data : d));
          break;
        }
        case 'distress': {
          if (msg.data?.alert) {
            setAlerts(prev => {
              playAlertSound([msg.data.alert], muted);
              return [...prev, msg.data.alert].slice(-100);
            });
          }
          break;
        }
        case 'alert_acknowledged': {
          setAlerts(prev => prev.map(a => a.id === msg.data.id ? { ...a, acknowledged: true } : a));
          break;
        }
      }
    }

    return () => {
      isSubscribed = false;
      if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
      if (wsRef.current) {
        try { wsRef.current.close(); } catch {}
      }
    };
  }, [role, shipId, muted]);

  const send = useCallback((msg) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
      return;
    }
    const sim = getSimulation();
    switch (msg.type) {
      case 'add_zone':
        sim.addRestrictedZone(msg.data);
        break;
      case 'remove_zone':
        sim.removeRestrictedZone(msg.data.id);
        break;
      case 'send_directive': {
        const d = sim.sendDirective(msg.data.shipId, msg.data.directive);
        if (d) setDirectives(prev => [...prev, d]);
        break;
      }
      case 'respond_directive': {
        const res = sim.respondToDirective(msg.data.directiveId, msg.data.response);
        if (res) setDirectives(prev => prev.map(d => d.id === msg.data.directiveId ? res : d));
        break;
      }
      case 'acknowledge_alert':
        sim.acknowledgeAlert(msg.data.alertId);
        setAlerts(prev => prev.map(a => a.id === msg.data.alertId ? { ...a, acknowledged: true } : a));
        break;
      case 'distress_message':
        sim.handleDistressMessage(msg.data.shipId, msg.data.message);
        break;
    }
  }, []);

  return { connected, isLocalEngine, state, alerts, directives, send };
}
