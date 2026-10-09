import { useState } from 'react';
import { api } from '../lib/api';
import { navigate } from '../lib/router';
import { Avatar, ErrorText, TopBar } from '../components/ui.jsx';
import CurrencySelect from '../components/CurrencySelect.jsx';

export const GROUP_EMOJIS = ['🏖️', '✈️', '🏔️', '🏠', '🍕', '🎉', '🚗', '⚽', '🎬', '💼', '🛒', '👥'];

export default function NewGroupScreen({ user }) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('🏖️');
  const [currency, setCurrency] = useState(user.currency || 'INR');
  const [guest, setGuest] = useState('');
  const [guests, setGuests] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function addGuest() {
    const n = guest.replace(/\s+/g, ' ').trim();
    if (n && !guests.includes(n)) setGuests([...guests, n]);
    setGuest('');
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const all = guest.trim() ? [...guests, guest.trim()] : guests;
      const d = await api('create_group', { name, emoji, currency, guests: all });
      navigate(`/g/${d.groupId}`, { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <>
      <TopBar back="/" title="New group" />
      <main className="wrap page narrow">
        <form className="stack" onSubmit={submit}>
          <label className="field">
            <span>Group name</span>
            <input required maxLength={60} placeholder="e.g. Goa trip" value={name} onChange={(e) => setName(e.target.value)} />
          </label>

          <fieldset className="field">
            <legend>Icon</legend>
            <div className="emoji-grid">
              {GROUP_EMOJIS.map((e) => (
                <button
                  type="button"
                  key={e}
                  className={`emoji-btn ${emoji === e ? 'on' : ''}`}
                  aria-pressed={emoji === e}
                  onClick={() => setEmoji(e)}
                >
                  {e}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="field">
            <span>Main currency</span>
            <CurrencySelect value={currency} onChange={setCurrency} />
            <small className="muted">You can still add expenses in other currencies.</small>
          </label>

          <div className="field">
            <span>People</span>
            <ul className="chips">
              <li className="chip">
                <Avatar name={user.name} size={22} /> {user.name} (you)
              </li>
              {guests.map((g) => (
                <li key={g} className="chip">
                  <Avatar name={g} size={22} /> {g}
                  <button type="button" className="chip-x" aria-label={`Remove ${g}`} onClick={() => setGuests(guests.filter((x) => x !== g))}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <div className="inline-add">
              <input
                placeholder="Add a name"
                maxLength={60}
                value={guest}
                onChange={(e) => setGuest(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addGuest();
                  }
                }}
              />
              <button type="button" className="btn" onClick={addGuest} disabled={!guest.trim()}>
                Add
              </button>
            </div>
            <small className="muted">
              No account needed. Add anyone by name now; later they can join with the invite link and take over their name.
            </small>
          </div>

          <ErrorText error={error} />
          <button className="btn primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create group'}
          </button>
        </form>
      </main>
    </>
  );
}
