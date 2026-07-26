import { useEffect, useRef, useState } from 'react';
import { enqueueDocument } from '../../api/documents';
import { fetchJobStatus, streamJobProgress } from '../../api/jobs';
import type { DocumentResult, JobStatus } from '../../types';
import { useModels } from '../../hooks/useModels';
import { ModelPicker } from '../../components/common/ModelPicker';

const STORAGE_KEY = 'mae_document_job_id';

interface DocumentPanelProps {
  historyJobId?: string | null;
  historyKey?: number;
  onClearHistoryMode?: () => void;
  onJobUpdate?: (terminal?: boolean) => void;
}

export function DocumentPanel({ historyJobId, historyKey, onClearHistoryMode, onJobUpdate }: DocumentPanelProps) {
  const [mode, setMode] = useState('create');
  const [format, setFormat] = useState('docx');
  const [prompt, setPrompt] = useState('');
  const [title, setTitle] = useState('');
  const [model, setModel] = useState('');
  const models = useModels();
  useEffect(() => { if (!model && models[0]) setModel(models[0].id); }, [models, model]);
  const [file, setFile] = useState<File>();
  const [files, setFiles] = useState<File[]>([]);
  const [pageStart, setPageStart] = useState('1');
  const [pageEnd, setPageEnd] = useState('1');
  const [phase, setPhase] = useState('idle');
  const [result, setResult] = useState<DocumentResult | null>(null);
  const [selectedJob, setSelectedJob] = useState<JobStatus | null>(null);
  const [error, setError] = useState('');
  const [code, setCode] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [draggingFile, setDraggingFile] = useState(false);

  useEffect(() => {
    if (!historyKey || !historyJobId) return;
    fetchJobStatus(historyJobId).then(job => {
      setSelectedJob(job);
      setResult(job.result as DocumentResult | null);
      setPhase(job.status);
      if (job.status === 'in_progress' || job.status === 'queued') void attach(historyJobId);
    }).catch(() => setError('Unable to load document history'));
    onClearHistoryMode?.();
  }, [historyKey, historyJobId, onClearHistoryMode]);

  const attach = async (id: string) => {
    try {
      for await (const event of streamJobProgress(id)) {
        if (event.type === 'status') { setPhase(event.status); setSelectedJob(previous => previous ? { ...previous, status: event.status } : previous); onJobUpdate?.(); }
        if (event.type === 'progress') { setPhase(event.phase); setSelectedJob(previous => previous ? { ...previous, status: event.status || 'in_progress' } : previous); onJobUpdate?.(); }
        if (event.type === 'code') setCode(previous => previous + event.chunk);
        if (event.type === 'retrying') { setCode(''); setPhase(`Retrying ${event.attempt}/${event.max_attempts}`); setError(''); onJobUpdate?.(); }
        if (event.type === 'done') {
          setResult(event.result as DocumentResult);
          setPhase('done');
          setSelectedJob(previous => previous ? { ...previous, status: 'done', result: event.result as unknown as Record<string, unknown> } : previous);
          onJobUpdate?.(true);
          localStorage.removeItem(STORAGE_KEY);
        }
        if (event.type === 'error') {
          setError(event.message);
          setPhase('error');
          setSelectedJob(previous => previous ? { ...previous, status: 'failed', error: event.message } : previous);
          onJobUpdate?.(true);
          localStorage.removeItem(STORAGE_KEY);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Document job failed');
      setPhase('error');
    }
  };

  useEffect(() => {
    const id = localStorage.getItem(STORAGE_KEY);
    if (id && !historyJobId) {
      setPhase('generating');
      void attach(id);
    }
  }, []);

  const submit = async () => {
    if (!prompt.trim() || (mode === 'edit' && !file)) return;
    setError(''); setResult(null); setSelectedJob(null); setCode(''); setPhase('enqueuing');
    try {
       const selectedFiles = mode === 'pdf_merge' ? files : file ? [file] : [];
       const { job_id } = await enqueueDocument({ format, mode, prompt, title, model, file, files: selectedFiles, page_start: mode === 'pdf_split' ? Number(pageStart) : undefined, page_end: mode === 'pdf_split' ? Number(pageEnd) : undefined });
      localStorage.setItem(STORAGE_KEY, job_id);
      setPhase('planning');
      onJobUpdate?.();
      void attach(job_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to start document job');
      setPhase('error');
    }
  };

  const acceptFile = (nextFile?: File) => {
    if (nextFile) setFile(nextFile);
  };

  const showingHistory = Boolean(selectedJob);
  const historyResult = selectedJob?.result as DocumentResult | null;

  return <div className="flex-1 overflow-y-auto px-5 py-8 sm:px-8"><div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
    <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-mae-accent">Document workspace</p><h2 className="mt-2 text-2xl font-semibold tracking-tight text-mae-text">Documents</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-mae-muted">{showingHistory ? 'Review the prompt and generated artifact.' : 'Create a new document or reshape an existing file with clear instructions.'}</p></div>
     {showingHistory ? <div className="flex flex-col gap-4">
       <div className="px-4 py-4 rounded-[10px] bg-mae-surface border border-mae-border"><div className="flex justify-between mb-2"><p className="text-[11px] uppercase tracking-[0.08em] text-mae-muted">Prompt</p><StatusBadge status={selectedJob?.status || phase} /></div><p className="text-sm text-mae-text whitespace-pre-wrap">{selectedJob?.payload?.prompt as string}</p>{selectedJob?.error && <p className="text-sm text-mae-error mt-3">{selectedJob.error}</p>}</div>
       {historyResult?.preview ? <div className="px-4 py-4 rounded-[10px] bg-mae-surface border border-mae-border"><div className="flex justify-between gap-4 mb-3"><p className="text-[11px] uppercase tracking-[0.08em] text-mae-muted">Generated preview</p><p className="text-xs text-mae-muted">{historyResult.preview.summary}</p></div><p className="max-h-72 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-mae-text">{historyResult.preview.text || "This document contains no extractable text."}</p></div> : selectedJob?.status === "done" && <div className="px-4 py-4 rounded-[10px] bg-mae-surface border border-mae-border text-sm text-mae-muted">Preview unavailable for this older result. Generate a new document to save a preview.</div>}
       {historyResult?.artifact ? <div className="flex items-center justify-between px-4 py-4 rounded-[10px] bg-mae-surface border border-mae-border"><div><p className="text-sm text-mae-text">{historyResult.artifact.display_name}</p><p className="text-xs text-mae-muted">{Math.ceil(historyResult.artifact.size / 1024)} KB · {historyResult.format.toUpperCase()}</p></div><a href={historyResult.artifact.download_url} download={historyResult.artifact.display_name} className="px-3 py-2 rounded-[8px] bg-mae-accent text-mae-accent-on text-sm">Download</a></div> : selectedJob?.status === "done" && <div className="px-4 py-4 rounded-[10px] bg-mae-surface border border-mae-border text-sm text-mae-muted">The generated file is unavailable for this result.</div>}
        {historyResult?.render?.preview_url && <img src={historyResult.render.preview_url} alt="Rendered document preview" className="max-w-full rounded-[10px] border border-mae-border" />}
     </div> : <>
       <div className="overflow-hidden rounded-2xl border border-mae-border bg-mae-surface">
         <div className="border-b border-mae-border p-5 sm:p-6">
           <p className="text-xs font-semibold uppercase tracking-[0.12em] text-mae-muted">1. Choose a workflow</p>
           <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
             {['create','edit', ...(format === 'pdf' ? ['pdf_merge','pdf_split'] : [])].map(x => <button type="button" key={x} onClick={() => setMode(x)} className={`rounded-xl border px-3 py-3 text-left transition-colors ${mode === x ? 'border-mae-accent bg-mae-accent/10 text-mae-text' : 'border-mae-border text-mae-muted hover:border-mae-muted hover:text-mae-text'}`}><span className="block text-sm font-medium">{x === 'create' ? 'Create' : x === 'edit' ? 'Edit' : x === 'pdf_merge' ? 'Merge PDFs' : 'Split PDF'}</span><span className="mt-1 block text-xs text-current/70">{x === 'create' ? 'Start from an idea' : x === 'edit' ? 'Revise a file' : x === 'pdf_merge' ? 'Combine files' : 'Select pages'}</span></button>)}
           </div>
         </div>
         <div className="space-y-6 p-5 sm:p-6">
           <div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-mae-muted">2. Set output</p><div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2"><label className="text-sm text-mae-text">Format<select value={format} onChange={e => setFormat(e.target.value)} className="mt-2 w-full rounded-xl border border-mae-border bg-mae-bg px-3 py-2.5 text-sm text-mae-text outline-none focus:border-mae-accent">{['docx','pptx','xlsx','pdf'].map(x => <option key={x} value={x}>{x.toUpperCase()}</option>)}</select></label><label className="text-sm text-mae-text">Model<div className="mt-2"><ModelPicker value={model} onChange={setModel} disabled={phase !== 'idle'} /></div></label></div><input value={title} onChange={e => setTitle(e.target.value)} placeholder="Document title (optional)" className="mt-4 w-full rounded-xl border border-mae-border bg-mae-bg px-3 py-2.5 text-sm text-mae-text outline-none placeholder:text-mae-muted focus:border-mae-accent" /></div>
           {(mode === 'edit' || mode === 'pdf_split' || mode === 'pdf_merge') && <div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-mae-muted">3. Add source file{mode === 'pdf_merge' ? 's' : ''}</p><button type="button" onClick={() => fileInputRef.current?.click()} onDragOver={event => { event.preventDefault(); setDraggingFile(true); }} onDragLeave={() => setDraggingFile(false)} onDrop={event => { event.preventDefault(); setDraggingFile(false); if (mode === 'pdf_merge') setFiles(Array.from(event.dataTransfer.files)); else acceptFile(event.dataTransfer.files[0]); }} className={`mt-3 flex min-h-28 w-full flex-col items-center justify-center rounded-xl border border-dashed px-4 py-5 text-center transition-colors ${draggingFile ? 'border-mae-accent bg-mae-accent/10' : 'border-mae-border bg-mae-bg hover:border-mae-muted'}`}><span className="text-sm font-medium text-mae-text">Drop {mode === 'pdf_merge' ? 'PDF files' : 'a file'} here or <span className="text-mae-accent">browse</span></span><span className="mt-1 text-xs text-mae-muted">{mode === 'pdf_merge' ? 'Select at least two PDF files' : `Accepted: .${format}`}</span>{mode === 'pdf_merge' && files.length > 0 && <span className="mt-3 text-xs text-mae-accent">{files.length} files selected</span>}{mode !== 'pdf_merge' && file && <span className="mt-3 max-w-full truncate text-xs text-mae-accent">{file.name}</span>}</button><input ref={fileInputRef} type="file" multiple={mode === 'pdf_merge'} accept={mode === 'pdf_merge' ? '.pdf' : `.${format}`} onChange={event => mode === 'pdf_merge' ? setFiles(Array.from(event.target.files || [])) : acceptFile(event.target.files?.[0])} className="hidden" /></div>}
           {mode === 'pdf_split' && <div className="grid grid-cols-2 gap-3"><label className="text-sm text-mae-text">First page<input type="number" min="1" value={pageStart} onChange={e => setPageStart(e.target.value)} className="mt-2 w-full rounded-xl border border-mae-border bg-mae-bg px-3 py-2.5 text-sm text-mae-text" /></label><label className="text-sm text-mae-text">Last page<input type="number" min="1" value={pageEnd} onChange={e => setPageEnd(e.target.value)} className="mt-2 w-full rounded-xl border border-mae-border bg-mae-bg px-3 py-2.5 text-sm text-mae-text" /></label></div>}
           <div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-mae-muted">{mode === 'create' ? '3' : '4'}. Instructions</p><textarea value={prompt} onChange={e => setPrompt(e.target.value)} rows={6} placeholder={mode === 'edit' ? 'Describe the changes to make…' : mode === 'pdf_merge' ? 'Describe the order or changes for the merged PDF…' : 'Describe the document to create…'} className="mt-3 w-full resize-y rounded-xl border border-mae-border bg-mae-bg px-3 py-3 text-sm leading-6 text-mae-text outline-none placeholder:text-mae-muted focus:border-mae-accent" /><p className="mt-2 text-xs leading-5 text-mae-muted">Include a theme, palette, or style and Mae will use it in the generated document.</p></div>
           {phase !== 'idle' && phase !== 'done' && <div className="rounded-xl border border-mae-border bg-mae-bg px-4 py-3 text-sm text-mae-text">{phase === 'error' ? error : `${phase === 'in_progress' || phase === 'planning' ? 'Thinking' : phase}…`}</div>}
           {error && phase === 'error' && <p className="text-sm text-mae-error">{error}</p>}
           <button type="button" onClick={submit} disabled={phase !== 'idle' && phase !== 'done' && phase !== 'error' || (mode !== 'pdf_merge' && !prompt.trim()) || ((mode === 'edit' || mode === 'pdf_split') && !file) || (mode === 'pdf_merge' && files.length < 2)} className="w-full rounded-xl bg-mae-accent px-4 py-3 font-medium text-mae-accent-on transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-35">{phase === 'enqueuing' ? 'Starting…' : 'Generate document'}</button>
         </div>
       </div>
       {code && <pre className="max-h-72 overflow-auto rounded-[10px] border border-mae-border bg-black/40 p-4 text-xs leading-relaxed text-mae-muted whitespace-pre-wrap">{code}</pre>}
       {result?.artifact && <div className="flex items-center justify-between rounded-[10px] border border-mae-border bg-mae-surface px-4 py-4"><div><p className="text-sm text-mae-text">{result.artifact.display_name}</p><p className="text-xs text-mae-muted">{Math.ceil(result.artifact.size / 1024)} KB · {result.format.toUpperCase()}</p></div><a href={result.artifact.download_url} download={result.artifact.display_name} className="rounded-[8px] bg-mae-accent px-3 py-2 text-sm text-mae-accent-on">Download</a></div>}
    </>}
  </div></div>;
}

function StatusBadge({ status }: { status: string }) {
  const label = status === 'done' ? 'Done' : status === 'failed' || status === 'error' ? 'Failed' : status === 'queued' ? 'Queued' : 'In progress';
  return <span className="text-xs text-mae-muted">{label}</span>;
}
