# Project Blueprint: Balanz EV Charging Interface

## Scope
Build a small React application, wrapped with Capacitor for iOS and Android, that also runs in a browser during development.

The product is a utilitarian EV charger monitor and control UI working as a light-weight frontend towards the Balanz OCPP system. Balanz is described in https://balanz.readthedocs.io/en/latest/. Source code is at https://github.com/ocpp-balanz/balanz. 

While Balanz also has a full web UI, this app is meant to be a minimal scope App focusing on monitoring and simpler charger session modifications.

## Product Rules
- Keep the UI dense, fast, and functional.
- Avoid decorative or marketing-style visuals.
- Require login before the main dashboard is shown.
- The main screen should show the currently selected charger and its live status.
- A group screen can be used to display basic status information concerning all groups, and to change selection of active charger.
- The user must be able to switch between chargers from the menu.
- All control actions must be routed through the backend API.
- Browser support is required; do not depend on native-only behavior for core flows.

## Technical Rules
- Use React with Vite for the web build.
- Use Capacitor for native shell builds.
- Keep networking in a centralized API client module.
- Handle auth, retries, and errors consistently in that client.
- Prefer simple functional components and React hooks.
- Use environment variables for backend URLs and other deployment-specific settings.

## Data And API Assumptions
- The backend is the Balanz OCPP server. API is described in https://balanz.readthedocs.io/en/latest/api.html.
- The app should treat backend responses as the source of truth.
- Charger selection changes should load the selected charger's details.
- Charger detail payloads should prefer the Balanz OCPP-style shape with `charger_id`, `alias`, `status`, `network_connected`, and connector session data.

## Implementation Notes
- The login screen should be minimal and direct.
- The hamburger menu should hold access to group menu, charger switching and sign out actions.
- The charger detail view should emphasize current OCPP status and session information.
- Display user-friendly charger aliases before technical charger IDs.
- Session data should highlight start time, kWh charged, current power, current amperage, and recent history.
- Background refreshes should update state without forcing manual page reloads.
- Keep the codebase small and easy to reason about.

## Workflow
- Update the README whenever setup or runtime steps change.
- Keep `package.json` scripts aligned with the actual web and Capacitor workflow.
- Keep the `Dockerfile` / `docker-compose.yml` / `nginx.conf` aligned with the
  actual build output (`dist/`) if the build tooling or output path changes -
  this is the served path for devices (e.g. iOS Safari) that can't run the
  Vite dev server or a Capacitor build directly.
- Prefer changes that improve browser and mobile parity together.
- Use `VITE_API_BASE_URL=http://localhost:8000` when testing against the local gateway.
