import React, { useState } from 'react';

import AboutPanel from './AboutPanel';
import SettingsPanel from './SettingsPanel';

// A simple 4-square "overview" glyph for the Groups & status nav item -
// nothing fancier is needed since there's only one primary destination.
function GroupsNavIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <rect x="3" y="3" width="8" height="8" rx="2" fill="currentColor" />
      <rect x="13" y="3" width="8" height="8" rx="2" fill="currentColor" opacity="0.55" />
      <rect x="3" y="13" width="8" height="8" rx="2" fill="currentColor" opacity="0.55" />
      <rect x="13" y="13" width="8" height="8" rx="2" fill="currentColor" />
    </svg>
  );
}

// Material's "receipt_long", matching the audit-log icon on the charger
// screen so the two entry points to the same tool look related.
function LogsNavIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        fill="currentColor"
        d="M19 5v14a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3v-2h3V2l1.5 1.5L8 2l1.5 1.5L11 2l1.5 1.5L14 2l1.5 1.5L17 2l2 2zM7 9h8V7H7zm0 4h8v-2H7zm0 4h6v-2H7zm10 3a1 1 0 0 0 1-1V7h2v12a1 1 0 0 1-1 1z"
      />
    </svg>
  );
}

export default function MenuDrawer({ open, currentView, canViewLogs, onClose, onOpenGroups, onOpenLogs }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

  // Opening a panel dismisses the drawer first, so the modal lands on the
  // app rather than stacking on top of a still-open drawer (which left two
  // overlapping surfaces and two backdrops fighting each other).
  function openPanel(setOpen) {
    onClose();
    setOpen(true);
  }

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

        {/* Primary nav: this is the app's one real destination (the
            per-charger dashboard is reached by picking a charger from here,
            not via its own nav entry), so it's styled as a prominent
            tappable row - icon, two-line label, accent fill - rather than a
            plain boxed button, to visually read as *the* thing this drawer
            is for. */}
        <nav className="menu-nav">
          <button
            type="button"
            className={`menu-nav-item ${currentView === 'groups' ? 'is-active' : ''}`}
            aria-current={currentView === 'groups' ? 'page' : undefined}
            onClick={onOpenGroups}
          >
            <span className="menu-nav-icon">
              <GroupsNavIcon />
            </span>
            <span className="menu-nav-copy">
              <strong>Groups &amp; status</strong>
              <small>Browse chargers by group</small>
            </span>
          </button>

          {/* GetLogs is Admin-only server-side, so this entry is hidden for
              other roles rather than leading to a NotAuthorized error. */}
          {canViewLogs ? (
            <button
              type="button"
              className={`menu-nav-item ${currentView === 'logs' ? 'is-active' : ''}`}
              aria-current={currentView === 'logs' ? 'page' : undefined}
              onClick={onOpenLogs}
            >
              <span className="menu-nav-icon">
                <LogsNavIcon />
              </span>
              <span className="menu-nav-copy">
                <strong>Logs</strong>
                <small>Audit trail and system log</small>
              </span>
            </button>
          ) : null}
        </nav>

        {/* Utility actions - deliberately understated (plain text rows,
            pinned to the bottom via margin-top: auto in CSS) so they read as
            secondary to the nav above rather than competing with it, the
            same way most drawer-based apps separate navigation from
            settings. Sign out is deliberately *not* here: it lives on the
            header's identity chip (see UserMenu.jsx), next to the account it
            applies to. */}
        <div className="menu-footer">
          <button type="button" className="menu-footer-item" onClick={() => openPanel(setSettingsOpen)}>
            Server settings
          </button>
          <button type="button" className="menu-footer-item" onClick={() => openPanel(setAboutOpen)}>
            About
          </button>
        </div>
      </aside>

      <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <AboutPanel open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </>
  );
}
