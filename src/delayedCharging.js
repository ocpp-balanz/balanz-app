/**
 * Remembers, on this device, that a charging session was told to start later.
 *
 * Balanz deliberately keeps no record of a delayed start: the schedule lives on
 * the charger as an OCPP TxProfile, and no API call reports it back. So the app
 * has to track it itself if it wants to tell the user that a delay is pending
 * rather than show an idle charger with no explanation.
 *
 * Two consequences follow, and both are accepted rather than worked around:
 *
 * - It is per device. A delay arranged on a phone is invisible on a tablet.
 * - It is a belief, not a fact. The charger is the only authority.
 *
 * What keeps that belief honest is the transaction id. A TxProfile dies with
 * its transaction, so unplugging the car cancels the delay; recording the
 * transaction the delay belongs to means a stale note is detected and dropped
 * rather than shown against a different session.
 */

/**
 * Turn an "HH:MM" wall-clock time into the "YYYY-MM-DD HH:MM:SS" the backend
 * expects, choosing today or tomorrow - whichever makes it the next occurrence.
 *
 * Asking for 00:45 at nine in the evening plainly means tonight, not a time
 * fifteen hours gone; the backend rejects a time already past, so resolving it
 * here is what makes "00:45" mean what the user intends.
 */
export function resolveScheduleTime(hhmm, now = new Date()) {
  const [hours, minutes] = String(hhmm).split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;

  const target = new Date(now);
  target.setHours(hours, minutes, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);

  const pad = (value) => String(value).padStart(2, '0');
  return (
    `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())} ` +
    `${pad(target.getHours())}:${pad(target.getMinutes())}:00`
  );
}

/** "2026-11-23 00:45:00" -> "00:45", for display. */
export function scheduleTimeLabel(startTime) {
  return typeof startTime === 'string' && startTime.length >= 16 ? startTime.slice(11, 16) : '';
}

const STORAGE_PREFIX = 'balanz.delayedCharging.';

function readStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    if (value === null) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage errors (e.g. private browsing).
  }
}

function keyFor(chargerId) {
  return `${STORAGE_PREFIX}${chargerId}`;
}

/** Record that this charger's current session is scheduled to start at startTime. */
export function rememberSchedule({ chargerId, transactionId, startTime }) {
  if (!chargerId || !transactionId || !startTime) return;
  writeStorage(keyFor(chargerId), JSON.stringify({ transactionId, startTime }));
}

/** Forget any schedule noted for this charger. */
export function forgetSchedule(chargerId) {
  if (!chargerId) return;
  writeStorage(keyFor(chargerId), null);
}

/**
 * The start time noted for this charger's current session, or null.
 *
 * Returns null - and clears the note - when it belongs to a different
 * transaction, which is what happens once the car is unplugged and plugged in
 * again. The charger discarded the profile at that point, so continuing to show
 * the delay would be a lie.
 */
export function getSchedule({ chargerId, transactionId }) {
  if (!chargerId) return null;
  const raw = readStorage(keyFor(chargerId));
  if (!raw) return null;

  let noted;
  try {
    noted = JSON.parse(raw);
  } catch {
    forgetSchedule(chargerId);
    return null;
  }

  if (!noted || !noted.startTime || !transactionId || String(noted.transactionId) !== String(transactionId)) {
    forgetSchedule(chargerId);
    return null;
  }
  return noted.startTime;
}
