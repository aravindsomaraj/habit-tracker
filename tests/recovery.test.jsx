import React, { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/app/App.jsx';
import { RECOVERY_KEY, RECOVERY_SUCCESS, recoveryRedirect } from '../src/auth/recovery.js';

const mock = vi.hoisted(() => ({ client: null }));
vi.mock('../src/data/supabase.js', () => ({ getSupabaseClient: () => mock.client }));
vi.mock('../src/app/TrackerApp.jsx', () => ({ TrackerApp: ({ auth }) => <><p>Tracker for {auth.session.user.id}</p><button onClick={auth.logout}>Log out</button></> }));
const session = (id = 'person', sid = 'session-1') => ({ user: { id }, access_token: `header.${btoa(JSON.stringify({ session_id: sid }))}.signature` });
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const recoveryUrl = '/?recovery=1#access_token=credential&refresh_token=refresh&expires_in=3600&token_type=bearer&type=recovery';
let now = Date.now();
function makeClient(initial = null) {
  const listeners = new Set();
  const unsubscribe = vi.fn();
  const client = {
    listeners, unsubscribe,
    emit(event, value) { for (const cb of listeners) cb(event, value); },
    auth: {
      initialize: vi.fn(async () => ({ error: null })),
      onAuthStateChange: vi.fn((cb) => { listeners.add(cb); return { data: { subscription: { unsubscribe: () => { listeners.delete(cb); unsubscribe(); } } } }; }),
      getSession: vi.fn(async () => ({ data: { session: initial }, error: null })),
      getUser: vi.fn(async () => ({ data: { user: session().user }, error: null })),
      resetPasswordForEmail: vi.fn(async () => ({ data: {}, error: null })),
      updateUser: vi.fn(async () => ({ data: { user: session().user }, error: null })),
      signOut: vi.fn(async () => { client.emit('SIGNED_OUT', null); return { error: null }; }),
    },
  };
  return client;
}
beforeEach(() => {
  window.history.replaceState({}, '', '/');
  sessionStorage.clear();
  now += 120000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  mock.client = makeClient();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.useRealTimers(); window.history.replaceState({}, '', '/'); sessionStorage.clear(); });
async function forgot() {
  render(<App />);
  await screen.findByText('Welcome back');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Forgot password?' }).matches(':disabled')).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
}
function request(email = 'person@example.com') {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.submit(screen.getByRole('button', { name: 'Send reset link' }).closest('form'));
}
async function ready() {
  window.history.replaceState({}, '', recoveryUrl);
  const result = render(<App />);
  await act(async () => {});
  act(() => mock.client.emit('PASSWORD_RECOVERY', session()));
  await screen.findByLabelText('New password');
  return result;
}
function changePassword(password = 'new-password', confirmation = password) {
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: password } });
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: confirmation } });
  fireEvent.submit(screen.getByRole('button', { name: 'Change password' }).closest('form'));
}

describe('requesting password recovery', () => {
  it('opens the native form, validates email, and returns to login', async () => {
    await forgot();
    request('invalid');
    expect(screen.getByText('Enter a valid email address.')).toBeTruthy();
    expect(mock.client.auth.resetPasswordForEmail).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Back to login'));
    expect(screen.getByText('Welcome back')).toBeTruthy();
  });
  it('sends the root query redirect, locks requests, and prevents accidental resends', async () => {
    const pending = deferred();
    mock.client.auth.resetPasswordForEmail.mockReturnValue(pending.promise);
    await forgot();
    request(' person@example.com ');
    const button = screen.getByText('Sending reset link…');
    expect(button.matches(':disabled')).toBe(true);
    fireEvent.submit(button.closest('form'));
    expect(mock.client.auth.resetPasswordForEmail).toHaveBeenCalledExactlyOnceWith('person@example.com', { redirectTo: `${window.location.origin}/?recovery=1` });
    await act(async () => pending.resolve({ error: null }));
    expect(screen.getByText(/If an account exists/)).toBeTruthy();
    expect(screen.queryByText('Send reset link')).toBeNull();
    fireEvent.click(screen.getByText('Back to login'));
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    request();
    expect(screen.getByText(/Please wait a minute/)).toBeTruthy();
    expect(mock.client.auth.resetPasswordForEmail).toHaveBeenCalledTimes(1);
  });
  it.each(['user_not_found', 'over_email_send_rate_limit'])('conceals account-dependent error %s', async (code) => {
    mock.client.auth.resetPasswordForEmail.mockResolvedValue({ error: { code, message: 'Account details must stay private' } });
    await forgot(); request();
    expect(await screen.findByText(/If an account exists/)).toBeTruthy();
    expect(screen.queryByText(/Account details/)).toBeNull();
  });
  it.each([[{ status: 429 }, /Too many requests/], [new Error('Offline'), /Unable to send/]])('handles operational errors safely', async (error, message) => {
    mock.client.auth.resetPasswordForEmail.mockRejectedValue(error);
    await forgot(); request();
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByText('Send reset link').matches(':disabled')).toBe(false);
  });
  it('preserves index.html and strips router fragments from redirect URLs', () => {
    window.history.replaceState({}, '', '/index.html?old=1#/today');
    expect(recoveryRedirect()).toBe(`${window.location.origin}/index.html?recovery=1`);
  });
});

describe('consuming password recovery', () => {
  it('waits for the queued recovery event even when a session is already restored', async () => {
    mock.client = makeClient(session());
    window.history.replaceState({}, '', recoveryUrl);
    render(<App />);
    await act(async () => {});
    expect(screen.getByText('Checking your reset link…')).toBeTruthy();
    expect(screen.queryByText(/Tracker for/)).toBeNull();
    act(() => mock.client.emit('PASSWORD_RECOVERY', session()));
    expect(screen.getByLabelText('New password')).toBeTruthy();
    expect(window.location.hash).toBe('');
    expect(sessionStorage.getItem(RECOVERY_KEY)).not.toContain('credential');
  });
  it('validates length and confirmation without an API call', async () => {
    await ready();
    changePassword('short');
    expect(screen.getByText('Use at least 6 characters.', { selector: '[role="alert"]' })).toBeTruthy();
    changePassword('new-password', 'different');
    expect(screen.getByText('Passwords do not match.')).toBeTruthy();
    expect(mock.client.auth.updateUser).not.toHaveBeenCalled();
  });
  it('updates once, then signs out locally and preserves the success message on Login', async () => {
    const pending = deferred();
    mock.client.auth.updateUser.mockReturnValue(pending.promise);
    await ready(); changePassword();
    const button = screen.getByText('Changing password…');
    expect(button.matches(':disabled')).toBe(true);
    fireEvent.submit(button.closest('form'));
    await waitFor(() => expect(mock.client.auth.updateUser).toHaveBeenCalledExactlyOnceWith({ password: 'new-password' }));
    expect(mock.client.auth.signOut).not.toHaveBeenCalled();
    act(() => mock.client.emit('USER_UPDATED', session()));
    await act(async () => pending.resolve({ error: null }));
    expect(screen.getByText(RECOVERY_SUCCESS)).toBeTruthy();
    expect(sessionStorage.getItem(RECOVERY_KEY)).toBeNull();
    expect(window.location.search).toBe('');
    expect(mock.client.auth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'local' });
    expect(screen.getByText('Welcome back')).toBeTruthy();
    act(() => mock.client.emit('INITIAL_SESSION', null));
    act(() => mock.client.emit('SIGNED_OUT', null));
    act(() => mock.client.emit('PASSWORD_RECOVERY', session()));
    act(() => mock.client.emit('SIGNED_IN', session()));
    expect(screen.getByText(RECOVERY_SUCCESS)).toBeTruthy();
    expect(screen.queryByText(/Tracker for/)).toBeNull();
    expect(screen.queryByLabelText('New password')).toBeNull();
  });
  it('restores only the same verified recovery session after refresh', async () => {
    const view = await ready(); view.unmount();
    mock.client = makeClient(session());
    render(<App />);
    expect(await screen.findByLabelText('New password')).toBeTruthy();
    expect(mock.client.auth.getUser).toHaveBeenCalledTimes(1);
  });
  it.each([null, session('other'), session('person', 'another-login')])('rejects a marker with a missing or different session', async (value) => {
    const view = await ready(); view.unmount();
    mock.client = makeClient(value);
    render(<App />);
    expect(await screen.findByText('Reset link unavailable')).toBeTruthy();
    expect(screen.queryByLabelText('New password')).toBeNull();
  });
  it('rejects a manually opened reset URL with an ordinary login', async () => {
    mock.client = makeClient(session());
    window.history.replaceState({}, '', '/?recovery=1');
    render(<App />);
    expect(await screen.findByText('Reset link unavailable')).toBeTruthy();
    fireEvent.click(screen.getByText('Request another password reset link'));
    expect(screen.getByLabelText('Email')).toBeTruthy();
  });
  it.each(['#error=access_denied&error_code=otp_expired', '#access_token=malformed&type=recovery'])('rejects unverified callback %s without waiting for a timer', async (hash) => {
    mock.client.auth.initialize.mockResolvedValue({ error: new Error('Invalid callback') });
    window.history.replaceState({}, '', `/?recovery=1${hash}`);
    render(<App />);
    await act(async () => {});
    expect(screen.getByText('Reset link unavailable')).toBeTruthy();
    expect(screen.queryByLabelText('New password')).toBeNull();
    expect(window.location.hash).toBe('');
  });
  it('cannot reuse the cleaned reset page after success', async () => {
    const view = await ready(); changePassword();
    await screen.findByText(RECOVERY_SUCCESS); view.unmount();
    window.history.replaceState({}, '', '/?recovery=1');
    mock.client = makeClient(session()); render(<App />);
    expect(await screen.findByText('Reset link unavailable')).toBeTruthy();
  });
  it('invalidates recovery on logout and ignores a pending verification response', async () => {
    const pending = deferred();
    mock.client.auth.getUser.mockReturnValue(pending.promise);
    await ready(); changePassword();
    act(() => mock.client.emit('SIGNED_OUT', null));
    await act(async () => pending.resolve({ data: { user: session().user }, error: null }));
    expect(screen.getByText('Reset link unavailable')).toBeTruthy();
    expect(mock.client.auth.updateUser).not.toHaveBeenCalled();
  });
  it('rejects expired or server-rejected sessions and permits retry after network failure', async () => {
    await ready();
    mock.client.auth.getUser.mockRejectedValueOnce(new Error('Network unavailable'));
    changePassword();
    expect(await screen.findByText(/Unable to change/)).toBeTruthy();
    mock.client.auth.getUser.mockResolvedValueOnce({ error: { status: 401 } });
    changePassword();
    expect(await screen.findByText('Reset link unavailable')).toBeTruthy();
    expect(mock.client.auth.updateUser).not.toHaveBeenCalled();
  });
  it('cleans up Strict Mode listeners and normal auth still restores, refreshes, and logs out', async () => {
    mock.client = makeClient(session());
    const view = render(<StrictMode><App /></StrictMode>);
    expect(await screen.findByText('Tracker for person')).toBeTruthy();
    expect(mock.client.listeners.size).toBe(1);
    act(() => mock.client.emit('TOKEN_REFRESHED', session()));
    expect(screen.getByText('Tracker for person')).toBeTruthy();
    fireEvent.click(screen.getByText('Log out'));
    expect(await screen.findByText('Welcome back')).toBeTruthy();
    expect(mock.client.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
    view.unmount();
    expect(mock.client.listeners.size).toBe(0);
    expect(mock.client.unsubscribe).toHaveBeenCalledTimes(2);
  });
  it('allows normal sign-in and email-confirmation events through the existing gate', async () => {
    render(<App />);
    await screen.findByText('Welcome back');
    act(() => mock.client.emit('SIGNED_IN', session()));
    expect(screen.getByText('Tracker for person')).toBeTruthy();
    expect(screen.queryByLabelText('New password')).toBeNull();
  });
  it('does not let a stale initial session override a newer auth event', async () => {
    const pending = deferred();
    mock.client.auth.getSession.mockReturnValue(pending.promise);
    render(<App />);
    act(() => mock.client.emit('SIGNED_IN', session('new-account')));
    await act(async () => pending.resolve({ data: { session: session('old-account') }, error: null }));
    expect(screen.getByText('Tracker for new-account')).toBeTruthy();
  });
  it('rejects an expired continuation marker on refresh', async () => {
    const view = await ready(); view.unmount();
    now += 3600001;
    mock.client = makeClient(session()); render(<App />);
    expect(await screen.findByText('Reset link unavailable')).toBeTruthy();
    expect(mock.client.auth.getUser).not.toHaveBeenCalled();
  });
  it.each([['same_password', /different from your current/], ['weak_password', /stronger password/]])('handles server password policy error %s', async (code, message) => {
    await ready();
    mock.client.auth.updateUser.mockResolvedValue({ error: { code } });
    changePassword();
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByText('Change password').matches(':disabled')).toBe(false);
  });
  it('keeps the login success message if another tab signs out', async () => {
    await ready(); changePassword();
    await screen.findByText(RECOVERY_SUCCESS);
    act(() => mock.client.emit('SIGNED_OUT', null));
    expect(screen.getByText('Welcome back')).toBeTruthy();
    expect(screen.getByText(RECOVERY_SUCCESS)).toBeTruthy();
  });
  it('keeps only one recovery listener in Strict Mode and ignores work after unmount', async () => {
    window.history.replaceState({}, '', recoveryUrl);
    const view = render(<StrictMode><App /></StrictMode>);
    await act(async () => {});
    act(() => mock.client.emit('PASSWORD_RECOVERY', session()));
    expect(mock.client.listeners.size).toBe(1);
    const pending = deferred();
    mock.client.auth.getUser.mockReturnValue(pending.promise);
    changePassword(); view.unmount();
    await act(async () => pending.resolve({ data: { user: session().user }, error: null }));
    expect(mock.client.auth.updateUser).not.toHaveBeenCalled();
    expect(mock.client.listeners.size).toBe(0);
  });

  it.each(['INITIAL_SESSION', 'SIGNED_IN', 'TOKEN_REFRESHED'])('does not leave recovery when %s arrives before or after PASSWORD_RECOVERY', async (event) => {
    window.history.replaceState({}, '', recoveryUrl);
    mock.client = makeClient(session('old-account', 'old-session'));
    render(<App />);
    await act(async () => {});
    act(() => mock.client.emit(event, session()));
    expect(screen.queryByText(/Tracker for/)).toBeNull();
    act(() => mock.client.emit('PASSWORD_RECOVERY', session()));
    act(() => mock.client.emit(event, session()));
    expect(screen.getByLabelText('New password')).toBeTruthy();
    expect(screen.queryByText(/Tracker for/)).toBeNull();
  });

  it('rejects a failed callback even when getSession returns an existing login', async () => {
    window.history.replaceState({}, '', recoveryUrl);
    mock.client = makeClient(session('old-account', 'old-session'));
    mock.client.auth.initialize.mockResolvedValue({ error: new Error('Expired link') });
    render(<App />);
    expect(await screen.findByText('Reset link unavailable')).toBeTruthy();
    expect(screen.queryByText(/Tracker for/)).toBeNull();
  });

  it('keeps the tracker blocked during delayed initialization', async () => {
    const initialization = deferred();
    window.history.replaceState({}, '', recoveryUrl);
    mock.client.auth.initialize.mockReturnValue(initialization.promise);
    render(<App />);
    act(() => mock.client.emit('INITIAL_SESSION', session()));
    expect(screen.queryByText(/Tracker for/)).toBeNull();
    expect(screen.getByText('Checking your reset link…')).toBeTruthy();
    await act(async () => initialization.resolve({ error: null }));
    expect(screen.getByText('Checking your reset link…')).toBeTruthy();
    act(() => mock.client.emit('PASSWORD_RECOVERY', session()));
    expect(screen.getByLabelText('New password')).toBeTruthy();
  });

  it('keeps recovery blocked on sign-out failure, including refresh, and retries only sign-out', async () => {
    mock.client.auth.signOut.mockResolvedValue({ error: new Error('Offline') });
    const view = await ready(); changePassword();
    expect(await screen.findByText(/sign-out failed/)).toBeTruthy();
    expect(screen.queryByText(/Tracker for/)).toBeNull();
    expect(screen.queryByLabelText('New password')).toBeNull();
    view.unmount();
    mock.client = makeClient(session());
    render(<App />);
    const button = await screen.findByText('Sign out and return to login');
    fireEvent.click(button);
    expect(await screen.findByText(RECOVERY_SUCCESS)).toBeTruthy();
    expect(mock.client.auth.updateUser).not.toHaveBeenCalled();
    expect(mock.client.auth.signOut).toHaveBeenCalledTimes(1);
  });

  it('does not sign out when the password update fails', async () => {
    mock.client.auth.updateUser.mockResolvedValue({ error: { code: 'weak_password' } });
    await ready(); changePassword();
    await screen.findByText(/stronger password/);
    expect(mock.client.auth.signOut).not.toHaveBeenCalled();
  });

});
