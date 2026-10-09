import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { linkProps } from '../lib/router';
import { formatMoney } from '../lib/money';
import { Avatar, ErrorText, NetSummary, Spinner, TopBar } from '../components/ui.jsx';

export default function GroupsScreen({ user }) {
  const [groups, setGroups] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('groups')
      .then((d) => setGroups(d.groups))
      .catch((e) => setError(e.message));
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
        {!groups && !error && <Spinner />}
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
