import React, { useState } from 'react';

import ChargingGraphModal from './ChargingGraphModal';
import './SessionsScreen.css';

// GetSessions returns everything for the charger in one go and has no date
// filter of its own, so these are purely a client-side view over data that's
// already in hand - which is why "All" costs nothing and the set is kept
// deliberately short. `months: null` means no cutoff at all.
export const SESSION_RANGES = [
  { id: '1m', label: 'Last month', months: 1 },
  { id: '12m', label: 'Last year', months: 12 },
  { id: 'all', label: 'All', months: null },
];

export const DEFAULT_SESSION_RANGE = '1m';

export const SESSION_GROUPINGS = [
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
];

export const DEFAULT_SESSION_GROUPING = 'month';

function pad2(n) {
  return String(n).padStart(2, '0');
}

// ISO-8601 week number: weeks start Monday, and week 1 is the one containing
// the first Thursday of the year. Worth doing properly - a naive "day of year
// / 7" disagrees with the calendar most people read around New Year.
function isoWeek(date) {
  const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNumber = (target.getUTCDay() + 6) % 7; // Mon = 0
  target.setUTCDate(target.getUTCDate() - dayNumber + 3); // nearest Thursday
  const isoYear = target.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNumber = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNumber + 3);
  const week = 1 + Math.round((target - firstThursday) / (7 * 24 * 60 * 60 * 1000));
  return { isoYear, week };
}

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

// Bucket key sorts descending as a string, so newest groups come first.
function bucketFor(date, grouping) {
  if (grouping === 'week') {
    const { isoYear, week } = isoWeek(date);
    return { key: `${isoYear}-W${pad2(week)}`, label: `Week ${week}, ${isoYear}` };
  }
  return {
    key: `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`,
    label: `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`,
  };
}

function formatDateTime(epochSeconds) {
  if (!Number.isFinite(epochSeconds)) {
    return '--';
  }
  const date = new Date(epochSeconds * 1000);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatTimeOnly(epochSeconds) {
  if (!Number.isFinite(epochSeconds)) {
    return '--';
  }
  const date = new Date(epochSeconds * 1000);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '--';
  }
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours === 0) {
    return `${minutes}m`;
  }
  return `${hours}h ${pad2(minutes)}m`;
}

function formatKwh(value) {
  return Number.isFinite(value) ? `${value.toFixed(2)} kWh` : '--';
}

// Mirrors the charger screen: a Free Vending session carries the charger's
// own id as its tag, which would otherwise read as a user name.
function sessionUser(session) {
  if (session.isFreeVending) {
    return 'Free vending';
  }
  if (session.userName && session.userName !== 'Unknown') {
    return session.userName;
  }
  return session.idTag || '--';
}

export default function SessionsScreen({
  charger,
  sessions,
  loading,
  error,
  range,
  onRangeChange,
  grouping,
  onGroupingChange,
}) {
  const [graphSession, setGraphSession] = useState(null);

  // GetSessions has no time filter, so the period is applied here. A null
  // `months` ("All") skips the cutoff entirely.
  const rangeOption = SESSION_RANGES.find((option) => option.id === range) ?? SESSION_RANGES[0];
  let cutoffSeconds = null;
  if (rangeOption.months !== null) {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - rangeOption.months);
    cutoffSeconds = cutoff.getTime() / 1000;
  }

  const visible = sessions
    .filter(
      (session) =>
        Number.isFinite(session.startTime) &&
        (cutoffSeconds === null || session.startTime >= cutoffSeconds),
    )
    .sort((a, b) => b.startTime - a.startTime);

  // Group into buckets, newest first, each carrying its own subtotals.
  const buckets = [];
  const byKey = new Map();
  for (const session of visible) {
    const { key, label } = bucketFor(new Date(session.startTime * 1000), grouping);
    let bucket = byKey.get(key);
    if (!bucket) {
      bucket = { key, label, sessions: [], energyKwh: 0, durationSeconds: 0 };
      byKey.set(key, bucket);
      buckets.push(bucket);
    }
    bucket.sessions.push(session);
    bucket.energyKwh += Number.isFinite(session.energyKwh) ? session.energyKwh : 0;
    bucket.durationSeconds += Number.isFinite(session.durationSeconds) ? session.durationSeconds : 0;
  }

  const totalEnergy = buckets.reduce((sum, bucket) => sum + bucket.energyKwh, 0);

  return (
    <section className="panel detail-panel sessions-screen">
      <div className="section-header">
        <div>
          <h2>Sessions</h2>
          {charger ? (
            <p className="subtle">
              {charger.alias || charger.chargerId}
              {charger.alias ? ` · ${charger.chargerId}` : ''}
            </p>
          ) : null}
        </div>
      </div>

      <div className="session-filters">
        <div className="session-chips" role="group" aria-label="Period">
          {SESSION_RANGES.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`session-chip ${range === option.id ? 'is-active' : ''}`}
              aria-pressed={range === option.id}
              onClick={() => onRangeChange(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="session-groupby">
          <span className="session-groupby-label">Subtotals per</span>
          <div className="session-chips" role="group" aria-label="Subtotal grouping">
            {SESSION_GROUPINGS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`session-chip ${grouping === option.id ? 'is-active' : ''}`}
                aria-pressed={grouping === option.id}
                onClick={() => onGroupingChange(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}

      {loading && visible.length === 0 ? <div className="inline-state">Loading sessions...</div> : null}

      {!loading && visible.length === 0 && !error ? (
        <div className="inline-state">No sessions for this charger in the selected period.</div>
      ) : null}

      {visible.length > 0 ? (
        <div className="session-total">
          {visible.length} {visible.length === 1 ? 'session' : 'sessions'} · {formatKwh(totalEnergy)} total
        </div>
      ) : null}

      <div className="session-list">
        {buckets.map((bucket) => (
          <section key={bucket.key} className="session-bucket">
            <header className="session-bucket-header">
              <strong>{bucket.label}</strong>
              <span>
                {bucket.sessions.length} {bucket.sessions.length === 1 ? 'session' : 'sessions'} ·{' '}
                {formatKwh(bucket.energyKwh)} · {formatDuration(bucket.durationSeconds)}
              </span>
            </header>

            {bucket.sessions.map((session) => (
              <article key={session.sessionId || `${session.startTime}`} className="session-card">
                <div className="session-card-head">
                  <strong>{formatDateTime(session.startTime)}</strong>
                  <span className="session-energy">{formatKwh(session.energyKwh)}</span>
                </div>

                <div className="session-meta">
                  <span>
                    <span className="session-meta-label">Ended</span>
                    {formatTimeOnly(session.endTime)}
                  </span>
                  <span>
                    <span className="session-meta-label">Duration</span>
                    {formatDuration(session.durationSeconds)}
                  </span>
                  <span>
                    <span className="session-meta-label">User</span>
                    {sessionUser(session)}
                  </span>
                  {session.reason ? (
                    <span>
                      <span className="session-meta-label">Reason</span>
                      {session.reason}
                    </span>
                  ) : null}
                </div>

                {session.chargingHistory.length > 1 ? (
                  <button
                    type="button"
                    className="session-graph-button"
                    onClick={() => setGraphSession(session)}
                  >
                    View charging graph
                  </button>
                ) : null}
              </article>
            ))}
          </section>
        ))}
      </div>

      {/* Exactly the same graph modal the live charger screen opens - zoom,
          pan and "Reset zoom" included - just pointed at a stored session's
          history instead of the running one. */}
      {graphSession ? (
        <ChargingGraphModal
          kicker={formatDateTime(graphSession.startTime)}
          history={graphSession.chargingHistory}
          onClose={() => setGraphSession(null)}
        />
      ) : null}
    </section>
  );
}
