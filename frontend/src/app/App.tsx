import { useCallback, useEffect, useRef, useState } from 'react';
import { ChatPanel } from '../features/chat/ChatPanel';
import { DocumentPanel } from '../features/documents/DocumentPanel';
import { RoutinesPanel } from '../features/automation/RoutinesPanel';
import { ArtifactsPanel } from '../features/artifacts/ArtifactsPanel';
import { MaeLogo } from '../components/common/MaeLogo';
import { Sidebar } from '../components/layout/Sidebar';
import { WorkspaceAccount } from '../components/layout/IconRail';
import { AuthPanel } from '../features/auth/AuthPanel';
import { AccountPanel } from '../features/settings/AccountPanel';
import type { User, WorkspaceView } from '../types';

const workspaceViews = [
  { view: 'chat', label: 'Chat', icon: 'M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l1.5-3A7.5 7.5 0 1 1 20 11.5Z' },
  { view: 'artifacts', label: 'Artifacts', icon: 'M13 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9m-6-6 6 6m-6-6v6h6M9 13h6m-6 4h4' },
  { view: 'automation', label: 'Routines', icon: 'M21 12a9 9 0 1 1-9-9 9 9 0 0 1 9 9Zm-9-5v5l3 2' },
] as const;

export function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => { fetch('/api/auth/me', { credentials: 'same-origin' }).then(async r => { if (!r.ok) { setAuthenticated(false); return; } setUser(await r.json()); setAuthenticated(true); }).catch(() => setAuthenticated(false)); const handler = () => { setAuthenticated(false); setUser(null); }; window.addEventListener('mae:auth-expired', handler); return () => window.removeEventListener('mae:auth-expired', handler); }, []);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [chatKey, setChatKey] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [view, setView] = useState<WorkspaceView>('chat');
  const [artifactVersion, setArtifactVersion] = useState(0);
  const [featureOpen, setFeatureOpen] = useState(false);
  const [featureKey, setFeatureKey] = useState(0);
  const [desktop, setDesktop] = useState(() => window.matchMedia('(min-width: 768px)').matches);
  const drawer = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 768px)');
    const update = () => setDesktop(query.matches);
    query.addEventListener('change', update);
    update();
    return () => query.removeEventListener('change', update);
  }, []);
  const documentRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Triggers panel to switch to history tab + optionally expand a job
  const [panelHistory, setPanelHistory] = useState<{
    jobId: string | null;
    show: boolean;
    key: number;
  }>({ jobId: null, show: false, key: 0 });

  const handleSelect = useCallback((id: string) => {
    const next = id || null;
    if (next !== activeId) {
      setActiveId(next);
      setChatKey(key => key + 1);
    }
    drawer.current?.close();
  }, [activeId]);

  const handleNewChat = useCallback(() => {
    setActiveId(null);
    setChatKey(key => key + 1);
    setView('chat');
    setFeatureOpen(false);
    drawer.current?.close();
  }, []);

  const handleConversationCreated = useCallback((id: string) => {
    setActiveId(id);
    setRefreshKey(key => key + 1);
  }, []);

  const handleNewDocument = useCallback(() => {
    setView('documents');
    setFeatureOpen(true);
    drawer.current?.close();
    setPanelHistory({ jobId: null, show: false, key: 0 });
    setFeatureKey(key => key + 1);
  }, []);
  const handleViewChange = useCallback((nextView: WorkspaceView) => {
    setView(nextView);
    drawer.current?.close();
    setFeatureOpen(false);
    setPanelHistory({ jobId: null, show: false, key: 0 });
  }, []);

  const handleTitleChange = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);
  const handleArtifactCreated = useCallback(() => setArtifactVersion(v => v + 1), []);

  const handleDocumentJobUpdate = useCallback((terminal = false) => {
    if (documentRefreshTimer.current) clearTimeout(documentRefreshTimer.current);
    documentRefreshTimer.current = setTimeout(() => {
      setRefreshKey(k => k + 1);
      documentRefreshTimer.current = null;
    }, terminal ? 0 : 750);
  }, []);

  // Called when sidebar job is clicked — switch to panel + history tab
  const handleSelectJob = useCallback((jobId: string) => {
    setFeatureOpen(true);
    drawer.current?.close();
    setPanelHistory(prev => ({ jobId, show: true, key: prev.key + 1 }));
  }, []);

  // Called when "View all history →" is clicked in sidebar
  const handleViewAllHistory = useCallback(() => {
    setPanelHistory(prev => ({ jobId: null, show: true, key: prev.key + 1 }));
  }, []);

  // Called by panel when user navigates back to "New Run" tab
  const handleClearPanelHistory = useCallback(() => {
    setPanelHistory({ jobId: null, show: false, key: 0 });
  }, []);

  if (authenticated === null || !user) {
    return authenticated === false ? <AuthPanel onAuthenticated={async () => { const r = await fetch('/api/auth/me', { credentials: 'same-origin' }); if (r.ok) { setUser(await r.json()); setAuthenticated(true); } }} /> : null;
  }

  const navigation = (
    <aside className="flex h-full w-full flex-col bg-mae-sidebar" aria-label="Mae workspace">
      <div className="flex min-h-20 shrink-0 items-center justify-between gap-2 px-5">
        <span className="flex items-center gap-2.5 text-2xl font-bold leading-none tracking-tight"><MaeLogo size={34} />Mae</span>
        {!desktop && <button type="button" autoFocus onClick={() => drawer.current?.close()} className="min-h-11 rounded-lg px-3 text-base font-medium text-mae-muted hover:bg-mae-bubble-assistant">Close</button>}
      </div>
      <nav aria-label="Workspace" className="shrink-0 space-y-1 px-3 pb-4">
        <button onClick={handleNewChat} className="mb-3 flex min-h-12 w-full items-center gap-2.5 rounded-xl border border-mae-border bg-mae-surface px-3 text-left text-base font-semibold text-mae-text hover:border-mae-accent">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-mae-lime">
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          </span>
          New chat
        </button>
        {workspaceViews.map(item => {
          const active = view === item.view || (item.view === 'artifacts' && view === 'documents');
          return <button key={item.view} onClick={() => handleViewChange(item.view)} aria-current={active ? 'page' : undefined}
            className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-base ${active ? 'bg-mae-accent-soft font-semibold text-mae-text' : 'font-medium text-mae-muted hover:bg-mae-bubble-assistant hover:text-mae-text'}`}>
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={item.icon} /></svg>
            {item.label}
          </button>;
        })}
      </nav>
      <Sidebar key={view === 'documents' ? 'documents' : 'chat'}
        view={view === 'documents' ? 'documents' : 'chat'}
        activeId={view === 'documents' ? panelHistory.jobId : activeId}
        onSelect={id => { handleSelect(id); setView('chat'); }}
        onNewDocument={handleNewDocument} refreshKey={refreshKey}
        onSelectJob={handleSelectJob} onViewAllHistory={handleViewAllHistory} />
      <WorkspaceAccount view={view} onViewChange={handleViewChange} user={user}
        onSignOut={() => { drawer.current?.close(); setAuthenticated(false); setUser(null); setActiveId(null); setView('chat'); }} />
    </aside>
  );

  return (
    <div className="flex h-dvh overflow-hidden bg-mae-bg">
      {desktop ? <div className="w-60 shrink-0 border-r border-mae-border lg:w-64">{navigation}</div> : (
        <dialog ref={drawer} aria-label="Workspace navigation"
          onClick={event => { if (event.target === event.currentTarget) drawer.current?.close(); }}
          className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none bg-transparent text-mae-text backdrop:bg-mae-text/55">
          <div className="h-full w-[min(18rem,85vw)]">{navigation}</div>
        </dialog>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        {!desktop && <header className="flex shrink-0 items-center gap-3 border-b border-mae-border px-3 py-2">
          <button type="button" aria-label="Open workspace navigation" aria-haspopup="dialog" onClick={() => drawer.current?.showModal()} className="grid size-11 place-items-center rounded-lg hover:bg-mae-bubble-assistant">
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <span className="flex items-center gap-2 text-xl font-bold tracking-tight"><MaeLogo size={26} />Mae</span>
        </header>}
        <main className="flex min-h-0 flex-1 overflow-hidden">
          {view === 'settings' ? <AccountPanel user={user} /> : view === 'artifacts' ? (
            <ArtifactsPanel refreshKey={artifactVersion} onDocumentTools={handleNewDocument} />
          ) : view === 'automation' ? <RoutinesPanel /> : view === 'documents' && featureOpen ? (
            <DocumentPanel key={`documents-${featureKey}`} historyJobId={panelHistory.show ? panelHistory.jobId : null} historyKey={panelHistory.key} onClearHistoryMode={handleClearPanelHistory} onJobUpdate={handleDocumentJobUpdate} />
          ) : view !== 'chat' ? (
            <section className="workspace-page">
              <div className="workspace-content">
                <h1 className="workspace-heading">Documents</h1>
                <p className="mt-2 text-sm text-mae-muted">Choose a result from the history, or create a new document.</p>
                <button onClick={handleNewDocument} className="mt-4 rounded-lg bg-mae-accent px-4 py-2 text-sm font-medium text-mae-accent-on">New document</button>
              </div>
            </section>
          ) : (
            <ChatPanel key={chatKey} conversationId={activeId} onConversationCreated={handleConversationCreated}
              onTitleChange={handleTitleChange} onArtifactCreated={handleArtifactCreated} />
          )}
        </main>
      </div>
    </div>
  );
}
