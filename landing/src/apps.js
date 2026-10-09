// Register new apps here. `path` is where the app is served on the site.
// In dev each app runs on its own Vite server, so `devUrl` points there.

export const CATEGORIES = [
  { id: 'money', label: 'Money', emoji: '💸', blurb: 'Split bills and keep track of who owes what.' },
  { id: 'productivity', label: 'Productivity', emoji: '✅', blurb: 'Get things done with less fuss.' },
  { id: 'travel', label: 'Travel', emoji: '🧳', blurb: 'Plan trips and keep everyone on the same page.' },
  { id: 'utilities', label: 'Utilities', emoji: '🧰', blurb: 'Handy little tools for everyday jobs.' },
];

export const APPS = [
  {
    id: 'spliteasy',
    title: 'SplitEasy',
    category: 'money',
    tagline: 'Share expenses on trips and outings. See who owes whom, then settle up with GPay, PhonePe or CRED.',
    tags: ['Groups', 'Any currency', 'UPI'],
    icon: '/spliteasy/favicon.svg',
    path: '/spliteasy/',
    devUrl: 'http://localhost:5174/spliteasy/',
  },
];

export const appUrl = (app) => (import.meta.env.DEV ? app.devUrl : app.path);
export const appIcon = (app) => (import.meta.env.DEV ? new URL('favicon.svg', app.devUrl).href : app.icon);
