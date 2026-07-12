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
- The selected charger's data always refreshes automatically in the
  background (`GetChargers`); the interval is a Settings panel field
  (minimum 30s, default 60s) rather than a fixed value — see "Server address
  (runtime setting)" below, which now also covers this. The groups list is
  deliberately *not* polled in the background (only fetched once on login
  and on demand via the Groups screen's own "Refresh" button), to avoid an
  extra recurring `GetGroups` call on top of the charger's own refresh.
- After a control action (current limit, priority, stop), an extra one-off
  refresh runs 10s later on top of the immediate one, since the backend
  needs a moment to actually apply the change.
- The full charging graph opens in a large modal on demand (a "View
  charging graph" button), instead of being squeezed into the page
  permanently — see "Charging graph" below.

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

## Server address & refresh interval (runtime settings)

`VITE_API_BASE_URL` (below) is just the *build-time default*. The actual
address used at runtime is resolved as: a value saved via the in-app
**Settings** panel, if any, otherwise that build-time default. This matters
most for the native Android build, since it's a fixed APK end users can't
rebuild themselves — they need a way to point it at their real server
without a developer involved.

The same panel also sets the background refresh interval (in seconds,
minimum 30, default 60) used for both the selected charger's detail and the
groups list — the app always refreshes automatically at this interval;
there is no on/off toggle.

Open Settings from the "Server settings" button on the sign-in screen (so it
works before you've ever logged in) or from the hamburger menu once signed
in. Saving stores both values in `localStorage` — which persists the same
way on the web build and inside the Capacitor Android WebView, so no extra
native plugin is needed — and reloads the app so the changes take effect
(the WebSocket client and the polling intervals are only set up once, at
startup). "Reset address to default" clears the server address override and
reloads back to the build-time `VITE_API_BASE_URL`. Changing the address
effectively starts a fresh session: sign in again against the new server.

See `getApiBaseUrl` / `setApiBaseUrl` / `clearApiBaseUrl` /
`getRefreshIntervalSeconds` / `setRefreshIntervalSeconds` in
`src/apiClient.js` and `src/components/SettingsPanel.jsx`.

## Charging graph

The step chart of offered vs. used current (`ChargingHistoryChart`) opens in
a large modal via a "View charging graph" button at the bottom of the main
overview card (no separate card of its own), rather than always rendering
inline — at its default inline size it would be cramped and partially cut
off the bottom of the screen on a phone. See `src/components/DialComponent.jsx`
(the `graphOpen` state and the `.modal-panel.is-wide` modal) and
`src/components/ChargingHistoryChart.jsx` (reused as-is, just rendered
larger via its `height` prop).

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
voltage. This is a fixed, site-wide assumption — the app does not attempt to
detect per-session phase count from the data Balanz reports.

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

## Docker (serving the built app)

For trying the app on a device that can't run the Vite dev server directly —
e.g. Safari on iOS, which has no Capacitor build in this repo yet — you can
serve the production build from a small container instead:

```bash
docker compose up --build
```

This builds the app (Node, multi-stage) and serves the static `dist/` output
via nginx on `http://localhost:8081` by default. From another device on the
same network, use this machine's LAN IP instead of `localhost`
(`http://<lan-ip>:8081`) — same idea as reaching the Vite dev server from a
phone, just pointed at a container instead of `npm run dev`.

Two things are configurable, both optional:

- `HOST_PORT` — which host port nginx is published on (default `8081`).
- `VITE_API_BASE_URL` — the build-time default backend address (default
  `http://localhost:8000`), baked in the same way the Capacitor builds do
  (see "Capacitor (iOS / Android)" above). It remains overridable afterwards
  from the in-app Settings panel without rebuilding the image.

Set either via a shell env var or a `.env` file in this directory (Docker
Compose's own convention — separate from Vite's `.env.local` used by
`npm run dev`), e.g.:

```bash
HOST_PORT=8081 VITE_API_BASE_URL=https://ocpp.example.com docker compose up --build
```

Serving over plain HTTP is fine even when the backend is `wss://` — the
browser only blocks *insecure* `ws://` from an HTTPS page, not the other way
around. This setup doesn't provide TLS itself; put a reverse proxy in front
if you need `https://` for the app itself (not required for this app's own
functionality).

### Reverse proxying `/api` (keeping the OCPP server off the public internet)

By default the app talks directly to whatever `VITE_API_BASE_URL` points at
— fine for a Balanz server you're already comfortable exposing, but not if
your organization wants to keep the OCPP server itself internal-only. Since
all backend traffic already goes through one path (`/api`, see
`src/apiClient.js`), the container's own nginx can proxy that path to the
real Balanz server instead of the browser talking to it directly:

```
Browser (anywhere) --https/wss--> this container (public) --ws (LAN only)--> Balanz OCPP server (internal-only)
```

To use this mode:

1. Set `VITE_API_BASE_URL` to this app's *own* public address (not
   Balanz's) — e.g. `https://ocpp.example.com`, the same address the app
   itself is served from. The app then calls same-origin `/api`.
2. Set `BALANZ_UPSTREAM` to the real Balanz server's `host:port` as reached
   from *inside* the container (a LAN address, e.g. `192.168.1.50:9111`) —
   this stays off the public internet entirely; only the container itself
   needs to be reachable from outside.

```bash
HOST_PORT=8081 \
VITE_API_BASE_URL=https://ocpp.example.com \
BALANZ_UPSTREAM=192.168.1.50:9111 \
docker compose up --build
```

The proxying is defined in [`nginx.conf.template`](./nginx.conf.template)
(templated so `${BALANZ_UPSTREAM}` is substituted at container start by
nginx's own `envsubst` entrypoint step — see comments in that file). Leaving
`BALANZ_UPSTREAM` unset and `VITE_API_BASE_URL` pointed directly at Balanz
(the default, as in the section above) simply leaves this location block
unused — the two modes coexist without conflicting.

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
Dockerfile                        Multi-stage build: npm build -> nginx serving dist/ (see "Docker" above)
docker-compose.yml                Builds and runs the Dockerfile, publishing nginx on HOST_PORT (default 8081)
nginx.conf.template                SPA fallback + optional /api reverse proxy (see "Docker" above), templated via envsubst at container start
src/
  apiClient.js                    Centralized WebSocket API client (auth, calls, normalization, roles)
  App.jsx                         Top-level state/routing (dashboard vs. groups view)
  styles.css                      Light theme (MUI-style palette matching balanz-ui)
  components/
    LoginScreen.jsx               Sign-in form, saves credential via Credential Management API
    SettingsPanel.jsx             Runtime server-address & refresh-interval editor (modal, reachable pre/post login)
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
- Success notices (e.g. after changing priority) auto-dismiss after 5
  seconds; errors stay on screen until the user takes another action.
- The WebSocket client checks the socket's actual `readyState` rather than
  a manually tracked flag, and the app proactively refreshes when the
  browser/WebView tab becomes visible again — mobile OSes can silently kill
  a backgrounded socket without firing its close handler, which previously
  caused a stale "no connection" error on the first request after resuming.
- Reconnecting after a dropped socket re-sends `Login` on the new connection
  before treating it as ready, since Balanz tracks auth per-connection, not
  per-token. Without this, a reconnect (e.g. after resuming from background)
  looked to the app like the whole session had expired, when really only the
  underlying socket needed to re-authenticate.
- `ChargingDial` and `ChargingHistoryChart` are hand-rolled SVG components
  (no charting library) to keep the app small, per the project's own
  "keep the codebase small and easy to reason about" guideline — even though
  balanz-ui itself uses MUI + `@mui/x-charts`.
