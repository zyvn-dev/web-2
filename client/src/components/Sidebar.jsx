import React, { useState } from 'react';

export default function Sidebar({
  role, setRole, captainShip, setCaptainShip,
  state, alerts, directives, selectedShip, onSelectShip,
  onSendDirective, onRespondDirective, onAcknowledgeAlert, onDistress,
  activeTab, setActiveTab, connected, criticalCount, unacknowledgedCount,
  searchQuery, setSearchQuery, statusFilter, setStatusFilter, muted, setMuted
}) {
  const ships = state?.ships || [];
  const ports = state?.ports || [];

  const distressedCount = ships.filter(s => s.status === 'distressed' || s.status === 'stranded').length;
  const reroutingCount = ships.filter(s => s.status === 'rerouting').length;

  return (
    <div className="sidebar">
      {/* Top Header */}
      <div className="sidebar-header">
        <div className="title-row">
          <div>
            <h1>FLEET COMMAND</h1>
            <div className="subtitle">Strait of Hormuz Operations</div>
          </div>
          <button 
            className={`sound-btn ${muted ? 'muted' : ''}`}
            onClick={() => setMuted(!muted)}
            title={muted ? "Unmute Alerts" : "Mute Alerts"}
          >
            {muted ? '🔇' : '🔔'}
          </button>
        </div>

        <div className="connection-status">
          <span className={`connection-dot ${connected ? 'connected' : 'disconnected'}`} />
          <span>{connected ? 'LIVE TELEMETRY' : 'RECONNECTING...'}</span>
          <span className="ship-count-badge">{ships.length} VESSELS IN STRAIT</span>
        </div>
      </div>

      {/* Role & Captain Selector */}
      <div className="role-selector">
        <div className="selector-group">
          <label>OPERATIONAL ROLE:</label>
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="command">🎖️ Fleet Command HQ</option>
            <option value="captain">⚓ Vessel Captain</option>
          </select>
        </div>

        {role === 'captain' && (
          <div className="selector-group" style={{ marginTop: 8 }}>
            <label>YOUR VESSEL:</label>
            <select value={captainShip} onChange={(e) => setCaptainShip(e.target.value)}>
              {state?.ships?.map(s => (
                <option key={s.shipId} value={s.shipId}>{s.name} ({s.shipId}) - {s.cargo}</option>
              )) || <option>Loading ships...</option>}
            </select>
          </div>
        )}
      </div>

      {/* Navigation Tabs */}
      <div className="tabs">
        <button className={`tab ${activeTab === 'ships' ? 'active' : ''}`} onClick={() => setActiveTab('ships')}>
          Vessels ({ships.length})
        </button>
        <button className={`tab ${activeTab === 'alerts' ? 'active' : ''}`} onClick={() => setActiveTab('alerts')}>
          Alerts
          {unacknowledgedCount > 0 && (
            <span className={`tab-badge ${criticalCount > 0 ? 'danger' : 'warning'}`}>
              {unacknowledgedCount}
            </span>
          )}
        </button>
        <button className={`tab ${activeTab === 'directives' ? 'active' : ''}`} onClick={() => setActiveTab('directives')}>
          Orders
        </button>
      </div>

      {/* Main Tab Content */}
      <div className="sidebar-content">
        {activeTab === 'ships' && (
          <ShipList 
            ships={ships} 
            ports={ports} 
            selectedShip={selectedShip} 
            onSelectShip={onSelectShip}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            statusFilter={statusFilter}
            setStatusFilter={setStatusFilter}
            distressedCount={distressedCount}
            reroutingCount={reroutingCount}
          />
        )}

        {activeTab === 'alerts' && (
          <AlertList alerts={alerts} onAcknowledge={onAcknowledgeAlert} />
        )}

        {activeTab === 'directives' && (
          role === 'command'
            ? <DirectivePanel ships={ships} ports={ports} directives={directives} onSendDirective={onSendDirective} />
            : <CaptainPanel
                ship={ships.find(s => s.shipId === captainShip)}
                directives={directives.filter(d => d.shipId === captainShip)}
                onRespond={onRespondDirective}
                onDistress={onDistress}
                captainShip={captainShip}
              />
        )}
      </div>
    </div>
  );
}

function ShipList({ 
  ships, ports, selectedShip, onSelectShip, 
  searchQuery, setSearchQuery, statusFilter, setStatusFilter,
  distressedCount, reroutingCount 
}) {
  const filteredShips = ships.filter(ship => {
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

  return (
    <div>
      {/* Search Input */}
      <div className="search-box">
        <input 
          type="text" 
          placeholder="🔍 Search vessel, ID, or cargo..." 
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        {searchQuery && (
          <button className="clear-search" onClick={() => setSearchQuery('')}>&times;</button>
        )}
      </div>

      {/* Quick Filter Pills */}
      <div className="filter-pills">
        <button className={`pill ${statusFilter === 'all' ? 'active' : ''}`} onClick={() => setStatusFilter('all')}>
          All ({ships.length})
        </button>
        <button className={`pill warning ${statusFilter === 'distressed' ? 'active' : ''}`} onClick={() => setStatusFilter('distressed')}>
          Emergency ({distressedCount})
        </button>
        <button className={`pill reroute ${statusFilter === 'rerouting' ? 'active' : ''}`} onClick={() => setStatusFilter('rerouting')}>
          Rerouting ({reroutingCount})
        </button>
      </div>

      {/* Vessels Cards List */}
      {filteredShips.length === 0 ? (
        <div className="empty-state">No matching vessels found</div>
      ) : (
        filteredShips.map(ship => {
          const dest = ports.find(p => p.id === ship.destination);
          const isSelected = selectedShip === ship.shipId;
          return (
            <div
              key={ship.shipId}
              className={`ship-card ${isSelected ? 'selected' : ''}`}
              onClick={() => onSelectShip(ship.shipId)}
            >
              <div className="ship-card-header">
                <div>
                  <span className="ship-name">{ship.name}</span>
                  <span className="ship-id font-mono">[{ship.shipId}]</span>
                </div>
                <span className={`status-badge status-${ship.status}`}>
                  {ship.status.replace('_', ' ')}
                </span>
              </div>

              <div className="ship-card-body">
                <div className="meta-col">
                  <span className="meta-label">Cargo</span>
                  <span className="meta-val" style={{ textTransform: 'capitalize' }}>{ship.cargo}</span>
                </div>
                <div className="meta-col">
                  <span className="meta-label">Speed</span>
                  <span className="meta-val">{ship.speed} kn</span>
                </div>
                <div className="meta-col">
                  <span className="meta-label">Fuel</span>
                  <span className="meta-val">{ship.fuel?.toFixed(0)} t</span>
                </div>
                <div className="meta-col">
                  <span className="meta-label">Destination</span>
                  <span className="meta-val" style={{ color: '#38bdf8' }}>{dest?.name || ship.destination}</span>
                </div>
              </div>

              {ship.weather && (
                <div className="ship-card-weather">
                  <span className={`weather-badge ${ship.weather.adverse ? 'adverse' : 'clear'}`}>
                    {ship.weather.adverse ? '⚠️ Adverse Weather' : '☀️ Clear Water'} &middot; {ship.weather.description}
                  </span>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

function AlertList({ alerts, onAcknowledge }) {
  const sorted = [...alerts].reverse();
  return (
    <div>
      {sorted.length === 0 && <div className="empty-state">No active crisis alerts</div>}
      {sorted.map(alert => (
        <div key={alert.id} className={`alert-card ${alert.severity} ${alert.acknowledged ? 'acknowledged' : ''}`}>
          <div className="alert-header">
            <span className="alert-type">
              {alert.type === 'geofence' ? '🚫 Restricted Zone' :
               alert.type === 'proximity' ? '⚠️ Proximity Warning' :
               alert.type === 'distress' ? '🚨 Distress Call' :
               alert.type === 'fuel' ? '⛽ Fuel Warning' : alert.type}
            </span>
            <span className="alert-time font-mono">{new Date(alert.timestamp).toLocaleTimeString()}</span>
          </div>

          <div className="alert-message">{alert.message}</div>

          {alert.analysis && (
            <div className="analysis-card">
              <div className="analysis-header">🤖 AI Distress NLP Diagnostics</div>
              
              <div className="analysis-grid">
                <div className="analysis-item">
                  <span className="label">Categories:</span>
                  <span className="val" style={{ textTransform: 'capitalize' }}>
                    {alert.analysis.categories?.join(', ')}
                  </span>
                </div>

                {alert.analysis.injuryCount != null && (
                  <div className="analysis-item">
                    <span className="label">Injuries:</span>
                    <span className="val danger font-bold">{alert.analysis.injuryCount} crew members</span>
                  </div>
                )}

                {alert.analysis.damageEstimate && (
                  <div className="analysis-item">
                    <span className="label">Damage:</span>
                    <span className="val warning">{alert.analysis.damageEstimate}</span>
                  </div>
                )}

                {alert.analysis.assistanceNeeded?.length > 0 && (
                  <div className="analysis-item">
                    <span className="label">Required Assistance:</span>
                    <div className="tag-list">
                      {alert.analysis.assistanceNeeded.map(a => (
                        <span key={a} className="assist-tag">{a.replace('_', ' ')}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {!alert.acknowledged && (
            <button className="ack-btn" onClick={() => onAcknowledge(alert.id)}>
              ✓ Acknowledge Alert
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function DirectivePanel({ ships, ports, directives, onSendDirective }) {
  const [targetShip, setTargetShip] = useState('');
  const [directiveType, setDirectiveType] = useState('reroute');
  const [destination, setDestination] = useState('');
  const [speed, setSpeed] = useState(14);

  const handleSend = () => {
    if (!targetShip) return;
    const data = {};
    if (directiveType === 'reroute') data.destination = destination;
    if (directiveType === 'change_speed') data.speed = Number(speed);
    if (directiveType === 'resume') data.speed = Number(speed);
    onSendDirective(targetShip, { type: directiveType, data });
    setTargetShip('');
  };

  const pendingDirs = directives.filter(d => d.status === 'pending');
  const recentDirs = directives.filter(d => d.status !== 'pending').slice(-8).reverse();

  return (
    <div>
      <div className="directive-panel">
        <h3>Issuing Tactical Command Directive</h3>
        
        <div className="form-group">
          <label>Target Vessel:</label>
          <select value={targetShip} onChange={e => setTargetShip(e.target.value)}>
            <option value="">Select Vessel</option>
            {ships.map(s => <option key={s.shipId} value={s.shipId}>{s.name} ({s.shipId}) - {s.status}</option>)}
          </select>
        </div>

        <div className="form-group">
          <label>Order Type:</label>
          <select value={directiveType} onChange={e => setDirectiveType(e.target.value)}>
            <option value="reroute">Reroute to Port</option>
            <option value="hold_position">Hold Position (Stop Engine)</option>
            <option value="resume">Resume Navigation</option>
            <option value="change_speed">Modify Speed (Knots)</option>
          </select>
        </div>

        {directiveType === 'reroute' && (
          <div className="form-group">
            <label>Destination Port:</label>
            <select value={destination} onChange={e => setDestination(e.target.value)}>
              <option value="">Select Port</option>
              {ports.map(p => <option key={p.id} value={p.id}>{p.name} ({p.id})</option>)}
            </select>
          </div>
        )}

        {(directiveType === 'change_speed' || directiveType === 'resume') && (
          <div className="form-group">
            <label>Set Target Speed (Knots):</label>
            <input type="number" value={speed} onChange={e => setSpeed(e.target.value)} min="0" max="30" />
          </div>
        )}

        <button className="btn btn-primary" onClick={handleSend} disabled={!targetShip} style={{ width: '100%', marginTop: 8 }}>
          🚀 Transmit Order to Captain
        </button>
      </div>

      {pendingDirs.length > 0 && (
        <div className="section-block">
          <h4 className="section-title warning">Pending Captain Responses</h4>
          {pendingDirs.map(d => (
            <div key={d.id} className="pending-directive">
              <div className="directive-type">Order: {d.type.toUpperCase()}</div>
              <div className="directive-ship">Target: {ships.find(s => s.shipId === d.shipId)?.name || d.shipId}</div>
            </div>
          ))}
        </div>
      )}

      {recentDirs.length > 0 && (
        <div className="section-block">
          <h4 className="section-title">Order Audit Log</h4>
          {recentDirs.map(d => (
            <div key={d.id} className="history-directive-card">
              <div className="history-header">
                <span className="type">{d.type} &rarr; {ships.find(s => s.shipId === d.shipId)?.name || d.shipId}</span>
                <span className={`status-badge ${d.status === 'ACCEPT' ? 'status-normal' : 'status-distressed'}`}>
                  {d.status}
                </span>
              </div>
              <div className="time font-mono">{new Date(d.timestamp).toLocaleTimeString()}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CaptainPanel({ ship, directives, onRespond, onDistress, captainShip }) {
  const [distressMsg, setDistressMsg] = useState('');

  const pending = directives.filter(d => d.status === 'pending');

  const handleDistress = () => {
    if (!distressMsg.trim()) return;
    onDistress(captainShip, distressMsg);
    setDistressMsg('');
  };

  return (
    <div>
      {ship && (
        <div className="vessel-status-header">
          <h3>⚓ Vessel: {ship.name} ({ship.shipId})</h3>
          <div className="vessel-badge-row">
            <span className={`status-badge status-${ship.status}`}>{ship.status}</span>
            <span className="vessel-speed">{ship.speed} Knots</span>
            <span className="vessel-fuel">Fuel: {ship.fuel?.toFixed(0)}t</span>
          </div>
        </div>
      )}

      {pending.length > 0 ? (
        pending.map(d => (
          <div key={d.id} className="pending-directive captain-alert">
            <div className="directive-type">⚠️ DIRECTIVE FROM COMMAND HQ</div>
            <div className="directive-detail">Order Type: <strong>{d.type.toUpperCase()}</strong></div>
            {d.data?.destination && <div className="directive-detail">New Target Port: <strong>{d.data.destination}</strong></div>}
            {d.data?.speed && <div className="directive-detail">Required Speed: <strong>{d.data.speed} knots</strong></div>}
            
            <div className="directive-actions">
              <button className="btn btn-success btn-sm" onClick={() => onRespond(d.id, { action: 'ACCEPT' })}>
                ✓ Accept & Comply
              </button>
              <button className="btn btn-danger btn-sm" onClick={() => {
                const msg = prompt('Enter Distress Reason for Command HQ:', 'Severe engine room flooding, unable to maneuver!') || 'Emergency situation on board';
                onRespond(d.id, { action: 'ESCALATE_DISTRESS', message: msg });
              }}>
                🚨 Escalate Emergency
              </button>
            </div>
          </div>
        ))
      ) : (
        <div className="empty-state">No pending directives from Command HQ</div>
      )}

      {/* Distress Transmission Panel */}
      <div className="distress-input">
        <h3>🚨 Transmit Emergency Distress Message</h3>
        <p className="hint">Describe onboard conditions. Fleet AI will classify severity, injuries, and dispatch aid.</p>
        <textarea
          value={distressMsg}
          onChange={e => setDistressMsg(e.target.value)}
          placeholder="Example: Engine explosion in cargo hold 2! Taking on water rapidly with 3 injured crew members..."
        />
        <button className="btn btn-danger" onClick={handleDistress} disabled={!distressMsg.trim()}>
          📡 Send Distress Broadcast
        </button>
      </div>
    </div>
  );
}
