import { APPS, CATEGORIES, appIcon, appUrl } from './apps';

export default function App() {
  return (
    <div className="app">
      <header className="header wrap">
        <span className="brand">
          <img src="/favicon.svg" alt="" width="30" height="30" />
          Apps by Ranjith
        </span>
      </header>

      <main className="wrap main">
        <section className="hero">
          <h1>Small apps for everyday things.</h1>
          <p>Simple, focused tools that work on your phone and your laptop. Sign in once and use them all.</p>
        </section>

        <nav className="jump" aria-label="Categories">
          {CATEGORIES.map((c) => (
            <a key={c.id} href={`#${c.id}`} className="jump-chip">
              <span aria-hidden>{c.emoji}</span> {c.label}
            </a>
          ))}
        </nav>

        {CATEGORIES.map((c) => {
          const apps = APPS.filter((a) => a.category === c.id);
          return (
            <section key={c.id} id={c.id} className="category" aria-labelledby={`h-${c.id}`}>
              <div className="category-head">
                <h2 id={`h-${c.id}`}>
                  <span aria-hidden>{c.emoji}</span> {c.label}
                </h2>
                <p>{c.blurb}</p>
              </div>
              <ul className="grid">
                {apps.map((a) => (
                  <li key={a.id}>
                    <a className="card app-card" href={appUrl(a)}>
                      <img className="app-icon" src={appIcon(a)} alt="" width="52" height="52" />
                      <span className="app-body">
                        <span className="app-title">{a.title}</span>
                        <span className="app-tagline">{a.tagline}</span>
                        <span className="tags">
                          {a.tags.map((t) => (
                            <span key={t} className="tag">
                              {t}
                            </span>
                          ))}
                        </span>
                      </span>
                      <span className="open" aria-hidden>
                        Open →
                      </span>
                    </a>
                  </li>
                ))}
                <li>
                  <div className="card soon">
                    <span className="soon-icon" aria-hidden>
                      {c.emoji}
                    </span>
                    <span className="app-body">
                      <span className="app-title">Coming soon</span>
                      <span className="app-tagline">
                        {apps.length
                          ? `More ${c.label.toLowerCase()} apps are on the way.`
                          : 'New apps for this category are on the way.'}
                      </span>
                    </span>
                  </div>
                </li>
              </ul>
            </section>
          );
        })}
      </main>

      <footer className="wrap footer">
        © {new Date().getFullYear()} Ranjith Kumar Madhavan · <a href="/privacy.html">Privacy</a> · <a href="/delete-account.html">Delete account</a>
      </footer>
    </div>
  );
}
