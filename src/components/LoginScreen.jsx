import React, { useState } from 'react';

import { getApiBaseUrl } from '../apiClient';
import balanzLogo from '../images/balanz.png';
import SettingsPanel from './SettingsPanel';

// The Android Capacitor build is a single-page app that never navigates
// after submitting the login form, so the WebView's usual heuristic for
// offering to save a password (which waits for a page navigation) never
// fires - unlike a regular browser tab. Explicitly using the standard
// Credential Management API works around this: it tells Chromium (desktop
// Chrome and Android's WebView, which is Chromium-based) to prompt the user
// to save the credential right away. It's a no-op (feature-detected) on
// browsers that don't support it, such as Safari/iOS.
async function trySaveCredential(username, password) {
  if (typeof window === 'undefined' || !window.PasswordCredential || !navigator.credentials) {
    return;
  }
  try {
    const credential = new window.PasswordCredential({ id: username, password, name: username });
    await navigator.credentials.store(credential);
  } catch {
    // Best-effort only - ignore if the platform blocks or doesn't support it.
  }
}

export default function LoginScreen({ loading, error, onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    const success = await onLogin({ username, password });
    if (success) {
      await trySaveCredential(username, password);
    }
  }

  return (
    <div className="auth-shell">
      <button className="settings-trigger ghost-button" type="button" onClick={() => setSettingsOpen(true)}>
        Server settings
      </button>

      <div className="auth-card panel">
        <div className="auth-brand">
          <img className="auth-logo" src={balanzLogo} alt="Balanz" />
          <p className="eyebrow">Balanz access</p>
          <h1>Sign in</h1>
          <p className="subtle">Use your Balanz user ID and password to continue to the charger monitor.</p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>User ID</span>
            <input
              type="text"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="operator"
              required
            />
          </label>

          <label className="field">
            <span>Password</span>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Password"
              required
            />
          </label>

          {error ? <div className="alert alert-error">{error}</div> : null}

          <button className="primary-button auth-button" type="submit" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <p className="subtle auth-footer">
          Connected to <code>{getApiBaseUrl()}</code>
        </p>
      </div>

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
