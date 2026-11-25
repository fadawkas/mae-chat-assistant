import { useState } from 'react';
import { apiFetch, apiError } from '../../api/client';
import type { User } from '../../types';

export function AccountPanel({ user }: { user: User }) {
  const [key, setKey] = useState(''); const [message, setMessage] = useState('');
  async function save(event: React.FormEvent) { event.preventDefault(); const response = await apiFetch('/api/account/openrouter-key', { method: 'PUT', headers: {'Content-Type':'application/json'}, body: JSON.stringify({api_key:key}) }); if (!response.ok) { setMessage((await apiError(response, 'Unable to save key')).message); return; } setKey(''); setMessage('OpenRouter key saved securely.'); }
  async function remove() { const response = await apiFetch('/api/account/openrouter-key', {method:'DELETE'}); setMessage(response.ok ? 'OpenRouter key removed.' : (await apiError(response, 'Unable to remove key')).message); }
  return <section className="workspace-page"><div className="workspace-content"><h1 className="workspace-heading">Account settings</h1><p className="mt-2 text-sm text-mae-muted">{user.first_name} {user.last_name} · {user.email}</p><div className="mt-5 max-w-xl border-t border-mae-border pt-4"><h2 className="font-medium text-mae-text">OpenRouter</h2><p className="mt-2 text-sm text-mae-muted">Your key is encrypted at rest and never displayed or sent to the browser after saving.</p><form onSubmit={save} className="mt-4 flex gap-2"><input required value={key} onChange={e=>setKey(e.target.value)} type="password" aria-label="OpenRouter API key" placeholder="sk-or-v1-..." className="min-w-0 flex-1 rounded-lg border border-mae-border bg-mae-surface p-3"/><button className="rounded-lg bg-mae-accent px-4 text-sm font-semibold text-mae-accent-on">Save</button></form><button onClick={remove} className="mt-3 text-sm text-mae-error">Remove key</button>{message && <p className="mt-3 text-sm text-mae-muted">{message}</p>}</div></div></section>;
}
