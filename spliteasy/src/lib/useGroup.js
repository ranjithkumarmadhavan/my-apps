// Loads a group's full state and keeps it fresh: polls every few seconds while the tab is
// visible, but the server only sends data when the group's version has changed.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

const POLL_MS = 4000;

export function useGroup(id) {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const version = useRef(null);

  const load = useCallback(
    async (force = false) => {
      try {
        const d = await api('group', force || version.current === null ? { id } : { id, since: version.current });
        if (!d.unchanged) {
          version.current = d.group.version;
          setState(d);
        }
        setError('');
      } catch (e) {
        setError(e.message);
      }
    },
    [id],
  );

  useEffect(() => {
    version.current = null;
    setState(null);
    load(true);
    const t = setInterval(() => document.visibilityState === 'visible' && load(), POLL_MS);
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  return { state, error, reload: () => load(true) };
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
