import React, { useEffect, useRef, useState } from 'react';

import {
  canControlCharging,
  canSetChargePriority,
  canViewLogs,
  fetchTags,
  RESET_TYPES,
} from '../apiClient';
import ChargingDial from './ChargingDial';
import ChargingGraphModal from './ChargingGraphModal';
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

// Material's "history" - a clock with a counter-clockwise arrow.
function HistoryIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        fill="currentColor"
        d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9m-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8z"
      />
    </svg>
  );
}

// Material's "restart_alt" - the same icon balanz-ui uses for this action.
function RestartIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 5V2L8 6l4 4V7c3.31 0 6 2.69 6 6 0 2.97-2.17 5.43-5 5.91v2.02c3.95-.49 7-3.85 7-7.93 0-4.42-3.58-8-8-8m-6 8c0-1.65.67-3.15 1.76-4.24L6.34 7.34C4.9 8.79 4 10.79 4 13c0 4.08 3.05 7.44 7 7.93v-2.02c-2.83-.48-5-2.94-5-5.91"
      />
    </svg>
  );
}

// Material's "receipt_long" - a document with ruled lines, the closest thing
// in that set to an audit trail.
function AuditLogIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <path
        fill="currentColor"
        d="M19 5v14a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3v-2h3V2l1.5 1.5L8 2l1.5 1.5L11 2l1.5 1.5L14 2l1.5 1.5L17 2l2 2zM7 9h8V7H7zm0 4h8v-2H7zm0 4h6v-2H7zm10 3a1 1 0 0 0 1-1V7h2v12a1 1 0 0 1-1 1z"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" fill="currentColor" />
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
  onOpenLogs,
  onOpenSessions,
  onResetCharger,
  isAllocationGroup,
  userType,
  draftPriority,
  onDraftPriorityChange,
  onApplyPriority,
}) {
  const [graphOpen, setGraphOpen] = useState(false);
  const [startModalOpen, setStartModalOpen] = useState(false);
  const [resetModalOpen, setResetModalOpen] = useState(false);
  // Remote-start tag selection. The charger accepts any string as an id_tag,
  // so rather than a free-text field (which risks starting a session with an
  // id no real tag owns), the user picks a known tag from GetTags. `tagSearch`
  // filters that list by user name; `selectedTag` holds the chosen tag whose
  // idTag (RFID value) is what actually gets sent.
  const [tags, setTags] = useState([]);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [tagsError, setTagsError] = useState('');
  const [tagSearch, setTagSearch] = useState('');
  const [selectedTag, setSelectedTag] = useState(null);
  // Guards the one-time tag load so the loader effect below can depend only
  // on `startModalOpen` - keying it on tagsLoading instead would let the
  // effect's own setTagsLoading(true) re-run it, whose cleanup then cancels
  // the very fetch it just started (tags would spin forever). Reset on error
  // so reopening the dialog retries.
  const tagsLoadedRef = useRef(false);

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
  // RemoteStartTransaction only makes sense once a cable is plugged in and
  // the charger is waiting for authorization (Preparing) or has just
  // finished (Finishing, e.g. restarting for the same plugged-in vehicle) -
  // OCPP has no concept of remotely starting a session on a connector that's
  // simply Available (nothing plugged in yet).
  const canRemoteStart = Boolean(connector && ['Preparing', 'Finishing'].includes(connector.status));
  const isAdmin = canControlCharging(userType);
  const canPrioritize = canSetChargePriority(userType);
  // GetLogs is Admin-only server-side, so don't offer the entry point to
  // anyone who'd just get NotAuthorized back.
  const canSeeLogs = canViewLogs(userType) && Boolean(onOpenLogs);
  // Reset is Admin-only too, and the backend rejects it outright when the
  // charger has no live OCPP link - there's nothing to send the command to.
  const canReset = isAdmin && Boolean(onResetCharger) && Boolean(charger.networkConnected);
  // GetSessions reaches a wider audience than the control commands (Analysis
  // and Tags as well as Admin), so App decides and passes the handler only
  // when the role allows it.
  const canSeeSessions = Boolean(onOpenSessions);
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
    setTagSearch('');
    setSelectedTag(null);
    setStartModalOpen(true);
  }

  // Load the tag list when the start dialog opens (once per session - tags
  // change rarely, and 250-odd entries are cheap to keep). Only Activated
  // tags are offered; a Blocked tag would just be rejected by the backend.
  // Depends solely on startModalOpen (see tagsLoadedRef above for why).
  useEffect(() => {
    if (!startModalOpen || tagsLoadedRef.current) {
      return;
    }
    tagsLoadedRef.current = true;
    let cancelled = false;
    setTagsLoading(true);
    setTagsError('');
    fetchTags()
      .then((list) => {
        if (cancelled) return;
        const usable = list
          .filter((tag) => tag.idTag && tag.status !== 'Blocked')
          .sort((a, b) => (a.userName || a.idTag).localeCompare(b.userName || b.idTag));
        setTags(usable);
      })
      .catch((error) => {
        if (cancelled) return;
        tagsLoadedRef.current = false;
        setTagsError(error instanceof Error ? error.message : 'Could not load tags.');
      })
      .finally(() => {
        if (!cancelled) setTagsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [startModalOpen]);

  const tagQuery = tagSearch.trim().toLowerCase();
  // Match on user name only (per requirements - the free-form description is
  // deliberately not searched), plus the id_tag itself so someone who knows
  // the RFID value can still find it. Cap the rendered rows so a broad/empty
  // search doesn't paint all ~250 at once; narrowing the search reveals more.
  const filteredTags = tags
    .filter(
      (tag) =>
        !tagQuery ||
        tag.userName.toLowerCase().includes(tagQuery) ||
        tag.idTag.toLowerCase().includes(tagQuery),
    )
    .slice(0, 50);

  function handleStartSubmit(event) {
    event.preventDefault();
    if (!selectedTag) {
      return;
    }
    onStartTransaction(selectedTag.idTag);
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

          {isAdmin || hasGraphAccess || canSeeLogs || canSeeSessions || canReset ? (
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
                ) : canRemoteStart ? (
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
                ) : null
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

              {canSeeSessions ? (
                <button
                  type="button"
                  className="icon-button icon-button-sessions"
                  onClick={onOpenSessions}
                  aria-label="View past sessions"
                  title="View past sessions"
                >
                  <HistoryIcon />
                </button>
              ) : null}

              {canSeeLogs ? (
                <button
                  type="button"
                  className="icon-button icon-button-logs"
                  onClick={onOpenLogs}
                  aria-label="View audit log"
                  title="View audit log"
                >
                  <AuditLogIcon />
                </button>
              ) : null}

              {canReset ? (
                <button
                  type="button"
                  className="icon-button icon-button-reset"
                  onClick={() => setResetModalOpen(true)}
                  disabled={saving || loading}
                  aria-label="Reset charger"
                  title="Reset charger"
                >
                  <RestartIcon />
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
            {isAllocationGroup && canStop ? (
              <article className="metric-card">
                <span className="metric-label">Session priority</span>
                {canPrioritize ? (
                  <div className="priority-field">
                    <input
                      type="number"
                      className="priority-input"
                      min={0}
                      max={10}
                      value={draftPriorityValue}
                      disabled={saving || loading}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        if (Number.isFinite(next)) {
                          onDraftPriorityChange(Math.min(10, Math.max(0, next)));
                        }
                      }}
                      aria-label="Session priority"
                    />
                    {hasPendingPriorityChange ? (
                      <button
                        type="button"
                        className="icon-button-check"
                        onClick={() => onApplyPriority(draftPriorityValue)}
                        disabled={saving || loading}
                        aria-label="Apply priority"
                        title="Apply priority"
                      >
                        <CheckIcon />
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <strong>{draftPriorityValue}</strong>
                )}
              </article>
            ) : null}
          </div>
        ) : (
          <div className="inline-state">No active session on this charger.</div>
        )}

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
            </div>

            <form className="auth-form" onSubmit={handleStartSubmit}>
              <label className="field">
                <span>Charging tag</span>
                <input
                  type="text"
                  value={tagSearch}
                  onChange={(event) => setTagSearch(event.target.value)}
                  placeholder="Search by user name"
                  autoComplete="off"
                />
              </label>

              {tagsLoading ? <div className="inline-state">Loading tags...</div> : null}
              {tagsError ? <div className="alert alert-error">{tagsError}</div> : null}

              {!tagsLoading && !tagsError ? (
                <div className="tag-picker" role="listbox" aria-label="Charging tags">
                  {filteredTags.length === 0 ? (
                    <div className="inline-state">No matching tags.</div>
                  ) : (
                    filteredTags.map((tag) => {
                      const isSelected = selectedTag?.idTag === tag.idTag;
                      return (
                        <button
                          key={tag.idTag}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          className={`tag-option ${isSelected ? 'is-selected' : ''}`}
                          onClick={() => setSelectedTag(tag)}
                        >
                          <strong>{tag.userName || '(no user name)'}</strong>
                          <span className="tag-option-id">{tag.idTag}</span>
                        </button>
                      );
                    })
                  )}
                </div>
              ) : null}

              <p className="subtle">
                {selectedTag
                  ? `Starting a session for ${selectedTag.userName || '(no user name)'} (${selectedTag.idTag}).`
                  : 'A remote start needs a valid tag. Pick the tag (by user name) to authorize the session with.'}
              </p>

              <div className="action-row">
                <button className="primary-button" type="submit" disabled={saving || loading || !selectedTag}>
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

      {/* Confirmation before rebooting a charger, wording and Soft/Hard
          choice matching balanz-ui's own ResetCharger dialog. Both options
          sit behind the confirmation rather than as separate icons: reset is
          rare and disruptive, so it shouldn't be one stray tap away. */}
      {resetModalOpen ? (
        <>
          <button
            type="button"
            className="menu-backdrop is-open"
            aria-label="Close"
            onClick={() => setResetModalOpen(false)}
          />
          <div className="modal-panel panel">
            {/* No Close button up here: the action row below already ends in
                Cancel, and two ways to dismiss in one small dialog is just
                noise. (The backdrop still dismisses too.) */}
            <div className="modal-panel-header">
              <div>
                <p className="section-kicker">Charger</p>
                <h3>Confirm charger reset</h3>
              </div>
            </div>

            <p className="subtle">
              Reset {charger.alias} ({charger.chargerId})? A <strong>soft</strong> reset restarts the
              charger&apos;s software and ends any running session gracefully. A <strong>hard</strong> reset
              reboots it as if the power had been cycled.
            </p>

            <div className="action-row">
              <button
                className="primary-button"
                type="button"
                disabled={saving || loading}
                onClick={() => {
                  setResetModalOpen(false);
                  onResetCharger(RESET_TYPES.SOFT);
                }}
              >
                Soft reset
              </button>
              <button
                className="secondary-button is-danger"
                type="button"
                disabled={saving || loading}
                onClick={() => {
                  setResetModalOpen(false);
                  onResetCharger(RESET_TYPES.HARD);
                }}
              >
                Hard reset
              </button>
              <button className="secondary-button" type="button" onClick={() => setResetModalOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </>
      ) : null}

      {graphOpen ? (
        <ChargingGraphModal kicker="Recent activity" history={history} onClose={() => setGraphOpen(false)} />
      ) : null}
    </div>
  );
}
