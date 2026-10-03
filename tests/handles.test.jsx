import React, { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/app/App.jsx';
import { HandleForm } from '../src/auth/HandleGate.jsx';
import { AppShell } from '../src/components/AppShell.jsx';
import { claimHandle } from '../src/data/profiles.js';
import { requestFriend, loadSocialData } from '../src/data/social.js';
import { handleError, normalizeHandle, suggestHandle } from '../src/lib/handles.js';

const mock = vi.hoisted(() => ({ client: null, renders: vi.fn() }));
vi.mock('../src/data/supabase.js', () => ({ getSupabaseClient: () => mock.client }));
vi.mock('../src/app/TrackerApp.jsx', () => ({ TrackerApp: ({ auth, profile }) => {
  mock.renders(auth.session.user.id, profile);
  return <><p>Journal for {auth.session.user.id}: @{profile.handle}</p><button onClick={auth.logout}>Log out</button></>;
} }));
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const session = (id = 'owner', provider = 'email') => ({ user: { id, email: 'john.smith+work@example.com', app_metadata: { provider } } });
let listeners, profiles, current;
function emit(event, value) { current = value; for (const listener of listeners) listener(event, value); }
beforeEach(() => {
  localStorage.clear(); sessionStorage.clear(); window.history.replaceState({}, '', '/');
  listeners = new Set(); profiles = new Map(); current = null; mock.renders.mockClear();
  mock.client = {
    from: vi.fn((table) => {
      expect(table).toBe('profiles'); let id;
      return { select(fields) { expect(fields).toBe('id,handle,display_name'); return this; }, eq(_column, value) { id = value; return this; }, maybeSingle: async () => ({ data: profiles.get(id) || null, error: null }) };
    }),
    rpc: vi.fn(async (name, { candidate }) => {
      if (name === 'handle_available') return { data: ![...profiles.values()].some((p) => p.handle === candidate), error: null };
      expect(name).toBe('claim_handle');
      const profile = { id: current.user.id, handle: candidate, display_name: candidate };
      profiles.set(profile.id, profile); return { data: [profile], error: null };
    }),
    auth: {
      initialize: vi.fn(async () => ({ error: null })),
      getSession: vi.fn(async () => ({ data: { session: current }, error: null })),
      onAuthStateChange: vi.fn((cb) => { listeners.add(cb); return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } }; }),
      signUp: vi.fn(async () => ({ data: { session: null }, error: null })),
      signOut: vi.fn(async () => { emit('SIGNED_OUT', null); return { error: null }; }),
    },
  };
});
afterEach(() => { cleanup(); vi.useRealTimers(); window.history.replaceState({}, '', '/'); });

async function choose(value = 'Manual_Choice') {
  fireEvent.change(await screen.findByLabelText('Handle'), { target: { value } });
  await screen.findByText(`✓ @${value.toLowerCase()} is available`);
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

describe('handle rules and suggestions', () => {
  it.each([
    ['aravindsomaraj101@gmail.com', 'aravindsomaraj101'],
    ['john.smith+work@gmail.com', 'john_smith'],
    ['Some!Name@example.com', 'some_name'],
    ['ABCDEFGHIJKLMNOPQRSTUVWXYZ@example.com', 'abcdefghijklmnopqrstuvwx'],
    ['a@example.com', ''], ['💛@example.com', ''], ['admin@example.com', ''], [undefined, ''],
  ])('suggests from %s without assigning it', (email, expected) => expect(suggestHandle(email)).toBe(expected));
  it('normalizes manually entered casing and optional @', () => expect(normalizeHandle(' @Aravind_S ')).toBe('aravind_s'));
  it.each(['ab', 'a'.repeat(25), 'bad space', 'bad!', '@john', 'John', 'admin', 'habit_tracker'])('rejects %s', (value) => expect(handleError(value)).not.toBe(''));
  it('accepts boundaries and underscores', () => { expect(handleError('a_1')).toBe(''); expect(handleError('a'.repeat(24))).toBe(''); });
});

describe('shared post-auth handle lifecycle', () => {
  it.each(['email', 'google'])('onboards a new %s session only after explicit confirmation', async (provider) => {
    render(<StrictMode><App /></StrictMode>);
    await screen.findByText('Welcome back');
    act(() => emit('SIGNED_IN', session('owner', provider)));
    expect((await screen.findByLabelText('Handle')).value).toBe('john_smith');
    expect(mock.renders).not.toHaveBeenCalled();
    expect(mock.client.rpc.mock.calls.some(([name]) => name === 'claim_handle')).toBe(false);
    await choose();
    expect(await screen.findByText('Journal for owner: @manual_choice')).toBeTruthy();
    expect(mock.client.rpc).toHaveBeenCalledWith('claim_handle', { candidate: 'manual_choice' });
    expect(mock.client.from).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(1);
  });
  it('waits for email confirmation before any profile access', async () => {
    render(<App />); await screen.findByText('Welcome back');
    fireEvent.click(screen.getByRole('button', { name: 'Create an account' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'john@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password123' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Sign up' }).closest('form'));
    await screen.findByText(/Check your email for a confirmation/);
    expect(mock.client.from).not.toHaveBeenCalled(); expect(mock.client.rpc).not.toHaveBeenCalled();
    act(() => emit('SIGNED_IN', session()));
    expect(await screen.findByText('Choose your handle')).toBeTruthy();
  });
  it.each([null, { id: 'owner', handle: null, display_name: 'Original name' }])('restores a legacy account missing identity (%s)', async (profile) => {
    current = session(); if (profile) profiles.set('owner', profile);
    render(<StrictMode><App /></StrictMode>);
    expect(await screen.findByText('Choose your handle')).toBeTruthy();
    expect(mock.client.from).toHaveBeenCalledTimes(1);
    expect(mock.renders).not.toHaveBeenCalled();
  });
  it('preserves a returning handle through token refresh, logout/login and page restoration', async () => {
    current = session(); profiles.set('owner', { id: 'owner', handle: 'established', display_name: 'Existing' });
    const view = render(<StrictMode><App /></StrictMode>);
    expect(screen.queryByText('Choose your handle')).toBeNull();
    await screen.findByText('Journal for owner: @established');
    act(() => emit('TOKEN_REFRESHED', session()));
    expect(mock.client.from).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Log out' })); await screen.findByText('Welcome back');
    act(() => emit('SIGNED_IN', session())); await screen.findByText('Journal for owner: @established');
    view.unmount(); render(<App />); await screen.findByText('Journal for owner: @established');
    expect(mock.client.rpc).not.toHaveBeenCalled();
    expect(profiles.get('owner').handle).toBe('established');
  });
  it('discards a slow profile read on account switch without showing the wrong identity', async () => {
    const pending = deferred(); current = session('old');
    mock.client.from.mockReturnValueOnce({ select() { return this; }, eq() { return this; }, maybeSingle: () => pending.promise });
    render(<App />);
    await screen.findByText('Checking your handle…');
    act(() => emit('SIGNED_IN', session('new')));
    await screen.findByText('Choose your handle');
    await act(async () => pending.resolve({ data: { id: 'old', handle: 'old_handle' }, error: null }));
    expect(mock.renders).not.toHaveBeenCalled();
    await choose('new_handle'); await screen.findByText('Journal for new: @new_handle');
  });
  it('retries a failed profile load without treating an error as missing identity', async () => {
    current = session();
    mock.client.from.mockReturnValueOnce({ select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ error: new Error('Offline') }) });
    render(<App />); await screen.findByText('Unable to load your profile');
    expect(screen.queryByLabelText('Handle')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('Choose your handle');
  });
  it('ignores a completed claim after logout while the request was in flight', async () => {
    current = session(); const save = deferred();
    mock.client.rpc.mockImplementation((name) => name === 'claim_handle' ? save.promise : Promise.resolve({ data: true }));
    render(<App />); await choose('pending_save');
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    await screen.findByText('Welcome back');
    await act(async () => save.resolve({ data: [{ id: 'owner', handle: 'pending_save' }] }));
    expect(mock.renders).not.toHaveBeenCalled();
    expect(screen.getByText('Welcome back')).toBeTruthy();
  });
  it('does not read or create a profile for a recovery session', async () => {
    window.history.replaceState({}, '', '/?recovery=1#type=recovery&access_token=credential');
    render(<App />); await act(async () => {});
    act(() => emit('PASSWORD_RECOVERY', session()));
    expect(await screen.findByLabelText('New password')).toBeTruthy();
    expect(mock.client.from).not.toHaveBeenCalled(); expect(mock.client.rpc).not.toHaveBeenCalled();
    expect(screen.queryByText('Choose your handle')).toBeNull();
  });
});

describe('availability and claim failures', () => {
  it('allows an availability retry after a network failure', async () => {
    mock.client.rpc.mockRejectedValueOnce(new Error('Offline')).mockResolvedValue({ data: true });
    render(<HandleForm client={mock.client} email="john@example.com" onSaved={vi.fn()} />);
    await screen.findByText('Unable to check availability. Please try again.');
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    expect(await screen.findByText('✓ @john is available')).toBeTruthy();
  });
  it('debounces checks and ignores an obsolete response', async () => {
    vi.useFakeTimers(); const old = deferred();
    mock.client.rpc.mockReturnValueOnce(old.promise).mockResolvedValue({ data: true });
    render(<HandleForm client={mock.client} email="first@example.com" onSaved={vi.fn()} />);
    await act(async () => vi.advanceTimersByTime(350));
    fireEvent.change(screen.getByLabelText('Handle'), { target: { value: 'sec' } });
    fireEvent.change(screen.getByLabelText('Handle'), { target: { value: 'second' } });
    await act(async () => vi.advanceTimersByTime(349));
    expect(mock.client.rpc).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(1));
    expect(screen.getByText('✓ @second is available')).toBeTruthy();
    await act(async () => old.resolve({ data: false }));
    expect(screen.getByText('✓ @second is available')).toBeTruthy();
    expect(mock.client.rpc).toHaveBeenCalledTimes(2);
  });
  it('shows taken handles and catches a conflict after availability succeeded', async () => {
    current = session(); profiles.set('other', { id: 'other', handle: 'john_smith' });
    render(<HandleForm client={mock.client} email={current.user.email} onSaved={vi.fn()} />);
    await screen.findByText('@john_smith is already taken');
    expect(screen.getByRole('button', { name: 'Continue' }).disabled).toBe(true);
    const availableRpc = mock.client.rpc.getMockImplementation();
    mock.client.rpc.mockImplementation((name, args) => name === 'claim_handle' ? Promise.resolve({ error: { code: '23505', details: 'private details' } }) : availableRpc(name, args));
    await choose('free_handle');
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'That handle is already taken. Choose another.');
    expect(screen.queryByText(/private details/)).toBeNull();
  });
  it('locks duplicate submissions and allows retry after a network error', async () => {
    const save = deferred(), onSaved = vi.fn(); current = session();
    mock.client.rpc.mockImplementation((name) => name === 'claim_handle' ? save.promise : Promise.resolve({ data: true }));
    render(<HandleForm client={mock.client} email="john@example.com" onSaved={onSaved} />);
    await screen.findByText('✓ @john is available');
    const form = screen.getByRole('button', { name: 'Continue' }).closest('form');
    fireEvent.submit(form); fireEvent.submit(form);
    expect(mock.client.rpc.mock.calls.filter(([name]) => name === 'claim_handle')).toHaveLength(1);
    await act(async () => save.resolve({ error: { message: 'network' } }));
    expect(screen.getByRole('alert').textContent).toMatch(/Unable to save/);
    expect(screen.getByRole('button', { name: 'Continue' }).matches(':disabled')).toBe(false);
    expect(onSaved).not.toHaveBeenCalled();
  });
  it('maps database validation errors to safe actionable feedback', async () => {
    mock.client.rpc.mockResolvedValue({ error: { code: '23514', details: 'internal' } });
    await expect(claimHandle(mock.client, 'valid_name')).rejects.toThrow('invalid or reserved');
  });
});

describe('public identity in Friends', () => {
  it('shows the handle in the current account footer, also used on mobile', () => {
    render(<MemoryRouter><AppShell handle="my_handle" view="today" links={{ today: '/today', progress: '/progress', calendar: '/calendar', graph: '/graph', proof: '/proof', social: '/friends', manage: '/habits' }} /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Your handle: @my_handle' }).getAttribute('href')).toBe('/friends');
  });
  it('resolves @handle through only public fields and inserts UUIDs', async () => {
    const insert = vi.fn(async () => ({ error: null })), select = vi.fn(), eq = vi.fn();
    const query = { select: (fields) => { select(fields); return query; }, eq: (...args) => { eq(...args); return query; }, maybeSingle: async () => ({ data: { id: 'friend-id', handle: 'friend' } }) };
    const client = { from: (table) => table === 'profiles' ? query : { insert } };
    await requestFriend(client, { id: 'my-id', handle: 'mine' }, ' @FrIeNd ');
    expect(select).toHaveBeenCalledWith('id,handle,display_name'); expect(eq).toHaveBeenCalledWith('handle', 'friend');
    expect(insert).toHaveBeenCalledWith({ requester_id: 'my-id', addressee_id: 'friend-id', status: 'pending' });
    query.maybeSingle = async () => ({ data: { id: 'my-id', handle: 'old_name' } });
    await expect(requestFriend(client, { id: 'my-id', handle: 'mine' }, 'old_name')).rejects.toThrow('yourself');
    expect(insert).toHaveBeenCalledTimes(1);
  });
  it('guards self requests and missing identities without querying private data', async () => {
    await expect(requestFriend(mock.client, { id: 'owner', handle: 'mine' }, '@MINE')).rejects.toThrow('yourself');
    await expect(requestFriend(mock.client, { id: 'owner', handle: null }, 'friend')).rejects.toThrow('Choose your handle');
    expect(mock.client.from).not.toHaveBeenCalled();
    expect(await loadSocialData(mock.client, 'owner', { id: 'owner', handle: null })).toMatchObject({ friends: [], requests: [] });
    expect(mock.client.from).not.toHaveBeenCalled();
  });
});
