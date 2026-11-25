import { useState } from 'react';
import { MaeLogo } from '../../components/common/MaeLogo';

export function AuthPanel({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [signup, setSignup] = useState(false);
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await fetch(`/api/auth/${signup ? 'signup' : 'signin'}`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(form) });
      if (!res.ok) { setError(await res.text()); return; }
      onAuthenticated();
    } catch {
      setError('Unable to connect. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };
  const updateField = (field: keyof typeof form, value: string) => setForm(previous => ({ ...previous, [field]: value }));

  return <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pb-8 pt-16 sm:justify-center sm:px-8 sm:pt-8">
    <div className="mb-5 flex items-center gap-2 font-display text-xl font-semibold"><MaeLogo size={28} />Mae</div>
    <form onSubmit={submit} className="rounded-xl border border-mae-border bg-mae-surface p-5 sm:p-6">
      <h1 className="workspace-heading mb-5">{signup ? 'Create an account' : 'Sign in'}</h1>

        {signup && <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="auth-field">First name<input required autoComplete="given-name" value={form.first_name} onChange={e=>updateField('first_name', e.target.value)} /></label>
          <label className="auth-field">Last name<input required autoComplete="family-name" value={form.last_name} onChange={e=>updateField('last_name', e.target.value)} /></label>
        </div>}
        <label className="auth-field mb-4">Email address<input required type="email" autoComplete="email" placeholder="you@example.com" value={form.email} onChange={e=>updateField('email', e.target.value)} /></label>
        <label className="auth-field mb-5">Password<input required minLength={8} type="password" autoComplete={signup ? 'new-password' : 'current-password'} placeholder="At least 8 characters" value={form.password} onChange={e=>updateField('password', e.target.value)} /></label>
        {error && <p role="alert" className="mb-4 rounded-lg border border-mae-error/40 bg-mae-error-bg px-3 py-2 text-sm leading-5 text-mae-error">{error}</p>}
        <button disabled={submitting} className="w-full rounded-lg hover:brightness-105 bg-mae-accent px-4 py-3 font-semibold text-mae-accent-on disabled:cursor-not-allowed disabled:opacity-50">{submitting ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}</button>
        <div className="mt-6 flex items-center justify-center gap-2 text-sm">
          <span className="text-mae-muted">{signup ? 'Already have an account?' : 'New to Mae?'}</span>
          <button type="button" onClick={()=>{ setSignup(!signup); setError(''); }} className="font-medium text-mae-accent underline decoration-mae-accent/40 underline-offset-4 hover:text-mae-text">{signup ? 'Sign in' : 'Create an account'}</button>
        </div>
    </form>
  </main>;
}
