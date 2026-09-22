// Matches supabase/config.toml; the hosted Auth service remains authoritative.
export const MIN_PASSWORD_LENGTH = 6;
export const passwordError = (password) => password.length < MIN_PASSWORD_LENGTH ? `Use at least ${MIN_PASSWORD_LENGTH} characters.` : '';
export const RECOVERY_KEY = 'habit-tracker.password-recovery';
export const RECOVERY_SUCCESS = 'Password updated successfully. Sign in with your new password.';

export function recoveryRedirect() {
  return `${window.location.origin}${window.location.pathname}?recovery=1`;
}

export function recoveryLocation() {
  const url = new URL(window.location.href);
  const hash = new URLSearchParams(url.hash.slice(1));
  // Match Supabase's parser: query parameters take precedence over the hash.
  const params = new URLSearchParams(hash);
  url.searchParams.forEach((value, key) => params.set(key, value));
  const callback = ['access_token', 'refresh_token', 'error', 'error_code', 'error_description', 'code'].some((key) => params.has(key));
  const type = params.get('type');
  return {
    requested: url.searchParams.has('recovery') || type === 'recovery' || !!readRecovery()
      || url.pathname === '/reset-password' || url.hash.split('?')[0] === '#/reset-password'
      || (callback && (!type || params.has('error') || params.has('error_code'))),
    callback,
    // A URL marker is never proof. Only PASSWORD_RECOVERY authorizes the form.
    recoveryCallback: type === 'recovery' && ['access_token', 'refresh_token', 'expires_in', 'token_type'].every((key) => !!params.get(key)),
  };
}

// This is a UI continuation marker, never a reset credential. Supabase validates
// the actual session. Bind it to a session ID so another login cannot reuse it.
export function sessionIdentity(session) {
  try {
    const part = session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(part)).session_id || null;
  } catch { return null; }
}
export function readRecovery() {
  try { return JSON.parse(sessionStorage.getItem(RECOVERY_KEY)); } catch { return null; }
}
export function saveRecovery(marker) {
  try {
    if (marker) sessionStorage.setItem(RECOVERY_KEY, JSON.stringify(marker));
    else sessionStorage.removeItem(RECOVERY_KEY);
  } catch { /* Storage blocked: recovery still works without refresh continuation. */ }
}
export function cleanRecoveryUrl(keepRecovery = false) {
  const url = new URL(window.location.href);
  for (const key of ['recovery', 'access_token', 'refresh_token', 'expires_in', 'expires_at', 'token_type', 'type', 'error', 'error_code', 'error_description', 'code']) url.searchParams.delete(key);
  if (keepRecovery) url.searchParams.set('recovery', '1');
  url.hash = '';
  window.history.replaceState(window.history.state, '', url);
}
