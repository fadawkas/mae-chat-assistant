import { useEffect, useState } from 'react';
import type { AutomationSchedule } from '../../types';
import { createAutomationSchedule, deleteAutomationSchedule, listAutomationSchedules, runAutomationSchedule } from '../../api/automation';
import { ModelPicker } from '../../components/common/ModelPicker';

type TaskType = 'research' | 'council' | 'document';
type FormState = { name: string; task_type: TaskType; cron_expression: string; timezone: string; query: string; model: string; format: string; enabled: boolean };
const defaults: FormState = { name: '', task_type: 'research', cron_expression: '0 2 * * *', timezone: 'UTC', query: '', model: '', format: 'docx', enabled: true };

export function AutomationPanel({ onJobStarted }: { onJobStarted: () => void }) {
  const [schedules, setSchedules] = useState<AutomationSchedule[]>([]);
  const [form, setForm] = useState(defaults);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => listAutomationSchedules().then(setSchedules).catch(() => setError('Could not load schedules.'));
  useEffect(() => { load(); }, []);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const payload = form.task_type === 'research' ? { query: form.query, model: form.model || null } : form.task_type === 'council' ? { prompt: form.query, models: null, judge_model: form.model || null } : { format: form.format, mode: 'create', prompt: form.query, title: form.name, model: form.model || null };
      await createAutomationSchedule({ name: form.name, description: null, task_type: form.task_type, cron_expression: form.cron_expression, timezone: form.timezone, enabled: form.enabled, payload });
      setForm(defaults); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not create schedule.'); } finally { setSaving(false); }
  };

  return <section className="flex-1 overflow-y-auto px-6 py-8 sm:px-10">
    <div className="mx-auto max-w-4xl">
      <div className="mb-8"><p className="text-xs uppercase tracking-[0.18em] text-mae-accent">Background work</p><h2 className="mt-2 text-3xl font-semibold text-mae-text">Automation</h2><p className="mt-2 max-w-xl text-sm text-mae-muted">Run research, council reviews, and document generation on a schedule, even when Mae is closed.</p></div>
      <form onSubmit={submit} className="mb-8 rounded-xl border border-mae-border bg-mae-surface p-5">
        <h3 className="mb-4 font-semibold text-mae-text">Create schedule</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <input required value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="Schedule name" className="glass-input rounded-lg border border-mae-border px-3 py-2 text-sm text-mae-text" />
          <select value={form.task_type} onChange={e => setForm({...form, task_type: e.target.value as typeof form.task_type})} className="glass-input rounded-lg border border-mae-border px-3 py-2 text-sm text-mae-text"><option value="research">Research</option><option value="council">Council</option><option value="document">Document</option></select>
          {form.task_type === 'document' && <select value={form.format} onChange={e => setForm({...form, format: e.target.value})} className="glass-input rounded-lg border border-mae-border px-3 py-2 text-sm text-mae-text"><option value="docx">DOCX</option><option value="pptx">PPTX</option><option value="xlsx">XLSX</option><option value="pdf">PDF</option></select>}
          <input required value={form.cron_expression} onChange={e => setForm({...form, cron_expression: e.target.value})} placeholder="Cron, e.g. 0 2 * * *" className="glass-input rounded-lg border border-mae-border px-3 py-2 text-sm text-mae-text" />
          <input value={form.timezone} onChange={e => setForm({...form, timezone: e.target.value})} placeholder="Timezone, e.g. UTC" className="glass-input rounded-lg border border-mae-border px-3 py-2 text-sm text-mae-text" />
        </div>
        <textarea required value={form.query} onChange={e => setForm({...form, query: e.target.value})} placeholder={form.task_type === 'research' ? 'What should Mae research?' : form.task_type === 'council' ? 'What should the council review?' : 'What document should Mae create?'} className="mt-3 min-h-24 w-full glass-input rounded-lg border border-mae-border px-3 py-2 text-sm text-mae-text" />
         <div className="mt-3 flex items-end gap-3"><div className="min-w-0 flex-1"><label className="mb-1 block text-xs text-mae-muted">Model override (optional)</label><ModelPicker value={form.model} onChange={model => setForm({...form, model})} optional disabled={saving} placeholder="Use default model" /></div><button disabled={saving} className="rounded-lg bg-mae-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{saving ? 'Saving…' : 'Add schedule'}</button></div>
        {error && <p className="mt-3 text-sm text-mae-error">{error}</p>}
      </form>
      <div className="space-y-3">{schedules.length === 0 ? <p className="rounded-xl border border-dashed border-mae-border p-8 text-center text-sm text-mae-muted">No schedules yet.</p> : schedules.map(schedule => <div key={schedule.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-mae-border bg-mae-surface p-4"><div><div className="flex items-center gap-2"><h3 className="font-medium text-mae-text">{schedule.name}</h3><span className={`h-2 w-2 rounded-full ${schedule.enabled ? 'bg-mae-accent' : 'bg-mae-muted'}`} /></div><p className="mt-1 text-xs text-mae-muted">{schedule.task_type} · {schedule.cron_expression} · {schedule.timezone}</p>{schedule.last_run_at && <p className="mt-1 text-xs text-mae-muted">Last run {new Date(schedule.last_run_at).toLocaleString()}</p>}</div><div className="flex gap-2"><button onClick={() => runAutomationSchedule(schedule.id).then(onJobStarted).catch(() => setError('Could not run schedule.'))} className="rounded-lg border border-mae-border px-3 py-1.5 text-xs text-mae-text hover:bg-mae-bubble-assistant">Run now</button><button onClick={() => deleteAutomationSchedule(schedule.id).then(load).catch(() => setError('Could not delete schedule.'))} className="rounded-lg px-3 py-1.5 text-xs text-mae-muted hover:bg-mae-error-bg hover:text-mae-error">Delete</button></div></div>)}</div>
    </div>
  </section>;
}
