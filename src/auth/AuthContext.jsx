import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { usePasswordRecovery } from './usePasswordRecovery.js';
import { getSupabaseClient } from '../data/supabase.js';
import { RECOVERY_SUCCESS } from './recovery.js';
import { cleanGoogleReturn, googleRedirect, googleReturn, googleReturnMessage } from './google.js';

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
  const [oauthCallback] = useState(googleReturn);
  const oauthPending = useRef(!!oauthCallback);

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

  const recoveryComplete = useCallback(() => {
    // Set this after local signOut resolves, so SIGNED_OUT cannot erase it.
    revision.current += 1;
    applySession(null);
    setMessage(RECOVERY_SUCCESS);
  }, [applySession]);
  const recovery = usePasswordRecovery(client, recoveryComplete);
  const { onAuth: onRecoveryAuth, restore: restoreRecovery, initializationFailed } = recovery;

  useEffect(() => {
    mounted.current = true;
    let active = true;
    let authSubscription;
    let latestSession;
    const slow = window.setTimeout(() => {
      if (active && !sessionKnown.current) setMessage('Still checking your session. Check your connection and reload if this continues.');
    }, 15000);
    try {
      const authClient = getSupabaseClient();
      setClient(authClient);
      const listener = authClient.auth.onAuthStateChange((event, nextSession) => {
        if (!active) return;
        if (!onRecoveryAuth(event, nextSession)) return;
        latestSession = nextSession;
        revision.current += 1;
        // Do not let INITIAL_SESSION restore a previous account while an OAuth
        // return is still being validated (including cancellation/error URLs).
        if (!oauthPending.current) applySession(nextSession);
      });
      authSubscription = listener.data.subscription;
      const readRevision = revision.current;
      authClient.auth.initialize().then(async (initialization) => {
        if (!active) return;
        if (initialization.error) initializationFailed();
        const result = await authClient.auth.getSession();
        if (!active) return;
        await restoreRecovery(readRevision === revision.current ? result.data?.session : latestSession, authClient, initialization.error || result.error);
        if (!active) return;
        if (oauthPending.current) {
          cleanGoogleReturn();
          if (oauthCallback.error || !oauthCallback.complete || initialization.error || result.error || !result.data?.session?.user) {
            applySession(null);
            setMessage(googleReturnMessage(oauthCallback));
            // Keep late INITIAL_SESSION/SIGNED_IN events from overriding the
            // failed return. Password sign-in or a fresh OAuth return releases it.
          } else {
            oauthPending.current = false;
            applySession(readRevision === revision.current ? result.data.session : latestSession);
          }
          return;
        }
        if (!active || readRevision !== revision.current) return;
        if (result.error) throw result.error;
        applySession(result.data.session);
      }).catch((error) => {
        if (!active) return;
        initializationFailed();
        if (oauthPending.current) {
          cleanGoogleReturn();
          applySession(null);
          setMessage(googleReturnMessage(oauthCallback));
          return;
        }
        if (userIdRef.current) return;
        setStatus('error');
        setMessage(error.message || 'Unable to restore your session. Reload to try again.');
      }).finally(() => window.clearTimeout(slow));
    } catch (error) {
      initializationFailed();
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
  }, [applySession, onRecoveryAuth, restoreRecovery, initializationFailed, oauthCallback]);

  useEffect(() => {
    // Back from Google's page can restore a frozen document with busy=true.
    function resume(event) {
      if (!event.persisted) return;
      busyRef.current = false;
      setBusy(false);
      setMessage('');
    }
    window.addEventListener('pageshow', resume);
    return () => window.removeEventListener('pageshow', resume);
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (busyRef.current || !client || status === 'checking' || recovery.state !== 'none') return;
    busyRef.current = true;
    setBusy(true);
    setMessage('Opening Google sign-in…');
    try {
      const result = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: googleRedirect() } });
      if (result.error || !result.data?.url) throw result.error || new Error('Missing OAuth destination');
      // The SDK navigates; retain the lock until navigation or a BFCache return.
    } catch {
      busyRef.current = false;
      if (mounted.current) {
        setBusy(false);
        setMessage('Unable to start Google sign-in. Please try again or sign in with email.');
      }
    }
  }, [client, status, recovery.state]);

  const authenticate = useCallback(async ({ signup, email, password }) => {
    if (busyRef.current || !client) return { ok: false };
    busyRef.current = true;
    oauthPending.current = false;
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
  return <AuthContext.Provider value={{ client, session, status, message, accountMessage, busy, recovery, authenticate, signInWithGoogle, logout, clearMessage }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}
