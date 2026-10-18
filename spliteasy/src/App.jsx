import { useCallback, useEffect, useState } from 'react';
import { auth } from './lib/api';
import { match, useRoute } from './lib/router';
import { Spinner } from './components/ui.jsx';
import { StatusBars } from './components/AppBars.jsx';
import { useOnline } from './lib/pwa';
import { lastUser, rememberUser, setCacheOwner } from './lib/offlineCache';
import AuthScreen from './screens/AuthScreen.jsx';
import ResetScreen from './screens/ResetScreen.jsx';
import GroupsScreen from './screens/GroupsScreen.jsx';
import NewGroupScreen from './screens/NewGroupScreen.jsx';
import GroupScreen from './screens/GroupScreen.jsx';
import ExpenseScreen from './screens/ExpenseScreen.jsx';
import PaymentScreen from './screens/PaymentScreen.jsx';
import JoinScreen from './screens/JoinScreen.jsx';
import AccountScreen from './screens/AccountScreen.jsx';

export default function App() {
  return (
    <>
      <StatusBars />
      <Screens />
    </>
  );
}

function Screens() {
  const [user, setUserState] = useState(undefined); // undefined = still checking
  const [error, setError] = useState('');
  const [fromCache, setFromCache] = useState(false); // opened offline as the last signed-in user
  const { path, query } = useRoute();
  const online = useOnline();

  const setUser = useCallback((u) => {
    setCacheOwner(u?.id);
    rememberUser(u);
    setUserState(u);
  }, []);

  const checkSession = useCallback(() => {
    setError('');
    auth('me')
      .then((d) => {
        setFromCache(false);
        setUser(d.user);
      })
      .catch((e) => {
        // No connection: carry on as the last signed-in user and show their cached data.
        const cached = e.status === 0 ? lastUser() : null;
        if (cached) {
          setCacheOwner(cached.id);
          setFromCache(true);
          setUserState(cached);
        } else setError(e.message);
      });
  }, [setUser]);

  useEffect(() => {
    checkSession();
    const out = () => setUser(null);
    window.addEventListener('spliteasy:signed-out', out);
    return () => window.removeEventListener('spliteasy:signed-out', out);
  }, [checkSession, setUser]);

  // Opened without a connection: confirm the session as soon as we're back online.
  useEffect(() => {
    if (online && ((error && user === undefined) || fromCache)) checkSession();
  }, [online, error, user, fromCache, checkSession]);

  if (error && user === undefined) {
    return (
      <div className="wrap center-page">
        <span className="empty-emoji" aria-hidden>
          {online ? '⚠️' : '📡'}
        </span>
        {online ? (
          <p className="error">{error}</p>
        ) : (
          <p>
            <strong>You're offline.</strong>
            <br />
            <span className="muted">SplitEasy will load as soon as you're connected.</span>
          </p>
        )}
        <button className="btn" onClick={checkSession}>
          Try again
        </button>
      </div>
    );
  }
  if (user === undefined) return <Spinner />;

  if (match('/reset', path)) return <ResetScreen token={query.get('token') ?? ''} onUser={setUser} />;
  if (!user) return <AuthScreen onUser={setUser} joining={path.startsWith('/join/')} />;

  let p;
  if ((p = match('/', path)) || (p = match('', path))) return <GroupsScreen user={user} />;
  if ((p = match('/new', path))) return <NewGroupScreen user={user} />;
  if ((p = match('/account', path))) return <AccountScreen user={user} onUser={setUser} />;
  if ((p = match('/join/:token', path))) return <JoinScreen token={p.token} user={user} />;
  if ((p = match('/g/:id', path))) return <GroupScreen id={Number(p.id)} tab={query.get('tab') ?? 'expenses'} user={user} />;
  if ((p = match('/g/:id/expense/new', path))) return <ExpenseScreen groupId={Number(p.id)} user={user} />;
  if ((p = match('/g/:id/expense/:eid', path))) {
    return <ExpenseScreen groupId={Number(p.id)} expenseId={Number(p.eid)} user={user} />;
  }
  if ((p = match('/g/:id/pay', path))) return <PaymentScreen groupId={Number(p.id)} query={query} user={user} />;
  return <GroupsScreen user={user} />;
}
