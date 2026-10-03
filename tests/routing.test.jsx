import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TrackerApp } from '../src/app/TrackerApp.jsx';

const fixtures = vi.hoisted(() => {
  const habits = [
    { id: 'walking', name: 'Walking', emoji: '🚶', target: 10000, unit: 'steps', days: 30, start: '2026-09-01', metric: '', ramp: false },
    { id: 'reading', name: 'Reading', emoji: '📖', target: 20, unit: 'pages', days: 30, start: '2026-09-01', metric: '', ramp: false },
  ];
  return {
    store: { status: 'ready', habits, entries: {}, busy: false, message: '', saveEntry: vi.fn(), createHabit: vi.fn(), deleteHabit: vi.fn(), uploadPhoto: vi.fn(), removePhoto: vi.fn() },
    social: { status: 'ready', profile: null, requests: [], friends: [], shares: [], feed: [], leaderboard: [], unreadCount: 0, receivedCount: 0, chat: null, setChat: vi.fn(), recordCompletion: vi.fn(), removeCompletion: vi.fn() },
  };
});

vi.mock('../src/hooks/useHabits.js', () => ({ useHabits: () => fixtures.store }));
vi.mock('../src/hooks/useSocial.js', () => ({ useSocial: () => fixtures.social }));
vi.mock('../src/views/TodayView.jsx', () => ({ TodayView: () => <div data-testid="view">Today</div> }));
vi.mock('../src/views/ProgressView.jsx', () => ({ ProgressView: ({ habit }) => <div data-testid="view">Progress {habit.name}</div> }));
vi.mock('../src/views/CalendarView.jsx', () => ({ CalendarView: ({ habit }) => <div data-testid="view">Calendar {habit.name}</div> }));
vi.mock('../src/views/GraphView.jsx', () => ({ GraphView: ({ habit }) => <div data-testid="view">Graph {habit.name}</div> }));
vi.mock('../src/views/ProofView.jsx', () => ({ ProofView: ({ habit }) => <div data-testid="view">Proof {habit.name}</div> }));
vi.mock('../src/views/SocialView.jsx', () => ({ SocialView: ({ section }) => <div data-testid="view">Social {section}</div> }));
vi.mock('../src/views/ProfileView.jsx', () => ({ ProfileView: ({ profileId }) => <div data-testid="view">Profile {profileId || 'me'}</div> }));
vi.mock('../src/views/ManageView.jsx', () => ({ ManageView: () => <div data-testid="view">Habits</div> }));

function LocationControls() {
  const location = useLocation();
  const navigate = useNavigate();
  return <><output data-testid="path">{location.pathname}</output><button onClick={() => navigate(-1)}>Back</button><button onClick={() => navigate(1)}>Forward</button></>;
}

function openAt(path, profile) {
  return render(<MemoryRouter initialEntries={[path]}><TrackerApp profile={profile} auth={{ session: { user: { id: 'owner' } }, client: {}, logout: vi.fn(), accountMessage: '', busy: false }} /><LocationControls /></MemoryRouter>);
}

afterEach(cleanup);

describe('tracker routes', () => {
  it('integrates the confirmed handle with the new account footer and floating navigation', () => {
    openAt('/today', { id: 'owner', handle: 'habit_friend', display_name: 'Habit Friend' });
    const identity = screen.getByRole('link', { name: 'Your handle: @habit_friend' });
    expect(identity.closest('footer').className).toBe('account-controls');
    expect(screen.getByRole('navigation', { name: 'Main navigation' }).className).toBe('floating-nav');
    expect(screen.getByRole('button', { name: 'New habit' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Switch theme' })).toBeTruthy();
    fireEvent.click(identity);
    expect(screen.getByTestId('path').textContent).toBe('/profile');
    expect(screen.getByTestId('view').textContent).toBe('Profile me');
    const more = screen.getByRole('link', { name: 'More — Habits' });
    expect(screen.getByRole('link', { name: 'Social' }).className).toBe('on');
    fireEvent.click(more);
    expect(screen.getByTestId('view').textContent).toBe('Habits');
  });

  it('opens a habit deep link and preserves its habit across tabs and browser history', async () => {
    openAt('/progress/reading');
    expect(screen.getByTestId('view').textContent).toBe('Progress Reading');
    fireEvent.click(screen.getByRole('link', { name: /Calendar/ }));
    expect(screen.getByTestId('path').textContent).toBe('/calendar/reading');
    expect(screen.getByTestId('view').textContent).toBe('Calendar Reading');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByTestId('path').textContent).toBe('/progress/reading');
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
    expect(screen.getByTestId('view').textContent).toBe('Calendar Reading');
  });

  it('puts habit picker and Social navigation in the URL', () => {
    openAt('/progress/reading');
    fireEvent.click(screen.getByRole('button', { name: /Walking/ }));
    expect(screen.getByTestId('path').textContent).toBe('/progress/walking');
    expect(screen.getByTestId('view').textContent).toBe('Progress Walking');
    fireEvent.click(screen.getByRole('link', { name: 'Social' }));
    expect(screen.getByTestId('path').textContent).toBe('/social/activity');
    expect(screen.getByTestId('view').textContent).toBe('Social activity');
  });

  it('redirects the old Friends route and opens friend profiles', async () => {
    openAt('/friends');
    await waitFor(() => expect(screen.getByTestId('path').textContent).toBe('/social/friends'));
    expect(screen.getByTestId('view').textContent).toBe('Social friends');
    cleanup();
    openAt('/profile/friend-id');
    expect(screen.getByTestId('view').textContent).toBe('Profile friend-id');
  });

  it('replaces an invalid habit deep link with the first available habit', async () => {
    openAt('/graph/missing');
    await waitFor(() => expect(screen.getByTestId('path').textContent).toBe('/graph/walking'));
    expect(screen.getByTestId('view').textContent).toBe('Graph Walking');
  });

  it('replaces an unknown route with Today', async () => {
    openAt('/unknown');
    await waitFor(() => expect(screen.getByTestId('path').textContent).toBe('/today'));
    expect(screen.getByTestId('view').textContent).toBe('Today');
  });
});
