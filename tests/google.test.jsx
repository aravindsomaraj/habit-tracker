import React, { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/app/App.jsx';
import { createAuthStorage } from '../src/data/authStorage.js';

const mock = vi.hoisted(() => ({ client: null, renders: vi.fn() }));
vi.mock('../src/data/supabase.js', () => ({ getSupabaseClient: () => mock.client }));
vi.mock('../src/app/TrackerApp.jsx', () => ({ TrackerApp: ({ auth }) => {
  mock.renders(auth.session.user.id);
  return <button onClick={auth.logout}>Log out {auth.session.user.id}</button>;
} }));
let listeners;
function emit(event, session) { for (const listener of listeners) listener(event, session); }
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  window.history.replaceState({}, '', '/');
  listeners = new Set();
  mock.renders.mockClear();
  mock.client = { auth: {
    initialize: vi.fn(async () => ({ error: null })),
    getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
    onAuthStateChange: vi.fn((listener) => { listeners.add(listener); return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } }; }),
    signInWithOAuth: vi.fn(async () => ({ data: { url: 'https://project.example/auth/v1/authorize?provider=google' }, error: null })),
    signInWithPassword: vi.fn(),
    signOut: vi.fn(async () => { emit('SIGNED_OUT', null); return { error: null }; }),
  } };
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks();
  localStorage.clear(); sessionStorage.clear();
  window.history.replaceState({}, '', '/');
});
async function ready() {
  render(<StrictMode><App /></StrictMode>);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in with Google' }).matches(':disabled')).toBe(false));
}

describe('Google initiation in the central auth lifecycle', () => {
  it.each([false, true])('works without password fields, shares the busy lock, and recovers on browser Back (signup: %s)', async (signup) => {
    window.history.replaceState({}, '', '/index.html#/today');
    await ready();
    if (signup) fireEvent.click(screen.getByRole('button', { name: 'Create an account' }));
    const google = screen.getByRole('button', { name: 'Sign in with Google' });
    fireEvent.click(google);
    fireEvent.click(google);
    fireEvent.submit(google.closest('form'));
    expect(mock.client.auth.signInWithOAuth).toHaveBeenCalledTimes(1);
    expect(mock.client.auth.signInWithOAuth).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: `${window.location.origin}/index.html?oauth=google` } });
    expect(mock.client.auth.signInWithPassword).not.toHaveBeenCalled();
    expect(screen.getByText('Opening Google sign-in…')).toBeTruthy();
    expect(google.matches(':disabled')).toBe(true);
    await act(async () => {});
    expect(google.matches(':disabled')).toBe(true);
    const event = new Event('pageshow');
    Object.defineProperty(event, 'persisted', { value: true });
    fireEvent(window, event);
    expect(google.matches(':disabled')).toBe(false);
    expect(listeners.size).toBe(1);
    cleanup();
    expect(listeners.size).toBe(0);
  });

  it.each(['supabase', 'network'])('unlocks the form after a %s initiation failure', async (kind) => {
    if (kind === 'supabase') mock.client.auth.signInWithOAuth.mockResolvedValue({ error: { message: 'Provider disabled' } });
    else mock.client.auth.signInWithOAuth.mockRejectedValue(new TypeError('Failed to fetch'));
    await ready();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    expect(await screen.findByText(/Unable to start Google sign-in/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in with Google' }).matches(':disabled')).toBe(false);
    expect(screen.getByRole('button', { name: 'Log in' }).matches(':disabled')).toBe(false);
  });

  it('waits for initialization and ignores late old-session events on a failed return', async () => {
    const initialization = deferred();
    mock.client.auth.initialize.mockReturnValue(initialization.promise);
    window.history.replaceState({}, '', '/?oauth=google#error=access_denied');
    render(<StrictMode><App /></StrictMode>);
    const previous = { user: { id: 'previous' } };
    act(() => emit('INITIAL_SESSION', previous));
    expect(mock.renders).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Sign in with Google' }).matches(':disabled')).toBe(true);
    await act(async () => initialization.resolve({ error: null }));
    expect(await screen.findByText(/Google sign-in was cancelled/)).toBeTruthy();
    act(() => emit('SIGNED_IN', previous));
    expect(mock.renders).not.toHaveBeenCalled();
    expect(screen.getByText(/Google sign-in was cancelled/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with Google' }));
    await act(async () => {});
    act(() => emit('SIGNED_IN', previous));
    expect(mock.renders).not.toHaveBeenCalled();
  });

  it('uses the existing logout for a Google session and clears the tracker', async () => {
    await ready();
    act(() => emit('SIGNED_IN', { user: { id: 'google-user', app_metadata: { provider: 'google' } } }));
    fireEvent.click(screen.getByRole('button', { name: 'Log out google-user' }));
    expect(await screen.findByText('You have logged out.')).toBeTruthy();
    expect(mock.client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(screen.getByText('Welcome back')).toBeTruthy();
  });
});

describe('Supabase session storage without Google API credentials', () => {
  it('keeps Supabase credentials, removes provider tokens, and cleans previously saved sessions', () => {
    const storage = createAuthStorage();
    const session = { access_token: 'supabase-access', refresh_token: 'supabase-refresh', user: { id: 'user' }, provider_token: 'google-access', provider_refresh_token: 'google-refresh' };
    localStorage.setItem('auth', JSON.stringify(session));
    const expected = { access_token: 'supabase-access', refresh_token: 'supabase-refresh', user: { id: 'user' } };
    expect(JSON.parse(storage.getItem('auth'))).toEqual(expected);
    expect(JSON.parse(localStorage.getItem('auth'))).toEqual(expected);
    storage.setItem('auth', JSON.stringify(session));
    expect(JSON.parse(localStorage.getItem('auth'))).toEqual(expected);
    storage.removeItem('auth');
    expect(localStorage.getItem('auth')).toBeNull();
    storage.setItem('sdk-value', 'non-json-value');
    expect(storage.getItem('sdk-value')).toBe('non-json-value');
  });

  it('keeps session operations usable in memory when browser storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Blocked'); });
    const storage = createAuthStorage();
    storage.setItem('auth', JSON.stringify({ access_token: 'supabase', provider_token: 'google' }));
    expect(JSON.parse(storage.getItem('auth'))).toEqual({ access_token: 'supabase' });
    storage.removeItem('auth');
    expect(storage.getItem('auth')).toBeNull();
  });
});
