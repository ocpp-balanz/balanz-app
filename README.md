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
- View a groups screen with basic allocation/usage status per group, plus
  live per-charger stats, and pick a charger from any group. This is the
  app's navigation root and its only charger picker — see "Navigation"
  below.
- View the selected charger's live OCPP status via a real circular dial
  (offered current vs. the charger's max) plus session data (start time,
  energy charged, estimated power, current draw, session user).
- View a live, reusable step chart of offered vs. used current over the
  session's `charging_history` — the same `ChargingHistoryChart` component
  is meant to be reused later for browsing historic (closed) sessions, since
  it takes only a raw history array as input and has no fetch logic of its
  own.
- Adjust the current limit on an active session by **dragging the dial
  itself**, adjust session priority with a stepper, or start/stop a session
  — gated by the charger's group type and the signed-in user's role (see
  "Group types & permissions" and "Charger controls" below).
- Sessions started without an RFID scan ("Free Vending" chargers) are shown
  with a "Free vending" badge instead of a misleading user name (see
  "Free Vending sessions" below).
- The server address is configurable at runtime from a Settings panel
  (reachable pre-login and from the menu), not just at build time — see
  "Server address & refresh interval (runtime settings)" below.
- On successful login, the app asks the browser/WebView to save the
  credential so it doesn't need to be retyped — see "Saving the login on
  Android" below.
- Data refreshes automatically in the background at a Settings-panel
  interval (minimum 30s, default 60s) rather than a fixed value: the
  selected charger's detail (`GetChargers`) whenever a charger is selected,
  and the groups list (`GetGroups`) **only while the groups screen is
  actually open**. Polling groups in the background from other screens would
  be an extra recurring call on top of the charger's own refresh, for data
  nobody is looking at. There are no manual "Refresh" buttons.
- After a control action (current limit, priority, start, stop) the app
  schedules a single one-off refresh 5s later — and deliberately does *not*
  refresh immediately, since the backend needs a moment to apply the change
  and an instant reload just redisplays the pre-change state.
- The app version and build timestamp are shown under **About** in the menu
  — see "Version & build info" below.

All control actions (current limit changes, priority changes, start, stop)
are routed through the centralized API client in `src/apiClient.js`, which
owns the WebSocket connection, login/session state, retries/reconnects, and
error handling.

## Navigation

The app is a two-level hierarchy, navigated the standard way rather than via
a menu of peer destinations:

- **Groups & status is the root.** It lists every group (accordion-style,
  collapsed by default) with each group's chargers and their live stats, and
  is the only place chargers are picked. The hamburger in the header's
  leading slot opens the drawer here.
- **The charger dashboard is the detail view**, drilled into by tapping a
  charger. Its header swaps the hamburger for a **back arrow** returning to
  the groups list, and shows the charger's alias as the title.

The root screen's header also shows **who is signed in**, top right: a pill
with the user name and a caret. Clicking it opens the account menu, which
repeats the name, adds the role, and is where **Sign out** lives — the
identity and the action that ends it belong together, rather than sign-out
sitting in the drawer away from any indication of whose session it would
end. Signing out is behind that click rather than on the pill itself, so the
pill stays a passive "who am I" indicator that can't be mis-tapped into
ending the session.

The pill deliberately shows only the name: the role is one click away in the
menu, and Balanz user names are short enough that the full name fits even on
a phone. It is shown on **every** screen, not just the root — sign out lives
behind it, so restricting it to one view stranded anyone who landed on the
charger view, which is exactly what happens on launch when a
previously-selected charger is remembered. For the same reason the header
is `flex-wrap: nowrap`: the title ellipsizes rather than pushing the pill
onto a second line where it could scroll out of reach.

Because the Balanz `Login` response returns only `user_type`, and the auth
token is an opaque `user_id + password` concatenation that cannot be split
back apart, the user id typed at sign-in is stored alongside the token
purely so it can be displayed here — including after a stored-session
resume. It is cleared on sign-out.

A session that began *before* that id was stored therefore resumes with a
valid token but no id. The chip falls back to a generic "Account" label in
that case rather than hiding itself: it is the only route to sign out, so
rendering nothing would strand the user with no way out. Signing out and
back in fills the id in.

The drawer therefore holds one primary nav item (Groups & status, marked as
current when it is) plus the understated utility actions (server settings,
about) pinned to the bottom. Choosing either of those closes the drawer
before opening the panel, so a modal never stacks on top of a still-open
drawer. Those are reached from the root, one step back
from anywhere — so "back" and "menu" never contend for the same slot in the
header. Sign out is not in the drawer; it's in the account menu on the
identity chip, described below.

On launch the app opens the last-selected charger if one is remembered, and
the groups list otherwise.

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
| Start a session, stop a session, set a current limit | `Admin` only |
| Set session priority | `SessionPriority`, `Tags`, or `Admin` |

Users without the right role see a plain explanation instead of a control
that would just fail server-side.

## Charger controls

All of these live in the charger dashboard, directly on or under the dial:

- **Current limit — drag the dial.** In non-allocation groups (and for
  `Admin` users), the ring doubles as the control: dragging its handle sets
  the limit. The change is applied once, on release (`SetTxProfile`), not on
  every intermediate drag tick, so there's no separate "Apply" step and no
  stream of backend calls mid-drag. Keyboard/arrow-key stepping is
  deliberately not wired up, since each keypress would otherwise apply its
  own change.
  Valid set-points are **0 A or 6 A and above** — Balanz/OCPP won't accept
  1–5 A, so the dial snaps out of that dead zone to whichever end is nearer.
  0 A is genuinely useful: it makes the charger settle into `SuspendedEVSE`
  rather than stopping the session.
- **Start / stop — Play and Stop icon buttons** below the dial, shown only
  to `Admin` users. Stopping issues `RemoteStopTransaction`. Starting opens
  a small dialog first, because `RemoteStartTransaction` requires an
  `id_tag` the backend cannot invent (a real session normally begins with an
  RFID scan at the charger); the field is prefilled with the charger's own
  id, the same convention this app already uses to detect and label
  "Free vending" sessions.
- **Session priority — a −/value/+ stepper** (allocation groups only),
  applied with its own button.
- **Charging graph — a QueryStats icon button** next to Play/Stop, matching
  balanz-ui's own icon for the same thing. Unlike Play/Stop it isn't
  Admin-gated: anyone who can see a session with history can view its graph.

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
groups list (the latter only while the groups screen is open) — the app
always refreshes automatically at this interval; there is no on/off toggle
and no manual refresh button.

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
a wide modal via the QueryStats icon button next to Play/Stop, rather than
always rendering inline — at its default inline size it would be cramped and
partially cut off the bottom of the screen on a phone. See
`src/components/DialComponent.jsx` (the `graphOpen` state and the
`.modal-panel.is-wide` modal) and `src/components/ChargingHistoryChart.jsx`
(reused as-is, just rendered larger via its `height` prop).

The chart sizes itself from its container's *measured* width (a
`ResizeObserver` feeding the SVG `viewBox`) instead of assuming a fixed one,
and its height comes solely from the `height` prop. Both matter because SVG
text scales with the ratio of rendered size to `viewBox` size: with a fixed
guess, axis labels came out illegibly small on a narrow phone and oversized
in the wide desktop modal, and a `height: auto` CSS rule additionally locked
the chart's height to its width, stretching it into a tall, scrolling,
mostly-empty column. Width and height are now independent.

## Version & build info

The **About** entry in the menu shows the app version and the build
timestamp. Both are injected at build time by Vite's `define`
(`vite.config.js`) and read back through `src/version.js`:

- the version comes from `package.json`, so bumping a release means editing
  one file;
- the build date is captured when `vite build` / `vite dev` starts, since a
  static bundle has no other way to know when it was produced.

Because both are baked in at build time, a version bump is only visible
after the bundle is rebuilt — editing `package.json` alone will not change
what About reports:

- **Rebuild** (`npm run build`) before serving `dist/` (Docker/nginx, or a
  Capacitor `cap:sync`); a stale `dist/` keeps showing the old version. With
  Docker, `dist/` is baked into the image, so rebuild the image
  (`docker compose up --build`) — rebuilding only on the host changes
  nothing the container serves.
- **Restart the dev server** after a bump — `vite.config.js` reads
  `package.json` once, when the config loads.
- If an **installed PWA** still shows the old version, see "Deploying
  updates to an installed PWA" below.

## Deploying updates to an installed PWA

An installed (Add to Home Screen) copy is served by a service worker, so a
new deployment only reaches it once that worker updates. Three things have
to line up, and all three are configured in this repo:

1. **The server must not cache the entry points.** `index.html` names the
   current build's content-hashed asset files, and `sw.js` is what the
   browser checks for updates. Without an explicit `Cache-Control`, nginx
   sends only `Last-Modified`/`ETag` and browsers apply *heuristic* caching
   — inventing their own freshness lifetime and potentially serving a stale
   `index.html` for a long time, which pins the app to the old bundle no
   matter what the service worker is set to do. `nginx.conf.template`
   therefore serves `index.html`, `sw.js` and the manifest as `no-cache`,
   while `/assets/` (content-hashed, so a change always means a new name)
   is cached immutably for a year.
2. **The worker updates without prompting** — `registerType: 'autoUpdate'`
   in `vite.config.js`.
3. **Something has to trigger the check.** `autoUpdate` only checks at
   registration time, i.e. on page load, and an installed app is usually
   *resumed* rather than reloaded. `src/main.jsx` registers the worker
   itself (hence `injectRegister: null`) and additionally calls
   `registration.update()` hourly and whenever the app returns to the
   foreground.

If an install is already stuck on an old build from before these were in
place, relaunching it once or twice should recover it (the browser
re-fetches `sw.js` bypassing the HTTP cache). Failing that, open the same
URL in a normal browser tab and hard-reload, or uninstall and re-add the
app.

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

- Node.js 22+ (`engines.node` in `package.json`, `.nvmrc`, and the
  Dockerfile's build stage all say 22). `@capacitor/cli` requires `>=22`, so
  an older runtime makes `npm install` / `npm ci` emit `EBADENGINE` warnings
  for the whole install — even though the web build itself doesn't use the
  Capacitor CLI.
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
"Server address & refresh interval (runtime settings)" above.

## Docker (serving the built app)

For trying the app on a device that can't run the Vite dev server directly —
e.g. Safari on iOS, which has no Capacitor build in this repo yet — you can
serve the production build from a small container instead:

```bash
docker compose up --build
```

This builds the app (Node 22, multi-stage) and serves the static `dist/`
output via nginx on `http://localhost:8081` by default. From another device on the
same network, use this machine's LAN IP instead of `localhost`
(`http://<lan-ip>:8081`) — same idea as reaching the Vite dev server from a
phone, just pointed at a container instead of `npm run dev`.

Two `npm warn deprecated` lines (for `glob@11` and `source-map@0.8.0-beta.0`)
are expected during the image build. Both come from `workbox-build`, a
transitive dependency of `vite-plugin-pwa`, which is already on its latest
release — there is nothing to update on our side, and neither package ships
in the output. Anything mentioning `EBADENGINE`, on the other hand, means the
build ran on a Node older than 22 (see "Requirements" above).

`npm audit` findings are likewise confined to the build toolchain (the
Vite/workbox chain). The runtime dependency tree is just React and
`@capacitor/core`/`app`, so those advisories don't reach the served bundle.

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

### Reverse proxying `/api` (not a security boundary)

By default the app talks directly to whatever `VITE_API_BASE_URL` points at.
Since all backend traffic already goes through one path (`/api`, see
`src/apiClient.js`), the container's own nginx can instead proxy that path
to the real Balanz server, so the browser only ever addresses this
container rather than Balanz's own host/port directly:

```
Browser (anywhere) --https/wss--> this container (public) --ws (LAN only)--> Balanz OCPP server
```

**This is not a way to keep the OCPP API off the internet.** The proxy is a
transparent relay — it forwards the exact same `Login` handshake and every
subsequent command byte-for-byte, with no added authentication or
restriction on which commands can be sent. Anyone who can reach the
container's public URL can do everything they could do by reaching Balanz
directly; only Balanz's internal network address is hidden, not its API
surface. It's useful for consolidating TLS/hostname handling in one place,
not for satisfying a "the OCPP server must not be reachable from outside"
requirement. For that, the real fix is a server-side component that
terminates the browser connection with its own auth and only forwards a
curated set of operations — a backend-for-frontend, not a byte-level proxy.

To use this mode anyway:

1. Set `VITE_API_BASE_URL` to this app's *own* public address (not
   Balanz's) — e.g. `https://ocpp.example.com`, the same address the app
   itself is served from. The app then calls same-origin `/api`.
2. Set `BALANZ_UPSTREAM` to the real Balanz server's `host:port` as reached
   from *inside* the container (a LAN address, e.g. `192.168.1.50:9111`).

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
sha256 in `users.csv`). The response carries only `user_type` — see
"Navigation" above for why the user id is stored client-side to display it. Charger data comes from `GetChargers` /
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
`SetChargePriority` (session priority, `SessionPriority`/`Tags`/`Admin`),
`RemoteStartTransaction` (start, Admin-only — requires `charger_id`,
`connector_id` and `id_tag`) and `RemoteStopTransaction` (stop, Admin-only —
requires `charger_id` and `transaction_id`). See `src/apiClient.js` for the
full mapping, normalization, and the `USER_TYPES` / `canControlCharging` /
`canSetChargePriority` role helpers.

Note that `energy_meter` is the meter's cumulative reading, not the energy
delivered by the current session, so the app displays
`energy_meter - meter_start` as "Energy charged". `meter_start` is usually 0
(meters typically reset at session start), but where it isn't, the raw
`energy_meter` would overstate the session considerably.

## Project structure

```
Dockerfile                        Multi-stage build: npm build -> nginx serving dist/ (see "Docker" above)
docker-compose.yml                Builds and runs the Dockerfile, publishing nginx on HOST_PORT (default 8081)
nginx.conf.template                SPA fallback + optional /api reverse proxy (see "Docker" above), templated via envsubst at container start
src/
  main.jsx                        React entry point; also registers the PWA service worker + update polling
  apiClient.js                    Centralized WebSocket API client (auth, calls, normalization, roles)
  App.jsx                         Top-level state/routing (groups root vs. charger detail) + header nav
  version.js                      Build-time injected app version / build date (see "Version & build info")
  styles.css                      Light theme (MUI-style palette matching balanz-ui)
  components/
    LoginScreen.jsx               Sign-in form, saves credential via Credential Management API
    SettingsPanel.jsx             Runtime server-address & refresh-interval editor (modal, reachable pre/post login)
    AboutPanel.jsx                Version / build date modal, opened from the menu
    UserMenu.jsx                  Header identity chip + account menu (sign out)
    MenuDrawer.jsx                Drawer: Groups & status nav item + settings/about footer
    GroupsScreen.jsx              Group status + charger picker (the navigation root)
    DialComponent.jsx             Selected charger detail, session data, controls
    ChargingDial.jsx / .css       Circular ring gauge; doubles as the drag-to-set current control
    ChargingHistoryChart.jsx/.css Reusable step chart of offered vs. usage current over time
    DialStyles.css                Styling for the charger detail view
```

## Notes

- Browser support is first-class; no native-only behavior is used for core
  flows.
- The backend is treated as the source of truth — the app does not cache or
  guess charger state beyond what the API returns.
- Chargers are switched from the Groups & status screen (the navigation
  root), not from the menu — the drawer holds navigation to that screen plus
  account actions. See "Navigation" above.
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
  balanz-ui itself uses MUI + `@mui/x-charts`. Icons are likewise inline SVG
  paths rather than an icon package; the graph icon reuses the exact path
  data from MUI's `QueryStats` so it matches balanz-ui.
- The dial's drag handler reports its final value through a ref rather than
  reading component state: the pointer-up handler is captured once, at
  pointer-down, so anything read from props/state at that moment would be
  the value from that render, not where the user actually dragged to.
