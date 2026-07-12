import React from 'react';

import { APP_VERSION, BUILD_DATE } from '../version';

function pad2(n) {
  return String(n).padStart(2, '0');
}

// Matches the app's own YYYY-MM-DD hh:mm convention (see DialComponent.jsx's
// formatTimestamp) rather than a locale-dependent format.
function formatBuildDate(isoString) {
  if (!isoString) {
    return '--';
  }
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return '--';
  }
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export default function AboutPanel({ open, onClose }) {
  if (!open) {
    return null;
  }

  return (
    <>
      <button type="button" className="menu-backdrop is-open" aria-label="Close about" onClick={onClose} />

      <div className="modal-panel panel">
        <div className="modal-panel-header">
          <div>
            <p className="section-kicker">About</p>
            <h3>Balanz</h3>
          </div>
          <button className="ghost-button" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <dl className="about-list">
          <div className="about-row">
            <dt>Version</dt>
            <dd>{APP_VERSION}</dd>
          </div>
          <div className="about-row">
            <dt>Build date</dt>
            <dd>{formatBuildDate(BUILD_DATE)}</dd>
          </div>
        </dl>
      </div>
    </>
  );
}
