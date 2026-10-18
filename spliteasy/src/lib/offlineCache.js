// On-device copy of the last data loaded from the server, so screens show instantly and stay
// readable offline. Keys are per user ("u12:group:3"); everything is wiped on sign-out or account
// deletion. Storage can be unavailable (private mode, blocked site data), so every call is
// best-effort and never throws.

const DB_NAME = 'spliteasy';
const STORE = 'cache';

let dbPromise;
function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

// Keys are prefixed with the signed-in user's id so one person never sees another's cached data.
let owner = null;
export function setCacheOwner(userId) {
  owner = userId ?? null;
}
const own = (key) => (owner === null ? null : `u${owner}:${key}`);

/** Returns { value, savedAt } or null. */
export async function cacheGet(key) {
  if (own(key) === null) return null;
  try {
    return (await run('readonly', (s) => s.get(own(key)))) ?? null;
  } catch {
    return null;
  }
}

export async function cacheSet(key, value) {
  if (own(key) === null) return;
  try {
    await run('readwrite', (s) => s.put({ value, savedAt: Date.now() }, own(key)));
  } catch {
    // out of space or storage blocked: the app just won't have an offline copy
  }
}

export async function cacheClear() {
  try {
    await run('readwrite', (s) => s.clear());
  } catch {
    // nothing stored, nothing to clear
  }
  try {
    localStorage.removeItem(LAST_USER);
  } catch {
    // storage blocked
  }
}

// The signed-in user, so the app can open offline without asking the server who you are.
const LAST_USER = 'spliteasy:last-user';
export function rememberUser(user) {
  try {
    if (user) localStorage.setItem(LAST_USER, JSON.stringify(user));
    else localStorage.removeItem(LAST_USER);
  } catch {
    // storage blocked
  }
}
export function lastUser() {
  try {
    return JSON.parse(localStorage.getItem(LAST_USER) ?? 'null');
  } catch {
    return null;
  }
}

/** "just now", "5 min ago", "yesterday 18:40" style label for a timestamp. */
export function syncedLabel(ms) {
  const diff = Math.round((Date.now() - ms) / 60000);
  if (diff < 1) return 'just now';
  if (diff < 60) return `${diff} min ago`;
  return new Date(ms).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
