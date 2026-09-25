import React, { useState, useCallback } from 'react';
import { useFleetSync } from './hooks/useFleetSync.js';
import FleetMap from './components/FleetMap.jsx';
import Sidebar from './components/Sidebar.jsx';
import PlaybackBar from './components/PlaybackBar.jsx';

export default function App() {
  const [role, setRole] = useState('command');
  const [captainShip, setCaptainShip] = useState('MV-1');
  const [selectedShip, setSelectedShip] = useState(null);
  const [activeTab, setActiveTab] = useState('ships');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [muted, setMuted] = useState(false);
  const [drawingMode, setDrawingMode] = useState(false);
  const [playbackMode, setPlaybackMode] = useState(false);
  const [playbackIndex, setPlaybackIndex] = useState(0);
  const [playbackHistory, setPlaybackHistory] = useState([]);
  const [showAssumptionsModal, setShowAssumptionsModal] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  const shipId = role === 'captain' ? captainShip : null;
  const { connected, isLocalEngine, state, alerts, directives, send } = useFleetSync(role, shipId, muted);

  const handleSelectShip = useCallback((id) => setSelectedShip(id), []);

  const handleAddZone = useCallback((polygon, name) => {
    send({ type: 'add_zone', data: { polygon, name } });
    setDrawingMode(false);
  }, [send]);

  const handleRemoveZone = useCallback((id) => {
    send({ type: 'remove_zone', data: { id } });
  }, [send]);

  const handleSendDirective = useCallback((shipId, directive) => {
    send({ type: 'send_directive', data: { shipId, directive } });
  }, [send]);

  const handleRespondDirective = useCallback((directiveId, response) => {
    send({ type: 'respond_directive', data: { directiveId, response } });
  }, [send]);

  const handleAcknowledgeAlert = useCallback((alertId) => {
    send({ type: 'acknowledge_alert', data: { alertId } });
  }, [send]);

  const handleDistress = useCallback((shipId, message) => {
    send({ type: 'distress_message', data: { shipId, message } });
  }, [send]);

  const handlePlayback = useCallback(() => {
    if (playbackMode) {
      setPlaybackMode(false);
      return;
    }
    const sim = window.__fleetSim;
    if (sim) {
      const history = sim.getHistory();
      if (history && history.length > 0) {
        setPlaybackHistory(history);
        setPlaybackMode(true);
        setPlaybackIndex(Math.max(0, history.length - 1));
      } else {
        alert('Historical snapshots initializing. Please wait a moment.');
      }
    } else {
      alert('Playback mode available in local browser simulation mode.');
    }
  }, [playbackMode]);

  const unacknowledgedAlerts = alerts.filter(a => !a.acknowledged);
  const criticalCount = unacknowledgedAlerts.filter(a => a.severity === 'critical').length;

  const displayState = playbackMode && playbackHistory[playbackIndex]
    ? { 
        ...state, 
        ships: playbackHistory[playbackIndex].ships.map(s => {
          const fullShip = state?.ships?.find(fs => fs.shipId === s.shipId);
          return { ...fullShip, ...s };
        })
      }
    : state;

  const normalShips = displayState?.ships?.filter(s => s.status === 'normal').length || 0;
  const reroutingShips = displayState?.ships?.filter(s => s.status === 'rerouting').length || 0;
  const emergencyShips = displayState?.ships?.filter(s => s.status === 'distressed' || s.status === 'stranded').length || 0;
  const arrivedShips = displayState?.ships?.filter(s => s.status === 'arrived').length || 0;

  // Loading Skeleton (#19)
  if (!state || !state.ships) {
    return (
      <div className="splash-screen">
        <div className="splash-spinner">◈</div>
        <h2>Initializing Fleet Telemetry Systems…</h2>
        <p>Connecting to Strait of Hormuz Crisis Command</p>
      </div>
    );
  }

  return (
    <div className="app">
      {/* Mobile Drawer Toggle Button (#29) */}
      <button 
        className="mobile-drawer-toggle"
        onClick={() => setMobileDrawerOpen(!mobileDrawerOpen)}
        aria-label="Toggle Command Control Sidebar"
      >
        {mobileDrawerOpen ? '✕ Close Sidebar' : '☰ Command Controls'}
      </button>

      {/* Control Sidebar */}
      <div className={`sidebar-wrapper ${mobileDrawerOpen ? 'mobile-open' : ''}`}>
        <Sidebar
          role={role}
          setRole={setRole}
          captainShip={captainShip}
          setCaptainShip={setCaptainShip}
          state={displayState}
          alerts={alerts}
          directives={directives}
          selectedShip={selectedShip}
          onSelectShip={handleSelectShip}
          onSendDirective={handleSendDirective}
          onRespondDirective={handleRespondDirective}
          onAcknowledgeAlert={handleAcknowledgeAlert}
          onDistress={handleDistress}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          connected={connected}
          criticalCount={criticalCount}
          unacknowledgedCount={unacknowledgedAlerts.length}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          muted={muted}
          setMuted={setMuted}
          onOpenAssumptions={() => setShowAssumptionsModal(true)}
        />
      </div>

      <div className="map-container">
        {/* Top Tactical KPI Bar (#13) */}
        <div className="top-tactical-bar">
          <div className="stats-pill-group">
            <div className="stat-pill normal" onClick={() => setStatusFilter('normal')} title="Show Normal Ships">
              <span className="dot"></span>
              <span>NORMAL: <strong>{normalShips}</strong></span>
            </div>
            <div className="stat-pill rerouting" onClick={() => setStatusFilter('rerouting')} title="Show Rerouting Ships">
              <span className="dot"></span>
              <span>REROUTING: <strong>{reroutingShips}</strong></span>
            </div>
            <div className="stat-pill emergency" onClick={() => setStatusFilter('distressed')} title="Show Emergency Ships">
              <span className="dot"></span>
              <span>EMERGENCY: <strong>{emergencyShips}</strong></span>
            </div>
            <div className="stat-pill arrived" onClick={() => setStatusFilter('arrived')} title="Show Arrived Ships">
              <span className="dot"></span>
              <span>ARRIVED: <strong>{arrivedShips}</strong></span>
            </div>
          </div>

          <div className="action-button-group">
            {role === 'command' && (
              <>
                <button
                  className={`action-btn ${drawingMode ? 'active' : ''}`}
                  onClick={() => setDrawingMode(!drawingMode)}
                  title="Draw Restricted Red Zone on Map"
                >
                  {drawingMode ? '❌ Cancel Draw' : '✏️ Draw Restricted Zone'}
                </button>
                <button 
                  className={`action-btn ${playbackMode ? 'active' : ''}`}
                  onClick={handlePlayback}
                  title="Timeline Scrubber Playback"
                >
                  {playbackMode ? '🔴 Exit Playback' : '⏮️ Playback (Space)'}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Map View */}
        <FleetMap
          state={displayState}
          selectedShip={selectedShip}
          onSelectShip={handleSelectShip}
          role={role}
          drawingMode={drawingMode}
          setDrawingMode={setDrawingMode}
          onAddZone={handleAddZone}
          onRemoveZone={handleRemoveZone}
          onClose={() => setSelectedShip(null)}
          onSendDirective={handleSendDirective}
          onDistress={handleDistress}
          searchQuery={searchQuery}
          statusFilter={statusFilter}
          playbackMode={playbackMode}
          setPlaybackMode={setPlaybackMode}
        />

        {/* Playback Scrubber Bar (#3) */}
        {playbackMode && playbackHistory.length > 0 && (
          <PlaybackBar
            history={playbackHistory}
            index={playbackIndex}
            onChange={setPlaybackIndex}
            onClose={() => setPlaybackMode(false)}
          />
        )}
      </div>

      {/* Assumptions Modal (#14) */}
      {showAssumptionsModal && (
        <div className="modal-backdrop" onClick={() => setShowAssumptionsModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>ℹ️ Operations System Parameters & Assumptions</h3>
            <div className="assumptions-list font-mono" style={{ fontSize: 12, marginTop: 12, lineHeight: 1.6 }}>
              <div>• <strong>Fuel Consumption:</strong> 0.15 tons / km base rate per vessel.</div>
              <div>• <strong>Adverse Weather Penalty:</strong> +30% fuel burn penalty in storm cells.</div>
              <div>• <strong>Arrival Radius:</strong> 2.0 km threshold from target port.</div>
              <div>• <strong>Proximity Alert Threshold:</strong> 2.0 km separation between vessels.</div>
              <div>• <strong>Routing Engine:</strong> A* grid pathfinding on 0.3° resolution grid.</div>
              <div>• <strong>Simulation Tick Rate:</strong> 1 Hz state update frequency.</div>
              <div>• <strong>AI NLP Classifier:</strong> Multi-category emergency severity extraction.</div>
            </div>
            <div style={{ marginTop: 20, textAlign: 'right' }}>
              <button className="btn btn-primary" onClick={() => setShowAssumptionsModal(false)}>
                Close Assumptions
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
