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

export default function DialComponent({
  charger,
  loading,
  saving,
  draftMaxCurrent,
  onDraftMaxCurrentChange,
  onApplyMaxCurrent,
  onStopTransaction,
  isAllocationGroup,
  userType,
  draftPriority,
  onDraftPriorityChange,
  onApplyPriority,
}) {
  const [graphOpen, setGraphOpen] = useState(false);

  const session = charger.session || null;
  const connector = charger.activeConnector || null;
  const tone = statusTone(charger.status);

  const baseline = connector?.offered ?? charger.connMax ?? 16;
  const draftValue = Number(draftMaxCurrent ?? baseline);
  const hasPendingChange = Number(baseline) !== draftValue;
  const sliderMax = Math.max(32, charger.connMax || 0, draftValue);

  const priorityBaseline = connector?.priority ?? charger.priority ?? 1;
  const draftPriorityValue = Number(draftPriority ?? priorityBaseline);
  const hasPendingPriorityChange = Number(priorityBaseline) !== draftPriorityValue;

  const history = Array.isArray(session?.chargingHistory) ? session.chargingHistory : [];

  const estimatedPowerKw =
    session && session.usageMeterA !== null
      ? (session.usageMeterA * ASSUMED_VOLTAGE_V * ASSUMED_PHASES) / 1000
      : null;

  const canStop = Boolean(session && connector?.transactionId);
  const isAdmin = canControlCharging(userType);
  const canPrioritize = canSetChargePriority(userType);

  const userDisplay = session
    ? session.isFreeVending
      ? null
      : session.userName && session.userName !== 'Unknown'
        ? session.userName
        : session.idTag || '--'
    : '--';

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

        <div className="overview-main">
          <div className="dial-column">
            <ChargingDial
              value={connector?.offered ?? 0}
              max={charger.connMax}
              tone={tone}
              statusLabel={charger.status}
              subLabel={`of ${formatMetric(charger.connMax, ' A')} max`}
            />

            {canStop && !isAllocationGroup && isAdmin ? (
              <div className="dial-control">
                <div className="slider-header compact">
                  <span>Max current</span>
                  <output>{draftValue} A</output>
                </div>
                <input
                  type="range"
                  min="6"
                  max={sliderMax}
                  step="1"
                  value={draftValue}
                  onChange={(event) => onDraftMaxCurrentChange(Number(event.target.value))}
                />
                <button
                  className="primary-button dial-apply-button"
                  type="button"
                  onClick={() => onApplyMaxCurrent(draftValue)}
                  disabled={saving || loading || !hasPendingChange}
                >
                  {saving ? 'Applying...' : 'Apply limit'}
                </button>
              </div>
            ) : null}
          </div>

          <div className="overview-stats">
            {session ? (
              <div className="session-grid">
                <article className="metric-card">
                  <span className="metric-label">Session start</span>
                  <strong>{formatTimestamp(session.startTime)}</strong>
                </article>
                <article className="metric-card">
                  <span className="metric-label">Energy charged</span>
                  <strong>{formatMetric(session.energyKwh, ' kWh', 2)}</strong>
                </article>
                <article className="metric-card">
                  <span className="metric-label">Power (est.)</span>
                  <strong>{formatMetric(estimatedPowerKw, ' kW', 1)}</strong>
                </article>
                <article className="metric-card">
                  <span className="metric-label">Current</span>
                  <strong>{formatMetric(session.usageMeterA, ' A', 1)}</strong>
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
                <article className="metric-card">
                  <span className="metric-label">Meter start</span>
                  <strong>
                    {formatMetric(
                      session.meterStartWh !== null ? session.meterStartWh / 1000 : null,
                      ' kWh',
                      2,
                    )}
                  </strong>
                </article>
              </div>
            ) : (
              <div className="inline-state">No active session on this charger.</div>
            )}
          </div>
        </div>

        <div className="overview-actions">
          {!canStop ? (
            <div className="inline-state">Start a session at the charger to enable controls.</div>
          ) : isAllocationGroup ? (
            <div className="control-panel">
              {canPrioritize ? (
                <label className="slider-field">
                  <div className="slider-header">
                    <span>Session priority</span>
                    <output>{draftPriorityValue}</output>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="10"
                    step="1"
                    value={draftPriorityValue}
                    onChange={(event) => onDraftPriorityChange(Number(event.target.value))}
                  />
                </label>
              ) : null}

              <div className="action-row">
                {canPrioritize ? (
                  <button
                    className="primary-button"
                    type="button"
                    onClick={() => onApplyPriority(draftPriorityValue)}
                    disabled={saving || loading || !hasPendingPriorityChange}
                  >
                    {saving ? 'Applying...' : 'Apply priority'}
                  </button>
                ) : null}
                {isAdmin ? (
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={onStopTransaction}
                    disabled={saving || loading}
                  >
                    Stop charging
                  </button>
                ) : null}
                {!canPrioritize && !isAdmin ? (
                  <span className="inline-state">Your account does not have permission to change this session.</span>
                ) : null}
              </div>
            </div>
          ) : isAdmin ? (
            <div className="action-row">
              <button
                className="secondary-button"
                type="button"
                onClick={onStopTransaction}
                disabled={saving || loading}
              >
                Stop charging
              </button>
            </div>
          ) : (
            <div className="inline-state">Your account does not have permission to control this session.</div>
          )}
        </div>

        <div className="graph-trigger-row">
          {history.length > 0 ? (
            <button className="secondary-button" type="button" onClick={() => setGraphOpen(true)}>
              View charging graph
            </button>
          ) : (
            <span className="inline-state">No recent charging history available yet.</span>
          )}
        </div>
      </section>

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
            <ChargingHistoryChart history={history} height={420} />
          </div>
        </>
      ) : null}
    </div>
  );
}
