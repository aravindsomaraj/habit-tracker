import { useState } from 'react';
import { useAuth } from './AuthContext.jsx';

export function AuthScreen() {
  const { authenticate, busy, client, status, message, clearMessage } = useAuth();
  const [signup, setSignup] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function submit(event) {
    event.preventDefault();
    const result = await authenticate({ signup, email, password });
    if (result.clearPassword) setPassword('');
  }

  function switchMode() {
    if (busy) return;
    setSignup((current) => !current);
    setPassword('');
    clearMessage();
  }

  return <section className="wrap auth-wrap" aria-labelledby="authTitle">
    <div className="card">
      <div className="logo"><span className="mark">🔥</span> Habit Tracker</div>
      <h1 id="authTitle">{signup ? 'Create your account' : 'Welcome back'}</h1>
      <p className="sub">{signup ? 'Sign up with your email and a password.' : 'Log in to your account.'}</p>
      <p className="banner" role="status" aria-live="polite" hidden={!message}>{message}</p>
      <form onSubmit={submit}>
        <fieldset disabled={busy || !client || status === 'checking'}>
          <label className="f"><span>Email</span><input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label className="f"><span>Password</span><input type="password" autoComplete={signup ? 'new-password' : 'current-password'} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <button className="cta" type="submit">{signup ? 'Sign up' : 'Log in'}</button>
          <button className="pillbtn" type="button" onClick={switchMode}>{signup ? 'Already have an account? Log in' : 'Create an account'}</button>
        </fieldset>
      </form>
      <noscript>Enable JavaScript to sign in and use Habit Tracker.</noscript>
    </div>
  </section>;
}
