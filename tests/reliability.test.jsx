import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../src/auth/AuthContext.jsx';
import { AuthScreen } from '../src/auth/AuthScreen.jsx';
import { insertHabit, readPages, writeEntryRow } from '../src/data/habits.js';
import { checkPhotoPath, deleteHabitPhotos, replaceProofPhoto, signedPhoto } from '../src/data/photos.js';
import { publishCompletion } from '../src/data/social.js';
import { dateKey, pointsForDay, stats, today } from '../src/lib/tracker.js';

const authMock = vi.hoisted(() => ({ client: null }));
vi.mock('../src/data/supabase.js', () => ({ getSupabaseClient: () => authMock.client }));
afterEach(() => cleanup());

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function authClient(overrides = {}) {
  let listener;
  return {
    auth: {
      onAuthStateChange(callback) { listener = callback; return { data: { subscription: { unsubscribe: vi.fn() } } }; },
      getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
      signInWithPassword: vi.fn(async () => ({ data: { session: null }, error: { message: 'Invalid credentials' } })),
      signUp: vi.fn(async () => ({ data: { session: null }, error: null })),
      signOut: vi.fn(async () => ({ error: null })),
      ...overrides,
    },
    emit(event, session) { listener?.(event, session); },
  };
}

describe('authentication reliability', () => {
  beforeEach(() => { window.APP_CONFIG = {}; });

  it('keeps the app gated during restoration and enables signed-out login afterward', async () => {
    const session = deferred();
    authMock.client = authClient({ getSession: vi.fn(() => session.promise) });
    render(<AuthProvider><AuthScreen /></AuthProvider>);
    expect(screen.getByText('Checking your session…')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Log in' }).matches(':disabled')).toBe(true);
    await act(async () => session.resolve({ data: { session: null }, error: null }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Log in' }).disabled).toBe(false));
  });

  it('blocks duplicate login submissions and restores the form after failure', async () => {
    const login = deferred();
    authMock.client = authClient({ signInWithPassword: vi.fn(() => login.promise) });
    render(<AuthProvider><AuthScreen /></AuthProvider>);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Log in' }).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'person@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password' } });
    fireEvent.submit(screen.getByRole('button', { name: 'Log in' }).closest('form'));
    fireEvent.submit(screen.getByRole('button', { name: 'Log in' }).closest('form'));
    expect(authMock.client.auth.signInWithPassword).toHaveBeenCalledTimes(1);
    await act(async () => login.resolve({ data: { session: null }, error: { message: 'Offline' } }));
    expect(await screen.findByText('Offline')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Log in' }).disabled).toBe(false);
  });

  it('shows confirmation guidance and uses the current production path', async () => {
    authMock.client = authClient();
    render(<AuthProvider><AuthScreen /></AuthProvider>);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Log in' }).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Create an account' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'person@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));
    expect(await screen.findByText(/Check your email/)).toBeTruthy();
    expect(authMock.client.auth.signUp.mock.calls[0][0].options.emailRedirectTo).toBe(window.location.origin + window.location.pathname);
  });
});

function singleResult(data, capture) {
  return {
    insert(payload) { capture.payload = payload; return this; },
    upsert(payload, options) { capture.payload = payload; capture.options = options; return this; },
    select() { return this; },
    single: async () => ({ data, error: null }),
  };
}

describe('habit persistence contracts', () => {
  it('paginates reads beyond the API row cap', async () => {
    const source = Array.from({ length: 1003 }, (_, id) => ({ id }));
    const calls = [];
    const rows = await readPages(() => ({ range: async (from, to) => { calls.push([from, to]); return { data: source.slice(from, to + 1), error: null }; } }));
    expect(rows).toHaveLength(1003);
    expect(calls).toEqual([[0, 499], [500, 999], [1000, 1499], [1003, 1502]]);
  });

  it('lets PostgreSQL generate habit IDs and maps start_date', async () => {
    const capture = {};
    const row = { id: 'server-id', name: 'Walk', emoji: '🚶', target: '10', unit: 'steps', days: 30, start_date: '2026-09-21', metric: 'weight', ramp: true, created_at: '2026-09-21T00:00:00Z' };
    const client = { from: () => singleResult(row, capture) };
    const saved = await insertHabit(client, 'owner', { name: 'Walk', emoji: '🚶', target: 10, unit: 'steps', days: 30, start: '2026-09-21', metric: 'weight', ramp: true });
    expect(capture.payload.user_id).toBe('owner');
    expect(capture.payload.start_date).toBe('2026-09-21');
    expect(capture.payload).not.toHaveProperty('id');
    expect(saved.id).toBe('server-id');
  });

  it('upserts only explicitly changed entry fields', async () => {
    const capture = {};
    const row = { id: 'entry', habit_id: 'habit', entry_date: '2026-09-21', done: true, rest: false, value: '12.5', metric: null, photo_path: 'owner/habit/photo.jpg', updated_at: '2026-09-21T00:00:00Z' };
    const client = { from: () => singleResult(row, capture) };
    const entry = await writeEntryRow(client, { id: 'habit' }, '2026-09-21', { value: 12.5 });
    expect(capture.options).toMatchObject({ onConflict: 'habit_id,entry_date', defaultToNull: false });
    expect(capture.payload).not.toHaveProperty('photo_path');
    expect(capture.payload).not.toHaveProperty('done');
    expect(entry.value).toBe(12.5);
    expect(entry.photo).toBe('owner/habit/photo.jpg');
  });
});

function photoClient({ failWrite = false } = {}) {
  const calls = [];
  let path = 'owner/habit/old.jpg';
  const client = {
    calls,
    storage: { from: () => ({
      upload: async (uploadPath, _file, options) => { calls.push(['upload', uploadPath, options]); return { data: {}, error: null }; },
      remove: async (paths) => { calls.push(['remove', paths]); return { data: {}, error: null }; },
      createSignedUrl: async (signedPath) => { calls.push(['sign', signedPath]); return { data: { signedUrl: `https://signed.example/${signedPath}` }, error: null }; },
    }) },
    from: () => {
      const builder = {
        select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { photo_path: path }, error: null }),
        upsert(payload) { calls.push(['upsert', payload]); path = payload.photo_path; return this; },
        single: async () => failWrite ? ({ data: null, error: { message: 'DB rejected' } }) : ({ data: { id: 'entry', habit_id: 'habit', entry_date: '2026-09-21', done: false, rest: false, value: null, metric: null, photo_path: path, updated_at: '2026-09-21T00:00:00Z' }, error: null }),
      };
      return builder;
    },
  };
  return client;
}

describe('private proof photos', () => {
  it('uploads, stores only the path, then removes the old object', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'unique' });
    const client = photoClient();
    const result = await replaceProofPhoto(client, 'owner', { id: 'habit' }, '2026-09-21', { type: 'image/jpeg', size: 100 });
    expect(client.calls.map(([operation]) => operation)).toEqual(['upload', 'upsert', 'remove']);
    expect(client.calls[0][1]).toBe('owner/habit/unique.jpg');
    expect(client.calls[0][2].upsert).toBe(false);
    expect(client.calls[1][1].photo_path).toBe('owner/habit/unique.jpg');
    expect(result.entry.photo).toBe('owner/habit/unique.jpg');
  });

  it('rolls back a new object when the database update fails', async () => {
    vi.stubGlobal('crypto', { randomUUID: () => 'unique' });
    const client = photoClient({ failWrite: true });
    await expect(replaceProofPhoto(client, 'owner', { id: 'habit' }, '2026-09-21', { type: 'image/png', size: 100 })).rejects.toThrow('DB rejected');
    expect(client.calls.at(-1)).toEqual(['remove', ['owner/habit/unique.png']]);
  });

  it('rejects unsupported or oversized files before uploading', async () => {
    const client = photoClient();
    await expect(replaceProofPhoto(client, 'owner', { id: 'habit' }, '2026-09-21', { type: 'image/gif', size: 10 })).rejects.toThrow('JPEG');
    await expect(replaceProofPhoto(client, 'owner', { id: 'habit' }, '2026-09-21', { type: 'image/png', size: 5 * 1024 * 1024 + 1 })).rejects.toThrow('5 MB');
    expect(client.calls).toHaveLength(0);
  });

  it('rejects foreign paths and caches temporary signed URLs', async () => {
    const client = photoClient();
    expect(() => checkPhotoPath('other/habit/file.jpg', 'owner')).toThrow();
    const first = await signedPhoto(client, 'owner', 'owner/habit/old.jpg', true);
    const second = await signedPhoto(client, 'owner', 'owner/habit/old.jpg');
    expect(first.url).toBe(second.url);
    expect(client.calls.filter(([operation]) => operation === 'sign')).toHaveLength(1);
  });

  it('paginates and batches complete habit-folder cleanup', async () => {
    let objects = Array.from({ length: 205 }, (_, index) => `owner/habit/file-${String(index).padStart(3, '0')}.png`);
    const calls = [];
    const client = {
      from: () => ({ select() { return this; }, eq() { return this; }, order() { return this; }, range: async () => ({ data: [], error: null }) }),
      storage: { from: () => ({
        list: async (prefix, options) => {
          calls.push(['list', options.offset]);
          return { data: objects.filter((path) => path.startsWith(`${prefix}/`)).slice(options.offset, options.offset + options.limit).map((path) => ({ id: path, name: path.slice(prefix.length + 1) })), error: null };
        },
        remove: async (paths) => { calls.push(['remove', paths.length]); objects = objects.filter((path) => !paths.includes(path)); return { data: [], error: null }; },
      }) },
    };
    await deleteHabitPhotos(client, 'owner', 'habit');
    expect(calls.filter(([operation]) => operation === 'list')).toHaveLength(4);
    expect(calls.filter(([operation]) => operation === 'remove').map(([, size]) => size)).toEqual([100, 100, 5]);
    expect(objects).toHaveLength(0);
  });
});

describe('social privacy', () => {
  it('publishes completion metadata without values, notes, or photo paths', async () => {
    let payload;
    const client = { from: () => ({ upsert: async (row, options) => { payload = row; expect(options.ignoreDuplicates).toBe(true); return { error: null }; } }) };
    await publishCompletion(client, 'owner', { id: 'habit', name: 'Walk', value: 5000, photo: 'private/path' }, '2026-09-21');
    expect(payload).toEqual({ actor_id: 'owner', habit_id: 'habit', habit_label: 'Walk', kind: 'completed', occurred_on: '2026-09-21' });
  });
});

describe('tracker behavior', () => {
  it('keeps rest days out of the streak break and daily possible points', () => {
    const current = dateKey(today());
    const habit = { id: 'habit', target: 1, days: 30, start: current, unit: 'unit', ramp: false };
    const entries = { habit: { [current]: { done: false, rest: true, value: null } } };
    expect(stats(habit, entries).rest).toBe(1);
    expect(pointsForDay([habit], entries, current)).toEqual({ earned: 0, possible: 0 });
  });
});
