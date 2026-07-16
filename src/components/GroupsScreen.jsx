import React, { useEffect, useRef, useState } from 'react';

// Right-pointing chevron; rotated 90deg via CSS when its group is expanded.
function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d="M9 6l6 6-6 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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

function pad2(n) {
  return String(n).padStart(2, '0');
}

// Fixed YYYY-MM-DD hh:mm (24h, local), matching DialComponent's session
// summary rather than a locale-driven format, for a consistent look.
function formatTimestamp(value) {
  if (value === null || value === undefined || value === '') {
    return '--';
  }
  const raw = Number(value);
  if (!Number.isFinite(raw)) {
    return '--';
  }
  const milliseconds = raw > 10_000_000_000 ? raw : raw * 1000;
  const date = new Date(milliseconds);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatEnergy(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return '--';
  }
  return `${Number(value).toFixed(2)} kWh`;
}

// User label for an active session, mirroring DialComponent: a Free Vending
// session shows a plain "Free vending" label rather than the charger-id tag
// it technically carries; otherwise the user name, falling back to the raw
// id tag.
function sessionUser(session) {
  if (session.isFreeVending) {
    return 'Free vending';
  }
  if (session.userName && session.userName !== 'Unknown') {
    return session.userName;
  }
  return session.idTag || '--';
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
  // Which groups are expanded (accordion-style, like balanz-ui). Groups are
  // collapsed by default so the ~20-group list stays a short, scannable set
  // of headers; the group holding the currently-selected charger is opened
  // automatically on first load so the user lands on something useful.
  const [expandedGroups, setExpandedGroups] = useState(() => new Set());
  const didInitRef = useRef(false);

  useEffect(() => {
    if (didInitRef.current || groups.length === 0) {
      return;
    }
    didInitRef.current = true;
    const selectedGroup = groups.find((group) =>
      group.chargers.some((charger) => charger.chargerId === selectedChargerId),
    );
    if (selectedGroup) {
      setExpandedGroups(new Set([selectedGroup.groupId]));
    }
  }, [groups, selectedChargerId]);

  function toggleGroup(groupId) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }

  const allExpanded = groups.length > 0 && expandedGroups.size === groups.length;

  function toggleAll() {
    setExpandedGroups(allExpanded ? new Set() : new Set(groups.map((group) => group.groupId)));
  }

  return (
    <section className="panel detail-panel groups-screen">
      <div className="section-header">
        <div>
          <p className="section-kicker">Groups</p>
          <h2>Group status</h2>
        </div>
        <div className="header-actions">
          {groups.length > 0 ? (
            <button className="ghost-button" type="button" onClick={toggleAll}>
              {allExpanded ? 'Collapse all' : 'Expand all'}
            </button>
          ) : null}
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
        {groups.map((group) => {
          const isExpanded = expandedGroups.has(group.groupId);
          const chargerCount = group.chargers.length;
          return (
          <article key={group.groupId} className="group-card">
            <button
              type="button"
              className={`group-card-header ${isExpanded ? 'is-open' : ''}`}
              onClick={() => toggleGroup(group.groupId)}
              aria-expanded={isExpanded}
            >
              <div className="group-card-heading">
                <span className="group-chevron">
                  <ChevronIcon />
                </span>
                <div>
                  <h3>{group.description || group.groupId}</h3>
                  <p className="subtle">
                    {group.groupId} · {chargerCount} charger{chargerCount === 1 ? '' : 's'}
                  </p>
                </div>
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
            </button>

            {isExpanded ? (
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
                              {charger.session ? (
                                <>
                                  <span className="charger-stat">
                                    <span className="charger-stat-label">User</span>
                                    {sessionUser(charger.session)}
                                  </span>
                                  <span className="charger-stat">
                                    <span className="charger-stat-label">Start</span>
                                    {formatTimestamp(charger.session.startTime)}
                                  </span>
                                  <span className="charger-stat">
                                    <span className="charger-stat-label">Charged</span>
                                    {formatEnergy(charger.session.energyKwh)}
                                  </span>
                                </>
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
            ) : null}
          </article>
          );
        })}
      </div>
    </section>
  );
}
