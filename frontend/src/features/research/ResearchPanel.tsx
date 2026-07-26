import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { enqueueResearch } from '../../api/research';
import { fetchJobStatus, listJobs, streamJobProgress } from '../../api/jobs';
import type {
  JobStatus,
  ResearchResult,
  ResearchSource,
} from '../../types';
import { markdownComponents } from '../../components/common/CodeBlock';
import { useModels } from '../../hooks/useModels';
import { ModelPicker } from '../../components/common/ModelPicker';

const STORAGE_KEY = 'mae_research_job_id';

type ResearchSection = 'run' | 'history';

type PanelStatus =
  | { type: 'idle' }
  | { type: 'enqueuing' }
  | { type: 'searching'; resultsCount?: number }
  | { type: 'synthesizing' }
  | { type: 'done'; result: ResearchResult }
  | { type: 'error'; message: string };


function SourceCard({ source, index }: { source: ResearchSource; index: number }) {
  const [expanded, setExpanded] = useState(false);
  const contentPreview = source.content.length > 300
    ? source.content.slice(0, 300) + '…'
    : source.content;

  return (
    <div className="flex flex-col gap-1.5 px-4 py-3 rounded-[10px] bg-mae-bubble-user border border-mae-border">
      <div className="flex items-start gap-2">
        <span className="w-5 h-5 rounded-full bg-mae-accent/20 text-mae-accent text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
          {index}
        </span>
        <div className="flex-1 min-w-0">
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-mae-accent hover:underline line-clamp-2"
          >
            {source.title || source.url}
          </a>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-mae-muted truncate max-w-[300px]">{source.url}</span>
            <button
              onClick={() => setExpanded(v => !v)}
              className="text-xs text-mae-accent hover:underline cursor-pointer bg-transparent border-none shrink-0"
            >
              {expanded ? 'Less' : 'Preview'}
            </button>
          </div>
        </div>
      </div>
      {expanded && (
        <div className="mt-1 text-xs text-mae-muted leading-relaxed max-h-48 overflow-y-auto border-t border-mae-border pt-2">
          {contentPreview}
        </div>
      )}
    </div>
  );
}

interface ResearchPanelProps {
  onNewResearch?: () => void;
  historyJobId?: string | null;
  historyKey?: number;
  onClearHistoryMode?: () => void;
}

export function ResearchPanel({ onNewResearch: _onNewResearch, historyJobId, historyKey, onClearHistoryMode }: ResearchPanelProps) {
  const [section, setSection] = useState<ResearchSection>('run');
  const [query, setQuery] = useState('');
  const [model, setModel] = useState('');
  const models = useModels();
  useEffect(() => { if (!model && models[0]) setModel(models[0].id); }, [models, model]);
  const [status, setStatus] = useState<PanelStatus>({ type: 'idle' });
  const [jobId, setJobId] = useState<string | null>(() =>
    localStorage.getItem(STORAGE_KEY),
  );

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
        fetchJobStatus(historyJobId).then(job => {
          setExpandedJob(job);
        }).catch(() => {});
      }
      onClearHistoryMode?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyKey]);

  // Load past results on mount
  const loadPastResults = useCallback(async () => {
    setPastLoading(true);
    setPastError(null);
    try {
      const jobs = await listJobs('research', 20);
      setPastJobs(jobs);
    } catch (err: unknown) {
      setPastError(err instanceof Error ? err.message : String(err));
    } finally {
      setPastLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPastResults();
  }, [loadPastResults]);

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
            if (ev.phase === 'searching') {
              const sEv = event as { type: 'progress'; phase: 'searching'; complete?: boolean; results_count?: number };
              if (sEv.complete) {
                setStatus({ type: 'searching', resultsCount: sEv.results_count });
              } else {
                setStatus({ type: 'searching' });
              }
            } else if (ev.phase === 'synthesizing') {
              setStatus({ type: 'synthesizing' });
            }
            break;
          }
          case 'done': {
            const dEv = event as { type: 'done'; result: ResearchResult; status: string };
            setStatus({ type: 'done', result: dEv.result });
            localStorage.removeItem(STORAGE_KEY);
            setJobId(null);
            loadPastResults();
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
  }, [loadPastResults]);

  // Reconnect to existing job on mount
  useEffect(() => {
    if (jobId && status.type === 'idle') {
      setStatus({ type: 'searching' });
      attachStream(jobId);
    }

    return () => {
      activeRef.current = false;
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleStartResearch = useCallback(async () => {
    if (!query.trim()) return;

    setStatus({ type: 'enqueuing' });
    try {
      const { job_id } = await enqueueResearch(query, model);
      localStorage.setItem(STORAGE_KEY, job_id);
      setJobId(job_id);
      setStatus({ type: 'searching' });
      attachStream(job_id);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus({ type: 'error', message: msg });
    }
  }, [query, model, attachStream]);

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

  // Hide sources list if the report is long
  const [sourcesExpanded, setSourcesExpanded] = useState(true);

  // Re-enable sources expand when a new result arrives
  useEffect(() => {
    if (status.type === 'done') {
      setSourcesExpanded(true);
    }
  }, [status]);

  return (
    <div className="flex-1 flex flex-col items-center py-8 px-8 overflow-y-auto">
      <div className="max-w-2xl w-full flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <h2 className="text-topbar tracking-tight text-mae-text">Research</h2>
        </div>
        <p className="text-sidebar-meta text-mae-muted">
          Search the web and synthesize a report using an LLM of your choice.
        </p>

        {/* ── Run tab ─────────────────────────────────────────────────── */}
        {section === 'run' && (
          <>
            {/* Query input */}
            <div className="flex flex-col gap-2">
              <textarea
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Enter a research query..."
                rows={3}
                disabled={status.type !== 'idle'}
                className="w-full resize-none px-4 py-3 rounded-[10px] glass-input text-mae-text text-sm border border-mae-border placeholder:text-mae-muted/50 focus-visible:outline-2 focus-visible:outline-mae-accent focus-visible:outline-offset-2 disabled:opacity-35"
              />
            </div>

            {/* Model selector */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mae-muted">
                Synthesis Model
              </label>
              <div className="w-full max-w-xs"><ModelPicker value={model} onChange={setModel} disabled={status.type !== 'idle'} /></div>
            </div>

            {/* Progress: searching */}
            {status.type === 'searching' && (
              <div className="flex items-center gap-2 px-4 py-3 rounded-[10px] glass-input border border-mae-border text-sm text-mae-text">
                <svg className="w-4 h-4 animate-spin text-mae-accent shrink-0" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span>
                  {status.resultsCount !== undefined
                    ? `Found ${status.resultsCount} sources`
                    : 'Searching the web…'}
                </span>
              </div>
            )}

            {/* Progress: synthesizing */}
            {status.type === 'synthesizing' && (
              <div className="flex items-center gap-2 px-4 py-3 rounded-[10px] glass-input border border-mae-border text-sm text-mae-text">
                <svg className="w-4 h-4 animate-spin text-mae-accent shrink-0" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span>Synthesizing report…</span>
              </div>
            )}

            {/* Done: results */}
            {status.type === 'done' && (
              <div className="flex flex-col gap-4">
                {/* Sources */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mae-muted">
                      Sources ({status.result.sources.length})
                    </span>
                    <button
                      onClick={() => setSourcesExpanded(v => !v)}
                      className="text-xs text-mae-accent hover:underline cursor-pointer bg-transparent border-none"
                    >
                      {sourcesExpanded ? 'Collapse' : 'Expand'}
                    </button>
                  </div>
                  {sourcesExpanded && (
                    <div className="flex flex-col gap-2">
                      {status.result.sources.map((source: ResearchSource, i: number) => (
                        <SourceCard key={source.url} source={source} index={i + 1} />
                      ))}
                    </div>
                  )}
                </div>

                {/* Report */}
                <div className="flex flex-col gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mae-muted">
                    Report
                  </span>
                  {status.result.report ? (
                    <div className="px-4 py-3 rounded-[10px] bg-mae-surface border border-mae-border text-sm text-mae-text leading-relaxed prose prose-sm prose-invert max-w-none prose-headings:text-mae-text prose-a:text-mae-accent prose-code:text-mae-text prose-code:bg-mae-surface prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-transparent prose-pre:p-0">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                        {status.result.report}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <div className="px-4 py-3 rounded-[10px] bg-mae-error-bg border border-mae-error text-sm text-mae-error">
                      Report synthesis was unavailable. Sources were retrieved but the report could not be generated.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Error */}
            {status.type === 'error' && (
              <div className="flex items-start gap-3 px-4 py-3 rounded-[10px] bg-mae-error-bg border border-mae-error text-sidebar-meta text-mae-error">
                <span className="shrink-0 text-base leading-tight">⚠</span>
                <span>{status.message}</span>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={handleStartResearch}
                disabled={status.type !== 'idle' || !query.trim()}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-[10px] bg-mae-accent text-mae-accent-on text-sm font-medium cursor-pointer transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-mae-accent focus-visible:outline-offset-2 disabled:opacity-35 disabled:cursor-not-allowed border-none"
              >
                {status.type === 'enqueuing'
                  ? 'Starting…'
                  : status.type === 'searching'
                    ? 'Searching…'
                    : status.type === 'synthesizing'
                      ? 'Synthesizing…'
                      : 'Start Research'}
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
                <span className="shrink-0 text-base leading-tight">⚠</span>
                <span>{pastError}</span>
              </div>
            )}

            {/* Empty state */}
            {!pastLoading && !pastError && pastJobs.length === 0 && (
              <div className="px-4 py-3 rounded-[10px] bg-mae-surface border border-mae-border text-sm text-mae-muted">
                No past research results yet. Submit a query above to get started.
              </div>
            )}

            {/* List */}
            {!pastLoading && pastJobs.length > 0 && (
              <div className="flex flex-col gap-2">
                {pastJobs.map(job => {
                  const displayTitle = job.title || (job.payload?.query as string) || '';
                  const truncated = displayTitle.length > 80
                    ? displayTitle.slice(0, 80) + '…'
                    : displayTitle;
                  const sourceCount = ((job.result as unknown as ResearchResult)?.sources ?? []).length;
                  const hasReport = !!(job.result as unknown as ResearchResult)?.report;
                  const date = new Date(job.created_at).toLocaleDateString(undefined, {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                  });

                  return (
                    <div key={job.id} className="flex flex-col">
                      <button
                        onClick={() => handleExpandJob(job.id)}
                        className="flex items-center gap-3 w-full px-4 py-2.5 rounded-[10px] bg-transparent border border-transparent text-left text-sm text-mae-text cursor-pointer transition-colors hover:bg-mae-bubble-assistant hover:border-mae-border focus-visible:outline-2 focus-visible:outline-mae-accent focus-visible:outline-offset-2"
                      >
                        <span className={`w-2 h-2 rounded-full shrink-0 ${
                          job.status === 'done' ? 'bg-mae-accent' : job.status === 'failed' ? 'bg-mae-error' : 'bg-yellow-500'
                        }`} />
                        <span className="flex-1 truncate text-mae-text">{truncated || '(no query)'}</span>
                        <span className="text-xs text-mae-muted shrink-0">{sourceCount} sources</span>
                        {hasReport && <span className="text-xs text-mae-accent shrink-0">report</span>}
                        <span className="text-xs text-mae-muted shrink-0">{date}</span>
                        <svg
                          className={`w-3.5 h-3.5 text-mae-muted shrink-0 transition-transform ${
                            expandedJobId === job.id ? 'rotate-180' : ''
                          }`}
                          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>

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
                              {/* Sources */}
                              <div className="flex flex-col gap-2">
                                <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mae-muted">
                                  Sources
                                </span>
                                {((expandedJob.result as unknown as ResearchResult).sources ?? []).map((source: ResearchSource, _i: number) => (
                                  <div key={source.url} className="flex flex-col gap-1 px-3 py-2 rounded-[8px] bg-mae-surface border border-mae-border">
                                    <a
                                      href={source.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-sm font-medium text-mae-accent hover:underline"
                                    >
                                      {source.title || source.url}
                                    </a>
                                    <span className="text-xs text-mae-muted truncate">{source.url}</span>
                                  </div>
                                ))}
                              </div>

                              {/* Report */}
                              {(expandedJob.result as unknown as ResearchResult).report && (
                                <div className="flex flex-col gap-2">
                                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-mae-muted">
                                    Report
                                  </span>
                                  <div className="text-sm text-mae-text leading-relaxed prose prose-sm prose-invert max-w-none prose-headings:text-mae-text prose-a:text-mae-accent prose-code:text-mae-text prose-code:bg-mae-surface prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-transparent prose-pre:p-0">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                                      {(expandedJob.result as unknown as ResearchResult).report!}
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
