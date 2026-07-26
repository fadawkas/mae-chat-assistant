import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConversationListItem, JobStatus } from '../../types';
import { fetchConversations, createConversation, renameConversation, deleteConversation } from '../../api/conversations';
import { deleteJob, listJobs } from '../../api/jobs';

interface SidebarProps {
  view: 'chat' | 'council' | 'research' | 'documents' | 'automation' | 'settings';
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewChat: (id: string) => void;
  onNewCouncil?: () => void;
  onNewResearch?: () => void;
  onNewDocument?: () => void;
  onNewAutomation?: () => void;
  refreshKey: number;
  expanded: boolean;
  onToggle: () => void;
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
  onNewChat,
  onNewCouncil,
  onNewResearch,
  onNewDocument,
  onNewAutomation,
  refreshKey,
  expanded,
  onSelectJob,
  onViewAllHistory,
}: SidebarProps) {
  const [convs, setConvs] = useState<ConversationListItem[]>([]);
  const [loading, setLoading] = useState(true);

  // Council / Research past jobs
  const [jobs, setJobs] = useState<JobStatus[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);

  // Search state
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

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
      const result = await listJobs(view === "documents" ? "document" : view, 50);
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

  const handleNewChat = async () => {
    try {
      const conv = await createConversation();
      setConvs((prev) => [conv, ...prev]);
      onNewChat(conv.id);
    } catch {
      // silently fail
    }
  };

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

  const newButtonLabel = view === 'chat' ? 'New chat' : view === 'council' ? 'New council' : view === 'research' ? 'New research' : view === 'documents' ? 'New document' : 'New schedule';

  const handleNewAction = () => {
    if (view === 'chat') handleNewChat();
    else if (view === 'council') onNewCouncil?.();
    else if (view === 'research') onNewResearch?.();
    else if (view === 'documents') onNewDocument?.();
    else if (view === 'automation') onNewAutomation?.();
  };

  return (
    <aside
      className="border-r border-mae-border glass-sidebar flex flex-col h-screen overflow-hidden transition-all duration-200 ease-in-out"
      style={{ width: expanded ? 260 : 0, minWidth: expanded ? 260 : 0 }}
    >
      {/* Content wrapper — hidden when collapsed to avoid overflow */}
      <div className={`flex flex-col h-full overflow-hidden ${expanded ? 'opacity-100' : 'opacity-0 pointer-events-none'} transition-opacity duration-150`}>
        {/* Wordmark header + search button */}
        <div className="shrink-0 flex items-center justify-between px-4 pt-4 pb-3">
          <h1 className="text-xl font-semibold tracking-tight text-mae-text leading-tight">Mae</h1>

          <button
            type="button"
            onClick={() => {
              setSearchOpen((value) => !value);

              setTimeout(() => {
                searchInputRef.current?.focus();
              }, 0);
            }}
            title="Search"
            aria-label="Search conversations"
            aria-expanded={searchOpen}
            className={`flex items-center justify-center w-8 h-8 rounded-[8px]
              border-none cursor-pointer transition-colors
              ${
                searchOpen
                  ? 'bg-mae-bubble-assistant text-mae-text'
                  : 'bg-transparent text-mae-muted hover:bg-mae-bubble-assistant hover:text-mae-text'
              }`}
          >
            <svg
              className="w-[17px] h-[17px]"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
            >
              <circle cx="11" cy="11" r="7" />
              <path
                d="m20 20-3.5-3.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* New [mode] button */}
        <div className="shrink-0 px-3 pb-2">
          <button
            onClick={handleNewAction}
            className="flex items-center gap-2 w-full px-3 py-2 rounded-[8px] border border-mae-border bg-transparent text-mae-text text-sidebar-title cursor-pointer transition-colors hover:bg-mae-bubble-assistant hover:border-mae-accent focus-visible:outline-2 focus-visible:outline-mae-accent focus-visible:outline-offset-1"
          >
            <span className="text-base leading-none text-mae-accent">+</span>
            <span>{newButtonLabel}</span>
          </button>
        </div>

        {/* Animated search input */}
        <div
          className={`grid shrink-0 transition-all duration-200 ${
            searchOpen
              ? 'grid-rows-[1fr] opacity-100 px-3 pb-2'
              : 'grid-rows-[0fr] opacity-0 px-3'
          }`}
        >
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
                    setSearchOpen(false);
                    setSearchQuery('');
                  }
                }}
                placeholder="Search…"
                className="w-full pl-9 pr-8 py-2 rounded-[8px] glass-input
                  text-mae-text text-sidebar-title border border-mae-border
                  placeholder:text-mae-muted/50 outline-none
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
        </div>

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
                <div className="px-2 py-6 text-center text-sidebar-meta text-mae-muted leading-relaxed">
                  No conversations yet.<br />
                  Start one above.
                </div>
              )}

              {groupByDate(filteredConvs).map((group) => (
                <div key={group.label} className="pt-3 first:pt-0">
                  <p className="text-sidebar-meta text-mae-muted font-medium px-2 pb-1">{group.label}</p>
                  <div className="space-y-[2px]">
                    {group.items.map((c) => (
                      <div
                        key={c.id}
                        onClick={() => onSelect(c.id)}
                        className={`group flex items-center justify-between px-3 py-[7px] rounded-[8px] cursor-pointer transition-colors ${
                          c.id === activeId
                            ? 'bg-mae-bubble-assistant text-mae-text'
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
                          <span className="text-sidebar-title truncate flex-1 min-w-0">
                            {c.title.length > 40 ? c.title.slice(0, 40) + '…' : c.title}
                          </span>
                        )}

                        {/* Hover actions: rename + delete */}
                        {renamingId !== c.id && (
                          <div className="hidden group-hover:flex items-center gap-0.5 shrink-0 ml-2">
                            <button
                              onClick={e => handleStartRename(e, c)}
                              className="w-5 h-5 flex items-center justify-center rounded-[4px] text-mae-muted hover:text-mae-text hover:bg-mae-border/50 cursor-pointer bg-transparent border-none"
                              title="Rename"
                            >
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                            <button
                              onClick={e => handleDelete(e, c.id)}
                              className="w-5 h-5 flex items-center justify-center rounded-[4px] text-mae-muted hover:text-mae-error hover:bg-mae-error-bg/50 cursor-pointer bg-transparent border-none"
                              title="Delete"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        )}

                        {/* Active indicator dot */}
                        {c.id === activeId && (
                          <span className="w-[6px] h-[6px] rounded-full bg-mae-accent shrink-0 ml-2 group-hover:hidden" />
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
                    onClick={() => onSelectJob?.(job.id)}
                    className={`group flex items-center justify-between px-3 py-[7px] rounded-[8px] cursor-pointer transition-colors ${
                      job.id === activeId
                        ? 'bg-mae-bubble-assistant text-mae-text'
                        : 'text-mae-muted hover:text-mae-text hover:bg-mae-bubble-assistant'
                    }`}
                   >
                     <span className="text-sidebar-title truncate flex-1 min-w-0">{truncated || '(untitled)'}</span>
                     <button
                       type="button"
                       onClick={event => handleDeleteJob(event, job.id)}
                       aria-label="Delete result"
                       className="hidden group-hover:flex w-5 h-5 items-center justify-center rounded-[4px] text-mae-muted hover:text-mae-error hover:bg-mae-error-bg/50 border-none bg-transparent"
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
    </aside>
  );
}
