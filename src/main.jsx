import React from 'react';
import ReactDOM from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';

import App from './App';
import './styles.css';

// The service worker is registered here rather than via the plugin's
// auto-injected script, so we can also poll for new builds. `autoUpdate`
// alone only checks at registration time - i.e. on a page load. An installed
// PWA is typically resumed rather than reloaded, so it can sit on an old
// build indefinitely; these two triggers are what actually make a deployed
// update land on a phone. (The nginx config additionally has to serve
// index.html/sw.js as no-cache, or the check itself reads a stale copy -
// see nginx.conf.template.)
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

registerSW({
  immediate: true,
  onRegisteredSW(_swUrl, registration) {
    if (!registration) {
      return;
    }

    const checkForUpdate = () => {
      // Skip while offline: update() would just reject and log noise.
      if (navigator.onLine === false) {
        return;
      }
      void registration.update();
    };

    window.setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS);

    // The common case on mobile: the app was backgrounded for a while and is
    // being brought back to the foreground.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        checkForUpdate();
      }
    });
  },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
