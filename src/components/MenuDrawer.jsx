import React, { useState } from 'react';

import SettingsPanel from './SettingsPanel';

export default function MenuDrawer({
  open,
  chargers,
  chargersLoading,
  chargersError,
  selectedChargerId,
  onClose,
  onSelectCharger,
  onOpenGroups,
  onRefreshChargers,
  onLogout,
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className={`menu-backdrop ${open ? 'is-open' : ''}`}
        aria-label="Close menu"
        onClick={onClose}
      />

      <aside className={`menu-drawer panel ${open ? 'is-open' : ''}`} aria-hidden={!open}>
        <div className="menu-drawer-header">
          <div>
            <p className="section-kicker">Menu</p>
            <h2>Balanz</h2>
          </div>
          <button className="ghost-button" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="menu-section">
          <h3>Groups</h3>
          <button className="menu-action" type="button" onClick={onOpenGroups}>
            View groups &amp; status
          </button>
        </div>

        <div className="menu-section">
          <div className="section-header">
            <h3>Chargers</h3>
            <button className="ghost-button" type="button" onClick={onRefreshChargers} disabled={chargersLoading}>
              {chargersLoading ? 'Loading...' : 'Refresh'}
            </button>
          </div>

          {chargersError ? <div className="alert alert-error">{chargersError}</div> : null}

          <div className="menu-charger-list">
            {!chargersLoading && chargers.length === 0 ? (
              <div className="inline-state">No chargers returned by the backend.</div>
            ) : null}

            {chargers.map((charger) => {
              const selected = charger.chargerId === selectedChargerId;
              return (
                <button
                  key={charger.chargerId}
                  type="button"
                  className={`menu-charger-item ${selected ? 'is-selected' : ''}`}
                  onClick={() => onSelectCharger(charger.chargerId)}
                >
                  <div className="menu-charger-label">{charger.alias}</div>
                  <div className="menu-charger-meta">
                    <span>{charger.chargerId}</span>
                    <span>{charger.networkConnected ? charger.status : 'Offline'}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="menu-section">
          <h3>Account</h3>
          <button className="menu-action" type="button" onClick={() => setSettingsOpen(true)}>
            Server settings
          </button>
          <button className="menu-action danger" type="button" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </aside>

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </>
  );
}
