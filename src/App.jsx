import React, { useEffect, useMemo, useState } from 'react';

import {
  ApiError,
  clearAuthToken,
  clearSelectedChargerId,
  fetchChargerDetails,
  fetchChargers,
  fetchGroups,
  getAutoRefreshEnabled,
  getStoredSelectedChargerId,
  hasStoredAuthToken,
  isAuthError,
  login as loginRequest,
  logout as logoutRequest,
  remoteStopTransaction,
  resumeStoredLogin,
  setAutoRefreshEnabled as persistAutoRefreshEnabled,
  setChargePriority,
  setTxProfile,
  storeSelectedChargerId,
} from './apiClient';
import DialComponent from './components/DialComponent';
import GroupsScreen from './components/GroupsScreen';
import LoginScreen from './components/LoginScreen';
import MenuDrawer from './components/MenuDrawer';

const CHARGER_REFRESH_INTERVAL_MS = 30000;
const GROUPS_REFRESH_INTERVAL_MS = 30000;

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

  const [view, setView] = useState('dashboard'); // 'dashboard' | 'groups'
  const [menuOpen, setMenuOpen] = useState(false);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(() => getAutoRefreshEnabled());

  const [selectedChargerId, setSelectedChargerId] = useState(() => getStoredSelectedChargerId());
  const [selectedCharger, setSelectedCharger] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailRefreshToken, setDetailRefreshToken] = useState(0);

  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [draftMaxCurrent, setDraftMaxCurrent] = useState(null);
  const [draftPriority, setDraftPriority] = useState(null);

  const [chargers, setChargers] = useState([]);
  const [chargersLoading, setChargersLoading] = useState(false);
  const [chargersError, setChargersError] = useState('');

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
    setMenuOpen(false);
    setView('dashboard');
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
    setChargers([]);
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
      setDetailError(formatError(error));
    } finally {
      if (!quiet) {
        setDetailLoading(false);
      }
    }
  }

  async function loadChargers() {
    setChargersLoading(true);
    setChargersError('');
    try {
      const list = await fetchChargers();
      setChargers(list);
    } catch (error) {
      if (handleAuthFailure(error)) return;
      setChargersError(formatError(error));
    } finally {
      setChargersLoading(false);
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
        const { userType: restoredUserType } = await resumeStoredLogin();
        if (!cancelled) {
          setUserType(restoredUserType);
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

  // Once authenticated, load the charger list and groups once (the latter
  // is needed both for the Groups screen and to know whether the selected
  // charger's group is SmartCharging-managed). Otherwise prompt via menu.
  useEffect(() => {
    if (authState !== 'authenticated') {
      return undefined;
    }
    void loadChargers();
    void loadGroups();
    if (!selectedChargerId) {
      setMenuOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState]);

  // Background polling of groups, only while auto-refresh is enabled. Kept
  // separate from the initial load above so toggling auto-refresh doesn't
  // re-trigger an extra fetch or reopen the menu.
  useEffect(() => {
    if (authState !== 'authenticated' || !autoRefreshEnabled) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      void loadGroups({ quiet: true });
    }, GROUPS_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState, autoRefreshEnabled]);

  // Load the selected charger's detail whenever the selection changes or a
  // manual refresh is requested.
  useEffect(() => {
    if (authState !== 'authenticated' || !selectedChargerId) {
      return undefined;
    }
    void loadChargerDetails(selectedChargerId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState, selectedChargerId, detailRefreshToken]);

  // Background polling of the selected charger's detail, only while
  // auto-refresh is enabled.
  useEffect(() => {
    if (authState !== 'authenticated' || !selectedChargerId || !autoRefreshEnabled) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      void loadChargerDetails(selectedChargerId, { quiet: true });
    }, CHARGER_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authState, selectedChargerId, autoRefreshEnabled]);

  async function handleLogin(credentials) {
    setAuthLoading(true);
    setAuthError('');
    try {
      const { userType: loggedInUserType } = await loginRequest(credentials);
      setUserType(loggedInUserType);
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

  function handleRefreshCurrent() {
    if (!selectedChargerId) return;
    setDetailRefreshToken((value) => value + 1);
  }

  function handleToggleAutoRefresh() {
    setAutoRefreshEnabled((current) => {
      const next = !current;
      persistAutoRefreshEnabled(next);
      return next;
    });
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
      setDetailRefreshToken((value) => value + 1);
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
      setDetailRefreshToken((value) => value + 1);
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
      setDetailRefreshToken((value) => value + 1);
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

  const selectedState = selectedCharger?.status || (selectedChargerId ? 'Loading' : '--');

  return (
    <div className="app-shell">
      <MenuDrawer
        open={menuOpen}
        chargers={chargers}
        chargersLoading={chargersLoading}
        chargersError={chargersError}
        selectedChargerId={selectedChargerId}
        onClose={() => setMenuOpen(false)}
        onSelectCharger={handleSelectCharger}
        onOpenGroups={handleOpenGroups}
        onRefreshChargers={loadChargers}
        onLogout={handleLogout}
      />

      <header className="app-header main-header">
        <div className="header-left">
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
          <h1>Balanz</h1>
        </div>

        <div className="header-actions">
          <button
            type="button"
            className={`toggle-switch ${autoRefreshEnabled ? 'is-on' : ''}`}
            role="switch"
            aria-checked={autoRefreshEnabled}
            onClick={handleToggleAutoRefresh}
          >
            <span className="toggle-switch-track">
              <span className="toggle-switch-thumb" />
            </span>
            <span className="toggle-switch-label">Auto-refresh</span>
          </button>
          <div className="pill">{selectedState}</div>
          <button className="ghost-button" type="button" onClick={handleRefreshCurrent} disabled={!selectedChargerId}>
            Refresh
          </button>
        </div>
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
            onRefresh={loadGroups}
            onClose={() => setView('dashboard')}
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
              <div className="empty-state">Choose a charger from the menu.</div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
