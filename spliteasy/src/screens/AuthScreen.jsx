import { useState } from 'react';
import { auth } from '../lib/api';
import { ErrorText, Segmented } from '../components/ui.jsx';
import GoogleButton from '../components/GoogleButton.jsx';

export default function AuthScreen({ onUser, joining }) {
  const [mode, setMode] = useState('signin'); // signin | signup | forgot
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'forgot') {
        await auth('forgot', { email: form.email, returnTo: import.meta.env.BASE_URL });
        setSent(true);
      } else {
        const d = await auth(mode === 'signup' ? 'signup' : 'login', form);
        onUser(d.user);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width="48" height="48" />
          <h1>SplitEasy</h1>
          <p className="muted">
            {joining ? 'Sign in to join the group you were invited to.' : 'Split trips and shared costs. Settle up in a tap.'}
          </p>
        </div>

        {mode === 'forgot' ? (
          sent ? (
            <div className="stack">
              <p>
                If an account exists for <strong>{form.email}</strong>, we've emailed a link to reset your password. It's valid
                for 1 hour.
              </p>
              <button className="btn ghost" onClick={() => (setMode('signin'), setSent(false))}>
                Back to sign in
              </button>
            </div>
          ) : (
            <form className="stack" onSubmit={submit}>
              <h2 className="h2">Reset your password</h2>
              <label className="field">
                <span>Email</span>
                <input type="email" autoComplete="email" required value={form.email} onChange={set('email')} />
              </label>
              <ErrorText error={error} />
              <button className="btn primary" disabled={busy}>
                {busy ? 'Sending…' : 'Email me a reset link'}
              </button>
              <button type="button" className="btn ghost" onClick={() => setMode('signin')}>
                Back to sign in
              </button>
            </form>
          )
        ) : (
          <>
            <Segmented
              label="Sign in or create account"
              value={mode}
              onChange={(m) => (setMode(m), setError(''))}
              options={[
                { value: 'signin', label: 'Sign in' },
                { value: 'signup', label: 'Create account' },
              ]}
            />
            <GoogleButton onUser={onUser} onError={setError} />
            <form className="stack" onSubmit={submit}>
              {mode === 'signup' && (
                <label className="field">
                  <span>Your name</span>
                  <input autoComplete="name" required maxLength={60} value={form.name} onChange={set('name')} />
                </label>
              )}
              <label className="field">
                <span>Email</span>
                <input type="email" autoComplete="email" required value={form.email} onChange={set('email')} />
              </label>
              <label className="field">
                <span>Password</span>
                <input
                  type="password"
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  required
                  minLength={mode === 'signup' ? 8 : undefined}
                  value={form.password}
                  onChange={set('password')}
                />
                {mode === 'signup' && <small className="muted">At least 8 characters</small>}
              </label>
              <ErrorText error={error} />
              <button className="btn primary" disabled={busy}>
                {busy ? 'Please wait…' : mode === 'signup' ? 'Create account' : 'Sign in'}
              </button>
              {mode === 'signin' && (
                <button type="button" className="link-btn" onClick={() => (setMode('forgot'), setError(''))}>
                  Forgot password?
                </button>
              )}
            </form>
          </>
        )}
        <p className="muted small center">
          <a href={import.meta.env.DEV ? 'http://localhost:5173/privacy.html' : '/privacy.html'}>Privacy policy</a>
        </p>
      </div>
    </div>
  );
}
