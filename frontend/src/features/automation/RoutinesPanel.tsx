import { useEffect, useState, type FormEvent } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { createAutomationSchedule, deleteAutomationSchedule, listAutomationSchedules, runAutomationSchedule } from '../../api/automation';
import { fetchJobStatus } from '../../api/jobs';
import { markdownComponents } from '../../components/common/CodeBlock';
import type { AutomationSchedule, JobStatus } from '../../types';

const defaults = { name: '', cron: '0 9 * * 1', timezone: 'UTC', prompt: '', enabled: false };
const field = 'bg-mae-surface w-full rounded-lg border border-mae-border px-3 py-2 text-sm text-mae-text';
const secondary = 'rounded-lg border border-mae-border px-3 py-2 text-sm text-mae-text hover:bg-mae-bubble-assistant disabled:opacity-50';

export function RoutinesPanel() {
  const [schedules, setSchedules] = useState<AutomationSchedule[] | null>(null);
  const [version, setVersion] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(defaults);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [run, setRun] = useState<JobStatus | null>(null);
  const [runError, setRunError] = useState(false);

  useEffect(() => {
    let active = true;
    listAutomationSchedules().then(items => { if (active) setSchedules(items); })
      .catch(() => { if (active) setError('Could not load routines.'); });
    return () => { active = false; };
  }, [version]);

  useEffect(() => {
    if (!runId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const job = await fetchJobStatus(runId);
        if (!active) return;
        setRun(job);
        setRunError(false);
        if (job.status === 'queued' || job.status === 'in_progress') timer = setTimeout(poll, 2000);
      } catch {
        if (active) setRunError(true);
      }
    };
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [runId]);

  function showRun(id: string) {
    if (runId === id) return;
    setRun(null);
    setRunError(false);
    setRunId(id);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await createAutomationSchedule({
        name: form.name.trim(), description: null, task_type: 'agent', cron_expression: form.cron,
        timezone: form.timezone, enabled: form.enabled, payload: { prompt: form.prompt.trim() },
      });
      setForm(defaults);
      setFormOpen(false);
      setVersion(n => n + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the routine.');
    } finally {
      setSaving(false);
    }
  }

  async function act(schedule: AutomationSchedule, action: 'run' | 'delete') {
    setPendingId(schedule.id);
    setError('');
    try {
      if (action === 'run') {
        const { job_id } = await runAutomationSchedule(schedule.id);
        showRun(job_id);
      } else {
        await deleteAutomationSchedule(schedule.id);
      }
    } catch {
      setError(action === 'run' ? 'Could not queue the routine.' : 'Could not delete the routine.');
    } finally {
      setVersion(n => n + 1);
      setPendingId(null);
    }
  }

  const content = run?.result?.content ?? run?.result?.report ?? run?.result?.verdict;
  const running = !!runId && !runError && (!run || run.status === 'queued' || run.status === 'in_progress');

  return (
    <section className="workspace-page" aria-labelledby="routines-heading">
      <div className="workspace-content">
        <header className="mb-5 flex flex-wrap items-center justify-between gap-2">
          <h1 id="routines-heading" className="workspace-heading">Routines</h1>
          <button type="button" aria-expanded={formOpen} onClick={() => setFormOpen(open => !open)} className={formOpen ? `min-h-10 ${secondary}` : 'min-h-10 rounded-lg bg-mae-accent px-3 text-sm font-semibold text-mae-accent-on'}>
            {formOpen ? 'Close form' : 'New routine'}
          </button>
        </header>
        {error && <p role="alert" className="mb-4 text-sm text-mae-error">{error}</p>}
        {formOpen && <form onSubmit={submit} className="mb-5 max-w-2xl space-y-3 rounded-xl border border-mae-border p-4">
          <h2 className="font-semibold text-mae-text">Create a routine</h2>
          <label className="block text-sm text-mae-muted">Name
            <input required maxLength={120} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Weekly status report" className={`mt-1 ${field}`} />
          </label>
          <label className="block text-sm text-mae-muted">Prompt
            <textarea required maxLength={20_000} value={form.prompt} onChange={e => setForm({ ...form, prompt: e.target.value })} placeholder="What should Mae do each time?" className={`mt-1 min-h-24 ${field}`} />
          </label>
          <label className="flex items-center gap-2 text-sm text-mae-text">
            <input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} /> Run on a schedule
          </label>
          {form.enabled && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm text-mae-muted">Cron expression
                <input required value={form.cron} onChange={e => setForm({ ...form, cron: e.target.value })} className={`mt-1 ${field}`} />
              </label>
              <label className="text-sm text-mae-muted">Timezone
                <input required value={form.timezone} onChange={e => setForm({ ...form, timezone: e.target.value })} className={`mt-1 ${field}`} />
              </label>
            </div>
          )}
          <div className="flex justify-end">
            <button disabled={saving || !form.name.trim() || !form.prompt.trim()} className="rounded-lg bg-mae-accent px-4 py-2 text-sm font-medium text-mae-accent-on disabled:opacity-50">
              {saving ? 'Saving…' : 'Save routine'}
            </button>
          </div>
        </form>}
        {schedules === null && !error && <p role="status" className="text-sm text-mae-muted">Loading routines…</p>}
        {schedules?.length === 0 && <p className="border-y border-mae-border py-4 text-sm text-mae-muted">No routines yet. Save a prompt to run on demand or on a schedule.</p>}
        <ul className={schedules?.length ? "divide-y divide-mae-border border-y border-mae-border" : undefined}>
          {schedules?.map(schedule => (
            <li key={schedule.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <h3 className="break-words font-medium text-mae-text">{schedule.name}</h3>
                <p className="mt-1 text-xs text-mae-muted">
                  {schedule.task_type !== 'agent' && `Legacy ${schedule.task_type} · `}
                  {schedule.enabled ? `${schedule.cron_expression} · ${schedule.timezone}` : 'On demand'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button disabled={pendingId !== null || (running && runId === schedule.last_job_id)} onClick={() => act(schedule, 'run')} className={secondary}>Run now</button>
                {schedule.last_job_id && <button onClick={() => showRun(schedule.last_job_id!)} className={secondary}>View last run</button>}
                <button disabled={pendingId !== null} onClick={() => act(schedule, 'delete')} className="rounded-lg px-3 py-2 text-sm text-mae-muted hover:bg-mae-error-bg hover:text-mae-error">Delete</button>
              </div>
            </li>
          ))}
        </ul>
        {runId && (
          <section aria-label="Routine result" className="mt-5 border-t border-mae-border pt-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-medium text-mae-text">{run?.title || 'Routine run'}</h2>
              <button onClick={() => { setRunId(null); setRun(null); }} className={secondary}>Close result</button>
            </div>
            {runError ? <p role="alert" className="mt-2 text-sm text-mae-error">Could not load the run. Close the result and try again.</p> : (
              <p role="status" className="mt-2 text-sm text-mae-muted">
                {!run ? 'Loading run…' : { queued: 'Queued', in_progress: 'Running…', done: 'Completed', failed: 'Failed' }[run.status] ?? run.status}
              </p>
            )}
            {run?.error && <p role="alert" className="mt-2 break-words text-sm text-mae-error">{run.error}</p>}
            {typeof content === 'string' && <div className="assistant-message mt-4 min-w-0 break-words"><ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{content}</ReactMarkdown></div>}
            {run?.status === 'done' && <p className="mt-4 text-sm text-mae-muted">Any generated files are in Artifacts.</p>}
          </section>
        )}
      </div>
    </section>
  );
}
