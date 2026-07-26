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

  return <div className="auth-shell flex min-h-screen items-center justify-center bg-mae-bg px-5 py-8 sm:px-8">
    <div className="auth-card grid w-full max-w-4xl overflow-hidden rounded-3xl border border-mae-border bg-mae-surface shadow-2xl md:grid-cols-[0.85fr_1.15fr]">
      <div className="auth-intro flex flex-col justify-between p-7 sm:p-10">
        <div>
          <MaeLogo size={54} className="mb-8" />
          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-mae-accent">A calmer way to think</p>
          <h1 className="max-w-xs text-3xl font-semibold leading-tight tracking-tight text-mae-text sm:text-4xl">Your ideas, with a council behind them.</h1>
        </div>
        <p className="mt-10 max-w-xs text-sm leading-6 text-mae-muted">Chat, research, and bring specialized perspectives together in one focused workspace.</p>
      </div>

      <form onSubmit={submit} className="border-t border-mae-border p-7 sm:p-10 md:border-l md:border-t-0">
        <div className="mb-8">
          <p className="mb-2 text-sm font-medium text-mae-accent">{signup ? 'Create your account' : 'Welcome back'}</p>
          <h2 className="text-2xl font-semibold tracking-tight text-mae-text">{signup ? 'Start your Mae workspace' : 'Sign in to Mae'}</h2>
          <p className="mt-2 text-sm leading-6 text-mae-muted">{signup ? 'Set up your personal space for better decisions.' : 'Pick up where your thinking left off.'}</p>
        </div>

        {signup && <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="auth-field">First name<input required autoComplete="given-name" value={form.first_name} onChange={e=>updateField('first_name', e.target.value)} /></label>
          <label className="auth-field">Last name<input required autoComplete="family-name" value={form.last_name} onChange={e=>updateField('last_name', e.target.value)} /></label>
        </div>}
        <label className="auth-field mb-4">Email address<input required type="email" autoComplete="email" placeholder="you@example.com" value={form.email} onChange={e=>updateField('email', e.target.value)} /></label>
        <label className="auth-field mb-5">Password<input required minLength={8} type="password" autoComplete={signup ? 'new-password' : 'current-password'} placeholder="At least 8 characters" value={form.password} onChange={e=>updateField('password', e.target.value)} /></label>
        {error && <p role="alert" className="mb-4 rounded-lg border border-mae-error/40 bg-mae-error-bg px-3 py-2 text-sm leading-5 text-mae-error">{error}</p>}
        <button disabled={submitting} className="auth-primary w-full rounded-xl bg-mae-accent px-4 py-3 font-semibold text-mae-accent-on disabled:cursor-not-allowed disabled:opacity-50">{submitting ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}</button>
        <div className="mt-6 flex items-center justify-center gap-2 text-sm">
          <span className="text-mae-muted">{signup ? 'Already have an account?' : 'New to Mae?'}</span>
          <button type="button" onClick={()=>{ setSignup(!signup); setError(''); }} className="font-medium text-mae-accent underline decoration-mae-accent/40 underline-offset-4 hover:text-mae-text">{signup ? 'Sign in' : 'Create an account'}</button>
        </div>
      </form>
    </div>
  </div>;
}
