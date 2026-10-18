// In-memory stand-in for the PHP APIs so the app runs with `npm run dev` (no PHP or MySQL):
//   /api/auth.php            -> landing/public/api/auth.php (shared accounts)
//   /spliteasy/api/index.php -> spliteasy/public/api/index.php
// Keep behaviour in sync with those files. Data resets when the dev server restarts.
//
// Seeded test account: demo@spliteasy.test / demo1234 (with a sample trip).
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { allocate, MAX_AMOUNT } from '../src/lib/money.js';

const SESSION_COOKIE = 'apps_session';
const SESSION_DAYS = 30;
const CATEGORIES = ['food', 'travel', 'stay', 'shopping', 'fun', 'bills', 'other'];
const ACTIVITY_LIMIT = 100;

class Fail extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const fail = (msg, status) => {
  throw new Fail(msg, status);
};

const now = () => Math.floor(Date.now() / 1000);
const token = (bytes = 32) => randomBytes(bytes).toString('hex');
const sha = (s) => createHash('sha256').update(s).digest('hex');
const hashPassword = (p) => {
  const salt = token(8);
  return `${salt}:${scryptSync(p, salt, 32).toString('hex')}`;
};
const checkPassword = (p, stored) => {
  const [salt, hash] = stored.split(':');
  return timingSafeEqual(scryptSync(String(p), salt, 32), Buffer.from(hash, 'hex'));
};

const cleanText = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const cleanEmail = (v) => {
  const e = String(v ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 190 ? e : '';
};
const cleanCurrency = (v) => {
  const c = String(v ?? '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : '';
};
const cleanUpi = (v) => {
  const u = String(v ?? '').trim();
  if (u === '') return '';
  return /^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9.-]{1,32}$/.test(u) ? u : null;
};
const validPassword = (p) => typeof p === 'string' && p.length >= 8 && p.length <= 200;
const validEmoji = (e) => {
  const s = String(e ?? '').trim();
  return s && [...s].length <= 4 ? s : '👥';
};
const validDate = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d ?? ''));
  const dt = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (!m || dt.getUTCMonth() !== +m[2] - 1 || dt.getUTCDate() !== +m[3]) fail('Please pick a valid date');
  return d;
};
const validAmount = (a) => {
  if (!Number.isInteger(a) || a <= 0 || a > MAX_AMOUNT) fail('Please enter a valid amount');
  return a;
};

// ---------- data ----------
const db = {
  users: [], // { id, email, name, passwordHash, googleSub, emailVerified, upi, currency }
  sessions: new Map(), // tokenHash -> { userId, expires }
  resets: new Map(), // tokenHash -> { userId, expires }
  groups: [], // { id, name, emoji, currency, rates, inviteToken, ownerId, version, seq, updatedAt }
  members: [], // { id, groupId, userId, name, upi, removed }
  expenses: [], // { id, groupId, desc, currency, amount, date, category, splitType, seq, version, payers, shares, createdBy, updatedBy, createdAt, updatedAt, deleted }
  payments: [], // { id, groupId, from, to, currency, amount, date, note, createdBy, createdAt, deleted }
  activity: [], // { id, groupId, by, at, ...data }
  ids: {},
};
const nextId = (k) => (db.ids[k] = (db.ids[k] ?? 0) + 1);

const userView = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  upi: u.upi ?? '',
  currency: u.currency,
  hasPassword: u.passwordHash !== null,
  google: u.googleSub !== null,
});

// ---------- auth (mirrors api/auth.php) ----------

async function verifyGoogle(credential) {
  const clientId = process.env.GOOGLE_CLIENT_ID ?? '';
  if (!clientId || !/^[A-Za-z0-9._-]+$/.test(credential)) return null;
  try {
    const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
    if (r.status !== 200) return null;
    const t = await r.json();
    const ok =
      t.aud === clientId &&
      ['accounts.google.com', 'https://accounts.google.com'].includes(t.iss) &&
      Number(t.exp) > now() &&
      t.email_verified === 'true' &&
      t.sub &&
      t.email;
    return ok ? t : null;
  } catch {
    return null;
  }
}

function startSession(ctx, userId) {
  const t = token();
  db.sessions.set(sha(t), { userId, expires: now() + SESSION_DAYS * 86400 });
  ctx.setCookie(t, SESSION_DAYS * 86400);
}

function currentUser(ctx) {
  const t = ctx.cookie;
  if (!t || !/^[a-f0-9]{64}$/.test(t)) return null;
  const s = db.sessions.get(sha(t));
  if (!s || s.expires <= now()) return null;
  return db.users.find((u) => u.id === s.userId) ?? null;
}

function requireUser(ctx) {
  const u = currentUser(ctx);
  if (!u) fail('Please sign in', 401);
  return u;
}

async function auth(body, ctx) {
  const action = String(body.action ?? '');
  switch (action) {
    case 'config':
      return { googleClientId: process.env.GOOGLE_CLIENT_ID ?? '' };

    case 'me': {
      const u = currentUser(ctx);
      return { user: u ? userView(u) : null };
    }

    case 'signup': {
      const name = cleanText(body.name, 60);
      const email = cleanEmail(body.email);
      if (!name) fail('Please enter your name');
      if (!email) fail('Please enter a valid email');
      if (!validPassword(body.password)) fail('Password must be at least 8 characters');
      if (db.users.some((u) => u.email === email)) fail('An account with this email already exists. Sign in instead.', 409);
      const u = {
        id: nextId('users'),
        email,
        name,
        passwordHash: hashPassword(body.password),
        googleSub: null,
        emailVerified: false,
        upi: null,
        currency: cleanCurrency(body.currency) || 'INR',
      };
      db.users.push(u);
      startSession(ctx, u.id);
      return { user: userView(u) };
    }

    case 'login': {
      const email = cleanEmail(body.email);
      const u = db.users.find((x) => x.email === email);
      if (!u || u.passwordHash === null || !checkPassword(body.password ?? '', u.passwordHash)) {
        if (u && u.passwordHash === null) {
          fail('This account uses Google sign-in. Continue with Google, or reset your password to set one.', 401);
        }
        fail('Wrong email or password', 401);
      }
      startSession(ctx, u.id);
      return { user: userView(u) };
    }

    case 'google': {
      const t = await verifyGoogle(String(body.credential ?? ''));
      if (!t) fail('Google sign-in failed. Please try again.', 401);
      const email = cleanEmail(t.email);
      let u = db.users.find((x) => x.googleSub === t.sub) ?? db.users.find((x) => x.email === email);
      if (u) {
        if (u.googleSub === null) {
          if (!u.emailVerified) {
            u.passwordHash = null;
            for (const [k, s] of db.sessions) if (s.userId === u.id) db.sessions.delete(k);
          }
          u.googleSub = t.sub;
          u.emailVerified = true;
        }
      } else {
        u = {
          id: nextId('users'),
          email,
          name: cleanText(t.name, 60) || email.split('@')[0],
          passwordHash: null,
          googleSub: t.sub,
          emailVerified: true,
          upi: null,
          currency: 'INR',
        };
        db.users.push(u);
      }
      startSession(ctx, u.id);
      return { user: userView(u) };
    }

    case 'logout':
      if (ctx.cookie) db.sessions.delete(sha(ctx.cookie));
      ctx.setCookie('', -1);
      return { ok: true };

    case 'forgot': {
      const email = cleanEmail(body.email);
      let returnTo = String(body.returnTo ?? '/');
      if (!/^\/([a-z0-9-]+\/)?$/.test(returnTo)) returnTo = '/';
      const u = db.users.find((x) => x.email === email);
      if (u) {
        const t = token();
        db.resets.set(sha(t), { userId: u.id, expires: now() + 3600 });
        // No mail locally: print the link (the PHP emails it instead).
        const link = `http://localhost:5174${returnTo}reset?token=${t}`;
        console.log(`\n[mock mail] Password reset for ${u.email}: ${link}\n`);
      }
      return { ok: true };
    }

    case 'reset': {
      if (!validPassword(body.password)) fail('Password must be at least 8 characters');
      const r = db.resets.get(sha(String(body.token ?? '')));
      if (!r || r.expires <= now()) fail('This reset link has expired. Ask for a new one.', 410);
      const u = db.users.find((x) => x.id === r.userId);
      u.passwordHash = hashPassword(body.password);
      u.emailVerified = true;
      for (const [k, v] of db.resets) if (v.userId === u.id) db.resets.delete(k);
      for (const [k, s] of db.sessions) if (s.userId === u.id) db.sessions.delete(k);
      startSession(ctx, u.id);
      return { user: userView(u) };
    }

    case 'profile': {
      const u = requireUser(ctx);
      const name = cleanText(body.name ?? u.name, 60);
      const upi = cleanUpi(body.upi ?? u.upi ?? '');
      const currency = cleanCurrency(body.currency ?? u.currency);
      if (!name) fail('Please enter your name');
      if (upi === null) fail("That UPI ID doesn't look right (example: name@okaxis)");
      if (!currency) fail('Unknown currency');
      Object.assign(u, { name, upi: upi || null, currency });
      return { user: userView(u) };
    }

    case 'password': {
      const u = requireUser(ctx);
      if (u.passwordHash !== null && !checkPassword(body.current ?? '', u.passwordHash)) fail('Current password is wrong', 401);
      if (!validPassword(body.password)) fail('Password must be at least 8 characters');
      u.passwordHash = hashPassword(body.password);
      return { ok: true };
    }

    case 'delete_account': {
      const u = requireUser(ctx);
      if (body.confirm !== 'DELETE') fail('Type DELETE to confirm');
      if (u.passwordHash !== null && !checkPassword(body.password ?? '', u.passwordHash)) fail('Password is wrong', 401);
      spliteasyDeleteUser(u);
      for (const [k, s] of db.sessions) if (s.userId === u.id) db.sessions.delete(k);
      for (const [k, r] of db.resets) if (r.userId === u.id) db.resets.delete(k);
      db.users = db.users.filter((x) => x !== u);
      ctx.setCookie('', -1);
      return { ok: true };
    }

    default:
      fail('Unknown action');
  }
}

// ---------- SplitEasy (mirrors spliteasy/public/api/index.php) ----------

/** Mirrors spliteasy/public/api/on-account-delete.php. */
function spliteasyDeleteUser(user) {
  for (const g of db.groups.filter((x) => x.ownerId === user.id)) {
    const heir = db.members
      .filter((m) => m.groupId === g.id && m.userId !== null && m.userId !== user.id && !m.removed)
      .sort((a, b) => a.id - b.id)[0];
    if (heir) g.ownerId = heir.userId;
    else {
      for (const k of ['members', 'expenses', 'payments', 'activity']) db[k] = db[k].filter((x) => x.groupId !== g.id);
      db.groups = db.groups.filter((x) => x !== g);
    }
  }
  for (const m of db.members.filter((x) => x.userId === user.id)) {
    Object.assign(m, { userId: null, name: user.name, upi: null });
    logActivity(m.groupId, m.id, { type: 'account_deleted', name: user.name });
    bump(db.groups.find((g) => g.id === m.groupId));
  }
}

function membership(groupId, uid) {
  const group = db.groups.find((g) => g.id === groupId);
  const me = group && db.members.find((m) => m.groupId === group.id && m.userId === uid && !m.removed);
  if (!group || !me) fail('Group not found', 404);
  return [group, me.id];
}

const memberIds = (gid, activeOnly) =>
  db.members.filter((m) => m.groupId === gid && (!activeOnly || !m.removed)).map((m) => m.id);

function bump(group) {
  group.version += 1;
  group.updatedAt = now();
}

function logActivity(gid, by, data) {
  db.activity.push({ id: nextId('activity'), groupId: gid, by, at: now(), ...data });
}

function memberNet(gid, mid) {
  const out = {};
  const add = (c, v) => (out[c] = (out[c] ?? 0) + v);
  for (const e of db.expenses) {
    if (e.groupId !== gid || e.deleted) continue;
    for (const p of e.payers) if (p.m === mid) add(e.currency, p.a);
    for (const s of e.shares) if (s.m === mid) add(e.currency, -s.a);
  }
  for (const p of db.payments) {
    if (p.groupId !== gid || p.deleted) continue;
    if (p.from === mid) add(p.currency, p.amount);
    if (p.to === mid) add(p.currency, -p.amount);
  }
  for (const c of Object.keys(out)) if (!out[c]) delete out[c];
  return out;
}

function memberView(m, meId) {
  const u = m.userId ? db.users.find((x) => x.id === m.userId) : null;
  return {
    id: m.id,
    name: u ? u.name : m.name,
    upi: (u ? u.upi : m.upi) ?? '',
    linked: !!u,
    removed: m.removed,
    isMe: m.id === meId,
  };
}

const byDateDesc = (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id);

function groupState(group, meId, uid) {
  const gid = group.id;
  return {
    group: {
      id: gid,
      name: group.name,
      emoji: group.emoji,
      currency: group.currency,
      rates: { ...group.rates },
      inviteToken: group.inviteToken,
      isOwner: group.ownerId === uid,
      version: group.version,
      seq: group.seq,
    },
    meId,
    members: db.members.filter((m) => m.groupId === gid).map((m) => memberView(m, meId)),
    expenses: db.expenses
      .filter((e) => e.groupId === gid && !e.deleted)
      .sort(byDateDesc)
      .map(({ groupId, deleted, ...e }) => ({
        ...e,
        payers: [...e.payers].sort((a, b) => a.m - b.m),
        shares: [...e.shares].sort((a, b) => a.m - b.m),
      })),
    payments: db.payments
      .filter((p) => p.groupId === gid && !p.deleted)
      .sort(byDateDesc)
      .map(({ groupId, deleted, ...p }) => p),
    activity: db.activity
      .filter((a) => a.groupId === gid)
      .sort((a, b) => b.id - a.id)
      .slice(0, ACTIVITY_LIMIT)
      .map(({ groupId, ...a }) => a),
  };
}

function checkPeople(list, key, allowed, what) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).map((row) => {
    const m = row?.m;
    if (!Number.isInteger(m) || !allowed.includes(m) || seen.has(m)) fail(`Please check who ${what}`);
    seen.add(m);
    return { m, [key]: row[key] ?? null };
  });
}

function spliteasy(body, ctx) {
  const user = requireUser(ctx);
  const uid = user.id;
  const action = String(body.action ?? '');

  switch (action) {
    case 'groups': {
      const mine = db.members.filter((m) => m.userId === uid && !m.removed);
      const groups = mine
        .map((m) => {
          const g = db.groups.find((x) => x.id === m.groupId);
          return {
            id: g.id,
            name: g.name,
            emoji: g.emoji,
            currency: g.currency,
            members: memberIds(g.id, true).length,
            updatedAt: g.updatedAt,
            net: memberNet(g.id, m.id),
          };
        })
        .sort((a, b) => b.updatedAt - a.updatedAt);
      return { groups };
    }

    case 'create_group': {
      const name = cleanText(body.name, 60);
      const currency = cleanCurrency(body.currency) || user.currency;
      if (!name) fail('Please name the group');
      const guests = (Array.isArray(body.guests) ? body.guests : []).map((n) => cleanText(n, 60)).filter(Boolean);
      if (guests.length > 50) fail("That's a lot of people. Add at most 50 at once.");
      const g = {
        id: nextId('groups'),
        name,
        emoji: validEmoji(body.emoji),
        currency,
        rates: {},
        inviteToken: token(16),
        ownerId: uid,
        version: 1,
        seq: 0,
        updatedAt: now(),
      };
      db.groups.push(g);
      const me = { id: nextId('members'), groupId: g.id, userId: uid, name: user.name, upi: null, removed: false };
      db.members.push(me);
      for (const n of guests) {
        db.members.push({ id: nextId('members'), groupId: g.id, userId: null, name: n, upi: null, removed: false });
      }
      logActivity(g.id, me.id, { type: 'group_create', name });
      return { groupId: g.id };
    }

    case 'group': {
      const [group, me] = membership(Number(body.id), uid);
      if (body.since !== undefined && Number(body.since) === group.version) return { unchanged: true };
      return groupState(group, me, uid);
    }

    case 'update_group': {
      const [group, me] = membership(Number(body.id), uid);
      const name = 'name' in body ? cleanText(body.name, 60) : group.name;
      const currency = 'currency' in body ? cleanCurrency(body.currency) : group.currency;
      if (!name) fail('Please name the group');
      if (!currency) fail('Unknown currency');
      let rates = group.rates;
      if ('rates' in body) {
        rates = {};
        for (const [c, r] of Object.entries(body.rates ?? {})) {
          const cur = cleanCurrency(c);
          const rate = String(r ?? '').trim();
          if (!cur || cur === currency || rate === '') continue;
          if (!/^\d{1,9}(\.\d{1,8})?$/.test(rate) || !(Number(rate) > 0)) fail(`Please check the rate for ${cur}`);
          rates[cur] = rate;
        }
      }
      Object.assign(group, { name, currency, rates, emoji: validEmoji(body.emoji ?? group.emoji) });
      logActivity(group.id, me, { type: 'group_update', name });
      bump(group);
      return { ok: true };
    }

    case 'delete_group': {
      const [group] = membership(Number(body.id), uid);
      if (group.ownerId !== uid) fail('Only the person who created the group can delete it', 403);
      for (const k of ['members', 'expenses', 'payments', 'activity']) db[k] = db[k].filter((x) => x.groupId !== group.id);
      db.groups = db.groups.filter((g) => g !== group);
      return { ok: true };
    }

    case 'reset_invite': {
      const [group, me] = membership(Number(body.id), uid);
      group.inviteToken = token(16);
      logActivity(group.id, me, { type: 'invite_reset' });
      bump(group);
      return { ok: true };
    }

    case 'add_member': {
      const [group, me] = membership(Number(body.groupId), uid);
      const name = cleanText(body.name, 60);
      const upi = cleanUpi(body.upi);
      if (!name) fail('Please enter a name');
      if (upi === null) fail("That UPI ID doesn't look right (example: name@okaxis)");
      const m = { id: nextId('members'), groupId: group.id, userId: null, name, upi: upi || null, removed: false };
      db.members.push(m);
      logActivity(group.id, me, { type: 'member_add', name });
      bump(group);
      return { memberId: m.id };
    }

    case 'update_member': {
      const [group] = membership(Number(body.groupId), uid);
      const m = db.members.find((x) => x.id === Number(body.memberId) && x.groupId === group.id);
      if (!m) fail('Member not found', 404);
      if (m.userId !== null) fail('People with an account edit their own name and UPI ID in their profile');
      const name = cleanText(body.name ?? m.name, 60);
      const upi = cleanUpi(body.upi ?? m.upi ?? '');
      if (!name) fail('Please enter a name');
      if (upi === null) fail("That UPI ID doesn't look right (example: name@okaxis)");
      Object.assign(m, { name, upi: upi || null });
      bump(group);
      return { ok: true };
    }

    case 'remove_member': {
      const [group, me] = membership(Number(body.groupId), uid);
      const m = db.members.find((x) => x.id === Number(body.memberId) && x.groupId === group.id && !x.removed);
      if (!m) fail('Member not found', 404);
      const display = memberView(m, me).name;
      if (m.userId === group.ownerId) fail("The group creator can't be removed");
      if (Object.keys(memberNet(group.id, m.id)).length) fail(`${display} still has an unsettled balance. Settle up first.`);
      m.removed = true;
      logActivity(group.id, me, { type: 'member_remove', name: display });
      bump(group);
      return { ok: true };
    }

    case 'save_expense': {
      const [group, me] = membership(Number(body.groupId), uid);
      const gid = group.id;
      const desc = cleanText(body.desc, 80);
      const currency = cleanCurrency(body.currency);
      const amount = validAmount(body.amount);
      const date = validDate(body.date);
      const category = CATEGORIES.includes(body.category) ? body.category : '';
      const type = String(body.splitType ?? '');
      if (!desc) fail('Please add a description');
      if (!currency) fail('Unknown currency');

      const id = Number(body.id ?? 0);
      let existing = null;
      if (id) {
        existing = db.expenses.find((e) => e.id === id && e.groupId === gid && !e.deleted);
        if (!existing) fail('This expense was deleted by someone else', 409);
        if (existing.version !== Number(body.version ?? 0)) {
          fail('Someone else just changed this expense. Reload to see their changes.', 409);
        }
      }
      const allowed = memberIds(gid, !existing);
      const payers = checkPeople(body.payers, 'a', allowed, 'paid');
      if (!payers.length) fail('Please choose who paid');
      for (const p of payers) if (!Number.isInteger(p.a) || p.a <= 0) fail('Each payer needs an amount');
      if (payers.reduce((s, p) => s + p.a, 0) !== amount) fail('What each person paid must add up to the total');
      const split = checkPeople(body.split, 'w', allowed, 'this is split with');
      const seq = existing ? existing.seq : group.seq;
      let shares;
      try {
        shares = allocate(amount, type, split, seq);
      } catch (e) {
        fail(e.message);
      }

      const t = now();
      const fields = { desc, currency, amount, date, category, splitType: type, payers, shares, updatedBy: me, updatedAt: t };
      let eid;
      if (existing) {
        Object.assign(existing, fields, { version: existing.version + 1 });
        eid = existing.id;
      } else {
        eid = nextId('expenses');
        db.expenses.push({ id: eid, groupId: gid, seq, version: 1, createdBy: me, createdAt: t, deleted: false, ...fields });
        group.seq += 1;
      }
      logActivity(gid, me, { type: existing ? 'expense_edit' : 'expense_add', desc, currency, amount });
      bump(group);
      return { expenseId: eid };
    }

    case 'delete_expense': {
      const [group, me] = membership(Number(body.groupId), uid);
      const e = db.expenses.find((x) => x.id === Number(body.id) && x.groupId === group.id && !x.deleted);
      if (!e) fail('This expense was already deleted', 409);
      if (e.version !== Number(body.version ?? 0)) fail('Someone else just changed this expense. Reload to see their changes.', 409);
      Object.assign(e, { deleted: true, updatedBy: me, updatedAt: now() });
      logActivity(group.id, me, { type: 'expense_delete', desc: e.desc, currency: e.currency, amount: e.amount });
      bump(group);
      return { ok: true };
    }

    case 'save_payment': {
      const [group, me] = membership(Number(body.groupId), uid);
      const active = memberIds(group.id, true);
      const { from, to } = body;
      if (!Number.isInteger(from) || !Number.isInteger(to) || !active.includes(from) || !active.includes(to) || from === to) {
        fail('Please choose who paid whom');
      }
      const currency = cleanCurrency(body.currency);
      if (!currency) fail('Unknown currency');
      const amount = validAmount(body.amount);
      const date = validDate(body.date);
      const note = cleanText(body.note, 80);
      const p = { id: nextId('payments'), groupId: group.id, from, to, currency, amount, date, note, createdBy: me, createdAt: now(), deleted: false };
      db.payments.push(p);
      logActivity(group.id, me, { type: 'payment_add', from, to, currency, amount });
      bump(group);
      return { paymentId: p.id };
    }

    case 'delete_payment': {
      const [group, me] = membership(Number(body.groupId), uid);
      const p = db.payments.find((x) => x.id === Number(body.id) && x.groupId === group.id && !x.deleted);
      if (!p) fail('This payment was already deleted', 409);
      p.deleted = true;
      logActivity(group.id, me, { type: 'payment_delete', from: p.from, to: p.to, currency: p.currency, amount: p.amount });
      bump(group);
      return { ok: true };
    }

    case 'invite_info': {
      const group = db.groups.find((g) => g.inviteToken === String(body.token ?? ''));
      if (!group) fail('This invite link is no longer valid. Ask for a new one.', 404);
      return {
        group: { id: group.id, name: group.name, emoji: group.emoji, members: memberIds(group.id, true).length },
        alreadyMember: db.members.some((m) => m.groupId === group.id && m.userId === uid && !m.removed),
        guests: db.members
          .filter((m) => m.groupId === group.id && m.userId === null && !m.removed)
          .map((m) => ({ id: m.id, name: m.name }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      };
    }

    case 'join': {
      const group = db.groups.find((g) => g.inviteToken === String(body.token ?? ''));
      if (!group) fail('This invite link is no longer valid. Ask for a new one.', 404);
      const mine = db.members.find((m) => m.groupId === group.id && m.userId === uid);
      if (mine && !mine.removed) return { groupId: group.id };
      const claim = Number(body.claimMemberId ?? 0);
      let me;
      if (claim) {
        if (mine) fail("You were in this group before, so you can't take over a guest. Join as yourself.");
        const g = db.members.find((m) => m.id === claim && m.groupId === group.id && m.userId === null && !m.removed);
        if (!g) fail('Someone else already claimed that name. Pick again.', 409);
        g.userId = uid;
        g.upi = null;
        me = g.id;
      } else if (mine) {
        mine.removed = false;
        me = mine.id;
      } else {
        me = nextId('members');
        db.members.push({ id: me, groupId: group.id, userId: uid, name: user.name, upi: null, removed: false });
      }
      logActivity(group.id, me, { type: 'member_join', name: user.name });
      bump(group);
      return { groupId: group.id };
    }

    default:
      fail('Unknown action');
  }
}

// ---------- seed ----------

function seed() {
  const ctx = { cookie: null, setCookie: (v) => (ctx.cookie = v) };
  auth({ action: 'signup', name: 'Ranjith', email: 'demo@spliteasy.test', password: 'demo1234' }, ctx);
  auth({ action: 'profile', upi: 'ranjith@okaxis' }, ctx);
  const { groupId } = spliteasy(
    { action: 'create_group', name: 'Goa trip', emoji: '🏖️', currency: 'INR', guests: ['Arun', 'Priya', 'Karthik'] },
    ctx,
  );
  const [me, arun, priya, karthik] = memberIds(groupId, true);
  const everyone = [me, arun, priya, karthik].map((m) => ({ m, w: 1 }));
  const add = (desc, amount, payers, split, extra = {}) =>
    spliteasy({ action: 'save_expense', groupId, desc, currency: 'INR', amount, date: '2026-10-02', category: 'food', splitType: 'equal', payers, split, ...extra }, ctx);
  add('Flights to Goa', 2400000, [{ m: me, a: 2400000 }], everyone, { category: 'travel', date: '2026-10-01' });
  add('Villa (2 nights)', 1800000, [{ m: arun, a: 1000000 }, { m: priya, a: 800000 }], everyone, { category: 'stay' });
  add('Seafood dinner', 640000, [{ m: karthik, a: 640000 }], [{ m: me, w: 2 }, { m: arun, w: 1 }, { m: priya, w: 1 }, { m: karthik, w: 2 }], { splitType: 'shares', date: '2026-10-02' });
  add('Scuba diving', 1200000, [{ m: me, a: 1200000 }], [{ m: me, w: 600000 }, { m: priya, w: 600000 }], { splitType: 'exact', category: 'fun', date: '2026-10-03' });
  spliteasy({ action: 'save_payment', groupId, from: arun, to: me, currency: 'INR', amount: 200000, date: '2026-10-04', note: 'Cash' }, ctx);
}
seed();

// ---------- Vite plugin ----------

function parseCookie(header) {
  const m = /(?:^|;\s*)apps_session=([^;]*)/.exec(header ?? '');
  return m ? decodeURIComponent(m[1]) : null;
}

function endpoint(handler) {
  return (req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      const ctx = {
        cookie: parseCookie(req.headers.cookie),
        setCookie(value, maxAge) {
          res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax`);
        },
      };
      let status = 200;
      let data;
      try {
        if (req.method !== 'POST') fail('Method not allowed', 405);
        if (req.headers['x-requested-with'] !== 'fetch') fail('Bad request', 400);
        data = await handler(JSON.parse(raw || '{}'), ctx);
      } catch (e) {
        status = e instanceof Fail ? e.status : 400;
        data = { error: e instanceof Fail ? e.message : 'Bad request' };
        if (!(e instanceof Fail)) console.error(e);
      }
      // A little latency so loading states are visible in dev.
      setTimeout(() => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify(data));
      }, 120);
    });
  };
}

export default function mockApi() {
  return {
    name: 'apps-mock-api',
    configureServer(server) {
      server.middlewares.use('/api/auth.php', endpoint(auth));
      server.middlewares.use('/spliteasy/api/index.php', endpoint(spliteasy));
    },
    // Also under `vite preview`, to test the production build (service worker etc.) locally.
    configurePreviewServer(server) {
      server.middlewares.use('/api/auth.php', endpoint(auth));
      server.middlewares.use('/spliteasy/api/index.php', endpoint(spliteasy));
    },
  };
}
