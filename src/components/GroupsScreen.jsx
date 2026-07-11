import React from 'react';

function formatAmps(value) {
  if (value === null || value === undefined) {
    return '--';
  }
  return `${value} A`;
}

export default function GroupsScreen({
  groups,
  loading,
  error,
  selectedChargerId,
  onSelectCharger,
  onRefresh,
  onClose,
}) {
  return (
    <section className="panel detail-panel groups-screen">
      <div className="section-header">
        <div>
          <p className="section-kicker">Groups</p>
          <h2>Group status</h2>
        </div>
        <div className="header-actions">
          <button className="ghost-button" type="button" onClick={onRefresh} disabled={loading}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
          <button className="ghost-button" type="button" onClick={onClose}>
            Back to charger
          </button>
        </div>
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}

      {loading && groups.length === 0 ? <div className="inline-state">Loading groups...</div> : null}

      {!loading && groups.length === 0 && !error ? (
        <div className="inline-state">No groups returned by the backend.</div>
      ) : null}

      <div className="group-list">
        {groups.map((group) => (
          <article key={group.groupId} className="group-card">
            <div className="group-card-header">
              <div>
                <h3>{group.description || group.groupId}</h3>
                <p className="subtle">{group.groupId}</p>
              </div>
              {group.isAllocationGroup ? (
                <div className="group-allocation">
                  <span className="muted-chip">Max now {formatAmps(group.maxAllocationNow)}</span>
                  <span className="muted-chip">Offered {formatAmps(group.offered)}</span>
                  <span className="muted-chip">Usage {formatAmps(group.usage)}</span>
                </div>
              ) : (
                <span className="muted-chip">Not smart-charged</span>
              )}
            </div>

            <div className="charger-items">
              {group.chargers.length === 0 ? (
                <div className="inline-state">No chargers in this group.</div>
              ) : (
                group.chargers.map((charger) => {
                  const selected = charger.chargerId === selectedChargerId;
                  const isOnline = Boolean(charger.networkConnected);
                  return (
                    <button
                      key={charger.chargerId}
                      type="button"
                      className={`charger-card ${selected ? 'is-selected' : ''}`}
                      onClick={() => onSelectCharger(charger.chargerId)}
                    >
                      <div className={`status-dot ${isOnline ? 'is-online' : 'is-offline'}`} />
                      <div className="charger-copy">
                        <div className="charger-name-row">
                          <strong>{charger.alias || charger.chargerId}</strong>
                          <span className={`status-chip ${isOnline ? 'chip-online' : 'chip-offline'}`}>
                            {isOnline ? charger.status || 'Online' : 'Offline'}
                          </span>
                        </div>
                        <div className="charger-meta">
                          <span>{charger.chargerId}</span>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
