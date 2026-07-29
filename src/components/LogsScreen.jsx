import React, { useEffect, useRef, useState } from 'react';

import { AUDIT_LOGGER } from '../apiClient';
import './LogsScreen.css';

// Sentinel for "don't filter by logger at all". The backend compares the
// logger field for equality, so this is stripped before the call rather than
// sent (balanz-ui's own Logs page does the same).
export const LOG_ALL = 'ALL';

const LOG_TYPES = [
  { id: AUDIT_LOGGER, label: 'Audit' },
  { id: LOG_ALL, label: 'All' },
];

// Typing shouldn't fire a request per keystroke.
const SEARCH_DEBOUNCE_MS = 400;

// Windows offered as filter chips. Kept coarse deliberately: the view is
// always narrowed to one charger and to audit entries only, which is a
// modest number of lines, so finer-grained windows would be busywork.
export const LOG_RANGES = [
  { id: '24h', label: '24 hours', hours: 24 },
  { id: '7d', label: 'Last week', hours: 24 * 7 },
  { id: '30d', label: 'Last month', hours: 24 * 30 },
];

export const DEFAULT_LOG_RANGE = '24h';

// Audit messages are written with a bracketed category prefix, e.g.
// "[SESSION-START] Starting charging session on ...". Splitting it out lets
// the category be shown as its own chip and keeps the message text itself
// readable, rather than every line starting with the same noisy token.
function splitCategory(message) {
  const match = /^\[([A-Z0-9-]+)\]\s*(.*)$/s.exec(message);
  if (!match) {
    return { category: null, text: message };
  }
  return { category: match[1], text: match[2] };
}

// The backend timestamp is "YYYY-MM-DD HH:MM:SS" (see formatLogTimestamp in
// apiClient). Only the date part is worth repeating as a group heading; each
// row then just needs the time.
function splitTimestamp(timestamp) {
  const [date = '', time = ''] = String(timestamp).split(' ');
  return { date, time };
}

function levelTone(level) {
  switch (String(level || '').toUpperCase()) {
    case 'WARNING':
      return 'tone-preparing';
    case 'ERROR':
    case 'CRITICAL':
      return 'tone-error';
    default:
      return null;
  }
}

export default function LogsScreen({
  charger,
  entries,
  loading,
  error,
  range,
  onRangeChange,
  logger,
  onLoggerChange,
  search,
  onSearchChange,
}) {
  const endRef = useRef(null);

  // The input is uncontrolled-ish on purpose: it updates locally on every
  // keystroke but only pushes upward (triggering a request) once typing
  // pauses. Re-synced when the prop changes from outside - e.g. opening the
  // screen from a charger seeds it with that charger's id.
  const [draftSearch, setDraftSearch] = useState(search ?? '');
  useEffect(() => {
    setDraftSearch(search ?? '');
  }, [search]);

  useEffect(() => {
    if (draftSearch === search) {
      return undefined;
    }
    const timeoutId = window.setTimeout(() => onSearchChange(draftSearch), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [draftSearch, search, onSearchChange]);

  // Oldest first, so the log reads chronologically like the file it came
  // from. "Jump to latest" below covers the common case of wanting the most
  // recent activity without scrolling the whole list.
  const ordered = [...entries].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));

  function jumpToLatest() {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }

  let lastDate = null;

  return (
    <section className="panel detail-panel logs-screen">
      <div className="section-header">
        <div>
          <h2>{logger === AUDIT_LOGGER ? 'Audit log' : 'System log'}</h2>
          {charger ? (
            <p className="subtle">
              {charger.alias || charger.chargerId}
              {charger.alias ? ` · ${charger.chargerId}` : ''}
            </p>
          ) : null}
        </div>
      </div>

      <div className="log-filters">
        <div className="log-ranges" role="group" aria-label="Time range">
          {LOG_RANGES.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`log-range-chip ${range === option.id ? 'is-active' : ''}`}
              aria-pressed={range === option.id}
              onClick={() => onRangeChange(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="log-ranges" role="group" aria-label="Log type">
          {LOG_TYPES.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`log-range-chip ${logger === option.id ? 'is-active' : ''}`}
              aria-pressed={logger === option.id}
              onClick={() => onLoggerChange(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <label className="log-search">
          <span className="log-search-label">Message search</span>
          <input
            type="search"
            value={draftSearch}
            onChange={(event) => setDraftSearch(event.target.value)}
            placeholder="Charger id, tag, user name..."
            autoComplete="off"
            spellCheck="false"
          />
        </label>
      </div>

      <div className="log-toolbar">
        <span className="log-count">
          {ordered.length} {ordered.length === 1 ? 'entry' : 'entries'}
        </span>

        {ordered.length > 0 ? (
          <button type="button" className="log-jump-button" onClick={jumpToLatest}>
            Jump to latest
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
              <path
                d="M12 5v14m0 0-6-6m6 6 6-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ) : null}
      </div>

      {error ? <div className="alert alert-error">{error}</div> : null}

      {loading && ordered.length === 0 ? <div className="inline-state">Loading audit log...</div> : null}

      {!loading && ordered.length === 0 && !error ? (
        <div className="inline-state">
          No {logger === AUDIT_LOGGER ? 'audit' : 'log'} entries match these filters.
        </div>
      ) : null}

      <div className="log-list">
        {ordered.map((entry, index) => {
          const { date, time } = splitTimestamp(entry.timestamp);
          const { category, text } = splitCategory(entry.message);
          const tone = levelTone(entry.level);
          const showDate = date !== lastDate;
          lastDate = date;

          return (
            <React.Fragment key={`${entry.timestamp}-${index}`}>
              {showDate ? <div className="log-day">{date}</div> : null}
              <article className="log-entry">
                <div className="log-entry-meta">
                  <time>{time}</time>
                  {/* Which module emitted it only matters once the log isn't
                      filtered down to AUDIT alone. */}
                  {logger === LOG_ALL && entry.logger ? (
                    <span className="log-logger">{entry.logger}</span>
                  ) : null}
                  {category ? <span className="log-category">{category}</span> : null}
                  {/* INFO is the overwhelming majority, so only anything
                      needing attention gets a level chip. */}
                  {tone ? <span className={`log-level ${tone}`}>{entry.level}</span> : null}
                </div>
                <p className="log-message">{text}</p>
              </article>
            </React.Fragment>
          );
        })}
        {/* Scroll target for "Jump to latest" - the newest entry is the last
            one now that the list reads oldest-first. */}
        <div ref={endRef} />
      </div>
    </section>
  );
}
