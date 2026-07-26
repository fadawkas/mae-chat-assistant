import { useCallback, useEffect, useRef, useState } from 'react';
import { ChatPanel } from '../features/chat/ChatPanel';
import { CouncilPanel } from '../features/council/CouncilPanel';
import { ResearchPanel } from '../features/research/ResearchPanel';
import { DocumentPanel } from '../features/documents/DocumentPanel';
import { AutomationPanel } from '../features/automation/AutomationPanel';
import { Sidebar } from '../components/layout/Sidebar';
import { IconRail } from '../components/layout/IconRail';
import { AuthPanel } from '../features/auth/AuthPanel';
import { AccountPanel } from '../features/settings/AccountPanel';
import type { User } from '../types';

const MODELS = [
  'deepseek/deepseek-v4-flash',
  'openai/gpt-4o',
  'google/gemini-2.0-flash-exp',
];

export function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [user, setUser] = useState<User | null>(null);
  useEffect(() => { fetch('/api/auth/me', { credentials: 'same-origin' }).then(async r => { if (!r.ok) { setAuthenticated(false); return; } setUser(await r.json()); setAuthenticated(true); }).catch(() => setAuthenticated(false)); const handler = () => { setAuthenticated(false); setUser(null); }; window.addEventListener('mae:auth-expired', handler); return () => window.removeEventListener('mae:auth-expired', handler); }, []);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [model, setModel] = useState(MODELS[0]);
  const [view, setView] = useState<'chat' | 'council' | 'research' | 'documents' | 'automation' | 'settings'>('chat');
  const [featureOpen, setFeatureOpen] = useState(false);
  const [featureKey, setFeatureKey] = useState(0);
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const documentRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Triggers panel to switch to history tab + optionally expand a job
  const [panelHistory, setPanelHistory] = useState<{
    jobId: string | null;
    show: boolean;
    key: number;
  }>({ jobId: null, show: false, key: 0 });

  const handleSelect = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  const handleNewChat = useCallback((id: string) => {
    setActiveId(id);
    setView('chat');
    setFeatureOpen(false);
  }, []);

  const handleNewCouncil = useCallback(() => {
    setView('council');
    setFeatureOpen(true);
    setPanelHistory({ jobId: null, show: false, key: 0 });
    setFeatureKey(key => key + 1);
  }, []);

  const handleNewResearch = useCallback(() => {
    setView('research');
    setFeatureOpen(true);
    setPanelHistory({ jobId: null, show: false, key: 0 });
    setFeatureKey(key => key + 1);
  }, []);

  const handleNewDocument = useCallback(() => {
    setView('documents');
    setFeatureOpen(true);
    setPanelHistory({ jobId: null, show: false, key: 0 });
    setFeatureKey(key => key + 1);
  }, []);
  const handleNewAutomation = useCallback(() => { setView('automation'); setFeatureOpen(true); setFeatureKey(key => key + 1); }, []);

  const handleViewChange = useCallback((nextView: 'chat' | 'council' | 'research' | 'documents' | 'automation' | 'settings') => {
    setView(nextView);
    setFeatureOpen(nextView === 'chat' ? false : false);
    setPanelHistory({ jobId: null, show: false, key: 0 });
  }, []);

  const handleTitleChange = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);
  const handleDocumentJobUpdate = useCallback((terminal = false) => {
    if (documentRefreshTimer.current) clearTimeout(documentRefreshTimer.current);
    documentRefreshTimer.current = setTimeout(() => {
      setRefreshKey(k => k + 1);
      documentRefreshTimer.current = null;
    }, terminal ? 0 : 750);
  }, []);

  const selectModel = useCallback((m: string) => {
    setModel(m);
  }, []);

  // Called when sidebar job is clicked — switch to panel + history tab
  const handleSelectJob = useCallback((jobId: string) => {
    setFeatureOpen(true);
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

  return (
    <div className="flex h-screen overflow-hidden bg-mae-bg">
      {/* Wide-screen responsive: bump chat column max-width */}
      <style>{`
        @media (min-width: 1400px) {
          .max-w-chat-col {
            max-width: 900px;
          }
        }
      `}</style>

      {/* Icon rail — always visible */}
      <IconRail
        view={view}
        onViewChange={handleViewChange}
        sidebarExpanded={sidebarExpanded}
        onToggleSidebar={() => setSidebarExpanded(v => !v)}
        user={user}
        onSignOut={() => { setAuthenticated(false); setUser(null); }}
      />

      {/* Expandable sidebar panel */}
      <Sidebar
        view={view}
        activeId={activeId}
        onSelect={handleSelect}
        onNewChat={handleNewChat}
        onNewCouncil={handleNewCouncil}
        onNewResearch={handleNewResearch}
      onNewDocument={handleNewDocument}
        onNewAutomation={handleNewAutomation}
        refreshKey={refreshKey}
        expanded={sidebarExpanded}
        onToggle={() => setSidebarExpanded((value) => !value)}
        onSelectJob={handleSelectJob}
        onViewAllHistory={handleViewAllHistory}
      />

      {/* Main content area */}
      <div className="flex flex-1 flex-col min-w-0">
        <main className="flex-1 min-h-0 flex overflow-hidden">
          {view === 'settings' ? <AccountPanel user={user} /> : view === 'automation' && featureOpen ? <AutomationPanel onJobStarted={() => setRefreshKey(k => k + 1)} /> : view === 'documents' && featureOpen ? <DocumentPanel key={`documents-${featureKey}`} historyJobId={panelHistory.show ? panelHistory.jobId : null} historyKey={panelHistory.key} onClearHistoryMode={handleClearPanelHistory} onJobUpdate={handleDocumentJobUpdate} /> : view === 'research' && featureOpen ? (
            <ResearchPanel
              key={`research-${featureKey}`}
              onNewResearch={handleNewResearch}
              historyJobId={panelHistory.show ? panelHistory.jobId : null}
              historyKey={panelHistory.key}
              onClearHistoryMode={handleClearPanelHistory}
            />
          ) : view === 'council' && featureOpen ? (
            <CouncilPanel
              key={`council-${featureKey}`}
              onNewCouncil={handleNewCouncil}
              historyJobId={panelHistory.show ? panelHistory.jobId : null}
              historyKey={panelHistory.key}
              onClearHistoryMode={handleClearPanelHistory}
            />
          ) : view !== 'chat' ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8 text-center">
              <p className="text-lg font-semibold text-mae-text">Choose a workspace action</p>
              <p className="text-sm text-mae-muted max-w-[320px]">Select a previous result from the sidebar or click New {view === 'documents' ? 'document' : view} to begin.</p>
            </div>
          ) : activeId ? (
            <ChatPanel
              key={activeId}
              conversationId={activeId}
              model={model}
              onModelChange={selectModel}
              onTitleChange={handleTitleChange}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 px-8 text-center">
              <p className="text-lg font-semibold text-mae-text">
                Pick up where you left off
              </p>
              <p className="text-sm text-mae-muted max-w-[300px]">
                Select a conversation from the sidebar or start a new one.
              </p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
