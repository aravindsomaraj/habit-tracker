import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { dateKey, today } from '../src/lib/tracker.js';
import { CalendarView } from '../src/views/CalendarView.jsx';
import { GraphView } from '../src/views/GraphView.jsx';
import { ManageView } from '../src/views/ManageView.jsx';
import { ProgressView } from '../src/views/ProgressView.jsx';
import { ProofView } from '../src/views/ProofView.jsx';
import { ProfileView } from '../src/views/ProfileView.jsx';
import { SocialView } from '../src/views/SocialView.jsx';
import { TodayView } from '../src/views/TodayView.jsx';

afterEach(cleanup);

const start = dateKey(today());
const habit = { id: 'habit', name: 'Walking', emoji: '🚶', target: 10000, unit: 'steps', days: 30, start, metric: 'weight (kg)', ramp: true };
const entries = { habit: { [start]: { done: true, rest: false, value: 10000, metric: 70, photo: null, ts: Date.now() } } };

describe('view smoke coverage', () => {
  it('renders every habit-tracking view from the shared object shapes', () => {
    const callbacks = { onSaveEntry: vi.fn(), onToggle: vi.fn(), onPhoto: vi.fn() };
    const views = [
      <TodayView habits={[habit]} entries={entries} selectedHabit={habit} {...callbacks} />,
      <ProgressView habit={habit} entries={entries} />,
      <CalendarView habit={habit} entries={entries} cursor={today()} onMove={vi.fn()} onOpenDay={vi.fn()} />,
      <GraphView habit={habit} entries={entries} flip={false} onFlip={vi.fn()} />,
      <ProofView client={{}} userId="owner" habit={habit} entries={entries} onRemove={vi.fn()} />,
      <ManageView habits={[habit]} entries={entries} onDelete={vi.fn()} onNew={vi.fn()} />,
    ];
    for (const view of views) {
      const result = render(view);
      expect(result.container.textContent.length).toBeGreaterThan(20);
      result.unmount();
    }
  });

  it('renders missing-identity guidance and the populated activity feed', () => {
    const base = { status: 'ready', error: '', message: '', requests: [], shares: [], leaderboard: [], receivedCount: 0, sendRequest: vi.fn(), updateFriendship: vi.fn(), openChat: vi.fn() };
    const setup = render(<MemoryRouter><SocialView habits={[habit]} social={{ ...base, profile: null, friends: [], feed: [] }} onOpenSharing={vi.fn()} /></MemoryRouter>);
    expect(screen.getByText('Build habits with people you trust')).toBeTruthy();
    setup.unmount();
    render(<MemoryRouter><SocialView habits={[habit]} social={{ ...base, profile: { id: 'owner', handle: 'owner', leaderboard_enabled: false }, friends: [{ id: 'friend', display_name: 'Alex', handle: 'alex', friendship_id: 'f' }], feed: [{ id: 'activity', actor_id: 'friend', person: { display_name: 'Alex' }, habit_label: 'Reading', occurred_on: start }] }} onOpenSharing={vi.fn()} /></MemoryRouter>);
    expect(screen.getByText('Friend activity')).toBeTruthy();
    expect(screen.getByText('Alex')).toBeTruthy();
  });

  it('renders editable private profile settings and account stats', () => {
    const social = { status: 'ready', message: '', profile: { id: 'owner', display_name: 'Madhav', handle: 'madhav', bio: '', discoverable: true, leaderboard_enabled: false }, friends: [], feed: [], leaderboard: [], updateProfile: vi.fn() };
    render(<ProfileView social={social} user={{ email: 'person@example.com' }} habits={[habit]} entries={entries} />);
    expect(screen.getByRole('heading', { name: 'Edit profile' })).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: /Join the friends leaderboard/ })).toBeTruthy();
    expect(screen.getByText('person@example.com')).toBeTruthy();
  });
});
