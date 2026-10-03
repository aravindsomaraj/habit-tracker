import { AuthProvider, useAuth } from '../auth/AuthContext.jsx';
import { HashRouter } from 'react-router';
import { AuthScreen } from '../auth/AuthScreen.jsx';
import { RecoveryScreen } from '../auth/RecoveryScreen.jsx';
import { TrackerApp } from './TrackerApp.jsx';
import { HandleGate } from '../auth/HandleGate.jsx';

function AppGate() {
  const auth = useAuth();
  if (auth.recovery.state !== 'none') return <RecoveryScreen />;
  if (auth.status !== 'signedIn' || !auth.session) return <AuthScreen />;
  return <HandleGate key={auth.session.user.id} auth={auth}>{(profile) => <HashRouter><TrackerApp auth={auth} profile={profile} /></HashRouter>}</HandleGate>;
}

export default function App() {
  return <AuthProvider><AppGate /></AuthProvider>;
}
