import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { navigate } from '../lib/router';
import { Avatar, ErrorText, Spinner, TopBar } from '../components/ui.jsx';

export default function JoinScreen({ token, user }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [claim, setClaim] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('invite_info', { token })
      .then((d) => {
        if (d.alreadyMember) navigate(`/g/${d.group.id}`, { replace: true });
        else setInfo(d);
      })
      .catch((e) => setError(e.message));
  }, [token]);

  async function join() {
    setBusy(true);
    setError('');
    try {
      const d = await api('join', { token, claimMemberId: claim || undefined });
      navigate(`/g/${d.groupId}`, { replace: true });
    } catch (e) {
      setError(e.message);
      setBusy(false);
      if (e.status === 409) api('invite_info', { token }).then(setInfo, () => {});
    }
  }

  return (
    <>
      <TopBar back="/" title="Join group" />
      <main className="wrap page narrow">
        {!info && !error && <Spinner />}
        {!info && <ErrorText error={error} />}
        {info && (
          <div className="stack">
            <div className="join-head">
              <span className="group-emoji big" aria-hidden>
                {info.group.emoji}
              </span>
              <h1 className="page-title">{info.group.name}</h1>
              <p className="muted">
                {info.group.members} {info.group.members === 1 ? 'person' : 'people'} in this group
              </p>
            </div>

            {info.guests.length > 0 && (
              <fieldset className="field box">
                <legend>Were you added by name?</legend>
                <small className="muted">Pick your name to take over its expenses and balance.</small>
                <ul className="person-list">
                  {info.guests.map((g) => (
                    <li key={g.id}>
                      <label className="check-row radio">
                        <input type="radio" name="claim" checked={claim === g.id} onChange={() => setClaim(g.id)} />
                        <Avatar name={g.name} size={28} />
                        <span className="person-name">I'm {g.name}</span>
                      </label>
                    </li>
                  ))}
                  <li>
                    <label className="check-row radio">
                      <input type="radio" name="claim" checked={claim === 0} onChange={() => setClaim(0)} />
                      <Avatar name={user.name} size={28} />
                      <span className="person-name">I'm not on this list: join as {user.name}</span>
                    </label>
                  </li>
                </ul>
              </fieldset>
            )}

            <ErrorText error={error} />
            <button className="btn primary" onClick={join} disabled={busy}>
              {busy ? 'Joining…' : 'Join group'}
            </button>
          </div>
        )}
      </main>
    </>
  );
}
