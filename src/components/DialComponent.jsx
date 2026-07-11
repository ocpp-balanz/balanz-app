import React from 'react';

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

function formatTimestamp(value) {
  if (!value && value !== 0) {
    return '--';
  }
  const raw = Number(value);
  if (!Number.isFinite(raw)) {
    return String(value);
  }
  const milliseconds = raw > 10_000_000_000 ? raw : raw * 1000;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
    hourCycle: 'h23',
  }).format(new Date(milliseconds));
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

// Balanz reports current draw in Amps only, so power is derived from an
// assumed voltage/phase count (see ASSUMED_VOLTAGE_V/ASSUMED_PHASES above).
// Some EVs can only charge on a single phase. When that happens, the actual
// energy the meter accrues over time falls well short of what the assumed
// phase count would predict from the observed current, revealing the
// mismatch. Detect that per-session and fall back to a 1-phase estimate for
// that session's instantaneous power, instead of overstating it.
function detectEffectivePhases(session, assumedVoltage, assumedPhases) {
  if (!session || assumedPhases <= 1 || session.energyKwh === null || !session.startTime) {
    return assumedPhases;
  }

  const history = Array.isArray(session.chargingHistory) ? session.chargingHistory : [];
  const usageSamples = history
    .map((entry) => entry.usage)
    .filter((value) => Number.isFinite(value) && value > 0);
  const avgUsageA =
    usageSamples.length > 0
      ? usageSamples.reduce((sum, value) => sum + value, 0) / usageSamples.length
      : session.usageMeterA;

  if (!Number.isFinite(avgUsageA) || avgUsageA <= 0) {
    return assumedPhases;
  }

  const rawStart = Number(session.startTime);
  if (!Number.isFinite(rawStart)) {
    return assumedPhases;
  }
  const startSeconds = rawStart > 10_000_000_000 ? rawStart / 1000 : rawStart;
  const elapsedHours = (Date.now() / 1000 - startSeconds) / 3600;

  // Require enough elapsed time and energy for the comparison to be
  // meaningful (avoids false positives during ramp-up or brief sessions).
  if (!Number.isFinite(elapsedHours) || elapsedHours < 0.1 || session.energyKwh < 0.2) {
    return assumedPhases;
  }

  const expectedKwh = (avgUsageA * assumedVoltage * assumedPhases * elapsedHours) / 1000;
  if (expectedKwh <= 0) {
    return assumedPhases;
  }

  // Actual energy well below the assumed-phase prediction (roughly a third
  // of it, matching a 1-phase connection) means the car is only using one
  // phase - revert to a 1-phase estimate for this session.
  const ratio = session.energyKwh / expectedKwh;
  return ratio < 0.6 ? 1 : assumedPhases;
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

  const effectivePhases = detectEffectivePhases(session, ASSUMED_VOLTAGE_V, ASSUMED_PHASES);
  const isSinglePhaseSession = effectivePhases !== ASSUMED_PHASES;

  const estimatedPowerKw =
    session && session.usageMeterA !== null
      ? (session.usageMeterA * ASSUMED_VOLTAGE_V * effectivePhases) / 1000
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
        <div className="overview-top">
          <div className="hero-copy">
            <h2>{charger.alias}</h2>
            <p className="hero-subtitle">{charger.description || 'No description provided'}</p>
          </div>
          <div className="overview-badges">
            <div className={`network-pill ${charger.networkConnected ? 'is-online' : 'is-offline'}`}>
              {charger.networkConnected ? 'Network connected' : 'Network offline'}
            </div>
            {loading ? <span className="muted-chip">Refreshing</span> : null}
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
                  <span className="metric-label">Power (est.){isSinglePhaseSession ? ' · 1-phase' : ''}</span>
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

        <div className="hero-meta">
          <span>{charger.chargerId}</span>
          <span>{charger.groupId || 'Ungrouped'}</span>
          {isAllocationGroup ? <span>Priority {connector?.priority ?? charger.priority ?? '--'}</span> : null}
        </div>
      </section>

      <section className="section-card">
        <div className="section-header">
          <div>
            <p className="section-kicker">Recent activity</p>
            <h3>Charging graph</h3>
          </div>
        </div>

        {history.length > 0 ? (
          <ChargingHistoryChart history={history} />
        ) : (
          <div className="inline-state">No recent charging history available yet.</div>
        )}
      </section>
    </div>
  );
}
