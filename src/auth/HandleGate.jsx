import { useEffect, useRef, useState } from 'react';
import { Brand, WorldBanner } from '../components/WorldBanner.jsx';
import { checkHandle, claimHandle, loadProfile } from '../data/profiles.js';
import { handleError, normalizeHandle, suggestHandle } from '../lib/handles.js';

function HandleLayout({ title, auth, children }) {
  const heading = useRef(null);
  useEffect(() => { heading.current?.focus(); }, [title]);
  return <section className="wrap auth-wrap" aria-labelledby="handle-title">
    <Brand />
    <WorldBanner title="A small introduction." subtitle="Your journal stays yours. Your handle helps friends find you." />
    <div className="card"><h1 id="handle-title" tabIndex={-1} ref={heading}>{title}</h1>{children}
      {auth.accountMessage && <p role="status" className="banner">{auth.accountMessage}</p>}
      <button className="pillbtn" disabled={auth.busy} onClick={auth.logout}>Log out</button>
    </div>
  </section>;
}

// Mounted only by AppGate after normal authentication, never during recovery.
// The parent keys this gate by UUID; account changes discard all pending state.
export function HandleGate({ auth, children }) {
  const [state, setState] = useState({ status: 'loading', profile: null });
  const [attempt, setAttempt] = useState(0);
  const pendingRead = useRef(null);
  useEffect(() => {
    let active = true;
    setState({ status: 'loading', profile: null });
    // Reuse the in-flight read during Strict Mode's effect replay.
    if (!pendingRead.current) pendingRead.current = loadProfile(auth.client, auth.session.user.id);
    pendingRead.current.then((profile) => {
      if (active) setState({ status: 'ready', profile });
    }, () => {
      if (active) setState({ status: 'error', profile: null });
    });
    return () => { active = false; };
  }, [auth.client, auth.session.user.id, attempt]);

  if (state.status === 'loading') return <HandleLayout title="Getting your journal ready" auth={auth}><p role="status">Checking your handle…</p></HandleLayout>;
  if (state.status === 'error') return <HandleLayout title="Unable to load your profile" auth={auth}>
    <p role="alert" className="sub">Your journal is safe. Check your connection and try again.</p>
    <button className="cta" onClick={() => { pendingRead.current = null; setAttempt((value) => value + 1); }}>Try again</button>
  </HandleLayout>;
  if (state.profile?.handle) return children(state.profile);
  return <HandleLayout title="Choose your handle" auth={auth}>
    <HandleForm client={auth.client} email={auth.session.user.email} disabled={auth.busy}
      onSaved={(profile) => setState({ status: 'ready', profile })} />
  </HandleLayout>;
}

export function HandleForm({ client, email, disabled = false, onSaved }) {
  const [handle, setHandle] = useState(() => suggestHandle(email));
  const [availability, setAvailability] = useState(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [checkAttempt, setCheckAttempt] = useState(0);
  const locked = useRef(false);
  const mounted = useRef(true);
  const validation = handleError(handle);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    if (validation) return undefined;
    const timer = window.setTimeout(async () => {
      try {
        const available = await checkHandle(client, handle);
        if (active) setAvailability({ handle, status: available ? 'available' : 'taken' });
      } catch {
        if (active) setAvailability({ handle, status: 'error' });
      }
    }, 350);
    return () => { active = false; window.clearTimeout(timer); };
  }, [client, handle, validation, checkAttempt]);

  const status = availability?.handle === handle ? availability.status : 'checking';
  async function submit(event) {
    event.preventDefault();
    if (locked.current || disabled || validation || status !== 'available') return;
    locked.current = true;
    setBusy(true);
    setMessage('');
    try {
      const profile = await claimHandle(client, handle);
      if (mounted.current) onSaved(profile);
    } catch (error) {
      if (mounted.current) setMessage(error.message);
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return <form onSubmit={submit} noValidate aria-busy={busy}>
    <p className="sub">This is how friends will find you. Edit the suggestion or choose your own before making it public.</p>
    <fieldset disabled={busy || disabled}>
      <div className="f"><label htmlFor="chosen-handle">Handle</label><span className="handle-input"><span aria-hidden="true">@</span><input id="chosen-handle" autoComplete="username" autoCapitalize="none" spellCheck={false} value={handle} aria-describedby="handle-help handle-status" onChange={(event) => {
        setHandle(normalizeHandle(event.target.value)); setAvailability(null); setMessage('');
      }} /></span></div>
      <p id="handle-help" className="tiny">3–24 letters, numbers or underscores. Letters are saved in lowercase. Your email stays private.</p>
      <p id="handle-status" className="handle-status" role="status">{validation || (status === 'available' ? `✓ @${handle} is available` : status === 'taken' ? `@${handle} is already taken` : status === 'error' ? 'Unable to check availability. Please try again.' : 'Checking…')}</p>
      {status === 'error' && !validation && <button type="button" className="pillbtn" onClick={() => { setAvailability(null); setCheckAttempt((value) => value + 1); }}>Check again</button>}
      {message && <p role="alert" className="banner">{message}</p>}
      <button className="cta" type="submit" disabled={!!validation || status !== 'available'}>{busy ? 'Saving…' : 'Continue'}</button>
    </fieldset>
  </form>;
}
