import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { fullUrl, linkProps, navigate } from '../lib/router';
import { balances, combine, formatMoney, settlePlan } from '../lib/money';
import { people, useGroup } from '../lib/useGroup';
import { groupCsv, downloadCsv } from '../lib/csv';
import {
  Avatar,
  ErrorText,
  Money,
  Segmented,
  Sheet,
  Spinner,
  TopBar,
  categoryEmoji,
  formatDate,
  useToast,
} from '../components/ui.jsx';
import CurrencySelect from '../components/CurrencySelect.jsx';
import { GROUP_EMOJIS } from './NewGroupScreen.jsx';

const TABS = [
  { value: 'expenses', label: 'Expenses' },
  { value: 'balances', label: 'Balances' },
  { value: 'people', label: 'People' },
  { value: 'activity', label: 'Activity' },
];

export default function GroupScreen({ id, tab }) {
  const { state, error, reload } = useGroup(id);
  const [settings, setSettings] = useState(false);

  if (!state) {
    return (
      <>
        <TopBar back="/" />
        <main className="wrap page">{error ? <ErrorText error={error} /> : <Spinner />}</main>
      </>
    );
  }

  const { group } = state;
  const myNet = {};
  for (const [cur, net] of Object.entries(balances(state.expenses, state.payments))) {
    if (net[state.meId]) myNet[cur] = net[state.meId];
  }

  return (
    <>
      <TopBar
        back="/"
        title={`${group.emoji} ${group.name}`}
        right={
          <button className="icon-btn" aria-label="Group settings" onClick={() => setSettings(true)}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
              <circle cx="5" cy="12" r="2" fill="currentColor" />
              <circle cx="12" cy="12" r="2" fill="currentColor" />
              <circle cx="19" cy="12" r="2" fill="currentColor" />
            </svg>
          </button>
        }
      />
      <main className="wrap page has-fab">
        <section className="group-hero">
          <div className="my-balance">
            {Object.keys(myNet).length ? (
              [1, -1].map((sign) => {
                const list = Object.entries(myNet).filter(([, v]) => Math.sign(v) === sign);
                if (!list.length) return null;
                return (
                  <p key={sign} className={sign > 0 ? 'pos' : 'neg'}>
                    {sign > 0 ? 'You get back ' : 'You owe '}
                    {list.map(([cur, v], i) => (
                      <span key={cur}>
                        {i > 0 && ' + '}
                        <strong>{formatMoney(Math.abs(v), cur)}</strong>
                      </span>
                    ))}
                  </p>
                );
              })
            ) : (
              <p className="zero">You're all settled up</p>
            )}
          </div>
          {Object.keys(myNet).length > 0 && (
            <a className="btn small" {...linkProps(`/g/${id}?tab=balances`)}>
              Settle up
            </a>
          )}
        </section>

        <div className="tabs-wrap">
          <Segmented label="Group sections" value={tab} options={TABS} onChange={(t) => navigate(`/g/${id}?tab=${t}`, { replace: true })} />
        </div>

        {tab === 'expenses' && <ExpensesTab state={state} reload={reload} />}
        {tab === 'balances' && <BalancesTab state={state} />}
        {tab === 'people' && <PeopleTab state={state} reload={reload} />}
        {tab === 'activity' && <ActivityTab state={state} />}
      </main>

      <a className="fab" {...linkProps(`/g/${id}/expense/new`)}>
        <span aria-hidden>+</span> Add expense
      </a>

      {settings && <SettingsSheet state={state} reload={reload} onClose={() => setSettings(false)} />}
    </>
  );
}

// ---------- expenses ----------

function ExpensesTab({ state, reload }) {
  const { name, obj } = people(state);
  const me = state.meId;
  const feed = useMemo(() => {
    const items = [
      ...state.expenses.map((e) => ({ kind: 'e', date: e.date, at: e.createdAt, e })),
      ...state.payments.map((p) => ({ kind: 'p', date: p.date, at: p.createdAt, p })),
    ];
    items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.at - a.at));
    const months = [];
    for (const it of items) {
      const key = it.date.slice(0, 7);
      if (months.at(-1)?.key !== key) months.push({ key, items: [] });
      months.at(-1).items.push(it);
    }
    return months;
  }, [state.expenses, state.payments]);

  if (!feed.length) {
    return (
      <div className="empty">
        <span className="empty-emoji" aria-hidden>
          🧾
        </span>
        <p>
          <strong>No expenses yet.</strong>
          <br />
          Tap “Add expense” to log the first one.
        </p>
      </div>
    );
  }

  return feed.map((month) => (
    <section key={month.key} className="month">
      <h3 className="month-head">{formatDate(`${month.key}-01`, { month: 'long', year: 'numeric' })}</h3>
      <ul className="list">
        {month.items.map((it) =>
          it.kind === 'e' ? (
            <li key={`e${it.e.id}`}>
              <ExpenseRow e={it.e} me={me} name={name} groupId={state.group.id} />
            </li>
          ) : (
            <li key={`p${it.p.id}`}>
              <PaymentRow p={it.p} name={name} obj={obj} groupId={state.group.id} reload={reload} />
            </li>
          ),
        )}
      </ul>
    </section>
  ));
}

function DateBox({ iso }) {
  return (
    <span className="date-box" aria-hidden>
      <span>{formatDate(iso, { month: 'short' })}</span>
      <strong>{Number(iso.slice(8))}</strong>
    </span>
  );
}

function ExpenseRow({ e, me, name, groupId }) {
  const paid = e.payers.find((p) => p.m === me)?.a ?? 0;
  const share = e.shares.find((s) => s.m === me)?.a ?? 0;
  const effect = paid - share;
  const payers =
    e.payers.length === 1
      ? `${name(e.payers[0].m)} paid ${formatMoney(e.amount, e.currency)}`
      : `${e.payers.length} people paid ${formatMoney(e.amount, e.currency)}`;
  return (
    <a className="list-row" {...linkProps(`/g/${groupId}/expense/${e.id}`)}>
      <DateBox iso={e.date} />
      <span className="cat-icon" aria-hidden>
        {categoryEmoji(e.category)}
      </span>
      <span className="row-main">
        <span className="row-title">{e.desc}</span>
        <span className="row-sub">{payers}</span>
      </span>
      <span className="row-end">
        {effect === 0 ? (
          <span className="muted small">{paid || share ? 'settled' : 'not involved'}</span>
        ) : (
          <>
            <span className={`small ${effect > 0 ? 'pos' : 'neg'}`}>{effect > 0 ? 'you lent' : 'you borrowed'}</span>
            <Money amount={Math.abs(effect)} currency={e.currency} tone={effect > 0 ? 'pos' : 'neg'} />
          </>
        )}
      </span>
    </a>
  );
}

function PaymentRow({ p, name, obj, groupId, reload }) {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  async function remove() {
    try {
      await api('delete_payment', { groupId, id: p.id });
      toast('Payment deleted');
      reload();
      setOpen(false);
    } catch (e) {
      toast(e.message, 'err');
    }
  }
  return (
    <>
      <button className="list-row payment-row" onClick={() => setOpen(true)}>
        <DateBox iso={p.date} />
        <span className="cat-icon" aria-hidden>
          💸
        </span>
        <span className="row-main">
          <span className="row-title">
            {name(p.from)} paid {obj(p.to)}
          </span>
          {p.note && <span className="row-sub">{p.note}</span>}
        </span>
        <span className="row-end">
          <Money amount={p.amount} currency={p.currency} tone="zero" />
        </span>
      </button>
      {open && (
        <Sheet
          title="Payment"
          onClose={() => setOpen(false)}
          footer={
            <button className="btn danger" onClick={remove}>
              Delete payment
            </button>
          }
        >
          <p>
            {name(p.from)} paid {obj(p.to)} <strong>{formatMoney(p.amount, p.currency)}</strong> on {formatDate(p.date, { dateStyle: 'medium' })}.
          </p>
          {p.note && <p className="muted">{p.note}</p>}
          <p className="muted small">Recorded by {name(p.createdBy)}.</p>
        </Sheet>
      )}
    </>
  );
}

// ---------- balances ----------

function BalancesTab({ state }) {
  const { name, obj, byId } = people(state);
  const { group } = state;
  const byCur = balances(state.expenses, state.payments);
  const used = Object.keys(byCur).filter((c) => Object.values(byCur[c]).some(Boolean));
  const combined = used.length > 1 || (used.length === 1 && used[0] !== group.currency) ? combine(byCur, group.currency, group.rates) : null;
  const options = [...used.map((c) => ({ value: c, label: c }))];
  if (used.length > 1) options.unshift({ value: 'all', label: `All in ${group.currency}` });
  const [view, setView] = useState(options[0]?.value);
  const current = options.some((o) => o.value === view) ? view : options[0]?.value;

  if (!used.length) {
    return (
      <div className="empty">
        <span className="empty-emoji" aria-hidden>
          🤝
        </span>
        <p>
          <strong>Everyone is settled up.</strong>
        </p>
      </div>
    );
  }

  const cur = current === 'all' ? group.currency : current;
  const net = current === 'all' ? combined : byCur[current];
  const plan = net ? settlePlan(net) : [];
  const rows = state.members.filter((m) => net?.[m.id] || !m.removed).sort((a, b) => (net?.[b.id] ?? 0) - (net?.[a.id] ?? 0));

  return (
    <>
      {options.length > 1 && (
        <div className="cur-switch">
          <Segmented label="Currency" value={current} options={options} onChange={setView} />
        </div>
      )}
      {current === 'all' && !combined && (
        <p className="note">
          To combine currencies, set exchange rates in group settings (⋯ at the top). Until then, settle each currency separately.
        </p>
      )}

      {net && (
        <>
          {current === 'all' && (
            <p className="note">
              Converted with your group's rates:{' '}
              {Object.entries(group.rates)
                .filter(([c]) => used.includes(c))
                .map(([c, r]) => `1 ${c} = ${r} ${group.currency}`)
                .join(', ')}
            </p>
          )}
          <h3 className="sub-head">Suggested payments</h3>
          {plan.length ? (
            <ul className="list">
              {plan.map((t) => (
                <li key={`${t.from}-${t.to}`} className="list-row plan-row">
                  <Avatar name={byId.get(t.from)?.name ?? '?'} size={32} />
                  <span className="row-main">
                    <span className="row-title">
                      {name(t.from)} {byId.get(t.from)?.isMe ? 'pay' : 'pays'} {obj(t.to)}
                    </span>
                    <Money amount={t.amount} currency={cur} tone="plain" />
                  </span>
                  <a
                    className="btn small primary"
                    {...linkProps(`/g/${group.id}/pay?from=${t.from}&to=${t.to}&amount=${t.amount}&currency=${cur}`)}
                  >
                    Settle
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Nothing to settle in {cur}.</p>
          )}

          <h3 className="sub-head">Balances</h3>
          <ul className="list">
            {rows.map((m) => {
              const v = net[m.id] ?? 0;
              return (
                <li key={m.id} className="list-row">
                  <Avatar name={m.name} size={32} />
                  <span className="row-main">
                    <span className="row-title">{m.isMe ? `${m.name} (you)` : m.name}</span>
                    <span className={`row-sub ${v > 0 ? 'pos' : v < 0 ? 'neg' : ''}`}>
                      {v > 0 ? 'gets back' : v < 0 ? 'owes' : 'settled up'}
                    </span>
                  </span>
                  <span className="row-end">
                    <Money amount={v} currency={cur} signed />
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </>
  );
}

// ---------- people ----------

function PeopleTab({ state, reload }) {
  const toast = useToast();
  const { group } = state;
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const link = fullUrl(`/join/${group.inviteToken}`);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      toast('Invite link copied');
    } catch {
      window.prompt('Copy this invite link', link);
    }
  }
  async function share() {
    try {
      await navigator.share({ title: `Join ${group.name} on SplitEasy`, url: link });
    } catch {
      // user cancelled
    }
  }

  const members = state.members.filter((m) => !m.removed);
  return (
    <>
      <section className="invite-card">
        <h3>Invite people</h3>
        <p className="muted small">
          Anyone with this link can sign in and join. If you added them by name, they can pick their name to take over its history.
        </p>
        <div className="invite-link">
          <code>{link}</code>
        </div>
        <div className="row-buttons">
          <button className="btn small" onClick={copy}>
            Copy link
          </button>
          {typeof navigator.share === 'function' && (
            <button className="btn small" onClick={share}>
              Share…
            </button>
          )}
          <a
            className="btn small"
            target="_blank"
            rel="noreferrer"
            href={`https://wa.me/?text=${encodeURIComponent(`Join "${group.name}" on SplitEasy to track our shared expenses: ${link}`)}`}
          >
            WhatsApp
          </a>
        </div>
      </section>

      <div className="section-head">
        <h3 className="sub-head">{members.length} people</h3>
        <button className="btn small primary" onClick={() => setAdding(true)}>
          + Add person
        </button>
      </div>
      <ul className="list">
        {members.map((m) => (
          <li key={m.id}>
            <button className="list-row" onClick={() => setEditing(m)}>
              <Avatar name={m.name} size={36} />
              <span className="row-main">
                <span className="row-title">
                  {m.name}
                  {m.isMe && ' (you)'}
                </span>
                <span className="row-sub">
                  {m.linked ? 'Has an account' : 'Added by name'}
                  {m.upi ? ` · UPI ${m.upi}` : ''}
                </span>
              </span>
              <span className="chev" aria-hidden>
                ›
              </span>
            </button>
          </li>
        ))}
      </ul>

      {adding && <MemberSheet groupId={group.id} onClose={() => setAdding(false)} onDone={reload} />}
      {editing && <MemberSheet groupId={group.id} member={editing} isOwner={group.isOwner} onClose={() => setEditing(null)} onDone={reload} />}
    </>
  );
}

function MemberSheet({ groupId, member, onClose, onDone }) {
  const toast = useToast();
  const [name, setName] = useState(member?.name ?? '');
  const [upi, setUpi] = useState(member?.upi ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const readOnly = member?.linked;

  async function run(fn, msg) {
    setBusy(true);
    setError('');
    try {
      await fn();
      toast(msg);
      onDone();
      onClose();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  const save = (e) => {
    e.preventDefault();
    run(
      () =>
        member
          ? api('update_member', { groupId, memberId: member.id, name, upi })
          : api('add_member', { groupId, name, upi }),
      member ? 'Saved' : `${name.trim()} added`,
    );
  };
  const remove = () =>
    window.confirm(`Remove ${member.name} from this group?`) &&
    run(() => api('remove_member', { groupId, memberId: member.id }), `${member.name} removed`);

  return (
    <Sheet title={member ? member.name : 'Add a person'} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        {readOnly ? (
          <p className="muted">
            {member.isMe ? 'This is you. Change your name and UPI ID on your account page.' : `${member.name} has an account and manages their own name and UPI ID.`}
          </p>
        ) : (
          <>
            <label className="field">
              <span>Name</span>
              <input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="field">
              <span>UPI ID (optional)</span>
              <input inputMode="email" autoCapitalize="none" placeholder="name@okaxis" value={upi} onChange={(e) => setUpi(e.target.value)} />
              <small className="muted">Lets others pay them with GPay, PhonePe or CRED when settling up.</small>
            </label>
          </>
        )}
        <ErrorText error={error} />
        {!readOnly && (
          <button className="btn primary" disabled={busy}>
            {member ? 'Save' : 'Add person'}
          </button>
        )}
        {member && !member.isMe && (
          <button type="button" className="btn danger" disabled={busy} onClick={remove}>
            Remove from group
          </button>
        )}
      </form>
    </Sheet>
  );
}

// ---------- activity ----------

export function describeActivity(a, name, obj) {
  const who = name(a.by);
  const money = a.amount !== undefined ? formatMoney(a.amount, a.currency) : '';
  switch (a.type) {
    case 'group_create':
      return `${who} created the group “${a.name}”`;
    case 'group_update':
      return `${who} updated the group settings`;
    case 'invite_reset':
      return `${who} made a new invite link`;
    case 'member_add':
      return `${who} added ${a.name}`;
    case 'member_remove':
      return `${who} removed ${a.name}`;
    case 'member_join':
      return `${a.name} joined the group`;
    case 'expense_add':
      return `${who} added “${a.desc}” (${money})`;
    case 'expense_edit':
      return `${who} edited “${a.desc}” (${money})`;
    case 'expense_delete':
      return `${who} deleted “${a.desc}” (${money})`;
    case 'payment_add':
      return `${who} recorded: ${name(a.from)} paid ${obj(a.to)} ${money}`;
    case 'payment_delete':
      return `${who} deleted a payment: ${name(a.from)} → ${obj(a.to)} ${money}`;
    default:
      return `${who} made a change`;
  }
}

function ActivityTab({ state }) {
  const { name, obj } = people(state);
  return (
    <ul className="list activity">
      {state.activity.map((a) => (
        <li key={a.id} className="list-row">
          <span className="row-main">
            <span className="row-title normal">{describeActivity(a, name, obj)}</span>
            <span className="row-sub">
              {new Date(a.at * 1000).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}

// ---------- settings ----------

function SettingsSheet({ state, reload, onClose }) {
  const toast = useToast();
  const { group } = state;
  const [name, setName] = useState(group.name);
  const [emoji, setEmoji] = useState(group.emoji);
  const [currency, setCurrency] = useState(group.currency);
  const foreign = [...new Set([...state.expenses.map((e) => e.currency), ...state.payments.map((p) => p.currency), ...Object.keys(group.rates)])].filter(
    (c) => c !== currency,
  );
  const [rates, setRates] = useState({ ...group.rates });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('update_group', { id: group.id, name, emoji, currency, rates });
      toast('Group updated');
      reload();
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function resetInvite() {
    if (!window.confirm('Make a new invite link? The old link will stop working.')) return;
    try {
      await api('reset_invite', { id: group.id });
      toast('New invite link created');
      reload();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove() {
    if (window.prompt(`This deletes "${group.name}" and all its expenses for everyone. Type DELETE to confirm.`) !== 'DELETE') return;
    try {
      await api('delete_group', { id: group.id });
      toast('Group deleted');
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
    }
  }

  function exportCsv() {
    const safe = group.name.replace(/[^\w\- ]+/g, '').trim() || 'group';
    downloadCsv(`${safe} - SplitEasy.csv`, groupCsv(state));
  }

  return (
    <Sheet title="Group settings" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <label className="field">
          <span>Name</span>
          <input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <fieldset className="field">
          <legend>Icon</legend>
          <div className="emoji-grid">
            {GROUP_EMOJIS.map((e) => (
              <button type="button" key={e} className={`emoji-btn ${emoji === e ? 'on' : ''}`} aria-pressed={emoji === e} onClick={() => setEmoji(e)}>
                {e}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="field">
          <span>Main currency</span>
          <CurrencySelect value={currency} onChange={setCurrency} />
        </label>
        {foreign.length > 0 && (
          <fieldset className="field">
            <legend>Exchange rates (optional)</legend>
            <small className="muted">Set these to see everything combined in {currency} on the Balances tab.</small>
            {foreign.map((c) => (
              <label key={c} className="rate-row">
                <span>1 {c} =</span>
                <input
                  inputMode="decimal"
                  placeholder="rate"
                  value={rates[c] ?? ''}
                  onChange={(e) => setRates({ ...rates, [c]: e.target.value.trim() })}
                />
                <span>{currency}</span>
              </label>
            ))}
          </fieldset>
        )}
        <ErrorText error={error} />
        <button className="btn primary" disabled={busy}>
          Save changes
        </button>
      </form>

      <hr />
      <div className="stack">
        <button className="btn" onClick={exportCsv}>
          Export to CSV
        </button>
        <button className="btn" onClick={resetInvite}>
          Make a new invite link
        </button>
        {group.isOwner && (
          <button className="btn danger" onClick={remove}>
            Delete group
          </button>
        )}
      </div>
    </Sheet>
  );
}
