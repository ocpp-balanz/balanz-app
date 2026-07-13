import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Read the version from package.json rather than hardcoding it a second
// time here, so bumping the app version only ever means editing one file.
const packageJson = JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8'));

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // Ships alongside the Capacitor native build, not instead of it - lets
      // the same web bundle be "Add to Home Screen"-installed on platforms
      // where the native app isn't (or can't yet be) installed.
      registerType: 'autoUpdate',
      manifest: {
        name: 'Balanz Charging Monitor',
        short_name: 'Balanz',
        description: 'Monitor and control Balanz OCPP chargers.',
        theme_color: '#1976d2',
        // Matches the logo artwork's own background so the maskable icon's
        // safe-zone padding (see public/maskable-icon-512x512.png) blends in
        // seamlessly during the launch splash rather than showing a seam.
        background_color: '#1f2025',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: {
    host: true,
  },
  define: {
    // Exposed to app code as src/version.js's APP_VERSION/BUILD_DATE, shown
    // in the hamburger menu's About panel. Captured once here (at
    // build/dev-server start), not read at runtime - a static build has no
    // other way to know its own build time.
    __APP_VERSION__: JSON.stringify(packageJson.version),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
  },
});
