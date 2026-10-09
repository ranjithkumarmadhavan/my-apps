// Money maths shared by the app and the dev mock API (dev/mockApi.js).
// public/api/index.php mirrors `allocate` and the balance rules — keep them in sync.
//
// All amounts are integers in the currency's minor unit (paise, cents, ...).

export const MAX_AMOUNT = 100_000_000_000; // 1 billion major units at 2 decimals
export const SPLIT_TYPES = ['equal', 'exact', 'shares', 'percent'];

/**
 * Split `total` across people by weight.
 * - equal: weight 1 each; shares: whole-number weights; percent: basis points (sum 10000);
 *   exact: the weight *is* the amount (must sum to total).
 * Leftover minor units go to the largest fractional remainders; ties rotate by `seq`
 * so the extra paisa doesn't always land on the same person.
 * Returns [{ m, a, w }] or throws an Error with a user-facing message.
 */
export function allocate(total, type, split, seq = 0) {
  if (!SPLIT_TYPES.includes(type)) throw new Error('Unknown split type');
  if (!split.length) throw new Error('Pick at least one person to split with');
  const rows = split.map(({ m, w }) => ({ m, w: type === 'equal' ? 1 : w }));
  for (const r of rows) {
    if (!Number.isSafeInteger(r.w) || r.w < 0) throw new Error('Split values must be whole, positive numbers');
    if (type === 'shares' && r.w > 1000) throw new Error('Shares can be at most 1000 each');
  }

  if (type === 'exact') {
    const sum = rows.reduce((s, r) => s + r.w, 0);
    if (sum !== total) throw new Error('Exact amounts must add up to the total');
    return rows.map((r) => ({ ...r, a: r.w }));
  }
  if (type === 'percent' && rows.reduce((s, r) => s + r.w, 0) !== 10000) {
    throw new Error('Percentages must add up to 100%');
  }

  const W = rows.reduce((s, r) => s + r.w, 0);
  if (W <= 0) throw new Error('Split values must add up to more than zero');
  const n = rows.length;
  const parts = rows.map((r, i) => ({
    ...r,
    i,
    a: Math.floor((total * r.w) / W),
    frac: (total * r.w) % W,
    rot: (((i - seq) % n) + n) % n,
  }));
  let rem = total - parts.reduce((s, p) => s + p.a, 0);
  const order = parts
    .filter((p) => p.w > 0)
    .sort((x, y) => y.frac - x.frac || x.rot - y.rot);
  for (let k = 0; rem > 0; k = (k + 1) % order.length, rem--) order[k].a += 1;
  return parts.map(({ m, w, a }) => ({ m, w, a }));
}

/** Net balance per currency per member: positive = gets money back. { CUR: { memberId: net } } */
export function balances(expenses, payments) {
  const out = {};
  const add = (cur, m, v) => {
    const b = (out[cur] ??= {});
    b[m] = (b[m] ?? 0) + v;
  };
  for (const e of expenses) {
    for (const p of e.payers) add(e.currency, p.m, p.a);
    for (const s of e.shares) add(e.currency, s.m, -s.a);
  }
  for (const p of payments) {
    add(p.currency, p.from, p.amount);
    add(p.currency, p.to, -p.amount);
  }
  return out;
}

/** Fewest-payments plan for one currency: greedy, largest debtor pays largest creditor. */
export function settlePlan(net) {
  const debtors = [];
  const creditors = [];
  for (const [m, v] of Object.entries(net)) {
    if (v < 0) debtors.push({ m: Number(m), v: -v });
    else if (v > 0) creditors.push({ m: Number(m), v });
  }
  const byBig = (a, b) => b.v - a.v || a.m - b.m;
  const plan = [];
  while (debtors.length && creditors.length) {
    debtors.sort(byBig);
    creditors.sort(byBig);
    const d = debtors[0];
    const c = creditors[0];
    const amt = Math.min(d.v, c.v);
    plan.push({ from: d.m, to: c.m, amount: amt });
    d.v -= amt;
    c.v -= amt;
    if (!d.v) debtors.shift();
    if (!c.v) creditors.shift();
  }
  return plan;
}

const digitsCache = {};
/** Number of minor-unit digits for a currency (INR 2, JPY 0, KWD 3). */
export function fractionDigits(cur) {
  if (!(cur in digitsCache)) {
    try {
      digitsCache[cur] = new Intl.NumberFormat('en', { style: 'currency', currency: cur }).resolvedOptions()
        .maximumFractionDigits;
    } catch {
      digitsCache[cur] = 2;
    }
  }
  return digitsCache[cur];
}

/**
 * Convert every currency's balances into `base` using manual rates ({ USD: '83.2' } = 1 USD in base).
 * Returns null when a currency in use has no rate. Rounding drift is absorbed by the largest balance
 * so the result still nets to zero.
 */
export function combine(byCurrency, base, rates) {
  const out = {};
  for (const [cur, net] of Object.entries(byCurrency)) {
    const rate = cur === base ? 1 : Number(rates?.[cur]);
    if (!(rate > 0)) return null;
    const scale = 10 ** (fractionDigits(base) - fractionDigits(cur));
    for (const [m, v] of Object.entries(net)) out[m] = (out[m] ?? 0) + Math.round(v * rate * scale);
  }
  const drift = Object.values(out).reduce((s, v) => s + v, 0);
  if (drift) {
    const big = Object.keys(out).sort((a, b) => Math.abs(out[b]) - Math.abs(out[a]))[0];
    out[big] -= drift;
  }
  return out;
}

/** "1,234.50" style string to minor units, or null if invalid. */
export function toMinor(text, cur) {
  const s = String(text ?? '').replace(/[,\s]/g, '');
  const d = fractionDigits(cur);
  const re = d ? new RegExp(`^\\d+(\\.\\d{0,${d}})?$`) : /^\d+$/;
  if (!re.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const v = Number(whole) * 10 ** d + Number((frac + '0'.repeat(d)).slice(0, d) || 0);
  return Number.isSafeInteger(v) ? v : null;
}

/** Minor units to a plain decimal string for inputs and CSV ("1234.50"). */
export function toMajorString(minor, cur) {
  const d = fractionDigits(cur);
  if (!d) return String(minor);
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  return `${sign}${Math.floor(abs / 10 ** d)}.${String(abs % 10 ** d).padStart(d, '0')}`;
}

/** Display string with symbol, e.g. ₹1,234.50 / $40.00. Indian digit grouping for INR. */
export function formatMoney(minor, cur, { signed = false } = {}) {
  const d = fractionDigits(cur);
  const locale = cur === 'INR' ? 'en-IN' : 'en';
  let text;
  try {
    text = new Intl.NumberFormat(locale, { style: 'currency', currency: cur, minimumFractionDigits: d }).format(
      Math.abs(minor) / 10 ** d,
    );
  } catch {
    text = `${cur} ${toMajorString(Math.abs(minor), cur)}`;
  }
  if (minor < 0) return `−${text}`;
  return signed && minor > 0 ? `+${text}` : text;
}
