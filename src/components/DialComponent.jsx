import React, { useState } from 'react';

import { canControlCharging, canSetChargePriority } from '../apiClient';
import ChargingDial from './ChargingDial';
import ChargingHistoryChart from './ChargingHistoryChart';
import './DialStyles.css';

// Balanz reports current draw in Amps only (no voltage/phase count in the
// model), so "power" is an estimate. Defaults assume a 230V phase voltage on
// a 3-phase connection (EU convention: P = phases x V x I, see balanz's own
// SmartCharging docs). Override with VITE_ASSUMED_VOLTAGE_V / VITE_ASSUMED_PHASES
// if a site differs.
const ASSUMED_VOLTAGE_V = Number(import.meta.env.VITE_ASSUMED_VOLTAGE_V) || 230;
const ASSUMED_PHASES = Number(import.meta.env.VITE_ASSUMED_PHASES) || 3;

// Minimum non-zero current the dial can be dragged to - 0A is also allowed
// (see ChargingDial's snapToAllowedValue), just nothing in between.
const MIN_DIRECT_CURRENT_A = 6;

function pad2(n) {
  return String(n).padStart(2, '0');
}

// Fixed YYYY-MM-DD hh:mm format (24h, local time) rather than locale-driven
// formatting, for a consistent, unambiguous display regardless of device
// locale settings.
function formatTimestamp(value) {
  if (!value && value !== 0) {
    return '--';
  }
  const raw = Number(value);
  if (!Number.isFinite(raw)) {
    return String(value);
  }
  const milliseconds = raw > 10_000_000_000 ? raw : raw * 1000;
  const date = new Date(milliseconds);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatMetric(value, suffix = '', precision = null) {
  if (value === null || value === undefined || value === '') {
    return '--';
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const digits = precision ?? (Math.abs(value) >= 10 ? 1 : 2);
    return `${value.toFixed(digits)}${suffix}`;
  }
  return `${value}${suffix}`;
}

function statusTone(status) {
  switch (String(status || '').toLowerCase()) {
    case 'charging':
      return 'tone-charging';
    case 'available':
      return 'tone-available';
    case 'preparing':
      return 'tone-preparing';
    case 'finishing':
      return 'tone-finishing';
    case 'suspendedev':
    case 'suspendedevse':
      return 'tone-suspended';
    case 'faulted':
      return 'tone-error';
    default:
      return 'tone-neutral';
  }
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" />
    </svg>
  );
}

// Same path data as @mui/icons-material's QueryStatsIcon, which balanz-ui
// uses for its own charging-history trigger (see ChargingHistory.tsx) - kept
// as a plain inline SVG here rather than pulling in the MUI icon package,
// since this app otherwise has no MUI dependency.
function QueryStatsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        fill="currentColor"
        d="M19.88 18.47c.44-.7.7-1.51.7-2.39 0-2.49-2.01-4.5-4.5-4.5s-4.5 2.01-4.5 4.5 2.01 4.5 4.49 4.5c.88 0 1.7-.26 2.39-.7L21.58 23 23 21.58zm-3.8.11c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5m-.36-8.5c-.74.02-1.45.18-2.1.45l-.55-.83-3.8 6.18-3.01-3.52-3.63 5.81L1 17l5-8 3 3.5L13 6zm2.59.5c-.64-.28-1.33-.45-2.05-.49L21.38 2 23 3.18z"
      />
    </svg>
  );
}

export default function DialComponent({
  charger,
  loading,
  saving,
  draftMaxCurrent,
  onDraftMaxCurrentChange,
  onApplyMaxCurrent,
  onStartTransaction,
  onStopTransaction,
  isAllocationGroup,
  userType,
  draftPriority,
  onDraftPriorityChange,
  onApplyPriority,
}) {
  const [graphOpen, setGraphOpen] = useState(false);
  const [startModalOpen, setStartModalOpen] = useState(false);
  const [startTagInput, setStartTagInput] = useState('');

  const session = charger.session || null;
  const connector = charger.activeConnector || null;
  const tone = statusTone(charger.status);

  const baseline = connector?.offered ?? charger.connMax ?? 16;
  const draftValue = Number(draftMaxCurrent ?? baseline);

  const priorityBaseline = connector?.priority ?? charger.priority ?? 1;
  const draftPriorityValue = Number(draftPriority ?? priorityBaseline);
  const hasPendingPriorityChange = Number(priorityBaseline) !== draftPriorityValue;

  const history = Array.isArray(session?.chargingHistory) ? session.chargingHistory : [];
  // Graph access isn't Admin-gated (unlike Start/Stop) - anyone who can see
  // a session with history can view its graph, so this sits in the same
  // transport row as Play/Stop but is shown independently of isAdmin.
  const hasGraphAccess = history.length > 0;

  const estimatedPowerKw =
    session && session.usageMeterA !== null
      ? (session.usageMeterA * ASSUMED_VOLTAGE_V * ASSUMED_PHASES) / 1000
      : null;

  // Starting/stopping a session (and, separately, adjusting its current
  // limit) are Admin-only actions - see "Group types & permissions" in the
  // README and balanz/api.py's API_ALLOW, which doesn't list either
  // RemoteStartTransaction or RemoteStopTransaction for any other role.
  const canStop = Boolean(session && connector?.transactionId);
  const isAdmin = canControlCharging(userType);
  const canPrioritize = canSetChargePriority(userType);
  // Direct current-limit control only makes sense outside SmartCharging
  // groups (Balanz's own allocation loop owns the offer there).
  const isDirectControl = canStop && !isAllocationGroup && isAdmin;

  const userDisplay = session
    ? session.isFreeVending
      ? null
      : session.userName && session.userName !== 'Unknown'
        ? session.userName
        : session.idTag || '--'
    : '--';

  // Charger/connector status, shown as a small colored pill inside the dial
  // (like a thermostat's mode pill). Network link status stays up on the
  // charger name row (see hero-name-row below), not in the dial.
  const badges = [{ label: charger.status || 'Unknown', tone }];

  // While the user is dragging the dial to set a new limit, the ring itself
  // tracks that pending value so the handle follows the drag exactly;
  // otherwise it shows the real, backend-confirmed offer.
  const ringValue = isDirectControl ? draftValue : connector?.offered ?? 0;

  const controlHint = isAdmin
    ? null
    : canStop
      ? 'Stopping this session requires an Admin account.'
      : 'Start a session at the charger, or ask an admin to start one remotely.';

  function openStartModal() {
    setStartTagInput(charger.chargerId || '');
    setStartModalOpen(true);
  }

  function handleStartSubmit(event) {
    event.preventDefault();
    const trimmed = startTagInput.trim();
    if (!trimmed) {
      return;
    }
    onStartTransaction(trimmed);
    setStartModalOpen(false);
  }

  return (
    <div className="charger-overview">
      <section className="section-card overview-card">
        <div className="hero-copy">
          <div className="hero-name-row">
            <h2>{charger.alias}</h2>
            <div className="hero-name-indicators">
              {loading ? <span className="muted-chip">Refreshing</span> : null}
              <span
                className={`status-dot ${charger.networkConnected ? 'is-online' : 'is-offline'}`}
                role="img"
                aria-label={charger.networkConnected ? 'Network connected' : 'Network offline'}
                title={charger.networkConnected ? 'Network connected' : 'Network offline'}
              />
            </div>
          </div>
          <p className="hero-subtitle">{charger.description || 'No description provided'}</p>
          <div className="hero-meta">
            <span>
              <code>{charger.chargerId}</code>
            </span>
            <span>{charger.groupId || 'Ungrouped'}</span>
            {isAllocationGroup ? <span>Priority {connector?.priority ?? charger.priority ?? '--'}</span> : null}
          </div>
        </div>

        <div className="dial-section">
          <ChargingDial
            value={ringValue}
            max={charger.connMax}
            tone={tone}
            badges={badges}
            primaryValue={formatMetric(session?.usageMeterA, '', 1)}
            primaryUnit="A"
            secondaryValue={session ? formatMetric(estimatedPowerKw, '', 1) : null}
            secondaryUnit="kW"
            footerLabel="Offered"
            footerValue={`${formatMetric(connector?.offered, '', 0)}/${formatMetric(charger.connMax, '', 0)}`}
            footerUnit="A"
            interactive={isDirectControl}
            interactiveMin={MIN_DIRECT_CURRENT_A}
            onInteractiveChange={onDraftMaxCurrentChange}
            onInteractiveCommit={
              isDirectControl
                ? (finalValue) => {
                    // Skip a no-op apply if the user just tapped/released
                    // without actually moving away from the current value.
                    if (Number(finalValue) !== Number(baseline)) {
                      onApplyMaxCurrent(finalValue);
                    }
                  }
                : undefined
            }
          />

          {isDirectControl ? (
            <div className="dial-readout">
              <span>Max current</span>
              <output>{draftValue} A</output>
            </div>
          ) : null}

          {isAdmin || hasGraphAccess ? (
            <div className="dial-transport-row">
              {isAdmin ? (
                canStop ? (
                  <button
                    type="button"
                    className="icon-button icon-button-stop"
                    onClick={onStopTransaction}
                    disabled={saving || loading}
                    aria-label="Stop charging"
                    title="Stop charging"
                  >
                    <StopIcon />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="icon-button icon-button-play"
                    onClick={openStartModal}
                    disabled={saving || loading}
                    aria-label="Start charging"
                    title="Start charging"
                  >
                    <PlayIcon />
                  </button>
                )
              ) : null}

              {hasGraphAccess ? (
                <button
                  type="button"
                  className="icon-button icon-button-graph"
                  onClick={() => setGraphOpen(true)}
                  aria-label="View charging graph"
                  title="View charging graph"
                >
                  <QueryStatsIcon />
                </button>
              ) : null}
            </div>
          ) : null}

          {controlHint ? <p className="dial-hint">{controlHint}</p> : null}
        </div>

        {session ? (
          <div className="session-summary-grid">
            <article className="metric-card">
              <span className="metric-label">Session start</span>
              <strong>{formatTimestamp(session.startTime)}</strong>
            </article>
            <article className="metric-card">
              <span className="metric-label">Energy charged</span>
              <strong>{formatMetric(session.energyKwh, ' kWh', 2)}</strong>
            </article>
            <article className="metric-card">
              <span className="metric-label">User</span>
              {session.isFreeVending ? (
                <strong>
                  <span className="free-vending-badge">Free vending</span>
                </strong>
              ) : (
                <strong>{userDisplay}</strong>
              )}
            </article>
          </div>
        ) : (
          <div className="inline-state">No active session on this charger.</div>
        )}

        {isAllocationGroup && canStop ? (
          <div className="overview-actions">
            <div className="control-panel">
              {canPrioritize ? (
                <>
                  <div className="stepper-field">
                    <span className="stepper-label">Session priority</span>
                    <div className="stepper-control">
                      <button
                        type="button"
                        className="stepper-button"
                        onClick={() => onDraftPriorityChange(Math.max(0, draftPriorityValue - 1))}
                        disabled={saving || loading || draftPriorityValue <= 0}
                        aria-label="Decrease session priority"
                      >
                        −
                      </button>
                      <output className="stepper-value">{draftPriorityValue}</output>
                      <button
                        type="button"
                        className="stepper-button"
                        onClick={() => onDraftPriorityChange(Math.min(10, draftPriorityValue + 1))}
                        disabled={saving || loading || draftPriorityValue >= 10}
                        aria-label="Increase session priority"
                      >
                        +
                      </button>
                    </div>
                  </div>
                  <div className="action-row">
                    <button
                      className="primary-button"
                      type="button"
                      onClick={() => onApplyPriority(draftPriorityValue)}
                      disabled={saving || loading || !hasPendingPriorityChange}
                    >
                      {saving ? 'Applying...' : 'Apply priority'}
                    </button>
                  </div>
                </>
              ) : (
                <span className="inline-state">Your account does not have permission to change this session's priority.</span>
              )}
            </div>
          </div>
        ) : null}

      </section>

      {startModalOpen ? (
        <>
          <button
            type="button"
            className="menu-backdrop is-open"
            aria-label="Close"
            onClick={() => setStartModalOpen(false)}
          />
          <div className="modal-panel panel">
            <div className="modal-panel-header">
              <div>
                <p className="section-kicker">Remote start</p>
                <h3>Start charging</h3>
              </div>
              <button className="ghost-button" type="button" onClick={() => setStartModalOpen(false)}>
                Close
              </button>
            </div>

            <form className="auth-form" onSubmit={handleStartSubmit}>
              <label className="field">
                <span>ID tag</span>
                <input
                  type="text"
                  value={startTagInput}
                  onChange={(event) => setStartTagInput(event.target.value)}
                  placeholder="RFID or virtual tag id"
                  autoComplete="off"
                  required
                />
              </label>

              <p className="subtle">
                A real session normally starts with an RFID scan at the charger - a remote start needs an id tag
                supplied here instead. It defaults to the charger's own id, the same convention this app already
                uses to detect and label "Free vending" sessions.
              </p>

              <div className="action-row">
                <button className="primary-button" type="submit" disabled={saving || loading}>
                  {saving ? 'Starting...' : 'Start charging'}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => setStartModalOpen(false)}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </>
      ) : null}

      {graphOpen ? (
        <>
          <button type="button" className="menu-backdrop is-open" aria-label="Close graph" onClick={() => setGraphOpen(false)} />
          <div className="modal-panel is-wide panel">
            <div className="modal-panel-header">
              <div>
                <p className="section-kicker">Recent activity</p>
                <h3>Charging graph</h3>
              </div>
              <button className="ghost-button" type="button" onClick={() => setGraphOpen(false)}>
                Close
              </button>
            </div>
            <ChargingHistoryChart history={history} height={260} />
          </div>
        </>
      ) : null}
    </div>
  );
}
