import { MaeLogo } from '../common/MaeLogo';
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../../api/client';
import type { User } from '../../types';

interface IconRailProps {
  view: 'chat' | 'council' | 'research' | 'documents' | 'automation' | 'settings';
  onViewChange: (v: 'chat' | 'council' | 'research' | 'documents' | 'automation' | 'settings') => void;
  sidebarExpanded: boolean;
  onToggleSidebar: () => void;
  user: User;
  onSignOut: () => void;
}

/** Simple SVG icons inline — no icon library dependency */
function ChatIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function CouncilIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l9 5v8l-9 5-9-5V8l9-5z" />
      <path d="M12 12l9-5" />
      <path d="M12 12v10" />
      <path d="M3 7l9 5" />
    </svg>
  );
}

/** Flask/beaker icon — visually distinct from the search icon used in the sidebar */
function ResearchIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      <path d="M9 12H4s.55-3.03 2-4" />
      <path d="M5 15h14" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function DocumentIcon() {
  return <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></svg>;
}

function AutomationIcon() {
  return <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3 2" /><path d="M5 4 3.5 5.5M19 4l1.5 1.5" /></svg>;
}

function PanelIcon({ expanded }: { expanded: boolean }) {
  return expanded ? (
    <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
      <path d="m15 9-3 3 3 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
      <path d="m13 9 3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const MODES: { key: 'chat' | 'council' | 'research' | 'documents' | 'automation'; label: string; Icon: React.FC }[] = [
  { key: 'chat', label: 'Chat', Icon: ChatIcon },
  { key: 'council', label: 'Council', Icon: CouncilIcon },
  { key: 'research', label: 'Research', Icon: ResearchIcon },
  { key: 'documents', label: 'Documents', Icon: DocumentIcon },
  { key: 'automation', label: 'Automation', Icon: AutomationIcon },
];

export function IconRail({ view, onViewChange, sidebarExpanded, onToggleSidebar, user, onSignOut }: IconRailProps) {
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
    <nav className="relative z-20 w-[60px] min-w-[60px] h-screen flex flex-col items-center py-3 border-r border-mae-border glass-sidebar overflow-visible">
      {/* Logo at top */}
      <button
        onClick={() => onViewChange('chat')}
        className="flex items-center justify-center w-9 h-9 rounded-[10px] mb-2 cursor-pointer bg-transparent border-none hover:opacity-80 transition-opacity"
        title="Home"
      >
        <MaeLogo size={28} />
      </button>

      {/* Sidebar toggle — expand button when collapsed */}
      <button
        onClick={onToggleSidebar}
        className="flex items-center justify-center w-9 h-9 rounded-[10px] text-mae-muted hover:text-mae-text cursor-pointer bg-transparent border-none transition-colors mb-1"
        title={sidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
        aria-label={sidebarExpanded ? 'Collapse sidebar' : 'Expand sidebar'}
      >
        <PanelIcon expanded={sidebarExpanded} />
      </button>

      {/* Mode icons */}
      <div className="flex flex-col items-center gap-1 w-full">
        {MODES.map(({ key, label, Icon }) => {
          const isActive = view === key;
          return (
            <button
              key={key}
              onClick={() => onViewChange(key)}
              className={`relative flex items-center justify-center w-full h-10 cursor-pointer bg-transparent border-none transition-colors ${
                isActive
                  ? 'text-mae-text'
                  : 'text-mae-muted hover:text-mae-text'
              }`}
              title={label}
            >
              {/* Active indicator bar */}
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 rounded-r-full bg-mae-accent" />
              )}
              {/* Background tint */}
              <span className={`flex items-center justify-center w-9 h-9 rounded-[10px] transition-colors ${
                isActive ? 'bg-mae-bubble-assistant' : ''
              }`}>
                <Icon />
              </span>
            </button>
          );
        })}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Settings */}
      <button
        onClick={() => onViewChange('settings')}
        className={`flex items-center justify-center w-9 h-9 rounded-[10px] cursor-pointer bg-transparent border-none transition-colors ${view === 'settings' ? 'text-mae-text bg-mae-bubble-assistant' : 'text-mae-muted hover:text-mae-text'}`}
        title="Settings"
      >
        <SettingsIcon />
      </button>

      {/* Account menu */}
      <div ref={accountRef} className="relative mt-1">
        {accountOpen && <div className="absolute bottom-0 left-11 z-20 w-56 rounded-xl border border-mae-border bg-mae-surface p-2 shadow-2xl">
          <div className="border-b border-mae-border px-3 py-2">
            <p className="truncate text-sm font-medium text-mae-text">{user.first_name} {user.last_name}</p>
            <p className="truncate text-xs text-mae-muted">{user.email}</p>
          </div>
          <button type="button" onClick={() => { setAccountOpen(false); onViewChange('settings'); }} className="mt-1 w-full rounded-lg px-3 py-2 text-left text-sm text-mae-text hover:bg-mae-bubble-assistant">Account settings</button>
          <button type="button" onClick={() => { setAccountOpen(false); setConfirmingSignOut(true); }} className="w-full rounded-lg px-3 py-2 text-left text-sm text-mae-error hover:bg-mae-error-bg">Sign out</button>
        </div>}
        <button type="button" onClick={() => setAccountOpen(value => !value)} aria-label="Open account menu" aria-expanded={accountOpen} className="flex h-7 w-7 items-center justify-center rounded-full border border-mae-accent/20 bg-mae-accent/20 text-xs font-medium text-mae-accent hover:border-mae-accent focus-visible:outline-2 focus-visible:outline-mae-accent">
          {(user.first_name[0] || user.email[0] || 'M').toUpperCase()}
        </button>
      </div>
      {confirmingSignOut && <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 px-5" role="presentation"><div role="dialog" aria-modal="true" aria-labelledby="rail-sign-out-title" className="w-full max-w-sm rounded-2xl border border-mae-border bg-mae-surface p-6 shadow-2xl"><h2 id="rail-sign-out-title" className="text-lg font-semibold text-mae-text">Sign out of Mae?</h2><p className="mt-2 text-sm leading-6 text-mae-muted">You will need to sign in again to access your workspace.</p><div className="mt-6 flex justify-end gap-3"><button type="button" disabled={signingOut} onClick={() => setConfirmingSignOut(false)} className="rounded-lg border border-mae-border px-4 py-2 text-sm text-mae-text hover:bg-mae-bubble-assistant disabled:opacity-50">Cancel</button><button type="button" disabled={signingOut} onClick={signOut} className="rounded-lg bg-mae-error px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{signingOut ? 'Signing out…' : 'Sign out'}</button></div></div></div>}
    </nav>
  );
}
