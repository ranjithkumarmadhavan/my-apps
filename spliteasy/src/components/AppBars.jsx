import { useState } from 'react';
import { applyUpdate, useInstall, useOnline, useUpdateReady } from '../lib/pwa';

/** Fixed bars shown over every screen: offline notice and "new version available". */
export function StatusBars() {
  const online = useOnline();
  const update = useUpdateReady();
  return (
    <>
      {!online && (
        <div className="status-bar offline" role="status">
          You're offline. Changes can't be saved until you reconnect.
        </div>
      )}
      {update && (
        <div className="status-bar update" role="status">
          <span>A new version of SplitEasy is ready.</span>
          <button className="btn small" onClick={applyUpdate}>
            Refresh
          </button>
        </div>
      )}
    </>
  );
}

const DISMISS_KEY = 'spliteasy:install-banner-dismissed';

function readDismissed() {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

/** Dismissible "Install the app" card for the groups list. */
export function InstallBanner() {
  const { mode, install } = useInstall();
  const [dismissed, setDismissed] = useState(readDismissed);
  if (dismissed || (mode !== 'prompt' && mode !== 'ios')) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // private mode: just hide it for this visit
    }
    setDismissed(true);
  };

  return (
    <section className="install-banner">
      <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" width="44" height="44" />
      <div className="install-text">
        <strong>Install SplitEasy</strong>
        <span>
          {mode === 'ios' ? (
            <>
              Tap <b>Share</b> then <b>Add to Home Screen</b>.
            </>
          ) : (
            'Opens from your home screen, like any app.'
          )}
        </span>
      </div>
      {mode === 'prompt' && (
        <button className="btn small primary" onClick={install}>
          Install
        </button>
      )}
      <button className="icon-btn" aria-label="Dismiss" onClick={dismiss}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
          <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      </button>
    </section>
  );
}

/** Permanent install section for the account page. */
export function InstallSection() {
  const { mode, install } = useInstall();
  return (
    <section className="stack card-section">
      <h2 className="h2">App</h2>
      {mode === 'installed' && <p className="muted small">SplitEasy is installed on this device. ✓</p>}
      {mode === 'prompt' && (
        <>
          <p className="muted small">Install SplitEasy to open it from your home screen, full screen, like any app.</p>
          <button className="btn" onClick={install}>
            Install app
          </button>
        </>
      )}
      {mode === 'ios' && (
        <p className="muted small">
          To install on iPhone or iPad: in Safari, tap <b>Share</b>, then <b>Add to Home Screen</b>.
        </p>
      )}
      {mode === 'unavailable' && (
        <p className="muted small">
          To install, open this page in Chrome and choose <b>Install app</b> (or <b>Add to Home screen</b>) from the ⋮ menu.
        </p>
      )}
    </section>
  );
}
