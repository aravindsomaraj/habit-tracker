import { AuthProvider, useAuth } from '../auth/AuthContext.jsx';
import { HashRouter } from 'react-router';
import { AuthScreen } from '../auth/AuthScreen.jsx';
import { RecoveryScreen } from '../auth/RecoveryScreen.jsx';
import { TrackerApp } from './TrackerApp.jsx';

function AppGate() {
  const auth = useAuth();
  if (auth.recovery.state !== 'none') return <RecoveryScreen />;
  if (auth.status !== 'signedIn' || !auth.session) return <AuthScreen />;
  return <HashRouter><TrackerApp key={auth.session.user.id} auth={auth} /></HashRouter>;
}

export default function App() {
  return <AuthProvider><AppGate /></AuthProvider>;
}
