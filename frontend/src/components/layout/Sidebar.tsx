import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConversationListItem, JobStatus } from '../../types';
import { fetchConversations, renameConversation, deleteConversation } from '../../api/conversations';
import { deleteJob, listJobs } from '../../api/jobs';

interface SidebarProps {
  view: 'chat' | 'documents';
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewDocument?: () => void;
  refreshKey: number;
  onSelectJob?: (jobId: string) => void;
  onViewAllHistory?: () => void;
}

/** Group label for a conversation based on its creation date. */
type GroupLabel = 'Today' | 'Previous 7 days' | 'Older';

interface Grouped<T> {
  label: GroupLabel;
  items: T[];
}

function groupByDate<T extends { created_at: string }>(items: T[]): Grouped<T>[] {
  const msDay = 86_400_000;
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayTs = todayStart.getTime();
  const sevenDaysAgo = todayTs - 7 * msDay;

  const groups: Record<GroupLabel, T[]> = {
    Today: [],
    'Previous 7 days': [],
    Older: [],
  };

  for (const c of items) {
    const ts = new Date(c.created_at).getTime();
    if (ts >= todayTs) {
      groups.Today.push(c);
    } else if (ts >= sevenDaysAgo) {
      groups['Previous 7 days'].push(c);
    } else {
      groups.Older.push(c);
    }
  }

  const result: Grouped<T>[] = [];
  for (const label of ['Today', 'Previous 7 days', 'Older'] as GroupLabel[]) {
    if (groups[label].length > 0) {
      result.push({ label, items: groups[label] });
    }
  }
  return result;
}

export function Sidebar({
  view,
  activeId,
  onSelect,
  onNewDocument,
  refreshKey,
  onSelectJob,
  onViewAllHistory,
}: SidebarProps) {
  const [convs, setConvs] = useState<ConversationListItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Document history
  const [jobs, setJobs] = useState<JobStatus[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);

  // Search state
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);

  // Inline rename state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (view !== 'chat') return;
    setLoading(true);
    try {
      const list = await fetchConversations();
      setConvs(list);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [view]);

  const loadJobs = useCallback(async () => {
    if (view === 'chat') return;
    setJobsLoading(true);
    try {
      const result = await listJobs('document', 50);
      setJobs(result);
    } catch {
      // silently fail
    } finally {
      setJobsLoading(false);
    }
  }, [view]);

  useEffect(() => {
    load();
  }, [refreshKey, load]);

  useEffect(() => {
    loadJobs();
  }, [refreshKey, loadJobs]);

  // Start inline rename
  const handleStartRename = useCallback((e: React.MouseEvent, conv: ConversationListItem) => {
    e.stopPropagation();
    setRenamingId(conv.id);
    setRenameValue(conv.title);
    setTimeout(() => renameInputRef.current?.focus(), 0);
  }, []);

  // Commit rename
  const handleCommitRename = useCallback(async (id: string) => {
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenamingId(null);
      return;
    }
    try {
      const updated = await renameConversation(id, trimmed);
      setConvs(prev => prev.map(c => c.id === id ? updated : c));
    } catch {
      // silently fail
    }
    setRenamingId(null);
  }, [renameValue]);

  // Cancel rename on Escape
  const handleRenameKeyDown = useCallback((e: React.KeyboardEvent, id: string) => {
    if (e.key === 'Enter') {
      handleCommitRename(id);
    } else if (e.key === 'Escape') {
      setRenamingId(null);
    }
  }, [handleCommitRename]);

  // Delete conversation
  const handleDelete = useCallback(async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await deleteConversation(id);
      setConvs(prev => prev.filter(c => c.id !== id));
      if (id === activeId) {
        onSelect(convs.find(c => c.id !== id)?.id ?? '');
      }
    } catch {
      // silently fail
    }
  }, [activeId, convs, onSelect]);

  const handleDeleteJob = useCallback(async (event: React.MouseEvent, id: string) => {
    event.stopPropagation();
    try {
      await deleteJob(id);
      setJobs(previous => previous.filter(job => job.id !== id));
    } catch {
      // Keep the history row when deletion fails.
    }
  }, []);

  const filteredConvs = convs.filter((conversation) =>
    conversation.title
      .toLowerCase()
      .includes(searchQuery.trim().toLowerCase()),
  );

  const filteredJobs = jobs.filter((job) => {
    const title =
      job.title ||
      String(job.payload?.prompt ?? job.payload?.query ?? '');

    return title
      .toLowerCase()
      .includes(searchQuery.trim().toLowerCase());
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-mae-border pt-3">
      <div className="flex items-center justify-between px-5 pb-1">
        <h2 className="text-sm font-semibold text-mae-text">{view === 'chat' ? 'Chat history' : 'Document history'}</h2>
        <button type="button" ref={searchButtonRef} aria-label="Search history" aria-expanded={searchOpen}
          className="grid size-9 place-items-center rounded-lg text-mae-muted hover:bg-mae-bubble-assistant hover:text-mae-text"
          onClick={() => {
            if (searchOpen) setSearchQuery('');
            setSearchOpen(!searchOpen);
            if (!searchOpen) requestAnimationFrame(() => searchInputRef.current?.focus());
          }}>
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></svg>
        </button>
      </div>
      {view === 'documents' && <button onClick={onNewDocument} className="mx-3 mb-2 rounded-lg px-3 py-2 text-left text-sm text-mae-accent hover:bg-mae-bubble-assistant">New document</button>}
        {searchOpen && <div className="shrink-0 px-3 pb-2">
          <div className="overflow-hidden">
            <div className="relative">
              <svg
                className="absolute left-3 top-1/2 w-3.5 h-3.5 -translate-y-1/2 text-mae-muted pointer-events-none"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" strokeLinecap="round" />
              </svg>

              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.stopPropagation();
                    event.preventDefault();
                    setSearchOpen(false);
                    setSearchQuery('');
                    searchButtonRef.current?.focus();
                  }
                }}
                placeholder="Search…"
                aria-label="Search history"
                className="w-full pl-9 pr-8 py-2 rounded-lg bg-mae-bg
                  text-mae-text text-sidebar-title border border-mae-border
                  placeholder:text-mae-muted outline-none
                  focus-visible:border-mae-accent transition-colors"
              />

              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    searchInputRef.current?.focus();
                  }}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2
                    w-6 h-6 flex items-center justify-center rounded-[6px]
                    border-none bg-transparent text-mae-muted
                    hover:text-mae-text hover:bg-mae-bubble-assistant"
                >
                  ×
                </button>
              )}
            </div>
          </div>
        </div>}

        {/* Scrollable history list */}
        <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-2">
          {view === 'chat' && (
            <>
              {loading && convs.length === 0 && (
                <div className="space-y-[4px] pt-2">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="h-[34px] rounded-[8px] bg-mae-border animate-pulse-soft" />
                  ))}
                </div>
              )}

              {!loading && convs.length === 0 && (
                <div className="px-2 py-3 text-sidebar-meta text-mae-muted leading-relaxed">
                  No chats yet.
                </div>
              )}

              {!loading && convs.length > 0 && !filteredConvs.length && (
                <p className="px-2 py-3 text-sidebar-meta text-mae-muted">No matching chats.</p>
              )}

              {groupByDate(filteredConvs).map((group) => (
                <div key={group.label} className="pt-3 first:pt-0">
                  <p className="text-sidebar-meta text-mae-muted font-medium px-2 pb-1">{group.label}</p>
                  <div className="space-y-[2px]">
                    {group.items.map((c) => (
                      <div
                        key={c.id}
                        className={`chat-history-row relative flex min-h-11 items-center justify-between rounded-lg px-2 transition-colors ${
                          c.id === activeId
                            ? 'bg-mae-bubble-user text-mae-text'
                            : 'text-mae-muted hover:text-mae-text hover:bg-mae-bubble-assistant'
                        }`}
                      >
                        {renamingId === c.id ? (
                          <input
                            ref={renameInputRef}
                            value={renameValue}
                            onChange={e => setRenameValue(e.target.value)}
                            onBlur={() => handleCommitRename(c.id)}
                            onKeyDown={e => handleRenameKeyDown(e, c.id)}
                            onClick={e => e.stopPropagation()}
                            className="flex-1 min-w-0 px-1 py-0.5 rounded-[4px] bg-mae-surface text-mae-text text-sidebar-title border border-mae-accent outline-none"
                          />
                        ) : (
                          <button onClick={() => onSelect(c.id)} aria-current={c.id === activeId ? 'true' : undefined} className="min-w-0 flex-1 truncate py-1 text-left text-sidebar-title" title={c.title}>{c.title}</button>
                        )}

                        {/* Hover actions: rename + delete */}
                        {renamingId !== c.id && (
                          <div className="chat-history-actions ml-1 flex shrink-0 items-center gap-0.5">
                            <button
                              onClick={e => handleStartRename(e, c)}
                              className="size-7 flex items-center justify-center rounded-md text-mae-muted hover:text-mae-text hover:bg-mae-border/50 cursor-pointer bg-transparent border-none"
                              title="Rename" aria-label={`Rename ${c.title}`}
                            >
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                            <button
                              onClick={e => handleDelete(e, c.id)}
                              className="size-7 flex items-center justify-center rounded-md text-mae-muted hover:text-mae-error hover:bg-mae-error-bg/50 cursor-pointer bg-transparent border-none"
                              title="Delete" aria-label={`Delete ${c.title}`}
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        )}

                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}

          {view !== 'chat' && (
            <>
              {jobsLoading && jobs.length === 0 && (
                <div className="space-y-[4px] pt-2">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="h-[34px] rounded-[8px] bg-mae-border animate-pulse-soft" />
                  ))}
                </div>
              )}

              {!jobsLoading && jobs.length === 0 && (
                <div className="px-2 py-6 text-center text-sidebar-meta text-mae-muted leading-relaxed">
                  No {view} results yet.<br />
                  Start one above.
                </div>
              )}

              {/* Latest 5 jobs for quick navigation */}
              {filteredJobs.slice(0, 5).map((job) => {
                const displayTitle = job.title || (job.payload?.prompt as string) || (job.payload?.query as string) || '';
                const truncated = displayTitle.length > 40 ? displayTitle.slice(0, 40) + '…' : displayTitle;
                return (
                  <div
                    key={job.id}
                    className={`group flex items-center justify-between px-3 py-[7px] rounded-[8px] cursor-pointer transition-colors ${
                      job.id === activeId
                        ? 'bg-mae-bubble-assistant text-mae-text'
                        : 'text-mae-muted hover:text-mae-text hover:bg-mae-bubble-assistant'
                    }`}
                   >
                     <button onClick={() => onSelectJob?.(job.id)} className="min-w-0 flex-1 truncate py-1 text-left text-sidebar-title" title={displayTitle}>{truncated || '(untitled)'}</button>
                     <button
                       type="button"
                       onClick={event => handleDeleteJob(event, job.id)}
                       aria-label="Delete result"
                       className="flex w-7 h-7 items-center justify-center rounded-[4px] text-mae-muted hover:text-mae-error hover:bg-mae-error-bg/50 border-none bg-transparent"
                     >
                       <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                         <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 0 0-1 1v3M4 7h16" />
                       </svg>
                     </button>
                     <span className={`w-[6px] h-[6px] rounded-full shrink-0 ml-2 ${
                      job.status === 'done' ? 'bg-mae-accent' : job.status === 'failed' ? 'bg-mae-error' : 'bg-yellow-500'
                    }`} />
                  </div>
                );
              })}

              {/* View all history link */}
              {filteredJobs.length > 0 && (
                <button
                  onClick={onViewAllHistory}
                  className="w-full mt-1 px-3 py-1.5 rounded-[8px] text-xs text-mae-accent hover:bg-mae-bubble-assistant cursor-pointer bg-transparent border-none transition-colors text-left"
                >
                  View all history →
                </button>
              )}
            </>
          )}
        </div>
    </div>
  );
}
