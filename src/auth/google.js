import { recoveryLocation } from './recovery.js';

export function googleRedirect() {
  // The document exists on Pages; no server-side route or hash callback needed.
  return `${window.location.origin}${window.location.pathname}?oauth=google`;
}

export function googleReturn() {
  const url = new URL(window.location.href);
  if (url.searchParams.get('oauth') !== 'google' || recoveryLocation().requested) return null;
  const params = new URLSearchParams(url.hash.slice(1));
  url.searchParams.forEach((value, key) => params.set(key, value));
  // Capture classification before Supabase consumes the URL, never credentials.
  return {
    error: params.has('error') || params.has('error_code') || params.has('error_description'),
    cancelled: params.get('error') === 'access_denied',
    complete: ['access_token', 'refresh_token', 'expires_in', 'token_type'].every((key) => !!params.get(key)),
  };
}

export function cleanGoogleReturn() {
  const url = new URL(window.location.href);
  for (const key of ['oauth', 'access_token', 'refresh_token', 'provider_token', 'provider_refresh_token', 'expires_in', 'expires_at', 'token_type', 'type', 'error', 'error_code', 'error_description', 'code']) url.searchParams.delete(key);
  if (!url.hash.startsWith('#/')) url.hash = '';
  window.history.replaceState(window.history.state, '', url);
}

export function googleReturnMessage(callback) {
  return callback?.cancelled
    ? 'Google sign-in was cancelled. Try again or sign in with email.'
    : 'Google sign-in could not be completed. Try again or sign in with email.';
}
