import React, { useEffect, useState } from 'react';

import { clearApiBaseUrl, getApiBaseUrl, getDefaultApiBaseUrl, hasApiBaseUrlOverride, setApiBaseUrl } from '../apiClient';

// The server address is stored in localStorage (works the same way for the
// browser build and the Capacitor Android WebView - both persist it on the
// device, no extra native plugin needed). The WebSocket client is only
// constructed once at module load, so applying a change just reloads the
// app rather than trying to hot-swap a live connection.
export default function SettingsPanel({ open, onClose }) {
  const [address, setAddress] = useState('');

  useEffect(() => {
    if (open) {
      setAddress(getApiBaseUrl());
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
    window.location.reload();
  }

  function handleReset() {
    clearApiBaseUrl();
    window.location.reload();
  }

  return (
    <>
      <button type="button" className="menu-backdrop is-open" aria-label="Close settings" onClick={onClose} />

      <div className="settings-panel panel">
        <div className="settings-panel-header">
          <div>
            <p className="section-kicker">Settings</p>
            <h3>Server address</h3>
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

          <p className="subtle">The app connects to this address over WebSocket. Saving reloads the app.</p>

          <div className="action-row">
            <button className="primary-button" type="submit">
              Save &amp; reload
            </button>
            {hasApiBaseUrlOverride() ? (
              <button className="secondary-button" type="button" onClick={handleReset}>
                Reset to default ({getDefaultApiBaseUrl()})
              </button>
            ) : null}
          </div>
        </form>
      </div>
    </>
  );
}
