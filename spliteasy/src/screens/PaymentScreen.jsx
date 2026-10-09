import { useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import { api } from '../lib/api';
import { navigate } from '../lib/router';
import { formatMoney, toMajorString, toMinor } from '../lib/money';
import { people, useGroup } from '../lib/useGroup';
import { UPI_APPS, appLink, platform, upiLink } from '../lib/upi';
import { ErrorText, Spinner, TopBar, todayISO, useToast } from '../components/ui.jsx';
import CurrencySelect from '../components/CurrencySelect.jsx';

export default function PaymentScreen({ groupId, query }) {
  const { state, error } = useGroup(groupId);
  if (!state) {
    return (
      <>
        <TopBar back={`/g/${groupId}?tab=balances`} title="Settle up" />
        <main className="wrap page">{error ? <ErrorText error={error} /> : <Spinner />}</main>
      </>
    );
  }
  return <PaymentForm state={state} query={query} />;
}

function UpiQr({ link }) {
  const svg = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(link);
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [link]);
  return <div className="qr" dangerouslySetInnerHTML={{ __html: svg }} />;
}

function PaymentForm({ state, query }) {
  const toast = useToast();
  const { group, meId } = state;
  const { active, byId } = people(state);
  const back = `/g/${group.id}?tab=balances`;
  const q = (k) => query.get(k);
  const startCur = q('currency') || group.currency;

  const [from, setFrom] = useState(Number(q('from')) || meId);
  const [to, setTo] = useState(Number(q('to')) || active.find((m) => m.id !== meId)?.id || meId);
  const [currency, setCurrency] = useState(startCur);
  const [amountText, setAmountText] = useState(q('amount') ? toMajorString(Number(q('amount')), startCur) : '');
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showQr, setShowQr] = useState(platform === 'desktop');

  const amount = toMinor(amountText, currency);
  const payee = byId.get(to);
  const canUpi = currency === 'INR' && amount > 0 && from === meId && payee?.upi;
  const upi = canUpi ? { upi: payee.upi, name: payee.name, amount, note: `SplitEasy: ${group.name}`.slice(0, 50) } : null;

  async function save(e) {
    e.preventDefault();
    setError('');
    if (!amount) return setError('Please enter a valid amount');
    setBusy(true);
    try {
      await api('save_payment', { groupId: group.id, from, to, currency, amount, date, note });
      toast('Payment recorded');
      navigate(back, { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const label = (m) => (m.isMe ? `${m.name} (you)` : m.name);

  return (
    <>
      <TopBar back={back} title="Settle up" />
      <main className="wrap page narrow">
        <form className="stack" onSubmit={save}>
          <div className="two-col">
            <label className="field">
              <span>From</span>
              <select value={from} onChange={(e) => setFrom(Number(e.target.value))}>
                {active.map((m) => (
                  <option key={m.id} value={m.id}>
                    {label(m)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>To</span>
              <select value={to} onChange={(e) => setTo(Number(e.target.value))}>
                {active.map((m) => (
                  <option key={m.id} value={m.id}>
                    {label(m)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="field">
            <label htmlFor="pay-amount">Amount</label>
            <div className="amount-row">
              <CurrencySelect compact value={currency} onChange={setCurrency} />
              <input
                id="pay-amount"
                className="amount-input"
                inputMode="decimal"
                required
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
              />
            </div>
          </div>

          {upi ? (
            <section className="upi-box">
              <h3>
                Pay {formatMoney(amount, 'INR')} to {payee.name}
              </h3>
              <p className="muted small">UPI ID {payee.upi}. Your app asks you to confirm; SplitEasy never moves money.</p>
              {platform !== 'desktop' && (
                <div className="upi-apps">
                  {UPI_APPS.map((app) => (
                    <a key={app.id} className={`btn upi-btn ${app.id}`} href={appLink(app, upi)}>
                      {app.label}
                    </a>
                  ))}
                  <a className="btn upi-btn" href={upiLink(upi)}>
                    Other UPI app
                  </a>
                </div>
              )}
              {platform !== 'desktop' && (
                <button type="button" className="link-btn" onClick={() => setShowQr(!showQr)}>
                  {showQr ? 'Hide QR code' : 'Show QR code instead'}
                </button>
              )}
              {showQr && (
                <>
                  <UpiQr link={upiLink(upi)} />
                  <p className="muted small center">Scan with GPay, PhonePe, CRED or any UPI app.</p>
                </>
              )}
              <p className="small">After paying, come back and tap “Record payment”.</p>
            </section>
          ) : (
            currency === 'INR' &&
            from === meId &&
            payee &&
            !payee.upi && (
              <p className="note">
                {payee.name} hasn't added a UPI ID yet, so there's no pay button.{' '}
                {payee.linked ? 'They can add one on their account page.' : 'Add it on the People tab.'}
              </p>
            )
          )}

          <div className="two-col">
            <label className="field">
              <span>Date</span>
              <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <label className="field">
              <span>Note (optional)</span>
              <input maxLength={80} placeholder="e.g. GPay" value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          </div>

          <ErrorText error={error} />
          <button className="btn primary" disabled={busy || from === to}>
            {busy ? 'Saving…' : 'Record payment'}
          </button>
          {from === to && <p className="hint neg">Pick two different people.</p>}
        </form>
      </main>
    </>
  );
}
