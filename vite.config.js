import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Read the version from package.json rather than hardcoding it a second
// time here, so bumping the app version only ever means editing one file.
const packageJson = JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8'));

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
