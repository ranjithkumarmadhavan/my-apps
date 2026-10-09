import { useState } from 'react';
import { auth } from '../lib/api';
import { navigate } from '../lib/router';
import { ErrorText } from '../components/ui.jsx';

export default function ResetScreen({ token, onUser }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const d = await auth('reset', { token, password });
      onUser(d.user);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-card stack" onSubmit={submit}>
        <div className="auth-brand">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width="48" height="48" />
          <h1>Set a new password</h1>
        </div>
        <label className="field">
          <span>New password</span>
          <input
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <small className="muted">At least 8 characters</small>
        </label>
        <ErrorText error={error} />
        <button className="btn primary" disabled={busy || !token}>
          {busy ? 'Saving…' : 'Save and sign in'}
        </button>
      </form>
    </div>
  );
}
