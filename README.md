# Balanz EV Charging Interface

A small, dense React app for monitoring and lightly controlling EV chargers
managed by [Balanz](https://balanz.readthedocs.io/en/latest/), an OCPP 1.6
central system with smart-charging (load balancing) support. The app talks
directly to the Balanz WebSocket API — see
https://balanz.readthedocs.io/en/latest/api.html — there is no separate REST
gateway; this is a thin client over that WebSocket protocol.

It runs in the browser during development and is wrapped with
[Capacitor](https://capacitorjs.com/) for iOS and Android builds.

## Scope

- Sign in with a Balanz user ID and password. Styling follows the same light
  Material Design palette as [balanz-ui](../balanz-ui) (the web dashboard) —
  MUI's default blue accent, Roboto, white panels on a light grey background.
- View the currently selected charger's live OCPP status via a real circular
  dial (offered current vs. the charger's max) plus session data (start
  time, energy charged, estimated power, current draw, session user).
- View a live, reusable step chart of offered vs. used current over the
  session's `charging_history` — the same `ChargingHistoryChart` component
  is meant to be reused later for browsing historic (closed) sessions, since
  it takes only a raw history array as input and has no fetch logic of its
  own.
- Adjust the current limit on an active session, adjust session priority, or
  stop a session — gated by the charger's group type and the signed-in
  user's role (see "Group types & permissions" below).
- Switch between chargers from the menu.
- View a groups screen with basic allocation/usage status per group, and pick
  a charger from any group.
- Sessions started without an RFID scan ("Free Vending" chargers) are shown
  with a "Free vending" badge instead of a misleading user name (see
  "Free Vending sessions" below).
- The server address is configurable at runtime from a Settings panel
  (reachable pre-login and from the menu), not just at build time — see
  "Server address (runtime setting)" below.
- On successful login, the app asks the browser/WebView to save the
  credential so it doesn't need to be retyped — see "Saving the login on
  Android" below.
- Background refresh (selected charger + groups, every 30s) can be turned
  on or off from a header toggle, and defaults to on. The manual Refresh
  button always works regardless of this setting.

All control actions (current limit changes, priority changes, stop) are
routed through the centralized API client in `src/apiClient.js`, which owns
the WebSocket connection, login/session state, retries/reconnects, and error
handling.

## Group types & permissions

Balanz groups come in two kinds (see
https://balanz.readthedocs.io/en/latest/smartcharging.html and
https://balanz.readthedocs.io/en/latest/glossary.html):

- **Allocation / SmartCharging groups** (`max_allocation` is set) — Balanz's
  own backend algorithm continuously rebalances each charger's current
  offer to stay within the group's shared capacity. **The app never lets a
  user set a current limit directly on a charger in one of these groups** —
  doing so would fight the backend's control loop. Instead, the app exposes
  a session **priority** control (0–10), which Balanz's allocation algorithm
  takes into account when dividing capacity.
- **Non-allocation groups** — Balanz does not run the balancing loop here,
  so the app exposes direct current-limit control as before.

Controls are further gated by the signed-in user's `UserType` (mirroring the
server-side `API_ALLOW` permissions in `balanz/api.py`), so the UI never
offers an action the backend would reject:

| Action | Required role(s) |
| --- | --- |
| Stop a session, set a current limit | `Admin` only |
| Set session priority | `SessionPriority`, `Tags`, or `Admin` |

Users without the right role see a plain explanation instead of a control
that would just fail server-side.

## Free Vending sessions

Some chargers are configured for "Free Vending" — no RFID tag scan is
required to start a session. Balanz has no dedicated flag for this; in
practice, operators register a tag whose id/name is simply the charger's own
id as a workaround. The app detects that pattern (`id_tag` or `user_name`
matching the charger id) and shows a "Free vending" badge in the session's
User field instead of displaying the charger id as if it were a person.

## Server address (runtime setting)

`VITE_API_BASE_URL` (below) is just the *build-time default*. The actual
address used at runtime is resolved as: a value saved via the in-app
**Settings** panel, if any, otherwise that build-time default. This matters
most for the native Android build, since it's a fixed APK end users can't
rebuild themselves — they need a way to point it at their real server
without a developer involved.

Open Settings from the "Server settings" button on the sign-in screen (so it
works before you've ever logged in) or from the hamburger menu once signed
in. Saving an address stores it in `localStorage` — which persists the same
way on the web build and inside the Capacitor Android WebView, so no extra
native plugin is needed — and reloads the app so the change takes effect
(the WebSocket client is only constructed once, at startup). "Reset to
default" clears the override and reloads back to the build-time
`VITE_API_BASE_URL`. Changing the address effectively starts a fresh
session: sign in again against the new server.

See `getApiBaseUrl` / `setApiBaseUrl` / `clearApiBaseUrl` in
`src/apiClient.js` and `src/components/SettingsPanel.jsx`.

## Saving the login on Android

In a regular browser tab, Chrome offers to save a submitted password because
it detects a page navigation right after the form submit. This app is a
single-page app that never navigates, so on Android that heuristic never
fires and the native "Save password?" prompt doesn't appear — even though
the same build works fine in desktop Chrome, which has more lenient SPA
heuristics.

`LoginScreen.jsx` works around this by explicitly calling the standard
[Credential Management API](https://developer.mozilla.org/en-US/docs/Web/API/Credential_Management_API)
(`navigator.credentials.store(new PasswordCredential(...))`) right after a
successful login. This directly triggers the save prompt instead of relying
on the browser's heuristics, and works on both desktop Chrome and Android's
WebView (both Chromium-based). It's feature-detected and silently skipped on
browsers that don't support it, such as Safari/iOS — no separate native
plugin was needed.

## Requirements

- Node.js 18+
- A reachable Balanz server (see the
  [Balanz repo](https://github.com/ocpp-balanz/balanz) for running one
  locally) with at least one user configured in `users.csv`.

## Setup

```bash
npm install
```

Configure the backend URL in `.env.local` (already present with a sensible
local default):

```env
VITE_API_BASE_URL=http://localhost:8000
```

The app derives the WebSocket URL from this value automatically
(`http` → `ws`, `https` → `wss`, appending `/api`). Point it at wherever your
Balanz server's host/port are, e.g. `https://ocpp.example.com` for a
deployment behind TLS. You can copy [`.env.example`](./.env.example) to
`.env.local` and adjust it as needed.

Optionally set `VITE_ASSUMED_VOLTAGE_V` (defaults to `230`) and
`VITE_ASSUMED_PHASES` (defaults to `3`). Balanz reports live current draw in
Amps only, not power, so the app estimates kW as `phases x voltage x amps`
(the standard EU convention: 230V phase voltage, 3-phase connection).
Adjust these if a site uses a single-phase connection or a different
voltage.

Some EVs can only charge on a single phase even when plugged into a 3-phase
charger. For those sessions, a 3-phase estimate would overstate the power
several-fold relative to the energy the meter actually accrues. The app
detects this per session — by comparing the session's measured energy
(`energy_meter`) against what the assumed phase count predicts from the
observed current over the elapsed session time — and automatically falls
back to a 1-phase estimate for that session's "Power (est.)" figure,
labelling it "1-phase" so it's clear the fallback kicked in. This only
affects the display; it has no effect on Balanz's own charging behavior.

## Run

```bash
npm run dev
```

Opens the Vite dev server (default http://localhost:5173). Sign in with a
`user_id`/password pair from the Balanz server's `users.csv`.

## Build

```bash
npm run build
npm run preview   # serve the production build locally
```

## Capacitor (iOS / Android)

The `android/` native project is already scaffolded (`capacitor.config.json`
points `webDir` at `dist`). To add iOS as well, run once:

```bash
npm run build
npm run cap:add:ios
```

After any web build, sync the native projects and open them in
Android Studio / Xcode:

```bash
npm run build
npm run cap:sync
npm run cap:open:android
npm run cap:open:ios
```

Native builds bake in `VITE_API_BASE_URL` as the *default* address at build
time, so point it at a URL reachable from the device (not `localhost`)
before building for a phone or emulator if possible. End users can also
override it later from the in-app Settings panel without a rebuild — see
"Server address (runtime setting)" above.

## API contract

The app authenticates via the `Login` command, sending `token` as the
concatenation of `user_id` and `password` (matched server-side against a
sha256 in `users.csv`). Charger data comes from `GetChargers` /
`GetGroups`, matching the raw Balanz model shape:

- `charger_id`, `alias`, `group_id`, `priority`, `description`, `conn_max`
- `network_connected` (whether the charger currently has an OCPP link)
- `connectors`, keyed by connector id, each with `status`, `offered`,
  `transaction_id`, and (when charging) a `transaction` object with
  `id_tag`, `user_name`, `start_time`, `meter_start`, `usage_meter`,
  `energy_meter`, and `charging_history`

Groups (`GetGroups`) additionally expose `max_allocation` (non-null marks an
allocation/SmartCharging group — see "Group types & permissions" above) and
`max_allocation_now`.

Control actions use `SetTxProfile` (current limit, Admin-only),
`SetChargePriority` (session priority, `SessionPriority`/`Tags`/`Admin`) and
`RemoteStopTransaction` (stop, Admin-only). See `src/apiClient.js` for the
full mapping, normalization, and the `USER_TYPES` / `canControlCharging` /
`canSetChargePriority` role helpers.

## Project structure

```
src/
  apiClient.js                    Centralized WebSocket API client (auth, calls, normalization, roles)
  App.jsx                         Top-level state/routing (dashboard vs. groups view)
  styles.css                      Light theme (MUI-style palette matching balanz-ui)
  components/
    LoginScreen.jsx               Sign-in form, saves credential via Credential Management API
    SettingsPanel.jsx             Runtime server-address editor (modal, reachable pre/post login)
    MenuDrawer.jsx                Hamburger menu: groups nav, charger switcher, settings, sign out
    GroupsScreen.jsx              Group status + charger picker
    DialComponent.jsx             Selected charger detail, session data, controls
    ChargingDial.jsx / .css       Reusable circular ring gauge (offered / max current)
    ChargingHistoryChart.jsx/.css Reusable step chart of offered vs. usage current over time
    DialStyles.css                Styling for the charger detail view
```

## Notes

- Browser support is first-class; no native-only behavior is used for core
  flows.
- The backend is treated as the source of truth — the app does not cache or
  guess charger state beyond what the API returns.
- The upper-left hamburger menu is the main way to switch chargers, jump to
  the groups screen, and sign out.
- Balanz has no battery state-of-charge (%) or pricing data in its model, so
  the dial and controls intentionally show real backend-sourced metrics
  (current in Amps, estimated power) rather than inventing a percentage or
  cost figure.
- `ChargingDial` and `ChargingHistoryChart` are hand-rolled SVG components
  (no charting library) to keep the app small, per the project's own
  "keep the codebase small and easy to reason about" guideline — even though
  balanz-ui itself uses MUI + `@mui/x-charts`.
