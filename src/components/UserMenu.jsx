import React, { useEffect, useRef, useState } from 'react';

/**
 * The signed-in identity chip in the header, doubling as the account menu.
 *
 * Sign out lives here rather than in the drawer: the identity and the action
 * that ends it belong together, and it's where people look for it. It sits
 * behind a click (rather than the chip itself signing out) so the chip can
 * still be a passive "who am I" indicator without a mis-tap ending the
 * session.
 */
export default function UserMenu({ userId, userType, onLogout }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);

  // Dismiss on outside click / Escape, the usual popover conventions.
  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function handlePointerDown(event) {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  if (!userId) {
    return null;
  }

  return (
    <div className="header-user-wrap" ref={containerRef}>
      {/* Just the user name: the role (and the name again) are in the menu
          below, so repeating them here would be redundant. Names are short
          enough that the full one fits even on a phone, so this doesn't need
          to collapse to initials. */}
      <button
        type="button"
        className="header-user"
        aria-haspopup="menu"
        aria-expanded={open}
        title={`Signed in as ${userId} (${userType})`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="header-user-name">{userId}</span>
        <svg className="header-user-caret" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
          <path
            d="M6 9l6 6 6-6"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open ? (
        <div className="header-user-menu panel" role="menu">
          {/* The menu carries the full identity - name plus role - so the
              trigger above only needs the name. */}
          <div className="header-user-menu-head">
            <strong>{userId}</strong>
            <small>{userType}</small>
          </div>
          <button
            type="button"
            role="menuitem"
            className="menu-footer-item is-danger"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
