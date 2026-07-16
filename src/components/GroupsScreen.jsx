import React from 'react';

function formatAmps(value) {
  if (value === null || value === undefined) {
    return '--';
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return '--';
  }
  // Offered/max are whole amps; usage is a live meter reading that can be
  // fractional - round to 1 decimal so "12.86" doesn't crowd the compact
  // per-charger chips, while integers still render clean ("16 A", not "16.0").
  return `${Math.round(number * 10) / 10} A`;
}

// Per-charger equivalents of the group-level Max/Offered/Usage stats, read
// from the charger's active connector (offered/priority/usage) and its own
// conn_max. There is no per-charger "max now" in the Balanz model - the
// allocation ceiling is a shared group value - so the charger's own conn_max
// (its hardware/config maximum) stands in as its "Max".
function chargerStats(charger) {
  const connector = charger.activeConnector || null;
  return {
    max: charger.connMax ?? null,
    offered: connector?.offered ?? null,
    usage: charger.session?.usageMeterA ?? null,
    priority: connector?.priority ?? charger.priority ?? null,
  };
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
                        {(() => {
                          const stats = chargerStats(charger);
                          // Offered/Usage are meaningful for any charger; Max
                          // (allocation ceiling) and Priority only apply to
                          // SmartCharging (allocation) groups, so those two
                          // chips are shown only there.
                          return (
                            <div className="charger-stats">
                              {group.isAllocationGroup ? (
                                <span className="charger-stat">
                                  <span className="charger-stat-label">Max</span>
                                  {formatAmps(stats.max)}
                                </span>
                              ) : null}
                              <span className="charger-stat">
                                <span className="charger-stat-label">Offered</span>
                                {formatAmps(stats.offered)}
                              </span>
                              <span className="charger-stat">
                                <span className="charger-stat-label">Usage</span>
                                {formatAmps(stats.usage)}
                              </span>
                              {group.isAllocationGroup ? (
                                <span className="charger-stat">
                                  <span className="charger-stat-label">Priority</span>
                                  {stats.priority ?? '--'}
                                </span>
                              ) : null}
                            </div>
                          );
                        })()}
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
