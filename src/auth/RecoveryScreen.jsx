import { useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext.jsx';
import { Brand, WorldBanner } from '../components/WorldBanner.jsx';
import { MIN_PASSWORD_LENGTH, recoveryRedirect } from './recovery.js';

const REQUEST_MESSAGE = "If an account exists for that email, we've sent a password reset link.";
// Shared across form mounts so Back / Forgot password cannot bypass the cooldown.
let nextRequestAt = 0;

export function RecoveryLayout({ title, children }) {
  const heading = useRef(null);
  useEffect(() => { heading.current?.focus(); }, [title]);
  return <section className="wrap auth-wrap" aria-labelledby="recoveryTitle">
    <Brand />
    <WorldBanner title="Good habits start with a small step." subtitle="Your progress, your pace. Pick up where you left off." />
    <div className="card"><h1 id="recoveryTitle" tabIndex={-1} ref={heading}>{title}</h1>{children}</div>
  </section>;
}

export function RecoveryRequest({ onBack, initialEmail = '', backLabel = 'Back to login' }) {
  const { client, status } = useAuth();
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);
  const lock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function submit(event) {
    event.preventDefault();
    if (lock.current || sent || !client) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setMessage('Enter a valid email address.'); return; }
    if (Date.now() < nextRequestAt) { setMessage('Please wait a minute before requesting another link.'); return; }
    lock.current = true;
    setBusy(true);
    setMessage('');
    nextRequestAt = Date.now() + 60000;
    try {
      const result = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: recoveryRedirect() });
      if (result.error) throw result.error;
      if (mounted.current) { setSent(true); setMessage(REQUEST_MESSAGE); }
    } catch (error) {
      if (mounted.current) {
        // Account-dependent Auth responses must not reveal whether a user exists.
        if (['user_not_found', 'email_not_confirmed', 'user_banned', 'over_email_send_rate_limit'].includes(error.code)) { setSent(true); setMessage(REQUEST_MESSAGE); }
        else setMessage(error.status === 429 ? 'Too many requests. Please wait a few minutes before trying again.' : 'Unable to send a reset link. Please wait a minute, check your connection, and try again.');
      }
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  return <RecoveryLayout title={sent ? 'Check your email' : 'Forgot password?'}>
    <p className="sub">{sent ? 'Check your inbox and spam folder. Delivery may take a few minutes.' : 'Enter your email and we’ll send you a password reset link.'}</p>
    <p className="banner" role="status" hidden={!message}>{message}</p>
    {!sent && <form onSubmit={submit} noValidate aria-busy={busy}>
      <fieldset disabled={busy || !client || status === 'checking'}>
        <label className="f"><span>Email</span><input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <button className="cta" type="submit">{busy ? 'Sending reset link…' : 'Send reset link'}</button>
      </fieldset>
    </form>}
    <button className="pillbtn" type="button" disabled={busy} onClick={onBack}>{backLabel}</button>
  </RecoveryLayout>;
}

export function RecoveryScreen() {
  const { recovery } = useAuth();
  const [request, setRequest] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  if (request && recovery.state === 'invalid') return <RecoveryRequest backLabel="Back" onBack={() => setRequest(false)} />;
  const title = recovery.state === 'signingOut' ? 'Password changed' : recovery.state === 'invalid' ? 'Reset link unavailable' : 'Set a new password';
  async function submit(event) {
    event.preventDefault();
    if (await recovery.updatePassword(password, confirmation)) { setPassword(''); setConfirmation(''); }
  }
  return <RecoveryLayout title={title}>
    {recovery.state === 'checking' && <p className="banner" role="status">Checking your reset link…</p>}
    {recovery.state === 'invalid' && <><p className="banner" role="alert">This reset link is invalid, expired, already used, or could not be verified. Request another link and check your connection.</p><button className="cta" onClick={() => setRequest(true)}>Request another password reset link</button></>}
    {recovery.state === 'signingOut' && <>
      <p className="banner" role="status">{recovery.message || (recovery.busy ? 'Password updated successfully. Signing out…' : 'Password updated successfully. Sign out to return to login.')}</p>
      <button className="cta" disabled={recovery.busy} onClick={recovery.finish}>{recovery.busy ? 'Signing out…' : 'Sign out and return to login'}</button>
    </>}
    {recovery.state === 'ready' && <>
      <p className="sub" id="passwordHelp">Use at least {MIN_PASSWORD_LENGTH} characters.</p>
      <p className="banner" role="alert" hidden={!recovery.message}>{recovery.message}</p>
      <form onSubmit={submit} noValidate aria-busy={recovery.busy}><fieldset disabled={recovery.busy}>
        <label className="f"><span>New password</span><input type="password" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} aria-describedby="passwordHelp" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <label className="f"><span>Confirm new password</span><input type="password" autoComplete="new-password" required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>
        <button className="cta" type="submit">{recovery.busy ? 'Changing password…' : 'Change password'}</button>
      </fieldset></form>
    </>}
  </RecoveryLayout>;
}
