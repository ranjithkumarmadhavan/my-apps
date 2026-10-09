// CSV export of a group: one row per expense or payment, plus a column per person
// showing how that row changed their balance (positive = they get back).
import { toMajorString } from './money';

const cell = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function groupCsv(state) {
  const members = state.members;
  const name = (id) => members.find((m) => m.id === id)?.name ?? 'Unknown';
  const header = ['Date', 'Type', 'Description', 'Category', 'Currency', 'Amount', 'Paid by', ...members.map((m) => m.name)];
  const rows = [];

  for (const e of state.expenses) {
    const effect = Object.fromEntries(members.map((m) => [m.id, 0]));
    for (const p of e.payers) effect[p.m] += p.a;
    for (const s of e.shares) effect[s.m] -= s.a;
    rows.push({
      date: e.date,
      id: e.createdAt,
      cols: [
        e.date,
        'Expense',
        e.desc,
        e.category,
        e.currency,
        toMajorString(e.amount, e.currency),
        e.payers.map((p) => `${name(p.m)} (${toMajorString(p.a, e.currency)})`).join('; '),
        ...members.map((m) => toMajorString(effect[m.id], e.currency)),
      ],
    });
  }
  for (const p of state.payments) {
    rows.push({
      date: p.date,
      id: p.createdAt,
      cols: [
        p.date,
        'Payment',
        `${name(p.from)} paid ${name(p.to)}${p.note ? ` (${p.note})` : ''}`,
        '',
        p.currency,
        toMajorString(p.amount, p.currency),
        name(p.from),
        ...members.map((m) =>
          toMajorString(m.id === p.from ? p.amount : m.id === p.to ? -p.amount : 0, p.currency),
        ),
      ],
    });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id));
  return [header, ...rows.map((r) => r.cols)].map((r) => r.map(cell).join(',')).join('\r\n');
}

export function downloadCsv(filename, text) {
  const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
