import { useState } from 'react';
import { auth } from '../lib/api';
import { navigate } from '../lib/router';
import { Avatar, ErrorText, TopBar, useToast } from '../components/ui.jsx';
import CurrencySelect from '../components/CurrencySelect.jsx';
import { InstallSection } from '../components/AppBars.jsx';
import { cacheClear } from '../lib/offlineCache';

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
    await cacheClear();
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

        <InstallSection />

        <button className="btn danger full" onClick={signOut}>
          Sign out
        </button>

        <DeleteAccount user={user} onUser={onUser} />
      </main>
    </>
  );
}

function DeleteAccount({ user, onUser }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function remove(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await auth('delete_account', { confirm, password });
      await cacheClear();
      toast('Your account has been deleted');
      onUser(null);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <p className="center small delete-link">
        <button type="button" className="link-btn danger-text" onClick={() => setOpen(true)}>
          Delete my account
        </button>
      </p>
    );
  }

  return (
    <form className="stack card-section danger-zone" onSubmit={remove}>
      <h2 className="h2">Delete your account</h2>
      <ul className="small delete-list">
        <li>Your sign-in, email, UPI ID and settings are deleted permanently. This can't be undone.</li>
        <li>
          In your groups, your name stays as a <strong>name-only guest</strong> so everyone else's expenses and balances
          stay correct. Any money you owe or are owed is still shown to them.
        </li>
        <li>Groups you created are handed to another member with an account, or deleted if nobody else has one.</li>
      </ul>
      {user.hasPassword && (
        <label className="field">
          <span>Your password</span>
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
      )}
      <label className="field">
        <span>Type DELETE to confirm</span>
        <input autoCapitalize="characters" autoComplete="off" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </label>
      <ErrorText error={error} />
      <div className="form-actions">
        <button className="btn danger" disabled={busy || confirm !== 'DELETE'}>
          {busy ? 'Deleting…' : 'Delete account'}
        </button>
        <button type="button" className="btn ghost" onClick={() => (setOpen(false), setError(''))}>
          Cancel
        </button>
      </div>
    </form>
  );
}
