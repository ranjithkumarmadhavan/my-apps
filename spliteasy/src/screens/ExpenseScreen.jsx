import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { navigate } from '../lib/router';
import { allocate, formatMoney, toMajorString, toMinor } from '../lib/money';
import { useGroup } from '../lib/useGroup';
import { Avatar, CATEGORY_LIST, ErrorText, Segmented, Spinner, TopBar, todayISO, useToast } from '../components/ui.jsx';
import CurrencySelect from '../components/CurrencySelect.jsx';

const SPLIT_OPTIONS = [
  { value: 'equal', label: 'Equally' },
  { value: 'exact', label: 'Amounts' },
  { value: 'shares', label: 'Shares' },
  { value: 'percent', label: '%' },
];

const parseBasisPoints = (t) => {
  const s = String(t ?? '').trim();
  if (s === '') return 0;
  if (!/^\d{1,3}(\.\d{0,2})?$/.test(s)) return null;
  const [w, f = ''] = s.split('.');
  return Number(w) * 100 + Number((f + '00').slice(0, 2));
};
const parseShares = (t) => {
  const s = String(t ?? '').trim();
  if (s === '') return 0;
  return /^\d{1,4}$/.test(s) ? Number(s) : null;
};

export default function ExpenseScreen({ groupId, expenseId }) {
  const { state, error: loadError } = useGroup(groupId);
  const back = `/g/${groupId}`;

  if (!state) {
    return (
      <>
        <TopBar back={back} title={expenseId ? 'Edit expense' : 'Add expense'} />
        <main className="wrap page">{loadError ? <ErrorText error={loadError} /> : <Spinner />}</main>
      </>
    );
  }
  const existing = expenseId ? state.expenses.find((e) => e.id === expenseId) : null;
  if (expenseId && !existing) {
    return (
      <>
        <TopBar back={back} title="Expense" />
        <main className="wrap page">
          <p className="error">This expense no longer exists. Someone may have deleted it.</p>
        </main>
      </>
    );
  }
  // Keyed so the form re-initialises if the expense changes under us after a save elsewhere.
  return <ExpenseForm key={existing ? `${existing.id}` : 'new'} state={state} existing={existing} back={back} />;
}

function ExpenseForm({ state, existing, back }) {
  const toast = useToast();
  const { group, meId } = state;
  const involved = new Set(existing ? [...existing.payers.map((p) => p.m), ...existing.shares.map((s) => s.m)] : []);
  const members = state.members.filter((m) => !m.removed || involved.has(m.id));

  const [desc, setDesc] = useState(existing?.desc ?? '');
  const [currency, setCurrency] = useState(existing?.currency ?? group.currency);
  const [amountText, setAmountText] = useState(existing ? toMajorString(existing.amount, existing.currency) : '');
  const [date, setDate] = useState(existing?.date ?? todayISO());
  const [category, setCategory] = useState(existing?.category ?? '');
  const [multiPay, setMultiPay] = useState(existing ? existing.payers.length > 1 : false);
  const [payer, setPayer] = useState(existing?.payers[0]?.m ?? meId);
  const [paid, setPaid] = useState(() =>
    Object.fromEntries((existing?.payers ?? []).map((p) => [p.m, toMajorString(p.a, existing.currency)])),
  );
  const [splitType, setSplitType] = useState(existing?.splitType ?? 'equal');
  const [selected, setSelected] = useState(
    () => new Set(existing ? existing.shares.filter((s) => s.w > 0).map((s) => s.m) : members.filter((m) => !m.removed).map((m) => m.id)),
  );
  const [inputs, setInputs] = useState(() => {
    if (!existing || existing.splitType === 'equal') return {};
    return Object.fromEntries(
      existing.shares.map((s) => [
        s.m,
        existing.splitType === 'exact'
          ? toMajorString(s.w, existing.currency)
          : existing.splitType === 'percent'
            ? String(s.w / 100)
            : String(s.w),
      ]),
    );
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);

  // Someone else saved this expense while we had it open.
  useEffect(() => {
    if (existing && state.expenses.find((e) => e.id === existing.id)?.version !== existing.version) setConflict(true);
  }, [state.expenses, existing]);

  const total = toMinor(amountText, currency);

  const payers = useMemo(() => {
    if (!multiPay) return total ? [{ m: payer, a: total }] : [];
    return members
      .map((m) => ({ m: m.id, a: paid[m.id] ? toMinor(paid[m.id], currency) : 0 }))
      .filter((p) => p.a !== 0);
  }, [multiPay, payer, paid, total, members, currency]);
  const paidSum = payers.reduce((s, p) => s + (p.a ?? NaN), 0);

  // Split rows + a preview of each person's share (or the reason it can't be computed yet).
  const { split, preview, splitError, splitHint } = useMemo(() => {
    let rows;
    if (splitType === 'equal') rows = members.filter((m) => selected.has(m.id)).map((m) => ({ m: m.id, w: 1 }));
    else {
      rows = members.map((m) => {
        const t = inputs[m.id];
        const w = splitType === 'exact' ? (t ? toMinor(t, currency) : 0) : splitType === 'percent' ? parseBasisPoints(t) : parseShares(t);
        return { m: m.id, w };
      });
      if (rows.some((r) => r.w === null)) return { split: rows, preview: {}, splitError: 'Check the numbers in the split' };
      rows = rows.filter((r) => r.w > 0);
    }
    let hint = '';
    const sum = rows.reduce((s, r) => s + r.w, 0);
    if (splitType === 'exact' && total) {
      const left = total - sum;
      if (left) hint = left > 0 ? `${formatMoney(left, currency)} left to assign` : `${formatMoney(-left, currency)} too much`;
    }
    if (splitType === 'percent' && sum !== 10000) hint = `${(sum / 100).toFixed(2).replace(/\.00$/, '')}% of 100% assigned`;
    if (!total) return { split: rows, preview: {}, splitHint: hint };
    try {
      const shares = allocate(total, splitType, rows, existing ? existing.seq : group.seq);
      return { split: rows, preview: Object.fromEntries(shares.map((s) => [s.m, s.a])), splitHint: hint };
    } catch (e) {
      return { split: rows, preview: {}, splitError: hint ? '' : e.message, splitHint: hint };
    }
  }, [splitType, members, selected, inputs, currency, total, existing, group.seq]);

  const toggle = (id) => {
    const s = new Set(selected);
    s.has(id) ? s.delete(id) : s.add(id);
    setSelected(s);
  };

  async function save(e) {
    e.preventDefault();
    setError('');
    if (!total) return setError('Please enter a valid amount');
    if (multiPay && paidSum !== total) return setError('What each person paid must add up to the total');
    setBusy(true);
    try {
      await api('save_expense', {
        groupId: group.id,
        id: existing?.id,
        version: existing?.version,
        desc,
        currency,
        amount: total,
        date,
        category,
        splitType,
        payers,
        split,
      });
      toast(existing ? 'Expense updated' : 'Expense added');
      navigate(back, { replace: true });
    } catch (err) {
      setError(err.message);
      if (err.status === 409) setConflict(true);
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete “${existing.desc}”?`)) return;
    setBusy(true);
    try {
      await api('delete_expense', { groupId: group.id, id: existing.id, version: existing.version });
      toast('Expense deleted');
      navigate(back, { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const nameOf = (m) => (m.isMe ? 'You' : m.name);

  return (
    <>
      <TopBar back={back} title={existing ? 'Edit expense' : 'Add expense'} />
      <main className="wrap page narrow">
        {conflict && (
          <div className="note warn" role="alert">
            Someone else changed this expense.{' '}
            <button className="link-btn" onClick={() => window.location.reload()}>
              Reload to see the latest
            </button>
          </div>
        )}
        <form className="stack" onSubmit={save}>
          <label className="field">
            <span>Description</span>
            <input required maxLength={80} placeholder="e.g. Dinner at Thalassa" value={desc} onChange={(e) => setDesc(e.target.value)} />
          </label>

          <div className="field">
            <label htmlFor="amount">Amount</label>
            <div className="amount-row">
              <CurrencySelect compact value={currency} onChange={setCurrency} />
              <input
                id="amount"
                className="amount-input"
                required
                inputMode="decimal"
                placeholder="0.00"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                aria-invalid={amountText !== '' && !total}
              />
            </div>
          </div>

          <div className="two-col">
            <label className="field">
              <span>Date</span>
              <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="field">
              <span>Category</span>
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">None</option>
                {CATEGORY_LIST.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.emoji} {c.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* ---- who paid ---- */}
          <fieldset className="field box">
            <legend>Paid by</legend>
            <Segmented
              label="Number of payers"
              value={multiPay ? 'multi' : 'single'}
              onChange={(v) => {
                if (v === 'multi' && !Object.values(paid).some(Boolean) && amountText) setPaid({ [payer]: amountText });
                setMultiPay(v === 'multi');
              }}
              options={[
                { value: 'single', label: 'One person' },
                { value: 'multi', label: 'Several people' },
              ]}
            />
            {!multiPay ? (
              <select aria-label="Who paid" value={payer} onChange={(e) => setPayer(Number(e.target.value))}>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {nameOf(m)}
                  </option>
                ))}
              </select>
            ) : (
              <>
                <ul className="person-list">
                  {members.map((m) => (
                    <li key={m.id} className="person-row">
                      <Avatar name={m.name} size={28} />
                      <span className="person-name">{nameOf(m)}</span>
                      <input
                        className="small-input"
                        inputMode="decimal"
                        placeholder="0"
                        aria-label={`${m.name} paid`}
                        value={paid[m.id] ?? ''}
                        onChange={(e) => setPaid({ ...paid, [m.id]: e.target.value })}
                      />
                    </li>
                  ))}
                </ul>
                {total > 0 && (
                  <p className={`hint ${paidSum === total ? 'pos' : 'neg'}`}>
                    {Number.isNaN(paidSum)
                      ? 'Check the amounts'
                      : paidSum === total
                        ? 'Adds up ✓'
                        : paidSum < total
                          ? `${formatMoney(total - paidSum, currency)} left to assign`
                          : `${formatMoney(paidSum - total, currency)} too much`}
                  </p>
                )}
              </>
            )}
          </fieldset>

          {/* ---- split ---- */}
          <fieldset className="field box">
            <legend>Split</legend>
            <Segmented label="Split type" value={splitType} options={SPLIT_OPTIONS} onChange={setSplitType} />
            <ul className="person-list">
              {members.map((m) => (
                <li key={m.id} className="person-row">
                  {splitType === 'equal' ? (
                    <label className="check-row">
                      <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggle(m.id)} />
                      <Avatar name={m.name} size={28} />
                      <span className="person-name">{nameOf(m)}</span>
                    </label>
                  ) : (
                    <>
                      <Avatar name={m.name} size={28} />
                      <span className="person-name">{nameOf(m)}</span>
                      <span className="input-suffix">
                        <input
                          className="small-input"
                          inputMode={splitType === 'shares' ? 'numeric' : 'decimal'}
                          placeholder="0"
                          aria-label={`${m.name} ${splitType === 'percent' ? 'percent' : splitType}`}
                          value={inputs[m.id] ?? ''}
                          onChange={(e) => setInputs({ ...inputs, [m.id]: e.target.value })}
                        />
                        {splitType === 'percent' && <span>%</span>}
                        {splitType === 'shares' && <span>×</span>}
                      </span>
                    </>
                  )}
                  <span className="share-preview">{preview[m.id] ? formatMoney(preview[m.id], currency) : ''}</span>
                </li>
              ))}
            </ul>
            {splitType === 'equal' && (
              <div className="row-buttons">
                <button type="button" className="link-btn" onClick={() => setSelected(new Set(members.filter((m) => !m.removed).map((m) => m.id)))}>
                  Everyone
                </button>
                <button type="button" className="link-btn" onClick={() => setSelected(new Set())}>
                  Nobody
                </button>
              </div>
            )}
            {splitType === 'shares' && <p className="hint muted">e.g. 2 for a couple, 1 for each single person.</p>}
            {(splitHint || splitError) && <p className="hint neg">{splitHint || splitError}</p>}
          </fieldset>

          <ErrorText error={error} />
          <div className="form-actions">
            <button className="btn primary" disabled={busy || conflict}>
              {busy ? 'Saving…' : existing ? 'Save changes' : 'Add expense'}
            </button>
            {existing && (
              <button type="button" className="btn danger" disabled={busy} onClick={remove}>
                Delete
              </button>
            )}
          </div>
          {existing && (
            <p className="muted small">
              Added by {state.members.find((m) => m.id === existing.createdBy)?.name ?? 'someone'}
              {existing.updatedAt !== existing.createdAt && ` · last edited by ${state.members.find((m) => m.id === existing.updatedBy)?.name ?? 'someone'}`}
            </p>
          )}
        </form>
      </main>
    </>
  );
}
