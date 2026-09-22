import { useCallback, useEffect, useRef, useState } from 'react';
import { cleanRecoveryUrl, passwordError, readRecovery, recoveryLocation, saveRecovery, sessionIdentity } from './recovery.js';

export function usePasswordRecovery(client, onComplete) {
  const [entry] = useState(recoveryLocation);
  const [state, setState] = useState(entry.requested ? 'checking' : 'none');
  const stateRef = useRef(state);
  const context = useRef(null);
  const currentSession = useRef(null);
  const completedSession = useRef(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const locked = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const change = useCallback((value) => { stateRef.current = value; setState(value); }, []);
  const invalidate = useCallback(() => {
    generation.current += 1;
    context.current = null;
    saveRecovery(null);
    cleanRecoveryUrl(true);
    change('invalid');
  }, [change]);
  const initializationFailed = useCallback(() => {
    if (stateRef.current === 'checking') invalidate();
  }, [invalidate]);
  const complete = useCallback(() => {
    completedSession.current = context.current?.sessionId;
    context.current = null;
    saveRecovery(null);
    cleanRecoveryUrl();
    onComplete();
    change('none');
  }, [change, onComplete]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; generation.current += 1; };
  }, []);
  useEffect(() => {
    // This timer expires an established recovery context; it never decides
    // whether initialization has completed or whether a callback is recovery.
    if (state !== 'ready') return;
    const delay = Math.max(0, context.current.expires - Date.now());
    const timer = window.setTimeout(invalidate, delay);
    return () => window.clearTimeout(timer);
  }, [state, invalidate]);

  // Called synchronously by the existing central subscription. Never await Auth
  // APIs inside onAuthStateChange (they may hold Supabase's session lock).
  const onAuth = useCallback((event, session) => {
    const sessionId = sessionIdentity(session);
    // Late notifications from the completed recovery session cannot reopen the
    // form or restore that session in the provider after local sign-out.
    if (sessionId && sessionId === completedSession.current) return false;
    if (stateRef.current === 'signingOut' && !session) {
      currentSession.current = null;
      return true;
    }
    const sessionChanged = session?.user?.id !== currentSession.current?.user?.id || sessionIdentity(session) !== sessionIdentity(currentSession.current);
    if (sessionChanged) generation.current += 1;
    currentSession.current = session;
    if (event === 'PASSWORD_RECOVERY' && session?.user) {
      if (context.current?.sessionId === sessionId && context.current?.userId === session.user.id) return true;
      generation.current += 1;
      context.current = { userId: session.user.id, sessionId: sessionIdentity(session), expires: Date.now() + 60 * 60 * 1000 };
      saveRecovery(context.current);
      cleanRecoveryUrl(true);
      setMessage('');
      change('ready');
    } else if (context.current && (!session || session.user.id !== context.current.userId || sessionIdentity(session) !== context.current.sessionId)) {
      invalidate();
    }
    return true;
  }, [change, invalidate]);

  const restore = useCallback(async (session, authClient, initializationError) => {
    if (stateRef.current !== 'checking') return;
    currentSession.current = session;
    if (initializationError) { invalidate(); return; }
    // initialize() exposes rejected callbacks that getSession() can hide behind
    // a previously stored login. A successful recovery callback still waits for
    // the SDK's queued PASSWORD_RECOVERY event. No timing-based fallback.
    if (entry.callback) {
      if (!entry.recoveryCallback) invalidate();
      return;
    }
    const marker = readRecovery();
    if (marker?.phase === 'signingOut' && !session) {
      context.current = marker;
      complete();
      return;
    }
    if (!marker?.sessionId || (marker.phase !== 'signingOut' && marker.expires <= Date.now()) || marker.userId !== session?.user?.id || marker.sessionId !== sessionIdentity(session)) {
      invalidate();
      return;
    }
    const version = generation.current;
    try {
      const result = await authClient.auth.getUser();
      if (!mounted.current || version !== generation.current) return;
      if (result.error || result.data.user?.id !== marker.userId) { invalidate(); return; }
      context.current = marker;
      change(marker.phase === 'signingOut' ? 'signingOut' : 'ready');
    } catch { if (mounted.current && version === generation.current) invalidate(); }
  }, [entry.callback, entry.recoveryCallback, change, invalidate, complete]);

  const signOutRecovery = async () => {
    const version = generation.current;
    try {
      const result = await client.auth.signOut({ scope: 'local' });
      if (!mounted.current || version !== generation.current) return;
      if (result.error) throw result.error;
      complete();
    } catch {
      if (mounted.current && version === generation.current) {
        setMessage('Your password was updated, but sign-out failed. Check your connection and try again.');
      }
    }
  };

  const updatePassword = async (password, confirmation) => {
    if (locked.current || stateRef.current !== 'ready') return false;
    const validation = passwordError(password) || (password !== confirmation ? 'Passwords do not match.' : '');
    if (validation) { setMessage(validation); return false; }
    const marker = context.current;
    if (!marker || marker.expires <= Date.now()) { invalidate(); return false; }
    locked.current = true;
    setBusy(true);
    setMessage('');
    const version = generation.current;
    try {
      const verified = await client.auth.getUser();
      if (!mounted.current || version !== generation.current) return false;
      if (verified.error) throw verified.error;
      if (verified.data.user?.id !== marker.userId || sessionIdentity(currentSession.current) !== marker.sessionId) {
        invalidate(); return false;
      }
      const result = await client.auth.updateUser({ password });
      if (!mounted.current || version !== generation.current) return false;
      if (result.error) throw result.error;
      // Keep the tracker gated until local sign-out succeeds. Persist this phase
      // so refreshing during a failed sign-out cannot reopen the password form.
      context.current = { ...marker, phase: 'signingOut' };
      saveRecovery(context.current);
      change('signingOut');
      await signOutRecovery();
      return true;
    } catch (error) {
      if (mounted.current && version === generation.current) {
        if ([401, 403].includes(error.status) || ['session_not_found', 'refresh_token_not_found'].includes(error.code)) invalidate();
        else setMessage(error.code === 'same_password' ? 'Choose a password different from your current password.' : error.code === 'weak_password' ? 'This password does not meet the account security requirements. Choose a stronger password.' : 'Unable to change your password. Check your connection and try again.');
      }
      return false;
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const finish = async () => {
    if (locked.current || stateRef.current !== 'signingOut') return;
    locked.current = true;
    setBusy(true);
    setMessage('');
    try { await signOutRecovery(); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  };
  return { state, busy, message, onAuth, restore, initializationFailed, updatePassword, finish };
}
