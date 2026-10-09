// Minimal history router: paths are relative to the app base (/spliteasy/).
import { useEffect, useState } from 'react';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

const current = () => {
  const p = window.location.pathname;
  return (p.startsWith(BASE) ? p.slice(BASE.length) : p) || '/';
};

export function navigate(to, { replace = false } = {}) {
  const url = BASE + to;
  if (replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
  window.dispatchEvent(new Event('spliteasy:navigate'));
  window.scrollTo(0, 0);
}

export function useRoute() {
  const [route, setRoute] = useState(() => ({ path: current(), query: new URLSearchParams(window.location.search) }));
  useEffect(() => {
    const update = () => setRoute({ path: current(), query: new URLSearchParams(window.location.search) });
    window.addEventListener('popstate', update);
    window.addEventListener('spliteasy:navigate', update);
    return () => {
      window.removeEventListener('popstate', update);
      window.removeEventListener('spliteasy:navigate', update);
    };
  }, []);
  return route;
}

/** Match "/g/:id/expense/:eid" style patterns; returns params or null. */
export function match(pattern, path) {
  const a = pattern.split('/');
  const b = path.replace(/\/$/, '').split('/');
  if (a.length !== b.length) return null;
  const params = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

/** <a> that navigates without a reload. */
export function linkProps(to) {
  return {
    href: BASE + to,
    onClick: (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      navigate(to);
    },
  };
}

export const fullUrl = (to) => window.location.origin + BASE + to;
