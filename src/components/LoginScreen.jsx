import React, { useState } from 'react';

import { getApiBaseUrl } from '../apiClient';
import balanzLogo from '../images/balanz.png';
import SettingsPanel from './SettingsPanel';

// Best-effort only: navigator.credentials.store()/PasswordCredential is a
// non-standard, largely-abandoned API (MDN marks it deprecated/non-standard)
// and is generally not implemented at all inside an embedded WebView like
// Capacitor's Android build - only in the full Chrome browser app, which has
// its own Password Manager UI to show the prompt in. It's feature-detected
// and silently skipped where unsupported (Safari/iOS, and likely the Android
// WebView build too).
//
// The mechanism that actually matters for saving a password inside the
// Android WebView build is the OS-level Autofill framework (Android 8+),
// which needs no JS API at all: it watches the real <form>/<input> elements
// for correct `autocomplete` hints and for the form being submitted and then
// removed from the DOM (which happens here automatically, since App.jsx
// unmounts <LoginScreen> the moment authState flips to 'authenticated'). If
// no save prompt appears on a device, check that a password manager is set
// as the device's Autofill service under Settings > System > Languages &
// input > Autofill service, rather than assuming this function is at fault.
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
              name="username"
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
              name="password"
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
