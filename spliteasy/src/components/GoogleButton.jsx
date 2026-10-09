import { useEffect, useRef, useState } from 'react';
import { auth } from '../lib/api';

// "Continue with Google" via Google Identity Services. Hidden when the server has no client ID.
let scriptPromise;
const loadScript = () =>
  (scriptPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  }));

export default function GoogleButton({ onUser, onError }) {
  const ref = useRef(null);
  const [clientId, setClientId] = useState('');
  const handlers = useRef({ onUser, onError });
  handlers.current = { onUser, onError };

  useEffect(() => {
    auth('config')
      .then((c) => setClientId(c.googleClientId || ''))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !ref.current) return;
        const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        window.google.accounts.id.initialize({
          client_id: clientId,
          callback: async ({ credential }) => {
            try {
              const d = await auth('google', { credential });
              handlers.current.onUser(d.user);
            } catch (e) {
              handlers.current.onError(e.message);
            }
          },
        });
        window.google.accounts.id.renderButton(ref.current, {
          theme: dark ? 'filled_black' : 'outline',
          size: 'large',
          shape: 'pill',
          text: 'continue_with',
          width: Math.min(ref.current.offsetWidth || 320, 400),
        });
      })
      .catch(() => handlers.current.onError("Couldn't load Google sign-in."));
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  if (!clientId) return null;
  return (
    <>
      <div ref={ref} className="google-btn" />
      <div className="divider">
        <span>or</span>
      </div>
    </>
  );
}
