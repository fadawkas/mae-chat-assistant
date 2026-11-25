import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../api/client';
import type { User, WorkspaceView } from '../../types';

export function WorkspaceAccount({ view, onViewChange, user, onSignOut }: {
  view: WorkspaceView;
  onViewChange: (view: WorkspaceView) => void;
  user: User;
  onSignOut: () => void;
}) {
  const [accountOpen, setAccountOpen] = useState(false);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!accountOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAccountOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [accountOpen]);

  async function signOut() {
    setSigningOut(true);
    try {
      const response = await apiFetch('/api/auth/signout', { method: 'POST' });
      if (response.ok) onSignOut();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="shrink-0 border-t border-mae-border p-3">
      <div ref={accountRef} className="relative">
        {accountOpen && <div className="absolute inset-x-0 bottom-full z-20 mb-2 rounded-lg border border-mae-border bg-mae-surface p-2">
          <div className="border-b border-mae-border px-3 py-2">
            <p className="truncate text-sm font-medium text-mae-text">{user.first_name} {user.last_name}</p>
            <p className="truncate text-xs text-mae-muted">{user.email}</p>
          </div>
          <button type="button" onClick={() => { setAccountOpen(false); onViewChange('settings'); }} className="mt-1 w-full rounded-lg px-3 py-2 text-left text-sm text-mae-text hover:bg-mae-bubble-assistant">Account settings</button>
          <button type="button" onClick={() => { setAccountOpen(false); setConfirmingSignOut(true); }} className="w-full rounded-lg px-3 py-2 text-left text-sm text-mae-error hover:bg-mae-error-bg">Sign out</button>
        </div>}
        <button type="button" onClick={() => setAccountOpen(value => !value)} aria-label="Open account menu" aria-expanded={accountOpen} className="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-base font-medium hover:bg-mae-bubble-assistant">
          <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-full bg-mae-bubble-user text-sm font-semibold text-mae-text">{(user.first_name?.[0] || user.email[0] || 'M').toUpperCase()}</span>
          <span className="truncate">{view === 'settings' ? 'Account settings' : `${user.first_name} ${user.last_name}`}</span>
        </button>
      </div>
      {confirmingSignOut && <div className="fixed inset-0 z-30 flex items-center justify-center bg-mae-text/60 px-5" role="presentation"><div role="dialog" aria-modal="true" aria-labelledby="rail-sign-out-title" className="w-full max-w-sm rounded-2xl border border-mae-border bg-mae-surface p-6 shadow-2xl"><h2 id="rail-sign-out-title" className="text-lg font-semibold text-mae-text">Sign out of Mae?</h2><p className="mt-2 text-sm leading-6 text-mae-muted">You will need to sign in again to access your workspace.</p><div className="mt-6 flex justify-end gap-3"><button type="button" disabled={signingOut} onClick={() => setConfirmingSignOut(false)} className="rounded-lg border border-mae-border px-4 py-2 text-sm text-mae-text hover:bg-mae-bubble-assistant disabled:opacity-50">Cancel</button><button type="button" disabled={signingOut} onClick={signOut} className="rounded-lg bg-mae-error px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{signingOut ? 'Signing out…' : 'Sign out'}</button></div></div></div>}
    </div>
  );
}
