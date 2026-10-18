# my-apps

Personal utility apps (not games). Games live in the separate `my-games` repo
(`../blink-and-draw` locally, deployed to games.ranjithkumarmadhavan.com).

## How Ranjith likes to work

- Discuss the idea and agree on a plan **before** writing code. When asked "just tell me the idea", don't code.
- Ask clarifying questions in one batch, with a recommended default for each.
- Build, then test it running in the browser (desktop + phone width) before reporting back.
- **Deploy only after Ranjith approves** the UI and flow. Commit/push only when asked.
- Must work in Chrome on desktop and mobile. Android = the same web app installed as a PWA and published to Play as a Trusted Web Activity (TWA) wrapper; no separate native code.

## Stack conventions (same as my-games)

- React + Vite, one folder per app, npm workspaces at the root.
- Backend when needed: a small PHP API + MySQL on Hostinger (shared hosting; no WebSockets, so poll ~1s if live updates are needed).
- No PHP locally: add a Vite dev-server middleware that mocks the PHP API in memory (see `my-games/hand-cricket/dev/mockApi.js` for the pattern), and keep the PHP and mock in sync.
- Secrets go in a server-only `config.php` (git-ignored, blocked with `.htaccess`); commit a `config.example.php`.
- Light + dark mode, 16px side gutters on phones, no horizontal scroll.

## Hosting (Hostinger, via the Hostinger connector)

- Account username: `u650774427`; main site `ranjithkumarmadhavan.com` is **WordPress — never touch its `public_html` root**.
- Existing subdomains: `portfolio.`, `test.`, `service.`, `games.` (each in `public_html/<name>`).
- Create a subdomain with `hosting_domains_create-website-subdomain` (`directory` = subdomain name).
- Create a database with `hosting_databases_create` (prefix `u650774427_` is added automatically; DB host from PHP is `localhost`). Existing DBs: two WordPress-era ones plus `u650774427_handcricket` — don't modify them.
- **Deploy by uploading built files one by one** with `hosting_files_generate-upload-url` + TUS (`POST` then `PATCH` to `{url}/{path}?override=true`). Uploads for a subdomain land in that subdomain's folder; nested paths work.
- **Do not use `hosting_websites_deploy-static-site-archive`** — it wipes the target folder, and on a subdomain it's unclear which root it resolves to (risk of deleting the WordPress site).
- Stale files can be deleted with `DELETE {url-without-/tus}/resources/<path>` using the same `X-Auth` / `X-Auth-Rest` headers. Only delete files you uploaded.
- After deploying, verify by fetching a string that's actually in the new files (a 200 alone isn't proof).

## apps.ranjithkumarmadhavan.com + SplitEasy — v1 live (deployed 2026-10-09)

Deployed to `public_html/apps` (subdomain `apps`), DB `u650774427_apps` (also existing now — don't recreate). Server-only `api/config.php` was uploaded from a scratch copy; it is not in the repo, so to change it, rebuild it from `config.example.php` (DB password: reset it in hPanel if lost). Redeploy = `npm run build`, get fresh credentials (`hosting_files_generate-upload-url`, they expire after a few hours) into a JSON file in the scratchpad, then `node scripts/hostinger-upload.mjs <creds.json> dist/<file>=<file> ...` (uploads assets first and the `index.html` files last; `--delete <remote>` removes stale hashed assets). Upload each file in `dist/` with the TUS flow (don't overwrite `api/config.php` unless changing it). No SQL tool in the Hostinger connector: for one-off DB fixes, upload a randomly named PHP script into `api/` that requires `lib/bootstrap.php`, run it once, then DELETE it.

Layout: `landing/` (site root; `public/api/` = shared `auth.php` + `lib/bootstrap.php`), `spliteasy/` (base `/spliteasy/`, PHP in `public/api/index.php`, dev mock in `dev/mockApi.js` covering both APIs, money maths in `src/lib/money.js` mirrored by PHP `allocate`). `npm run dev` → landing :5173, SplitEasy :5174 (seeded test login `demo@spliteasy.test` / `demo1234`). `npm run build` → `dist/` mirrors the server folder for the `apps` subdomain. Tables are created automatically on first request (`migrate()`; append-only step lists). PHP is not available locally, so the PHP has not been run yet; test it on the server first.

Before deploy: create `apps` subdomain + `u650774427_apps` DB, write `api/config.php` on the server (`noreply@ranjithkumarmadhavan.com` mailbox exists, created 2026-10-09), Google OAuth Web client ID is created (project "Apps by Ranjith"; origins: apps subdomain, http://localhost:5174, http://localhost). It's in `spliteasy/.env` for dev and goes in `config.php` as `google_client_id` on the server. Privacy policy: `landing/public/privacy.html`.

Decisions:

- Subdomain `apps.ranjithkumarmadhavan.com` gets a **landing page with app categories**; SplitEasy (Splitwise-style expense splitter) lives at **`/spliteasy`**.
- **Real sign-in required** (email + password) **plus Google SSO**.
- **All currencies**, default INR.
- **Multiple payers per expense.** People without an account are added by name inside a group (trip/activity) and logs go against that name; they can later be linked to a real account.
- **Settle-up "Pay" buttons for GPay, PhonePe, CRED** (UPI deep links only; no money moves through the app).
- **Shared "apps account"**: auth API at `/api/auth.php` (site root, source in `landing/public/api/`), session cookie on path `/`, so future apps reuse it. Shared DB for all apps; SplitEasy tables prefixed `se_`.
- Currencies: balances **kept separate per currency**; optional manual exchange rates per group give a combined view in the group currency.
- Landing categories: Money (SplitEasy), Productivity, Travel, Utilities, each with "Coming soon" cards. **No link to the games site.**
- Groups only (no one-to-one expenses outside a group). Receipt photos are v2.
- Forgot-password emails go out with PHP `mail()` from a Hostinger mailbox (e.g. `noreply@ranjithkumarmadhavan.com`), which Ranjith creates in hPanel.
- **Android / Play Store (in progress, 2026-10):** Play Console personal account is set up and verified (identity, phone, device). Built in two rounds:
  - **Round A (live since 2026-10-18):** PWA (manifest, icons, service worker caching the app shell only; "New version available → Refresh" bar; install banner on the groups list + button on the account page), **account deletion**, and **offline viewing**: last-loaded groups/balances are kept on the device (IndexedDB, per user, cleared on sign-out) and shown instantly with a "Last synced" note. Then wrap as a TWA and start the 12-tester / 14-day closed test.
  - **Round B (later):** offline changes for expenses (add/edit/delete), payments and adding people by name, via a local queue synced on reconnect with client-generated IDs so retries never duplicate. On an edit conflict, show a "Needs your attention" card to keep mine or keep theirs. Signing in, joining, creating groups, settings and account deletion stay online-only.
- **Account deletion:** allowed even with unsettled balances. The user's member rows become name-only guests (UPI removed) so others' balances stay intact. Groups they own pass to another member with an account, or are deleted if none. Public instructions page `delete-account.html` for the Play listing.
- Core features from the original idea still apply: split equal / exact / shares / percentages, live balances, fewest-payments settle-up, record payments, activity log, CSV export, integer minor units, fair rounding, version check for concurrent edits, green/red money look, dark mode.
