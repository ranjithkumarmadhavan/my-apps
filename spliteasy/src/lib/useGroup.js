// Loads a group's full state and keeps it fresh: polls every few seconds while the tab is
// visible, but the server only sends data when the group's version has changed.
// The last loaded state is kept on the device, so the group shows instantly and stays readable
// offline (`offline` + `syncedAt` tell the screen it's looking at the saved copy).
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { cacheGet, cacheSet } from './offlineCache';

const POLL_MS = 4000;

export function useGroup(id) {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(false);
  const [syncedAt, setSyncedAt] = useState(null);
  const version = useRef(null);
  const latest = useRef(null); // newest state, for re-saving after "unchanged" replies
  const fresh = useRef(false); // true once the server has answered, so the cache can't overwrite it
  const key = `group:${id}`;

  const load = useCallback(
    async (force = false) => {
      try {
        const d = await api('group', force || version.current === null ? { id } : { id, since: version.current });
        fresh.current = true;
        if (!d.unchanged) {
          version.current = d.group.version;
          latest.current = d;
          setState(d);
        }
        if (latest.current) cacheSet(key, latest.current);
        setSyncedAt(Date.now());
        setOffline(false);
        setError('');
      } catch (e) {
        if (e.status === 0) setOffline(true); // keep showing whatever we have
        else setError(e.message);
      }
    },
    [id, key],
  );

  useEffect(() => {
    version.current = null;
    latest.current = null;
    fresh.current = false;
    setState(null);
    setOffline(false);
    setSyncedAt(null);
    cacheGet(key).then((c) => {
      if (!c || fresh.current) return;
      latest.current = c.value;
      version.current = c.value.group.version;
      setState(c.value);
      setSyncedAt(c.savedAt);
    });
    load(true);
    const t = setInterval(() => document.visibilityState === 'visible' && load(), POLL_MS);
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, [load, key]);

  return { state, error, offline, syncedAt, reload: () => load(true) };
}

/** Lookup helpers over a group state. */
export function people(state) {
  const byId = new Map(state.members.map((m) => [m.id, m]));
  const name = (id) => {
    const m = byId.get(id);
    if (!m) return 'Someone';
    return m.isMe ? 'You' : m.name;
  };
  // Object form: "Arun paid you" rather than "Arun paid You".
  const obj = (id) => (byId.get(id)?.isMe ? 'you' : name(id));
  return { byId, name, obj, active: state.members.filter((m) => !m.removed) };
}
