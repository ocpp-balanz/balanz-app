import React, { useEffect, useState } from 'react';

import {
  clearApiBaseUrl,
  DEFAULT_REFRESH_INTERVAL_SECONDS,
  getApiBaseUrl,
  getDefaultApiBaseUrl,
  getRefreshIntervalSeconds,
  hasApiBaseUrlOverride,
  MIN_REFRESH_INTERVAL_SECONDS,
  setApiBaseUrl,
  setRefreshIntervalSeconds,
} from '../apiClient';

// The server address and refresh interval are stored in localStorage (works
// the same way for the browser build and the Capacitor Android WebView -
// both persist it on the device, no extra native plugin needed). The
// WebSocket client and the polling intervals are only set up once at module
// load, so applying a change just reloads the app rather than trying to
// hot-swap a live connection/timer.
export default function SettingsPanel({ open, onClose }) {
  const [address, setAddress] = useState('');
  const [refreshSeconds, setRefreshSeconds] = useState(DEFAULT_REFRESH_INTERVAL_SECONDS);

  useEffect(() => {
    if (open) {
      setAddress(getApiBaseUrl());
      setRefreshSeconds(getRefreshIntervalSeconds());
    }
  }, [open]);

  if (!open) {
    return null;
  }

  function handleSave(event) {
    event.preventDefault();
    const trimmed = address.trim();
    if (!trimmed) {
      return;
    }
    setApiBaseUrl(trimmed);
    setRefreshIntervalSeconds(refreshSeconds);
    window.location.reload();
  }

  function handleReset() {
    clearApiBaseUrl();
    window.location.reload();
  }

  return (
    <>
      <button type="button" className="menu-backdrop is-open" aria-label="Close settings" onClick={onClose} />

      <div className="modal-panel panel">
        <div className="modal-panel-header">
          <div>
            <p className="section-kicker">Settings</p>
            <h3>Server &amp; refresh</h3>
          </div>
          <button className="ghost-button" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <form className="auth-form" onSubmit={handleSave}>
          <label className="field">
            <span>Balanz server address</span>
            <input
              type="text"
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="http://192.168.1.10:8000"
              autoComplete="off"
            />
          </label>

          <label className="field">
            <span>Refresh interval (seconds)</span>
            <input
              type="number"
              min={MIN_REFRESH_INTERVAL_SECONDS}
              step="5"
              value={refreshSeconds}
              onChange={(event) => setRefreshSeconds(event.target.value)}
            />
          </label>

          <p className="subtle">
            The app connects to this address over WebSocket and refreshes automatically at the interval above
            (minimum {MIN_REFRESH_INTERVAL_SECONDS}s, default {DEFAULT_REFRESH_INTERVAL_SECONDS}s). Saving reloads
            the app.
          </p>

          <div className="action-row">
            <button className="primary-button" type="submit">
              Save &amp; reload
            </button>
            {hasApiBaseUrlOverride() ? (
              <button className="secondary-button" type="button" onClick={handleReset}>
                Reset address to default ({getDefaultApiBaseUrl()})
              </button>
            ) : null}
          </div>
        </form>
      </div>
    </>
  );
}
