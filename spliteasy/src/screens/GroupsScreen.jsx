import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { linkProps } from '../lib/router';
import { formatMoney } from '../lib/money';
import { Avatar, ErrorText, NetSummary, Spinner, SyncNote, TopBar } from '../components/ui.jsx';
import { cacheGet, cacheSet } from '../lib/offlineCache';
import { InstallBanner } from '../components/AppBars.jsx';

export default function GroupsScreen({ user }) {
  const [groups, setGroups] = useState(null);
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(false);
  const [syncedAt, setSyncedAt] = useState(null);

  useEffect(() => {
    let fresh = false;
    // Saved copy first (instant, works offline), then the server's answer replaces it.
    cacheGet('groups').then((c) => {
      if (c && !fresh) {
        setGroups(c.value);
        setSyncedAt(c.savedAt);
      }
    });
    const load = () =>
      api('groups')
        .then((d) => {
          fresh = true;
          setGroups(d.groups);
          setSyncedAt(Date.now());
          setOffline(false);
          setError('');
          cacheSet('groups', d.groups);
        })
        .catch((e) => (e.status === 0 ? setOffline(true) : setError(e.message)));
    load();
    window.addEventListener('online', load);
    return () => window.removeEventListener('online', load);
  }, []);

  // Totals across every group, per currency.
  const totals = {};
  for (const g of groups ?? []) {
    for (const [cur, v] of Object.entries(g.net)) totals[cur] = (totals[cur] ?? 0) + v;
  }
  const owed = Object.entries(totals).filter(([, v]) => v > 0);
  const owe = Object.entries(totals).filter(([, v]) => v < 0);

  return (
    <>
      <TopBar
        right={
          <a className="avatar-link" aria-label="Your account" {...linkProps('/account')}>
            <Avatar name={user.name} size={34} />
          </a>
        }
      />
      <main className="wrap page">
        <h1 className="page-title">Hi {user.name.split(' ')[0]}</h1>
        <InstallBanner />
        <SyncNote offline={offline} syncedAt={syncedAt} />

        {groups && (
          <section className="summary-cards">
            <div className="summary-card">
              <span className="muted">You get back</span>
              {owed.length ? (
                owed.map(([cur, v]) => (
                  <strong key={cur} className="pos">
                    {formatMoney(v, cur)}
                  </strong>
                ))
              ) : (
                <strong className="zero">—</strong>
              )}
            </div>
            <div className="summary-card">
              <span className="muted">You owe</span>
              {owe.length ? (
                owe.map(([cur, v]) => (
                  <strong key={cur} className="neg">
                    {formatMoney(-v, cur)}
                  </strong>
                ))
              ) : (
                <strong className="zero">—</strong>
              )}
            </div>
          </section>
        )}

        <div className="section-head">
          <h2>Your groups</h2>
          <a className="btn primary small" {...linkProps('/new')}>
            + New group
          </a>
        </div>

        <ErrorText error={error} />
        {!groups && !error && !offline && <Spinner />}
        {!groups && offline && <p className="muted">You're offline and nothing is saved on this device yet.</p>}
        {groups && !groups.length && (
          <div className="empty">
            <span className="empty-emoji" aria-hidden>
              🧳
            </span>
            <p>
              <strong>No groups yet.</strong>
              <br />
              Create one for a trip, a flat or a night out, then add everyone who's sharing costs.
            </p>
            <a className="btn primary" {...linkProps('/new')}>
              Create your first group
            </a>
          </div>
        )}
        {groups && groups.length > 0 && (
          <ul className="list">
            {groups.map((g) => (
              <li key={g.id}>
                <a className="list-row" {...linkProps(`/g/${g.id}`)}>
                  <span className="group-emoji" aria-hidden>
                    {g.emoji}
                  </span>
                  <span className="row-main">
                    <span className="row-title">{g.name}</span>
                    <span className="row-sub">
                      {g.members} {g.members === 1 ? 'person' : 'people'}
                    </span>
                  </span>
                  <span className="row-end">
                    <NetSummary net={g.net} empty="settled up" />
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
