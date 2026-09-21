import { AuthProvider, useAuth } from '../auth/AuthContext.jsx';
import { HashRouter } from 'react-router';
import { AuthScreen } from '../auth/AuthScreen.jsx';
import { TrackerApp } from './TrackerApp.jsx';

function AppGate() {
  const auth = useAuth();
  if (auth.status !== 'signedIn' || !auth.session) return <AuthScreen />;
  return <TrackerApp key={auth.session.user.id} auth={auth} />;
}

export default function App() {
  return <HashRouter><AuthProvider><AppGate /></AuthProvider></HashRouter>;
}
