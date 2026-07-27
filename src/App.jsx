import React, { useEffect, useMemo, useRef, useState } from 'react';

import {
  ApiError,
  clearAuthToken,
  clearSelectedChargerId,
  fetchChargerDetails,
  fetchGroups,
  getRefreshIntervalSeconds,
  getStoredSelectedChargerId,
  hasStoredAuthToken,
  isAuthError,
  login as loginRequest,
  logout as logoutRequest,
  remoteStartTransaction,
  remoteStopTransaction,
  resumeStoredLogin,
  setChargePriority,
  setTxProfile,
  storeSelectedChargerId,
} from './apiClient';
import DialComponent from './components/DialComponent';
import GroupsScreen from './components/GroupsScreen';
import LoginScreen from './components/LoginScreen';
import MenuDrawer from './components/MenuDrawer';
import UserMenu from './components/UserMenu';

// Read once at module load - a changed interval takes effect after the
// Settings panel's save-triggered reload, matching how the server address
// override applies (see SettingsPanel.jsx).
const REFRESH_INTERVAL_MS = getRefreshIntervalSeconds() * 1000;

// Left-pointing "up/back" arrow for returning from a charger to the groups
// list (the navigation root).
function BackIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        d="M15 5l-7 7 7 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function formatError(error) {
  if (error instanceof ApiError || error instanceof Error) {
    return error.message;
  }
  return 'Unexpected request failure.';
}

export default function App() {
  const [authState, setAuthState] = useState(() => (hasStoredAuthToken() ? 'checking' : 'unauthenticated'));
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [userType, setUserType] = useState('');
  const [userId, setUserId] = useState('');

  // 'groups' is the navigation root (the browsable list); 'dashboard' is the
  // detail view drilled into from it. Start on the dashboard only when a
  // previously-selected charger is remembered - otherwise there's nothing to
  // show there, so the list is the sensible landing screen.
  const [view, setView] = useState(() => (getStoredSelectedChargerId() ? 'dashboard' : 'groups'));
  const [menuOpen, setMenuOpen] = useState(false);

  const [selectedChargerId, setSelectedChargerId] = useState(() => getStoredSelectedChargerId());
  const [selectedCharger, setSelectedCharger] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailRefreshToken, setDetailRefreshToken] = useState(0);

  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [draftMaxCurrent, setDraftMaxCurrent] = useState(null);
  const [draftPriority, setDraftPriority] = useState(null);

  const [groups, setGroups] = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupsError, setGroupsError] = useState('');

  // group_id -> group, so the selected charger's group type (allocation /
  // SmartCharging vs. not) can be looked up without a dedicated fetch.
  const groupsIndex = useMemo(() => {
    const index = new Map();
    groups.forEach((group) => index.set(group.groupId, group));
    return index;
  }, [groups]);

  const selectedGroup = selectedCharger ? groupsIndex.get(selectedCharger.groupId) : null;
  const isAllocationGroup = Boolean(selectedGroup?.isAllocationGroup);

  function resetSession(message = '') {
    logoutRequest();
    setAuthState('unauthenticated');
    setAuthLoading(false);
    setAuthError(message);
    setUserType('');
    setUserId('');
    setMenuOpen(false);
    // Back to the navigation root - after a sign-out there's no selected
    // charger left for the dashboard to show.
    setView('groups');
    setSelectedChargerId('');
    clearSelectedChargerId();
    setSelectedCharger(null);
    setDetailLoading(false);
    setSaving(false);
    setDetailError('');
    setNotice('');
    setDraftMaxCurrent(null);
    setDraftPriority(null);
    setDetailRefreshToken(0);
    setGroups([]);
  }

  function handleAuthFailure(error) {
    if (isAuthError(error)) {
      resetSession('Your session expired. Please sign in again.');
      return true;
    }
    return false;
  }

  async function loadChargerDetails(chargerId, { quiet = false } = {}) {
    if (!chargerId) {
      setSelectedCharger(null);
      return;
    }

    if (!quiet) {
      setDetailLoading(true);
      setDetailError('');
    }

    try {
      const details = await fetchChargerDetails(chargerId);
      setSelectedCharger(details);
      setDraftMaxCurrent((current) =>
        quiet && current !== null ? current : details.activeConnector?.offered ?? details.connMax,
      );
      setDraftPriority((current) =>
        quiet && current !== null ? current : details.activeConnector?.priority ?? details.priority,
      );
    } catch (error) {
      if (handleAuthFailure(error)) return;
      // A quiet call (background poll or the visibility-resume refresh below)
      // races a possibly-stale connection on purpose - the client reconnects
      // automatically on the next call, so a transient failure here isn't
      // worth surfacing. Only report it when it's the result of something
      // the user is actively waiting on.
      if (!quiet) {
        setDetailError(formatError(error));
      }
    } finally {
      if (!quiet) {
        setDetailLoading(false);
      }
    }
  }

  async function loadGroups({ quiet = false } = {}) {
    if (!quiet) {
      setGroupsLoading(true);
      setGroupsError('');
    }
    try {
      const list = await fetchGroups({ chargerDetails: true });
      setGroups(list);
    } catch (error) {
      if (handleAuthFailure(error)) return;
      if (!quiet) {
        setGroupsError(formatError(error));
      }
    } finally {
      if (!quiet) {
        setGroupsLoading(false);
      }
    }
  }

  // Restore a stored session on load.
  useEffect(() => {
    if (authState !== 'checking') {
      return undefined;
    }

    let cancelled = false;

    async function restoreSession() {
      setAuthLoading(true);
      setAuthError('');
      try {
        const { userType: restoredUserType, userId: restoredUserId } = await resumeStoredLogin();
        if (!cancelled) {
          setUserType(restoredUserType);
          setUserId(restoredUserId);
          setAuthState('authenticated');
        }
      } catch (error) {
        if (!cancelled) {
          clearAuthToken();
          setAuthState('unauthenticated');
          setAuthError('Stored session expired. Please sign in again.');
        }
      } finally {
        if (!cancelled) {
          setAuthLoading(false);
        }
      }
    }

    void restoreSession();
    return () => {
      cancelled = true;
    };
  }, [authState]);

  // Once authenticated, load groups once (needed both for the Groups screen
  // and to know whether the selected charger's group is SmartCharging-
  // managed). There's no separate flat charger list to fetch anymore -
  // GroupsScreen's own per-group charger data is a strict superset of what
  // that used to show. No need to force the menu open when nothing is
  // selected either: `view` already defaults to the groups list in that
  // case, which is a better landing spot than an empty dashboard.
  useEffect(() => {
    if (authState !== 'authenticated') {
      return undefined;
    }
    void loadGroups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState]);

  // Groups are fetched once on login (above) and then periodically (quietly)
  // while that screen is actually open - see the effect below. They're
  // deliberately NOT polled while some other screen is showing: the selected
  // charger's own GetChargers refresh already reflects that charger's live
  // status, so a recurring GetGroups call on top of it would be extra server
  // load without extra value for the common case of watching one charger.
  useEffect(() => {
    if (authState !== 'authenticated' || view !== 'groups') {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      void loadGroups({ quiet: true });
    }, REFRESH_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState, view]);

  // Load the selected charger's detail whenever the selection changes or a
  // mutation (apply limit/priority, stop) requests a refresh.
  useEffect(() => {
    if (authState !== 'authenticated' || !selectedChargerId) {
      return undefined;
    }
    void loadChargerDetails(selectedChargerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState, selectedChargerId, detailRefreshToken]);

  // Background polling of the selected charger's detail.
  useEffect(() => {
    if (authState !== 'authenticated' || !selectedChargerId) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      void loadChargerDetails(selectedChargerId, { quiet: true });
    }, REFRESH_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState, selectedChargerId]);

  // Success notices (e.g. "Updated session priority...") are transient -
  // clear them a few seconds after they appear instead of leaving them on
  // screen forever. Errors are left alone; they need explicit attention.
  useEffect(() => {
    if (!notice) {
      return undefined;
    }
    const timeoutId = window.setTimeout(() => setNotice(''), 5000);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  // Mobile browsers/WebViews can suspend the WebSocket while the app is
  // backgrounded without ever firing its close handler, leaving `connected`
  // stale until something tries to use it (see the readyState check in
  // apiClient.js). Force an immediate refresh on resume instead of waiting
  // for the next poll tick, so the first thing the user sees isn't a stale
  // "no connection" error from a request that raced the wake-up.
  useEffect(() => {
    if (authState !== 'authenticated') {
      return undefined;
    }

    function handleVisibilityChange() {
      if (document.visibilityState !== 'visible') {
        return;
      }
      if (selectedChargerId) {
        void loadChargerDetails(selectedChargerId, { quiet: true });
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState, selectedChargerId]);

  // Tracks the latest selectedChargerId for scheduleFollowUpRefresh below,
  // since a plain closure over the state value would go stale if the user
  // switches chargers before the 5s timer fires.
  const selectedChargerIdRef = useRef(selectedChargerId);
  useEffect(() => {
    selectedChargerIdRef.current = selectedChargerId;
  }, [selectedChargerId]);

  // After a control action (current limit, priority, stop), the backend
  // needs a moment to actually apply it - the immediate refresh right after
  // the request often still shows the pre-change state. Rather than wait for
  // the next full interval tick (up to REFRESH_INTERVAL_MS later), schedule
  // one extra quiet refresh 5s out to pick up the settled state promptly.
  function scheduleFollowUpRefresh(chargerId) {
    window.setTimeout(() => {
      if (selectedChargerIdRef.current === chargerId) {
        void loadChargerDetails(chargerId, { quiet: true });
      }
    }, 5000);
  }

  async function handleLogin(credentials) {
    setAuthLoading(true);
    setAuthError('');
    try {
      const { userType: loggedInUserType, userId: loggedInUserId } = await loginRequest(credentials);
      setUserType(loggedInUserType);
      setUserId(loggedInUserId);
      setAuthState('authenticated');
      return true;
    } catch (error) {
      setAuthError(formatError(error));
      return false;
    } finally {
      setAuthLoading(false);
    }
  }

  function handleSelectCharger(chargerId) {
    setSelectedChargerId(chargerId);
    storeSelectedChargerId(chargerId);
    setMenuOpen(false);
    setView('dashboard');
    setNotice('');
    setDetailError('');
    setDraftMaxCurrent(null);
    setDraftPriority(null);
    setDetailRefreshToken((value) => value + 1);
  }

  function handleOpenGroups() {
    setMenuOpen(false);
    setView('groups');
  }

  async function handleApplyCurrentLimit(nextCurrent) {
    const connector = selectedCharger?.activeConnector;
    if (!selectedCharger || !connector || !connector.transactionId) {
      setDetailError('No active session is available for current limit changes.');
      return;
    }

    setSaving(true);
    setDetailError('');
    setNotice('');

    try {
      await setTxProfile({
        chargerId: selectedCharger.chargerId,
        connectorId: connector.connectorId,
        transactionId: connector.transactionId,
        limit: nextCurrent,
      });
      setNotice(`Updated current limit to ${nextCurrent} A.`);
      // Deliberately no immediate (non-quiet) refresh here - the backend
      // needs a moment to apply the change, so an immediate reload tends to
      // just redisplay the pre-change state. scheduleFollowUpRefresh below
      // is the only refresh triggered by this action.
      scheduleFollowUpRefresh(selectedCharger.chargerId);
    } catch (error) {
      if (handleAuthFailure(error)) return;
      setDetailError(formatError(error));
    } finally {
      setSaving(false);
    }
  }

  async function handleApplyPriority(nextPriority) {
    const connector = selectedCharger?.activeConnector;
    if (!selectedCharger || !connector) {
      setDetailError('No active session is available for priority changes.');
      return;
    }

    setSaving(true);
    setDetailError('');
    setNotice('');

    try {
      await setChargePriority({
        chargerId: selectedCharger.chargerId,
        connectorId: connector.connectorId,
        priority: nextPriority,
      });
      setNotice(`Updated session priority to ${nextPriority}.`);
      scheduleFollowUpRefresh(selectedCharger.chargerId);
    } catch (error) {
      if (handleAuthFailure(error)) return;
      setDetailError(formatError(error));
    } finally {
      setSaving(false);
    }
  }

  // Unlike stopping, remote-starting a session needs an id_tag the backend
  // can't invent itself (a real session normally starts with an RFID scan).
  // The caller is DialComponent's start-charging dialog, which prompts the
  // admin for a tag rather than us guessing one silently.
  async function handleStartTransaction(idTag) {
    const connector = selectedCharger?.activeConnector || selectedCharger?.connectors?.[0];
    const trimmedTag = String(idTag || '').trim();
    if (!selectedCharger || !connector) {
      setDetailError('No connector is available to start a session on.');
      return;
    }
    if (!trimmedTag) {
      setDetailError('An ID tag is required to start a session.');
      return;
    }

    setSaving(true);
    setDetailError('');
    setNotice('');

    try {
      await remoteStartTransaction({
        chargerId: selectedCharger.chargerId,
        connectorId: connector.connectorId,
        idTag: trimmedTag,
      });
      setNotice('Start request sent.');
      scheduleFollowUpRefresh(selectedCharger.chargerId);
    } catch (error) {
      if (handleAuthFailure(error)) return;
      setDetailError(formatError(error));
    } finally {
      setSaving(false);
    }
  }

  async function handleStopTransaction() {
    const connector = selectedCharger?.activeConnector;
    if (!selectedCharger || !connector || !connector.transactionId) {
      setDetailError('No active session is available to stop.');
      return;
    }

    setSaving(true);
    setDetailError('');
    setNotice('');

    try {
      await remoteStopTransaction({
        chargerId: selectedCharger.chargerId,
        transactionId: connector.transactionId,
      });
      setNotice('Stop request sent.');
      scheduleFollowUpRefresh(selectedCharger.chargerId);
    } catch (error) {
      if (handleAuthFailure(error)) return;
      setDetailError(formatError(error));
    } finally {
      setSaving(false);
    }
  }

  function handleLogout() {
    resetSession('');
  }

  if (authState === 'checking') {
    return (
      <div className="auth-shell">
        <div className="auth-card panel">
          <div>
            <p className="eyebrow">Balanz access</p>
            <h1>Connecting</h1>
            <p className="subtle">
              {authLoading ? 'Restoring your Balanz session...' : 'Checking for a stored Balanz session...'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (authState !== 'authenticated') {
    return <LoginScreen loading={authLoading} error={authError} onLogin={handleLogin} />;
  }

  return (
    <div className="app-shell">
      <MenuDrawer
        open={menuOpen}
        currentView={view}
        onClose={() => setMenuOpen(false)}
        onOpenGroups={handleOpenGroups}
      />

      {/* Standard hierarchical-navigation header: a single leading slot,
          holding the hamburger at the root (groups list) and a back arrow
          on the drilled-into charger view. The drawer is reached from the
          root only - one step back from anywhere - so "back" and "menu"
          never compete for the same spot. */}
      <header className="app-header main-header">
        <div className="header-left">
          {view === 'dashboard' ? (
            <button
              className="menu-button"
              type="button"
              aria-label="Back to groups"
              title="Back to groups"
              onClick={() => setView('groups')}
            >
              <BackIcon />
            </button>
          ) : (
            <button
              className="menu-button"
              type="button"
              aria-label="Open menu"
              onClick={() => setMenuOpen(true)}
            >
              <span />
              <span />
              <span />
            </button>
          )}
          <h1>{view === 'dashboard' ? selectedCharger?.alias || 'Balanz' : 'Balanz'}</h1>
        </div>

        {/* Who's signed in, and the account menu (sign out) - shown on the
            root screen only. The charger view deliberately stays uncluttered
            (its header already carries the charger's own name), and the
            identity is one step back anyway. */}
        {view === 'groups' ? (
          <UserMenu userId={userId} userType={userType} onLogout={handleLogout} />
        ) : null}
      </header>

      {(detailError || notice) && (
        <section className="alerts">
          {detailError ? <div className="alert alert-error">{detailError}</div> : null}
          {notice ? <div className="alert alert-success">{notice}</div> : null}
        </section>
      )}

      <main className="main-layout">
        {view === 'groups' ? (
          <GroupsScreen
            groups={groups}
            loading={groupsLoading}
            error={groupsError}
            selectedChargerId={selectedChargerId}
            onSelectCharger={handleSelectCharger}
          />
        ) : selectedCharger ? (
          <section className="panel detail-panel">
            <DialComponent
              charger={selectedCharger}
              loading={detailLoading}
              saving={saving}
              draftMaxCurrent={draftMaxCurrent}
              onDraftMaxCurrentChange={setDraftMaxCurrent}
              onApplyMaxCurrent={handleApplyCurrentLimit}
              onStartTransaction={handleStartTransaction}
              onStopTransaction={handleStopTransaction}
              isAllocationGroup={isAllocationGroup}
              userType={userType}
              draftPriority={draftPriority}
              onDraftPriorityChange={setDraftPriority}
              onApplyPriority={handleApplyPriority}
            />
          </section>
        ) : (
          <section className="panel detail-panel">
            {detailLoading ? (
              <div className="empty-state">Loading charger details...</div>
            ) : (
              // Reachable only if a stored charger id no longer resolves -
              // give a way out rather than a dead-end instruction.
              <div className="empty-state">
                <p>No charger selected.</p>
                <button className="primary-button" type="button" onClick={() => setView('groups')}>
                  Browse groups &amp; status
                </button>
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
