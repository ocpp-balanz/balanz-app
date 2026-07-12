/**
 * Centralized networking module for the Balanz app.
 *
 * Talks to the Balanz OCPP server's WebSocket API (see
 * https://balanz.readthedocs.io/en/latest/api.html). All commands are sent as
 * `[2, messageId, command, payload]` and answered with either
 * `[3, messageId, payload]` (success) or `[4, messageId, payload]` (error).
 *
 * VITE_API_BASE_URL configures the backend, e.g. http://localhost:8000. The
 * scheme is translated to ws/wss and the API path is appended automatically.
 */

const AUTH_TOKEN_KEY = 'balanz.authToken';
const SELECTED_CHARGER_KEY = 'balanz.selectedChargerId';
const API_BASE_URL_KEY = 'balanz.apiBaseUrl';
const REFRESH_INTERVAL_KEY = 'balanz.refreshIntervalSeconds';
const SUBPROTOCOLS = ['ocpp1.6'];
const CALL_TIMEOUT_MS = 20000;

// The app always auto-refreshes (selected charger + groups) in the
// background; only the interval is user-configurable, from the Settings
// panel. 30s is a floor to avoid hammering the backend by mistake.
export const MIN_REFRESH_INTERVAL_SECONDS = 30;
export const DEFAULT_REFRESH_INTERVAL_SECONDS = 60;

function readStorage(key, fallback = '') {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    if (value === null || value === undefined || value === '') {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage errors (e.g. private browsing).
  }
}

// The server address is configurable at runtime (Settings panel) so the
// native Android build - a fixed APK that end users can't rebuild - can be
// pointed at a real server instead of the http://localhost:8000 build-time
// default. A stored override always wins over VITE_API_BASE_URL. Changing
// it requires a reload (see setApiBaseUrl below) since the WebSocket client
// below is only constructed once, at module load.
const DEFAULT_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').trim();
const RAW_BASE_URL = (readStorage(API_BASE_URL_KEY) || DEFAULT_BASE_URL).trim();

// Balanz UserType roles (balanz/user.py). Roles combine API access with UI
// screens - mirrored here so the app can hide/disable controls the backend
// would reject anyway, instead of surfacing a NotAuthorized round-trip.
export const USER_TYPES = {
  STATUS: 'Status',
  ANALYSIS: 'Analysis',
  SESSION_PRIORITY: 'SessionPriority',
  TAGS: 'Tags',
  ADMIN: 'Admin',
};

// SetTxProfile / RemoteStartTransaction / RemoteStopTransaction are not in
// any role's API_ALLOW list server-side, so only Admin may call them.
export function canControlCharging(userType) {
  return userType === USER_TYPES.ADMIN;
}

// SetChargePriority is allowed for SessionPriority, Tags, and Admin.
export function canSetChargePriority(userType) {
  return [USER_TYPES.SESSION_PRIORITY, USER_TYPES.TAGS, USER_TYPES.ADMIN].includes(userType);
}

// Known error codes returned by the Balanz API, mapped to user-facing text.
const ERROR_MESSAGES = {
  NotAuthorized: 'You are not authorized to perform this action.',
  InvalidLogin: 'Invalid user ID or password.',
  NoSuchCharger: 'That charger could not be found.',
  NoSuchGroup: 'That group could not be found.',
  ChargerNotConnected: 'The charger is not currently connected to the backend.',
  NoSuchConnector: 'That connector does not exist on this charger.',
  ConnectorNotInTransaction: 'This connector has no active charging session.',
  InvalidParameters: 'The request was missing required parameters.',
  IllegalArguments: 'The request was missing required parameters.',
  ProtocolError: 'The request was malformed.',
  PriorityNotSupplied: 'A priority value is required.',
};

function deriveWebsocketUrl(baseUrl) {
  let url = baseUrl;
  if (/^https:\/\//i.test(url)) {
    url = url.replace(/^https:\/\//i, 'wss://');
  } else if (/^http:\/\//i.test(url)) {
    url = url.replace(/^http:\/\//i, 'ws://');
  } else if (!/^wss?:\/\//i.test(url)) {
    url = `ws://${url}`;
  }
  url = url.replace(/\/$/, '');
  if (!/\/api$/i.test(url)) {
    url = `${url}/api`;
  }
  return url;
}

const BALANZ_WS_URL = deriveWebsocketUrl(RAW_BASE_URL);

export class ApiError extends Error {
  constructor(code, message, data) {
    super(message || code || 'Request failed');
    this.name = 'ApiError';
    this.code = code || 'Error';
    this.data = data;
  }
}

function isAuthErrorCode(code) {
  return code === 'NotAuthorized' || code === 'InvalidLogin';
}

export function isAuthError(error) {
  return error instanceof ApiError && isAuthErrorCode(error.code);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function toNullableNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Errors from the API arrive either as a plain string or as {status: "Code"}. */
function errorFromPayload(payload) {
  let code;
  if (typeof payload === 'string') {
    code = payload;
  } else if (payload && typeof payload === 'object' && payload.status) {
    code = String(payload.status);
  } else {
    code = 'Error';
  }
  const message = ERROR_MESSAGES[code] || code;
  return new ApiError(code, message, payload);
}

// ---------------------------------------------------------------------------
// Normalization: convert Balanz model.py `external()` payloads into a shape
// that is convenient to render, without losing any information (raw is kept).
// ---------------------------------------------------------------------------

function normalizeChargingHistoryEntry(entry = {}) {
  return {
    timestamp: entry.timestamp ?? null,
    offered: toNullableNumber(entry.offered),
    usage: toNullableNumber(entry.usage),
  };
}

// Some chargers are configured for "Free Vending" (no RFID scan required to
// start a session). There is no explicit flag for this in the Balanz model -
// operators typically register a tag whose id/user name is just the
// charger's own id as a workaround. Detect that pattern so the UI can label
// it clearly instead of showing the charger id as if it were a person.
function detectFreeVending(idTag, userName, chargerId) {
  if (!chargerId) {
    return false;
  }
  const normalizedChargerId = chargerId.trim().toLowerCase();
  const candidates = [idTag, userName].filter(Boolean).map((value) => String(value).trim().toLowerCase());
  return candidates.includes(normalizedChargerId);
}

function normalizeTransaction(transaction = {}, chargerId = '') {
  const energyMeterWh = toNullableNumber(transaction.energy_meter);
  const meterStartWh = toNullableNumber(transaction.meter_start);
  const chargingHistory = Array.isArray(transaction.charging_history)
    ? transaction.charging_history.map(normalizeChargingHistoryEntry)
    : [];
  const idTag = transaction.id_tag ?? null;
  const userName = transaction.user_name ?? null;

  // energy_meter is the meter's cumulative reading, not the energy used this
  // session - meter_start is usually 0 (the meter resets at session start),
  // but where it isn't, energy_meter alone overstates what this session
  // actually delivered. Subtract it so "energy charged" is always the
  // session's own delta, whether or not meter_start happens to be 0.
  // Clamped to 0 as a safety net against a corrupt/rolled-over meter_start.
  const energyKwh =
    energyMeterWh !== null ? Math.max(0, (energyMeterWh - (meterStartWh ?? 0)) / 1000) : null;

  return {
    idTag,
    userName,
    isFreeVending: detectFreeVending(idTag, userName, chargerId),
    startTime: transaction.start_time ?? null,
    meterStartWh,
    energyMeterWh,
    energyKwh,
    usageMeterA: toNullableNumber(transaction.usage_meter),
    chargingHistory,
    raw: transaction,
  };
}

function normalizeConnector(connectorId, source = {}, chargerId = '') {
  const rawStatus = source.status;
  const status = rawStatus && rawStatus !== 'None' ? String(rawStatus) : 'Unknown';

  return {
    connectorId: String(connectorId),
    transactionId: source.transaction_id ?? null,
    offered: toNullableNumber(source.offered),
    status,
    priority: toNumber(source.priority, 0),
    evMaxUsage: toNullableNumber(source.ev_max_usage),
    suspendUntil: source.suspend_until ?? null,
    transaction: source.transaction ? normalizeTransaction(source.transaction, chargerId) : null,
    raw: source,
  };
}

function pickActiveConnector(connectors = []) {
  if (!Array.isArray(connectors) || connectors.length === 0) {
    return null;
  }
  return (
    connectors.find((connector) => connector.transaction) ||
    connectors.find((connector) => connector.status.toLowerCase() !== 'available') ||
    connectors[0]
  );
}

function normalizeCharger(source = {}) {
  const chargerId = String(source.charger_id ?? '').trim();
  const alias = String(source.alias ?? '').trim();
  const connectorsSource = source.connectors && typeof source.connectors === 'object' ? source.connectors : {};
  const connectors = Object.entries(connectorsSource)
    .map(([connectorId, connector]) => normalizeConnector(connectorId, connector, chargerId))
    .sort((a, b) => Number(a.connectorId) - Number(b.connectorId));
  const activeConnector = pickActiveConnector(connectors);
  const networkConnected = Boolean(source.network_connected);
  const status = activeConnector ? activeConnector.status : networkConnected ? 'Available' : 'Offline';

  return {
    chargerId,
    alias: alias || chargerId,
    groupId: source.group_id ?? null,
    priority: toNumber(source.priority, 0),
    description: source.description ?? '',
    connMax: toNumber(source.conn_max, 16),
    chargePointModel: source.charge_point_model ?? null,
    chargePointVendor: source.charge_point_vendor ?? null,
    firmwareVersion: source.firmware_version ?? null,
    networkConnected,
    status,
    connectors,
    activeConnector,
    session: activeConnector ? activeConnector.transaction : null,
    raw: source,
  };
}

function normalizeGroup(source = {}) {
  const chargersRaw = Array.isArray(source.chargers) ? source.chargers : [];
  const hasDetails = chargersRaw.length > 0 && typeof chargersRaw[0] === 'object';
  const maxAllocationNow = Array.isArray(source.max_allocation_now) ? source.max_allocation_now : null;

  return {
    groupId: source.group_id,
    description: source.description || source.group_id,
    isAllocationGroup: source.max_allocation !== null && source.max_allocation !== undefined,
    maxAllocationNow: maxAllocationNow && maxAllocationNow.length > 0 ? maxAllocationNow[0][1] : null,
    offered: toNullableNumber(source.offered),
    usage: toNullableNumber(source.usage),
    chargers: hasDetails
      ? chargersRaw.map(normalizeCharger)
      : chargersRaw.map((chargerId) => ({ chargerId: String(chargerId) })),
    raw: source,
  };
}

// ---------------------------------------------------------------------------
// WebSocket client. Owns the connection, login/session state, retries and
// message correlation. All API calls above go through `call()`.
// ---------------------------------------------------------------------------

class BalanzWebsocketClient {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.connected = false;
    this.userType = '';
    this.token = '';
    this.lastError = '';
    this._pending = new Map();
    this._connectPromise = null;
    this._messageCounter = 0;
    this._sendQueue = Promise.resolve();
    this._shouldReconnect = false;
    this._reconnectDelayMs = 1000;
    this._reconnectTimer = null;
  }

  async connect() {
    // Check the socket's actual readyState, not just our own `connected`
    // bookkeeping - mobile browsers/WebViews can suspend a WebSocket while
    // the app is backgrounded without ever firing onclose, so `connected`
    // can be stale-true for a socket that's really dead. Trusting it alone
    // caused the first request after resuming from background to fail with
    // a "no connection" error even though the app looked otherwise fine.
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return this.ws;
    }
    if (this._connectPromise) {
      return this._connectPromise;
    }

    this._connectPromise = new Promise((resolve, reject) => {
      let settled = false;
      let ws;
      try {
        ws = new WebSocket(this.url, SUBPROTOCOLS);
      } catch (error) {
        this._connectPromise = null;
        reject(new ApiError('ConnectionError', 'Could not open a connection to the backend.'));
        return;
      }
      this.ws = ws;

      const settleResolve = (value) => {
        if (settled) return;
        settled = true;
        this._connectPromise = null;
        resolve(value);
      };
      const settleReject = (error) => {
        if (settled) return;
        settled = true;
        this._connectPromise = null;
        reject(error);
      };

      ws.onopen = () => {
        this.connected = true;
        this.lastError = '';
        this._reconnectDelayMs = 1000;
        if (this.token) {
          // A freshly opened socket has no memory of a previous login - the
          // Balanz server tracks auth per-connection. If we already have
          // credentials from an earlier login (this is a reconnect, e.g.
          // after the OS killed a backgrounded socket), re-send Login on
          // this socket before treating it as ready. Without this, the very
          // next command (GetGroups/GetChargers) comes back NotAuthorized on
          // the new-but-unauthenticated connection, which looked to the app
          // - and the user - like the whole session had expired.
          this.call('Login', { token: this.token })
            .then(() => settleResolve(ws))
            .catch((error) => settleReject(error));
        } else {
          settleResolve(ws);
        }
      };

      ws.onmessage = (event) => this._handleMessage(event.data);

      ws.onerror = () => {
        this.lastError = 'WebSocket error';
      };

      ws.onclose = () => {
        this.connected = false;
        this.ws = null;
        this._failPending(new ApiError('ConnectionError', 'Connection to the backend was lost.'));
        if (!settled) {
          settleReject(new ApiError('ConnectionError', 'Could not open a connection to the backend.'));
        }
        if (this._shouldReconnect && this.token) {
          this._scheduleReconnect();
        }
      };
    });

    return this._connectPromise;
  }

  disconnect() {
    this._shouldReconnect = false;
    this.token = '';
    this.userType = '';
    if (this._reconnectTimer) {
      window.clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Ignore close errors.
      }
    }
    this.connected = false;
    this.ws = null;
    this._failPending(new ApiError('Disconnected', 'Disconnected.'));
  }

  async login({ username, password } = {}) {
    const token = `${username || ''}${password || ''}`;
    if (!username || !password) {
      throw new ApiError('InvalidLogin', 'A user ID and password are required.');
    }
    return this._loginWithToken(token, { persist: true });
  }

  async resumeStoredLogin() {
    const token = getStoredAuthToken();
    if (!token) {
      throw new ApiError('InvalidLogin', 'No stored session found.');
    }
    return this._loginWithToken(token, { persist: false });
  }

  async _loginWithToken(token, { persist }) {
    this._shouldReconnect = true;
    await this.connect();
    const payload = await this.call('Login', { token });
    if (!payload || typeof payload !== 'object' || !payload.user_type) {
      throw new ApiError('InvalidLogin', 'Login failed.');
    }
    this.token = token;
    this.userType = String(payload.user_type);
    if (persist) {
      storeAuthToken(token);
    }
    return { userType: this.userType };
  }

  async call(command, payload = {}, timeoutMs = CALL_TIMEOUT_MS) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.connect();
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new ApiError('ConnectionError', 'The backend connection is not available.');
    }

    const messageId = this._nextMessageId();
    const promise = new Promise((resolve, reject) => {
      this._pending.set(messageId, { resolve, reject });
    });

    const message = JSON.stringify([2, messageId, command, payload]);
    this._sendQueue = this._sendQueue.catch(() => undefined).then(async () => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        throw new ApiError('ConnectionError', 'The backend connection is not available.');
      }
      this.ws.send(message);
    });

    try {
      await this._sendQueue;
    } catch (error) {
      this._pending.delete(messageId);
      throw error;
    }

    return Promise.race([
      promise,
      delay(timeoutMs).then(() => {
        if (this._pending.has(messageId)) {
          this._pending.delete(messageId);
          throw new ApiError('Timeout', `Timed out waiting for a response to ${command}.`);
        }
        return undefined;
      }),
    ]);
  }

  async fetchChargerDetails(chargerIdOrAlias) {
    const key = String(chargerIdOrAlias || '').trim();
    if (!key) {
      throw new ApiError('InvalidParameters', 'A charger id or alias is required.');
    }

    let candidates = normalizeChargerListPayload(await this.call('GetChargers', { charger_id: key }));
    let match = candidates.find((c) => c.charger_id === key);

    if (!match) {
      candidates = normalizeChargerListPayload(await this.call('GetChargers', { alias: key }));
      match = candidates.find((c) => c.charger_id === key || c.alias === key);
    }

    if (!match) {
      throw new ApiError('NoSuchCharger', ERROR_MESSAGES.NoSuchCharger);
    }

    return normalizeCharger(match);
  }

  async fetchChargers({ groupId } = {}) {
    const payload = groupId ? { group_id: groupId } : {};
    const list = normalizeChargerListPayload(await this.call('GetChargers', payload));
    return list.map(normalizeCharger);
  }

  async fetchGroups({ chargerDetails = true } = {}) {
    const list = await this.call('GetGroups', { charger_details: chargerDetails });
    return (Array.isArray(list) ? list : []).map(normalizeGroup);
  }

  async setTxProfile({ chargerId, connectorId, transactionId, limit }) {
    return this.call('SetTxProfile', {
      charger_id: chargerId,
      connector_id: Number(connectorId) || 1,
      transaction_id: transactionId,
      limit,
    });
  }

  async remoteStopTransaction({ chargerId, transactionId }) {
    return this.call('RemoteStopTransaction', {
      charger_id: chargerId,
      transaction_id: transactionId,
    });
  }

  async setChargePriority({ chargerId, connectorId, priority }) {
    return this.call('SetChargePriority', {
      charger_id: chargerId,
      connector_id: Number(connectorId) || 1,
      priority,
    });
  }

  _scheduleReconnect() {
    if (this._reconnectTimer) {
      return;
    }
    const delayMs = this._reconnectDelayMs;
    this._reconnectDelayMs = Math.min(this._reconnectDelayMs * 2, 30000);
    this._reconnectTimer = window.setTimeout(() => {
      this._reconnectTimer = null;
      if (!this._shouldReconnect || !this.token) {
        return;
      }
      // connect() itself now re-authenticates on the new socket when
      // this.token is set (see ws.onopen above), so there's no need to
      // separately call _loginWithToken here.
      this.connect().catch((error) => {
        this.lastError = error instanceof Error ? error.message : String(error);
        this._scheduleReconnect();
      });
    }, delayMs);
  }

  _nextMessageId() {
    this._messageCounter += 1;
    return String(this._messageCounter);
  }

  _handleMessage(rawMessage) {
    let message;
    try {
      message = JSON.parse(rawMessage);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      return;
    }

    if (!Array.isArray(message) || message.length < 3) {
      return;
    }

    const [messageType, messageId, payload] = message;
    const entry = this._pending.get(String(messageId));
    if (!entry) {
      return;
    }
    this._pending.delete(String(messageId));

    if (messageType === 3) {
      entry.resolve(payload);
      return;
    }

    if (messageType === 4) {
      entry.reject(errorFromPayload(payload));
      return;
    }

    entry.reject(new ApiError('ProtocolError', `Unexpected message type ${messageType}.`));
  }

  _failPending(error) {
    for (const entry of this._pending.values()) {
      entry.reject(error);
    }
    this._pending.clear();
  }
}

/** GetChargers can return a bare array, or (defensively) be wrapped. */
function normalizeChargerListPayload(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (Array.isArray(payload?.chargers)) {
    return payload.chargers;
  }
  return [];
}

const client = new BalanzWebsocketClient(BALANZ_WS_URL);

// ---------------------------------------------------------------------------
// Public module API
// ---------------------------------------------------------------------------

export function getApiBaseUrl() {
  return RAW_BASE_URL;
}

export function getDefaultApiBaseUrl() {
  return DEFAULT_BASE_URL;
}

export function hasApiBaseUrlOverride() {
  return Boolean(readStorage(API_BASE_URL_KEY, ''));
}

// Persists the override and requires a reload to take effect (the
// WebSocket client is constructed once from RAW_BASE_URL at module load).
export function setApiBaseUrl(url) {
  writeStorage(API_BASE_URL_KEY, String(url || '').trim());
}

export function clearApiBaseUrl() {
  writeStorage(API_BASE_URL_KEY, '');
}

// Background polling (selected charger + groups) always runs; only the
// interval is configurable, from the Settings panel. Invalid/too-low stored
// values fall back to the default rather than being silently clamped on
// every read, so a bad value in localStorage can't creep below the floor.
export function getRefreshIntervalSeconds() {
  const stored = Number(readStorage(REFRESH_INTERVAL_KEY, ''));
  if (!Number.isFinite(stored) || stored < MIN_REFRESH_INTERVAL_SECONDS) {
    return DEFAULT_REFRESH_INTERVAL_SECONDS;
  }
  return Math.round(stored);
}

export function setRefreshIntervalSeconds(seconds) {
  const clamped = Math.max(MIN_REFRESH_INTERVAL_SECONDS, Math.round(Number(seconds) || DEFAULT_REFRESH_INTERVAL_SECONDS));
  writeStorage(REFRESH_INTERVAL_KEY, String(clamped));
}

export async function login(credentials) {
  return client.login(credentials);
}

export async function resumeStoredLogin() {
  return client.resumeStoredLogin();
}

export function logout() {
  client.disconnect();
  clearAuthToken();
}

export function clearAuthToken() {
  writeStorage(AUTH_TOKEN_KEY, '');
}

export function hasStoredAuthToken() {
  return Boolean(getStoredAuthToken());
}

export function getStoredAuthToken() {
  return readStorage(AUTH_TOKEN_KEY, '');
}

export function storeAuthToken(token) {
  writeStorage(AUTH_TOKEN_KEY, token);
}

export function getStoredSelectedChargerId() {
  return readStorage(SELECTED_CHARGER_KEY, '');
}

export function storeSelectedChargerId(chargerId) {
  writeStorage(SELECTED_CHARGER_KEY, chargerId);
}

export function clearSelectedChargerId() {
  writeStorage(SELECTED_CHARGER_KEY, '');
}

export async function fetchChargerDetails(chargerIdOrAlias) {
  return client.fetchChargerDetails(chargerIdOrAlias);
}

export async function fetchChargers(filters) {
  return client.fetchChargers(filters);
}

export async function fetchGroups(options) {
  return client.fetchGroups(options);
}

export async function setTxProfile(payload) {
  return client.setTxProfile(payload);
}

export async function remoteStopTransaction(payload) {
  return client.remoteStopTransaction(payload);
}

export async function setChargePriority(payload) {
  return client.setChargePriority(payload);
}

export function getConnectionStatus() {
  return {
    connected: client.connected,
    userType: client.userType,
    lastError: client.lastError,
  };
}
