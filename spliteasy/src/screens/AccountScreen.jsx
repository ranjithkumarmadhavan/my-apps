import { useState } from 'react';
import { auth } from '../lib/api';
import { navigate } from '../lib/router';
import { Avatar, ErrorText, TopBar, useToast } from '../components/ui.jsx';
import CurrencySelect from '../components/CurrencySelect.jsx';

export default function AccountScreen({ user, onUser }) {
  const toast = useToast();
  const [form, setForm] = useState({ name: user.name, upi: user.upi, currency: user.currency });
  const [pw, setPw] = useState({ current: '', password: '' });
  const [error, setError] = useState('');
  const [pwError, setPwError] = useState('');
  const [busy, setBusy] = useState(false);

  async function saveProfile(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const d = await auth('profile', form);
      onUser(d.user);
      toast('Profile saved');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function savePassword(e) {
    e.preventDefault();
    setPwError('');
    try {
      await auth('password', pw);
      setPw({ current: '', password: '' });
      onUser({ ...user, hasPassword: true });
      toast('Password updated');
    } catch (err) {
      setPwError(err.message);
    }
  }

  async function signOut() {
    await auth('logout').catch(() => {});
    onUser(null);
    navigate('/', { replace: true });
  }

  return (
    <>
      <TopBar back="/" title="Your account" />
      <main className="wrap page narrow">
        <div className="account-head">
          <Avatar name={user.name} size={56} />
          <div>
            <strong>{user.name}</strong>
            <p className="muted small">
              {user.email}
              {user.google && ' · Google'}
            </p>
          </div>
        </div>

        <form className="stack card-section" onSubmit={saveProfile}>
          <h2 className="h2">Profile</h2>
          <label className="field">
            <span>Name</span>
            <input required maxLength={60} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="field">
            <span>UPI ID</span>
            <input
              inputMode="email"
              autoCapitalize="none"
              placeholder="yourname@okaxis"
              value={form.upi}
              onChange={(e) => setForm({ ...form, upi: e.target.value })}
            />
            <small className="muted">Friends see a GPay / PhonePe / CRED button to pay you when settling up.</small>
          </label>
          <label className="field">
            <span>Default currency for new groups</span>
            <CurrencySelect value={form.currency} onChange={(currency) => setForm({ ...form, currency })} />
          </label>
          <ErrorText error={error} />
          <button className="btn primary" disabled={busy}>
            Save profile
          </button>
        </form>

        <form className="stack card-section" onSubmit={savePassword}>
          <h2 className="h2">{user.hasPassword ? 'Change password' : 'Set a password'}</h2>
          {!user.hasPassword && <p className="muted small">You sign in with Google. Set a password to also sign in with your email.</p>}
          {user.hasPassword && (
            <label className="field">
              <span>Current password</span>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={pw.current}
                onChange={(e) => setPw({ ...pw, current: e.target.value })}
              />
            </label>
          )}
          <label className="field">
            <span>New password</span>
            <input
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={pw.password}
              onChange={(e) => setPw({ ...pw, password: e.target.value })}
            />
          </label>
          <ErrorText error={pwError} />
          <button className="btn">{user.hasPassword ? 'Change password' : 'Set password'}</button>
        </form>

        <button className="btn danger full" onClick={signOut}>
          Sign out
        </button>
      </main>
    </>
  );
}
