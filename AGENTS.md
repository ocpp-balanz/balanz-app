# Project Blueprint: Balanz EV Charging Interface

## Scope
Build a small React application, wrapped with Capacitor for iOS and Android, that also runs in a browser during development.

The product is a utilitarian EV charger monitor and control UI working as a light-weight frontend towards the Balanz OCPP system. Balanz is described in https://balanz.readthedocs.io/en/latest/. Source code is at https://github.com/ocpp-balanz/balanz. 

While Balanz also has a full web UI, this app is meant to be a minimal scope App focusing on monitoring and simpler charger session modifications.

## Product Rules
- Keep the UI dense, fast, and functional.
- Avoid decorative or marketing-style visuals.
- Require login before the main dashboard is shown.
- The charger screen should show the selected charger and its live status.
- The root screen's header shows the signed-in user, with their role one
  click away in the account menu, so it is always clear which account's
  permissions are in effect. Do not duplicate the same detail in both the
  trigger and the menu it opens.
- The group screen displays basic status information concerning all groups
  and their chargers, and is where the active charger is selected. It is the
  navigation root; the charger screen is the detail view drilled into from
  it, returning via a back arrow. Do not add a second, redundant charger
  picker elsewhere.
- All control actions must be routed through the backend API.
- Gate every control on the signed-in user's role so the UI never offers an
  action the backend would reject.
- Data refreshes automatically on a user-configurable interval; do not add
  manual refresh buttons.
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
- The hamburger menu holds navigation to the group screen plus utility
  actions (server settings, about). Keep navigation visually prominent and
  the utility actions understated.
- Sign out belongs to the header's identity chip, not the drawer - the
  account and the action that ends its session stay together.
- The charger detail view should emphasize current OCPP status and session information.
- Prefer direct manipulation over separate form controls where it fits: the
  dial itself is the current-limit control, applying once on release rather
  than on every drag tick.
- Display user-friendly charger aliases before technical charger IDs.
- Session data should highlight start time, kWh charged, current power, current amperage, and recent history.
- Background refreshes should update state without forcing manual page reloads.
- Keep the codebase small and easy to reason about. Hand-rolled SVG is
  preferred over pulling in charting or icon libraries; where an icon has a
  balanz-ui counterpart, reuse that icon's path data so the two match.

## Workflow
- **Always keep `AGENTS.md` and `README.md` up to date as part of the same
  change** — never as a follow-up task, and never waiting to be asked. If a
  change alters behaviour, navigation, permissions, controls, or the API
  surface, update the README section describing it; if it alters an intended
  product or technical rule, update this file too. Both should always
  describe the app as it currently is, not as it once was. See `CLAUDE.md`
  for the full checklist of what triggers a docs update.
- Bump the `version` in `package.json` for user-visible releases. It is
  injected at build time and surfaced under About, so it only changes after
  a rebuild / dev-server restart (see "Version & build info" in the README).
- Update the README whenever setup or runtime steps change.
- Keep `package.json` scripts aligned with the actual web and Capacitor workflow.
- Keep the Node version consistent across `engines.node` in `package.json`,
  `.nvmrc`, and the Dockerfile build stage. It is currently 22, set by
  `@capacitor/cli`'s `>=22` requirement; a mismatch shows up as `EBADENGINE`
  warnings on every install.
- Regenerate `package-lock.json` (`npm install --package-lock-only`) after
  editing `package.json` — including version bumps. `npm ci`, which the
  Docker build uses, fails when the two disagree.
- Keep the `Dockerfile` / `docker-compose.yml` / `nginx.conf.template` aligned with the
  actual build output (`dist/`) if the build tooling or output path changes -
  this is the served path for devices (e.g. iOS Safari) that can't run the
  Vite dev server or a Capacitor build directly.
- Prefer changes that improve browser and mobile parity together.
- Use `VITE_API_BASE_URL=http://localhost:8000` when testing against the local gateway.
