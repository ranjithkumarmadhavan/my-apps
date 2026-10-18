import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { formatMoney } from '../lib/money';
import { linkProps } from '../lib/router';
import { syncedLabel } from '../lib/offlineCache';

// ---------- avatar ----------
const HUES = [152, 210, 265, 330, 25, 45, 190, 290];
function hueFor(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return HUES[h % HUES.length];
}

export function Avatar({ name, size = 36 }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => [...w][0].toUpperCase())
    .join('');
  return (
    <span className="avatar" style={{ '--h': hueFor(name), width: size, height: size, fontSize: size * 0.4 }} aria-hidden>
      {initials || '?'}
    </span>
  );
}

// ---------- money ----------
export function Money({ amount, currency, signed, tone }) {
  const cls = tone ?? (amount > 0 ? 'pos' : amount < 0 ? 'neg' : 'zero');
  return <span className={`money ${cls}`}>{formatMoney(amount, currency, { signed })}</span>;
}

/** "you get back ₹200 · you owe $40" style summary of a { CUR: net } map. */
export function NetSummary({ net, empty = 'All settled up' }) {
  const entries = Object.entries(net ?? {}).filter(([, v]) => v);
  if (!entries.length) return <span className="muted">{empty}</span>;
  return (
    <span className="net-summary">
      {entries.map(([cur, v]) => (
        <span key={cur} className={v > 0 ? 'pos' : 'neg'}>
          {v > 0 ? 'you get back ' : 'you owe '}
          <strong>{formatMoney(Math.abs(v), cur)}</strong>
        </span>
      ))}
    </span>
  );
}

// ---------- header ----------
export function TopBar({ title, back, right }) {
  return (
    <header className="topbar">
      <div className="topbar-inner wrap">
        {back ? (
          <a className="icon-btn" aria-label="Back" {...linkProps(back)}>
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden>
              <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        ) : (
          <a className="brand" {...linkProps('/')}>
            <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width="28" height="28" />
            <span>SplitEasy</span>
          </a>
        )}
        {title && <h1 className="topbar-title">{title}</h1>}
        <div className="topbar-right">{right}</div>
      </div>
    </header>
  );
}

// ---------- sheet / modal ----------
export function Sheet({ title, onClose, children, footer }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const prev = document.activeElement;
    ref.current?.querySelector('input, select, textarea, button:not(.sheet-close)')?.focus();
    const onKey = (e) => e.key === 'Escape' && closeRef.current();
    document.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
      prev?.focus?.();
    };
  }, []);
  return (
    <div className="sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn sheet-close" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

// ---------- toast ----------
const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);
  const timer = useRef();
  const show = useCallback((text, kind = 'ok') => {
    clearTimeout(timer.current);
    setToast({ text, kind, key: Date.now() });
    timer.current = setTimeout(() => setToast(null), 3200);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toast-zone" aria-live="polite">
        {toast && (
          <div key={toast.key} className={`toast ${toast.kind}`}>
            {toast.text}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

// ---------- misc ----------
export function ErrorText({ error }) {
  return error ? (
    <p className="error" role="alert">
      {error}
    </p>
  ) : null;
}

export function Spinner({ label = 'Loading…' }) {
  return (
    <div className="spinner-wrap" role="status">
      <span className="spinner" aria-hidden />
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function Segmented({ value, options, onChange, label }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const CATEGORY_LIST = [
  { id: 'food', label: 'Food', emoji: '🍽️' },
  { id: 'travel', label: 'Travel', emoji: '🚕' },
  { id: 'stay', label: 'Stay', emoji: '🏨' },
  { id: 'shopping', label: 'Shopping', emoji: '🛍️' },
  { id: 'fun', label: 'Fun', emoji: '🎉' },
  { id: 'bills', label: 'Bills', emoji: '🧾' },
  { id: 'other', label: 'Other', emoji: '📦' },
];
export const categoryEmoji = (id) => CATEGORY_LIST.find((c) => c.id === id)?.emoji ?? '🧾';

export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function formatDate(iso, opts = { day: 'numeric', month: 'short' }) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', opts);
}

/** "Offline · showing data from 10 min ago" note for screens showing their cached copy. */
export function SyncNote({ offline, syncedAt }) {
  if (!offline || !syncedAt) return null;
  return (
    <p className="sync-note" role="status">
      <span aria-hidden>📡</span> Offline · showing what was saved {syncedLabel(syncedAt)}. Balances may have changed.
    </p>
  );
}
