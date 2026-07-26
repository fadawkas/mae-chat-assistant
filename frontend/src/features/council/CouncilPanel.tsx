import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { enqueueCouncil } from '../../api/council';
import { fetchJobStatus, listJobs, streamJobProgress } from '../../api/jobs';
import {
  createCouncil,
  deleteCouncil,
  getCouncil,
  listCouncils,
  updateCouncil,
} from '../../api/councils';
import type {
  CouncilConfigCreate,
  CouncilConfigDetail,
  CouncilConfigListItem,
  CouncilMemberResult,
  CouncilResult,
  JobStatus,
} from '../../types';
import { CouncilGraph, type MemberNodeStatus } from './CouncilGraph';
import { NewCouncilForm } from './NewCouncilForm';
import { MemberEditDialog } from './MemberEditDialog';
import { markdownComponents } from '../../components/common/CodeBlock';

const STORAGE_KEY = 'mae_council_job_id';
const COUNCIL_MODELS_KEY = 'mae_council_selected_id';

type CouncilSection = 'run' | 'history';

type PanelStatus =
  | { type: 'idle' }
  | { type: 'enqueuing' }
  | { type: 'members'; done: string[]; errors: string[] }
  | { type: 'judging' }
  | { type: 'done'; result: CouncilResult }
  | { type: 'error'; message: string };


/** Warning icon for error states (consistent across OSes) */
function WarningIcon() {
  return (
    <svg className="w-3.5 h-3.5 shrink-0 mt-0.5 text-mae-error" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
    </svg>
  );
}


interface CouncilPanelProps {
  onNewCouncil?: () => void;
  historyJobId?: string | null;
  historyKey?: number;
  onClearHistoryMode?: () => void;
}

export function CouncilPanel({ onNewCouncil: _onNewCouncil, historyJobId, historyKey, onClearHistoryMode }: CouncilPanelProps) {
  const [section, setSection] = useState<CouncilSection>('run');
  const [prompt, setPrompt] = useState('');
  const [status, setStatus] = useState<PanelStatus>({ type: 'idle' });
  const [jobId, setJobId] = useState<string | null>(() =>
    localStorage.getItem(STORAGE_KEY),
  );

  // Council config state
  const [councils, setCouncils] = useState<CouncilConfigListItem[]>([]);
  const [selectedCouncilId, setSelectedCouncilId] = useState<string | null>(
    () => localStorage.getItem(COUNCIL_MODELS_KEY),
  );
  const [selectedCouncilDetail, setSelectedCouncilDetail] = useState<CouncilConfigDetail | null>(null);
  const [showManager, setShowManager] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [editingCouncil, setEditingCouncil] = useState<CouncilConfigDetail | null>(null);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);

  // Past results
  const [pastJobs, setPastJobs] = useState<JobStatus[]>([]);
  const [pastLoading, setPastLoading] = useState(false);
  const [pastError, setPastError] = useState<string | null>(null);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [expandedJob, setExpandedJob] = useState<JobStatus | null>(null);
  const [expandedLoading, setExpandedLoading] = useState(false);

  const activeRef = useRef(true);
  const abortRef = useRef<AbortController | null>(null);

  // React to external history trigger from sidebar
  useEffect(() => {
    if (historyKey && historyKey > 0) {
      setSection('history');
      if (historyJobId) {
        setExpandedJobId(historyJobId);
        // Fetch and expand the job
        fetchJobStatus(historyJobId).then(job => {
          setExpandedJob(job);
        }).catch(() => {});
      }
      onClearHistoryMode?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyKey]);

  // Load councils on mount
  useEffect(() => {
    listCouncils()
      .then(setCouncils)
      .catch(() => {});
  }, []);

  // Fetch full council detail when selected council changes
  useEffect(() => {
    if (selectedCouncilId) {
      getCouncil(selectedCouncilId)
        .then(setSelectedCouncilDetail)
        .catch(() => setSelectedCouncilDetail(null));
    } else {
      setSelectedCouncilDetail(null);
    }
  }, [selectedCouncilId]);

  // Load past results scoped to the selected council
  const loadPastResults = useCallback(async (councilId: string | null) => {
    setPastLoading(true);
    setPastError(null);
    try {
      const jobs = await listJobs('council', 20, councilId ?? undefined);
      setPastJobs(jobs);
    } catch (err: unknown) {
      setPastError(err instanceof Error ? err.message : String(err));
    } finally {
      setPastLoading(false);
    }
  }, []);

  // Load past results on mount and when selected council changes
  useEffect(() => {
    loadPastResults(selectedCouncilId);
  }, [selectedCouncilId, loadPastResults]);

  const clearJob = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setJobId(null);
    setStatus({ type: 'idle' });
  }, []);

  const attachStream = useCallback(async (id: string) => {
    if (!activeRef.current) return;

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      for await (const event of streamJobProgress(id)) {
        if (!activeRef.current || controller.signal.aborted) break;

        switch (event.type) {
          case 'progress': {
            const ev = event as { type: 'progress'; phase?: string };
            if (ev.phase === 'members') {
              const mEv = event as { type: 'progress'; phase: 'members'; model: string; member_id?: string; error?: string };
              const mid = mEv.member_id ?? mEv.model;
              setStatus(prev => {
                const base = prev.type === 'members'
                  ? { done: [...prev.done], errors: [...prev.errors] }
                  : { done: [], errors: [] };
                if (mEv.error) base.errors.push(`${mid}::${mEv.error}`);
                else base.done.push(mid);
                return { type: 'members', ...base };
              });
            } else if (ev.phase === 'judging') {
              setStatus({ type: 'judging' });
            }
            break;
          }
          case 'done': {
            const dEv = event as { type: 'done'; result: CouncilResult; status: string };
            setStatus({ type: 'done', result: dEv.result });
            localStorage.removeItem(STORAGE_KEY);
            setJobId(null);
            // Refresh past results
            loadPastResults(selectedCouncilId);
            break;
          }
          case 'error': {
            setStatus({ type: 'error', message: event.message });
            localStorage.removeItem(STORAGE_KEY);
            setJobId(null);
            break;
          }
        }

        if (event.type === 'done' || event.type === 'error') break;
      }
    } catch (err: unknown) {
      if (!activeRef.current || controller.signal.aborted) return;
      const msg = err instanceof Error ? err.message : String(err);
      setStatus({ type: 'error', message: msg });
      localStorage.removeItem(STORAGE_KEY);
      setJobId(null);
    }
  }, [loadPastResults, selectedCouncilId]);

  // Reconnect to existing job on mount
  useEffect(() => {
    activeRef.current = true;

    if (jobId && status.type === 'idle') {
      setStatus({ type: 'members', done: [], errors: [] });
      attachStream(jobId);
    }

    return () => {
      activeRef.current = false;
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStartCouncil = useCallback(async () => {
    if (!prompt.trim() || !selectedCouncilId) return;

    // Auto-clear previous result before starting a new job
    if (status.type === 'done' || status.type === 'error') {
      localStorage.removeItem(STORAGE_KEY);
      setJobId(null);
    }

    setStatus({ type: 'enqueuing' });
    try {
      const { job_id } = await enqueueCouncil(prompt, {
        councilId: selectedCouncilId,
      });
      localStorage.setItem(STORAGE_KEY, job_id);
      setJobId(job_id);
      setStatus({ type: 'members', done: [], errors: [] });
      attachStream(job_id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus({ type: 'error', message: msg });
    }
  }, [prompt, selectedCouncilId, attachStream]);

  // Save new council
  const handleSaveNewCouncil = useCallback(async (data: CouncilConfigCreate) => {
    await createCouncil(data);
    setShowNewForm(false);
    const updated = await listCouncils();
    setCouncils(updated);
    if (updated.length > 0) {
      setSelectedCouncilId(updated[0].id);
      localStorage.setItem(COUNCIL_MODELS_KEY, updated[0].id);
    }
  }, []);

  // Update existing council
  const handleUpdateCouncil = useCallback(async (id: string, data: CouncilConfigCreate) => {
    await updateCouncil(id, data);
    setEditingCouncil(null);
    setShowNewForm(false);
    const updated = await listCouncils();
    setCouncils(updated);
    // Refresh detail if this is the currently selected council
    if (selectedCouncilId === id) {
      const detail = await getCouncil(id);
      setSelectedCouncilDetail(detail);
    }
  }, [selectedCouncilId]);

  // Start editing a council
  const handleEditCouncil = useCallback(async (id: string) => {
    try {
      const detail = await getCouncil(id);
      setEditingCouncil(detail);
      setShowNewForm(true);
      setShowManager(false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus({ type: 'error', message: msg });
    }
  }, []);

  // Manage councils: delete
  const handleDeleteCouncil = useCallback(async (id: string) => {
    try {
      await deleteCouncil(id);
      if (selectedCouncilId === id) {
        localStorage.removeItem(COUNCIL_MODELS_KEY);
        setSelectedCouncilId(null);
      }
      setCouncils(await listCouncils());
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus({ type: 'error', message: msg });
    }
  }, [selectedCouncilId]);

  const handleSelectCouncil = useCallback((id: string | null) => {
    if (id) {
      localStorage.setItem(COUNCIL_MODELS_KEY, id);
    } else {
      localStorage.removeItem(COUNCIL_MODELS_KEY);
    }
    setSelectedCouncilId(id);
  }, []);

  // Edit a member from the graph (double-click)
  const handleEditMember = useCallback((memberId: string) => {
    setEditingMemberId(memberId);
  }, []);

  const handleSaveMember = useCallback(async (memberId: string, model: string, systemPrompt: string | null) => {
    if (!selectedCouncilDetail) return;
    const updatedMembers = selectedCouncilDetail.members.map(m =>
      m.id === memberId ? { ...m, model, system_prompt: systemPrompt } : m,
    );
    try {
      await updateCouncil(selectedCouncilDetail.id, {
        name: selectedCouncilDetail.name,
        description: selectedCouncilDetail.description,
        judge_model: selectedCouncilDetail.judge_model,
        members: updatedMembers.map(m => ({ model: m.model, system_prompt: m.system_prompt })),
      });
      const detail = await getCouncil(selectedCouncilDetail.id);
      setSelectedCouncilDetail(detail);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus({ type: 'error', message: msg });
    } finally {
      setEditingMemberId(null);
    }
  }, [selectedCouncilDetail]);

  const editingMember = editingMemberId && selectedCouncilDetail
    ? selectedCouncilDetail.members.find(m => m.id === editingMemberId) ?? null
    : null;

  // Expand a past result
  const handleExpandJob = useCallback(async (id: string) => {
    if (expandedJobId === id) {
      setExpandedJobId(null);
      setExpandedJob(null);
      return;
    }
    setExpandedJobId(id);
    setExpandedLoading(true);
    try {
      const job = await fetchJobStatus(id);
      setExpandedJob(job);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setPastError(msg);
    } finally {
      setExpandedLoading(false);
    }
  }, [expandedJobId]);

  const selectedCouncil = selectedCouncilDetail;

  // Derive graph data from the selected council + run status
  const graphMembers = selectedCouncil
    ? selectedCouncil.members.map(m => ({
        id: m.id,
        model: m.model,
        status: 'pending' as MemberNodeStatus,
        systemPrompt: m.system_prompt ?? undefined,
      }))
    : [];

  // Build live graph status from the current run
  const liveMembers = (() => {
    if (status.type === 'members' && selectedCouncil) {
      return selectedCouncil.members.map(m => {
        let memberStatus: MemberNodeStatus = 'pending';
        const exactDone = status.done.includes(m.id);
        const errorEntry = status.errors.find(e => e.startsWith(`${m.id}::`));
        if (errorEntry) memberStatus = 'error';
        else if (exactDone) memberStatus = 'done';
        if (memberStatus === 'pending') memberStatus = 'in_progress';
        return {
          id: m.id,
          model: m.model,
          status: memberStatus,
          error: errorEntry ? errorEntry.split('::').slice(1).join('::') : undefined,
          systemPrompt: m.system_prompt ?? undefined,
        };
      });
    }
    return null;
  })();

  const graphJudgeModel = selectedCouncil?.judge_model || 'default';
  const graphJudgeStatus = (() => {
    if (status.type === 'judging') return 'judging' as const;
    if (status.type === 'done') return 'done' as const;
    return 'idle' as const;
  })();

  const isLive = status.type === 'members' || status.type === 'judging' || status.type === 'done';
  const isProcessing = status.type !== 'idle' && status.type !== 'done' && status.type !== 'error';

  return (
    <div className="flex-1 flex flex-col items-center py-8 px-8 overflow-y-auto">
      <div className="max-w-3xl w-full flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <h2 className="text-topbar tracking-tight text-mae-text">Council</h2>
        </div>
        <p className="text-sidebar-meta text-mae-muted">
          Send one prompt to a configured council and get a synthesized verdict.
        </p>

        {/* ── Run tab ─────────────────────────────────────────────────── */}
        {section === 'run' && (
          <>
            {/* Council selector + New Council button */}
            <div className="flex items-end gap-3">
              <div className="flex-1 flex flex-col gap-1">
                <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mae-muted">
                  Council Configuration
                </label>
                <select
                  value={selectedCouncilId ?? ''}
                  onChange={e => handleSelectCouncil(e.target.value || null)}
                  disabled={status.type !== 'idle'}
                  className="w-full px-3 py-2 rounded-[10px] glass-input text-mae-text text-sm border border-mae-border focus-visible:outline-2 focus-visible:outline-mae-accent focus-visible:outline-offset-2 disabled:opacity-35"
                >
                  <option value="">— Select a council —</option>
                  {councils.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={() => setShowNewForm(v => !v)}
                className="px-3 py-2 rounded-[10px] bg-transparent text-mae-text text-xs cursor-pointer transition-colors hover:border-mae-accent focus-visible:outline-2 focus-visible:outline-mae-accent focus-visible:outline-offset-2 border border-mae-border shrink-0 whitespace-nowrap"
              >
                + New council
              </button>
              <button
                onClick={() => setShowManager(v => !v)}
                className="px-3 py-2 rounded-[10px] bg-mae-surface text-mae-muted text-xs cursor-pointer transition-colors hover:bg-mae-bubble-assistant hover:text-mae-text focus-visible:outline-2 focus-visible:outline-mae-accent focus-visible:outline-offset-2 border border-mae-border shrink-0"
              >
                {showManager ? 'Done' : 'Manage'}
              </button>
            </div>

            {/* New Council form */}
            {showNewForm && (
              <NewCouncilForm
                onSave={editingCouncil
                  ? (data) => handleUpdateCouncil(editingCouncil.id, data)
                  : handleSaveNewCouncil}
                onCancel={() => {
                  setShowNewForm(false);
                  setEditingCouncil(null);
                }}
                initial={editingCouncil ?? undefined}
              />
            )}

            {/* Council Graph — idle preview */}
            {selectedCouncil && !isLive && (
              <div className="flex flex-col gap-3 p-5 rounded-[14px] glass-input border border-mae-border">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mae-muted">
                  {selectedCouncil.name}
                </span>
                <CouncilGraph
                  members={graphMembers}
                  judgeModel={graphJudgeModel}
                  judgeStatus="idle"
                  idle
                  onEditMember={handleEditMember}
                />
              </div>
            )}

            {/* Council Graph — live run */}
            {liveMembers && isLive && (
              <div className="flex flex-col gap-3 p-5 rounded-[14px] glass-input border border-mae-border">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mae-muted">
                  {selectedCouncil?.name || 'Council Run'}
                </span>
                <CouncilGraph
                  members={liveMembers}
                  judgeModel={graphJudgeModel}
                  judgeStatus={graphJudgeStatus}
                  idle={false}
                  onEditMember={isProcessing ? undefined : handleEditMember}
                  onClick={() => {
                    // Scroll to verdict if done
                    if (status.type === 'done') {
                      document.getElementById('council-verdict')?.scrollIntoView({ behavior: 'smooth' });
                    }
                  }}
                />
              </div>
            )}

            {/* Member edit dialog */}
            {editingMember && (
              <MemberEditDialog
                member={editingMember}
                onSave={handleSaveMember}
                onClose={() => setEditingMemberId(null)}
              />
            )}

            {/* Council configuration manager */}
            {showManager && (
              <div className="flex flex-col gap-4 p-4 rounded-[10px] glass-input border border-mae-border">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mae-muted">
                  Manage Councils
                </span>

                {/* Existing councils */}
                {councils.length > 0 && (
                  <div className="flex flex-col gap-2">
                    {councils.map(c => (
                      <div key={c.id} className="flex items-center gap-2 px-3 py-2 rounded-[8px] bg-mae-bubble-user border border-mae-border">
                        <span className="flex-1 text-sm text-mae-text">{c.name}</span>
                        <span className="text-xs text-mae-muted">{c.description || ''}</span>
                        <button
                          onClick={() => handleEditCouncil(c.id)}
                          className="px-2 py-1 rounded-[6px] text-xs text-mae-accent bg-mae-surface border border-mae-accent cursor-pointer hover:opacity-80"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteCouncil(c.id)}
                          className="px-2 py-1 rounded-[6px] text-xs text-mae-error bg-mae-error-bg border border-mae-error cursor-pointer hover:opacity-80"
                        >
                          Delete
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {councils.length === 0 && (
                  <span className="text-sm text-mae-muted">No councils saved yet.</span>
                )}
              </div>
            )}

            {/* Prompt input */}
            <div className="flex flex-col gap-2">
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                placeholder="Enter your prompt for the council..."
                rows={4}
                disabled={isProcessing}
                className="w-full resize-none px-4 py-3 rounded-[10px] glass-input text-mae-text text-sm border border-mae-border placeholder:text-mae-muted/50 focus-visible:outline-2 focus-visible:outline-mae-accent focus-visible:outline-offset-2 disabled:opacity-35"
              />
            </div>

            {/* Progress: member-by-member */}
            {status.type === 'members' && (
              <div className="flex flex-col gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mae-muted">
                  Consulting council members…
                </span>
                {status.done.map(model => (
                  <div key={model} className="flex items-center gap-2 px-4 py-2 rounded-[10px] bg-mae-bubble-user border border-mae-border text-sm text-mae-text">
                    <svg className="w-4 h-4 text-mae-accent shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="font-mono text-xs">{model}</span>
                    <span className="text-mae-muted text-xs ml-auto">complete</span>
                  </div>
                ))}
                {status.errors.map(err => (
                  <div key={err} className="flex items-center gap-2 px-4 py-2 rounded-[10px] bg-mae-error-bg border border-mae-error text-sm text-mae-error">
                    <WarningIcon />
                    <span className="font-mono text-xs">{err}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Judging phase */}
            {status.type === 'judging' && (
              <div className="flex items-center gap-2 px-4 py-3 rounded-[10px] glass-input border border-mae-border text-sm text-mae-text">
                <svg className="w-4 h-4 animate-spin text-mae-accent shrink-0" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span>Synthesizing verdict…</span>
              </div>
            )}

            {/* Done: results */}
            {status.type === 'done' && (
              <div className="flex flex-col gap-4" id="council-verdict">
                <div className="flex flex-col gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mae-muted">
                    Member responses
                  </span>
                  {status.result.members.map((member: CouncilMemberResult) => (
                    <div
                      key={member.model}
                      className="flex flex-col gap-2 px-4 py-3 rounded-[10px] bg-mae-bubble-user border border-mae-border"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-mae-accent font-medium">{member.model}</span>
                        {member.error && (
                          <span className="text-xs text-mae-error flex items-center gap-1">
                            <WarningIcon /> {member.error}
                          </span>
                        )}
                      </div>
                      {member.content && (
                        <div className="text-sm text-mae-text leading-relaxed prose prose-sm prose-invert max-w-none prose-headings:text-mae-text prose-a:text-mae-accent prose-code:text-mae-text prose-code:bg-mae-surface prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-transparent prose-pre:p-0">
                          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                            {member.content}
                          </ReactMarkdown>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="flex flex-col gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mae-muted">
                    Verdict
                  </span>
                  {status.result.verdict ? (
                    <div className="px-4 py-3 rounded-[10px] bg-mae-surface border border-mae-border text-sm text-mae-text leading-relaxed prose prose-sm prose-invert max-w-none prose-headings:text-mae-text prose-a:text-mae-accent prose-code:text-mae-text prose-code:bg-mae-surface prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-transparent prose-pre:p-0">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                        {status.result.verdict}
                      </ReactMarkdown>
                    </div>
                  ) : status.result.judge_error ? (
                    <div className="flex items-start gap-3 px-4 py-3 rounded-[10px] bg-mae-error-bg border border-mae-error text-sm text-mae-error">
                      <WarningIcon />
                      <div className="flex flex-col gap-1">
                        <span className="font-medium">Synthesis unavailable</span>
                        <span className="text-xs">{status.result.judge_error}</span>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            )}

            {/* Error */}
            {status.type === 'error' && (
              <div className="flex items-start gap-3 px-4 py-3 rounded-[10px] bg-mae-error-bg border border-mae-error text-sidebar-meta text-mae-error">
                <WarningIcon />
                <span>{status.message}</span>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={handleStartCouncil}
                disabled={isProcessing || !prompt.trim() || !selectedCouncilId}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-[10px] bg-mae-accent text-mae-accent-on text-sm font-medium cursor-pointer transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-mae-accent focus-visible:outline-offset-2 disabled:opacity-35 disabled:cursor-not-allowed border-none"
              >
                {status.type === 'enqueuing'
                  ? 'Starting…'
                  : status.type === 'members'
                    ? `${status.done.length + status.errors.length} members contacted…`
                    : status.type === 'judging'
                      ? 'Judging…'
                      : 'Start Council'}
              </button>

              {(status.type === 'done' || status.type === 'error') && (
                <button
                  onClick={clearJob}
                  className="flex items-center justify-center px-4 py-2.5 rounded-[10px] bg-mae-surface text-mae-muted text-sm cursor-pointer transition-colors hover:bg-mae-bubble-assistant hover:text-mae-text focus-visible:outline-2 focus-visible:outline-mae-accent focus-visible:outline-offset-2 border border-mae-border"
                >
                  Clear
                </button>
              )}
            </div>
          </>
        )}

        {/* ── History tab ─────────────────────────────────────────────── */}
        {section === 'history' && (
          <div className="flex flex-col gap-3">
            {/* Loading */}
            {pastLoading && (
              <div className="flex items-center gap-2 px-4 py-3 rounded-[10px] bg-mae-surface border border-mae-border text-sm text-mae-muted">
                <svg className="w-4 h-4 animate-spin text-mae-accent shrink-0" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span>Loading past results…</span>
              </div>
            )}

            {/* Error */}
            {pastError && (
              <div className="flex items-start gap-3 px-4 py-3 rounded-[10px] bg-mae-error-bg border border-mae-error text-sm text-mae-error">
                <WarningIcon />
                <span>{pastError}</span>
              </div>
            )}

            {/* Empty state */}
            {!pastLoading && !pastError && pastJobs.length === 0 && (
              <div className="px-4 py-3 rounded-[10px] bg-mae-surface border border-mae-border text-sm text-mae-muted">
                {selectedCouncilId
                  ? 'No past results for this council yet.'
                  : 'Select or create a council to see its past results.'}
              </div>
            )}

            {/* List */}
            {!pastLoading && pastJobs.length > 0 && (
              <div className="flex flex-col gap-2">
                {pastJobs.map(job => {
                  const displayTitle = job.title || (job.payload?.prompt as string) || '';
                  const truncated = displayTitle.length > 80
                    ? displayTitle.slice(0, 80) + '…'
                    : displayTitle;
                  const modelCount = (job.payload?.models as string[])?.length ?? 0;
                  const date = new Date(job.created_at).toLocaleDateString(undefined, {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                  });

                  return (
                    <div key={job.id} className="flex flex-col">
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => handleExpandJob(job.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleExpandJob(job.id);
                          }
                        }}
                        className="flex items-center gap-3 w-full px-4 py-2.5 rounded-[10px] bg-transparent border border-transparent text-left text-sm text-mae-text cursor-pointer transition-colors hover:bg-mae-bubble-assistant hover:border-mae-border focus-visible:outline-2 focus-visible:outline-mae-accent focus-visible:outline-offset-2"
                      >
                        <span className={`w-2 h-2 rounded-full shrink-0 ${
                          job.status === 'done' ? 'bg-mae-accent' : job.status === 'failed' ? 'bg-mae-error' : 'bg-yellow-500'
                        }`} />
                        <span className="flex-1 truncate text-mae-text">{truncated || '(no prompt)'}</span>
                        <span className="text-xs text-mae-muted shrink-0">{modelCount} models</span>
                        <span className="text-xs text-mae-muted shrink-0">{date}</span>
                        <svg
                          className={`w-3.5 h-3.5 text-mae-muted shrink-0 transition-transform ${
                            expandedJobId === job.id ? 'rotate-180' : ''
                          }`}
                          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>

                      {/* Expanded detail */}
                      {expandedJobId === job.id && (
                        <div className="mt-2 px-4 py-3 rounded-[10px] bg-mae-bubble-user border border-mae-border">
                          {expandedLoading ? (
                            <div className="flex items-center gap-2 text-sm text-mae-muted">
                              <svg className="w-4 h-4 animate-spin text-mae-accent shrink-0" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                              <span>Loading…</span>
                            </div>
                          ) : expandedJob && expandedJob.result ? (
                            <div className="flex flex-col gap-4">
                              {/* Member responses */}
                              <div className="flex flex-col gap-2">
                                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mae-muted">
                                  Member responses
                                </span>
                                {((expandedJob.result as unknown as CouncilResult).members ?? []).map((member: CouncilMemberResult) => (
                                  <div key={member.model} className="flex flex-col gap-1">
                                    <span className="text-xs font-mono text-mae-accent font-medium">{member.model}</span>
                                    {member.content && (
                                      <div className="text-sm text-mae-text leading-relaxed prose prose-sm prose-invert max-w-none prose-headings:text-mae-text prose-a:text-mae-accent prose-code:text-mae-text prose-code:bg-mae-surface prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-transparent prose-pre:p-0">
                                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                                          {member.content}
                                        </ReactMarkdown>
                                      </div>
                                    )}
                                    {member.error && (
                                      <span className="text-xs text-mae-error flex items-center gap-1"><WarningIcon />{member.error}</span>
                                    )}
                                  </div>
                                ))}
                              </div>

                              {/* Verdict */}
                              {(expandedJob.result as unknown as CouncilResult).verdict && (
                                <div className="flex flex-col gap-2">
                                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mae-muted">
                                    Verdict
                                  </span>
                                  <div className="text-sm text-mae-text leading-relaxed prose prose-sm prose-invert max-w-none prose-headings:text-mae-text prose-a:text-mae-accent prose-code:text-mae-text prose-code:bg-mae-surface prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-transparent prose-pre:p-0">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                                      {(expandedJob.result as unknown as CouncilResult).verdict!}
                                    </ReactMarkdown>
                                  </div>
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-sm text-mae-muted">No result data available.</span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
