import React, { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/app/App.jsx';
import { getSupabaseClient, resetSupabaseClientForTests } from '../src/data/supabase.js';
import { RECOVERY_SUCCESS } from '../src/auth/recovery.js';

// Use the installed Supabase SDK and its actual URL/session/event lifecycle.
// Only the HTTP server and tracker data UI are replaced. Any tracker render,
// even one immediately undone by PASSWORD_RECOVERY, fails the assertion.
const tracker = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock('../src/app/TrackerApp.jsx', () => ({ TrackerApp: ({ auth }) => {
  tracker.render(auth.session.user.id);
  return <p>Tracker for {auth.session.user.id}</p>;
} }));

const storageKey = 'sb-project-auth-token';
let http;
const jwt = (id) => `${btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${btoa(JSON.stringify({ sub: id, session_id: `session-${id}`, exp: Math.floor(Date.now() / 1000) + 3600 }))}.signature`;
const storedSession = (id) => ({ access_token: jwt(id), refresh_token: `refresh-${id}`, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id, email: `${id}@example.com` } });
function callback(type = 'recovery') {
  return new URLSearchParams({ access_token: jwt('recovered'), refresh_token: 'refresh-recovered', expires_in: '3600', token_type: 'bearer', type }).toString();
}

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear();
  window.history.replaceState({}, '', '/');
  resetSupabaseClientForTests();
  tracker.render.mockClear();
  window.APP_CONFIG = { SUPABASE_URL: 'https://project.example', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' };
  http = vi.fn(async (input, options = {}) => {
    const url = new URL(input);
    if (url.pathname === '/auth/v1/user') return new Response(JSON.stringify({ id: 'recovered', email: 'recovered@example.com' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (url.pathname === '/auth/v1/logout' && options.method === 'POST') return new Response(null, { status: 204 });
    throw new Error(`Unexpected test request: ${url.pathname}`);
  });
  vi.stubGlobal('fetch', http);
});
afterEach(async () => {
  cleanup();
  await getSupabaseClient().auth.dispose();
  resetSupabaseClientForTests();
  vi.unstubAllGlobals();
  localStorage.clear(); sessionStorage.clear();
  window.history.replaceState({}, '', '/');
});

describe('real Supabase callback lifecycle', () => {
  it.each([
    ['hash with redirect marker', () => `/?recovery=1#${callback()}`, false],
    ['hash without redirect marker', () => `/#${callback()}`, false],
    ['query callback', () => `/?${callback()}`, false],
    ['another account already signed in', () => `/?recovery=1#${callback()}`, true],
  ])('shows reset before any tracker render: %s', async (_name, url, previousLogin) => {
    if (previousLogin) localStorage.setItem(storageKey, JSON.stringify(storedSession('previous')));
    window.history.replaceState({}, '', url());
    render(<StrictMode><App /></StrictMode>);
    expect(await screen.findByLabelText('New password')).toBeTruthy();
    expect(tracker.render).not.toHaveBeenCalled();
    expect((await getSupabaseClient().auth.getSession()).data.session.user.id).toBe('recovered');
    expect(window.location.hash).toBe('');
    expect(window.location.search).toBe('?recovery=1');
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-password' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'new-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText(RECOVERY_SUCCESS)).toBeTruthy();
    expect(screen.getByText('Welcome back')).toBeTruthy();
    expect(tracker.render).not.toHaveBeenCalled();
    expect((await getSupabaseClient().auth.getSession()).data.session).toBeNull();
    const writes = http.mock.calls.filter(([, options]) => options?.method === 'PUT' || options?.method === 'POST');
    expect(writes.map(([url]) => new URL(url).pathname)).toEqual(['/auth/v1/user', '/auth/v1/logout']);
    expect(JSON.parse(writes[0][1].body).password).toBe('new-password');
    expect(new URL(writes[1][0]).searchParams.get('scope')).toBe('local');
  });

  it.each(['/?recovery=1#error=access_denied&error_code=otp_expired', '/?recovery=1#access_token=malformed&type=recovery', '/?recovery=1', '/#/reset-password'])('blocks invalid/manual recovery with an existing login: %s', async (url) => {
    localStorage.setItem(storageKey, JSON.stringify(storedSession('previous')));
    window.history.replaceState({}, '', url);
    render(<StrictMode><App /></StrictMode>);
    expect(await screen.findByText('Reset link unavailable')).toBeTruthy();
    expect(screen.queryByLabelText('New password')).toBeNull();
    expect(tracker.render).not.toHaveBeenCalled();
  });

  it('keeps a legitimate recovery refresh gated even after URL credentials are removed', async () => {
    window.history.replaceState({}, '', `/?recovery=1#${callback()}`);
    const view = render(<App />);
    await screen.findByLabelText('New password');
    view.unmount();
    await getSupabaseClient().auth.dispose();
    resetSupabaseClientForTests();
    render(<StrictMode><App /></StrictMode>);
    expect(await screen.findByLabelText('New password')).toBeTruthy();
    expect(tracker.render).not.toHaveBeenCalled();
  });

  it('restores an ordinary existing session into the tracker', async () => {
    localStorage.setItem(storageKey, JSON.stringify(storedSession('ordinary')));
    render(<StrictMode><App /></StrictMode>);
    expect(await screen.findByText('Tracker for ordinary')).toBeTruthy();
  });

  it('allows email confirmation callbacks into the normal app', async () => {
    window.history.replaceState({}, '', `/#${callback('signup')}`);
    render(<StrictMode><App /></StrictMode>);
    expect(await screen.findByText('Tracker for recovered')).toBeTruthy();
    await act(async () => {});
    await waitFor(() => expect(screen.queryByLabelText('New password')).toBeNull());
  });
});
