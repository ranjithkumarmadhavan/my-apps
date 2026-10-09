import { useEffect, useState } from 'react';
import { auth } from './lib/api';
import { match, useRoute } from './lib/router';
import { Spinner } from './components/ui.jsx';
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
  const [user, setUser] = useState(undefined); // undefined = still checking
  const [error, setError] = useState('');
  const { path, query } = useRoute();

  useEffect(() => {
    auth('me')
      .then((d) => setUser(d.user))
      .catch((e) => setError(e.message));
    const out = () => setUser(null);
    window.addEventListener('spliteasy:signed-out', out);
    return () => window.removeEventListener('spliteasy:signed-out', out);
  }, []);

  if (error && user === undefined) {
    return (
      <div className="wrap center-page">
        <p className="error">{error}</p>
        <button className="btn" onClick={() => window.location.reload()}>
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
