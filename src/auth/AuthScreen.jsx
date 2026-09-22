import { useEffect, useRef, useState } from 'react';
import { RecoveryRequest } from './RecoveryScreen.jsx';
import { MIN_PASSWORD_LENGTH } from './recovery.js';
import { useAuth } from './AuthContext.jsx';
import { Brand, WorldBanner } from '../components/WorldBanner.jsx';

export function AuthScreen() {
  const { authenticate, busy, client, status, message, clearMessage } = useAuth();
  const [forgot, setForgot] = useState(false);
  const [signup, setSignup] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const titleRef = useRef(null);
  useEffect(() => { if (!forgot) titleRef.current?.focus(); }, [forgot, signup]);

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

  if (forgot) return <RecoveryRequest initialEmail={email} onBack={() => setForgot(false)} />;

  return <section className="wrap auth-wrap" aria-labelledby="authTitle">
    <Brand />
    <WorldBanner title="Good habits start with a small step." subtitle="Your progress, your pace. Pick up where you left off." />
    <div className="card">
      <h1 id="authTitle" tabIndex={-1} ref={titleRef}>{signup ? 'Create your account' : 'Welcome back'}</h1>
      <p className="sub">{signup ? 'Sign up with your email and a password.' : 'Log in to your account.'}</p>
      <p className="banner" role="status" aria-live="polite" hidden={!message}>{message}</p>
      <form onSubmit={submit}>
        <fieldset disabled={busy || !client || status === 'checking'}>
          <label className="f"><span>Email</span><input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label className="f"><span>Password</span><input type="password" minLength={signup ? MIN_PASSWORD_LENGTH : undefined} autoComplete={signup ? 'new-password' : 'current-password'} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          <button className="cta" type="submit">{signup ? 'Sign up' : 'Log in'}</button>
          {!signup && <button className="pillbtn" type="button" onClick={() => { setPassword(''); clearMessage(); setForgot(true); }}>Forgot password?</button>}
          <button className="pillbtn" type="button" onClick={switchMode}>{signup ? 'Already have an account? Log in' : 'Create an account'}</button>
        </fieldset>
      </form>
      <noscript>Enable JavaScript to sign in and use Habit Tracker.</noscript>
    </div>
  </section>;
}
