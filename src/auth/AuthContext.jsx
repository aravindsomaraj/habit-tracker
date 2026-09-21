import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { getSupabaseClient } from '../data/supabase.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [client, setClient] = useState(null);
  const [session, setSession] = useState(null);
  const [status, setStatus] = useState('checking');
  const [message, setMessage] = useState('Checking your session…');
  const [accountMessage, setAccountMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const revision = useRef(0);
  const accountRevision = useRef(0);
  const userIdRef = useRef(null);
  const sessionKnown = useRef(false);
  const mounted = useRef(true);

  const applySession = useCallback((nextSession) => {
    const firstSession = !sessionKnown.current;
    sessionKnown.current = true;
    const nextId = nextSession?.user?.id || null;
    if (nextId !== userIdRef.current) {
      accountRevision.current += 1;
      setMessage('');
      setAccountMessage('');
    }
    userIdRef.current = nextId;
    setSession(nextSession || null);
    setStatus(nextId ? 'signedIn' : 'signedOut');
    if (firstSession) setMessage('');
  }, []);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    let authSubscription;
    const slow = window.setTimeout(() => {
      if (active && !sessionKnown.current) setMessage('Still checking your session. Check your connection and reload if this continues.');
    }, 15000);
    try {
      const authClient = getSupabaseClient();
      setClient(authClient);
      const listener = authClient.auth.onAuthStateChange((_event, nextSession) => {
        if (!active) return;
        revision.current += 1;
        applySession(nextSession);
      });
      authSubscription = listener.data.subscription;
      const readRevision = revision.current;
      authClient.auth.getSession().then((result) => {
        if (!active || readRevision !== revision.current) return;
        if (result.error) throw result.error;
        applySession(result.data.session);
      }).catch((error) => {
        if (!active || userIdRef.current) return;
        setStatus('error');
        setMessage(error.message || 'Unable to restore your session. Reload to try again.');
      }).finally(() => window.clearTimeout(slow));
    } catch (error) {
      window.clearTimeout(slow);
      setStatus('error');
      setMessage(error.message || 'Unable to restore your session. Reload to try again.');
    }
    return () => {
      active = false;
      mounted.current = false;
      window.clearTimeout(slow);
      authSubscription?.unsubscribe();
    };
    // This effect intentionally owns the single auth subscription for this provider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applySession]);

  const authenticate = useCallback(async ({ signup, email, password }) => {
    if (busyRef.current || !client) return { ok: false };
    busyRef.current = true;
    setBusy(true);
    setMessage(signup ? 'Creating your account…' : 'Logging in…');
    try {
      const credentials = { email: email.trim(), password };
      if (signup) credentials.options = { emailRedirectTo: window.location.origin + window.location.pathname };
      const result = signup ? await client.auth.signUp(credentials) : await client.auth.signInWithPassword(credentials);
      if (result.error) throw result.error;
      if (signup && !result.data.session && !userIdRef.current) {
        setMessage('Check your email for a confirmation link, then return here to log in.');
      } else {
        setMessage('');
      }
      return { ok: true, clearPassword: true };
    } catch (error) {
      if (!userIdRef.current) setMessage(error.message || 'Sign-in failed. Please try again.');
      return { ok: false };
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [client]);

  const logout = useCallback(async () => {
    if (busyRef.current || !client) return;
    const currentRevision = accountRevision.current;
    busyRef.current = true;
    setBusy(true);
    setAccountMessage('Logging out…');
    try {
      const result = await client.auth.signOut({ scope: 'local' });
      if (userIdRef.current && currentRevision !== accountRevision.current) return;
      if (result.error) throw result.error;
      applySession(null);
      setMessage('You have logged out.');
    } catch (error) {
      if (userIdRef.current && currentRevision === accountRevision.current) {
        setAccountMessage(error.message || 'Logout failed. Please try again.');
      }
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [applySession, client]);

  const clearMessage = useCallback(() => setMessage(''), []);
  return <AuthContext.Provider value={{ client, session, status, message, accountMessage, busy, authenticate, logout, clearMessage }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}
