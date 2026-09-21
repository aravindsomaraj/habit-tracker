import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dateKey, today } from '../src/lib/tracker.js';
import { CalendarView } from '../src/views/CalendarView.jsx';
import { GraphView } from '../src/views/GraphView.jsx';
import { ManageView } from '../src/views/ManageView.jsx';
import { ProgressView } from '../src/views/ProgressView.jsx';
import { ProofView } from '../src/views/ProofView.jsx';
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

  it('renders the Friends profile setup and populated feed states', () => {
    const base = { status: 'ready', error: '', message: '', requests: [], shares: [], createProfile: vi.fn(), sendRequest: vi.fn(), updateFriendship: vi.fn(), openChat: vi.fn() };
    const setup = render(<SocialView habits={[habit]} social={{ ...base, profile: null, friends: [], feed: [] }} onOpenSharing={vi.fn()} />);
    expect(screen.getByText('Set up Friends')).toBeTruthy();
    setup.unmount();
    render(<SocialView habits={[habit]} social={{ ...base, profile: { id: 'owner' }, friends: [{ id: 'friend', display_name: 'Alex', handle: 'alex', friendship_id: 'f' }], feed: [{ id: 'activity', person: { display_name: 'Alex' }, habit_label: 'Reading', occurred_on: start }] }} onOpenSharing={vi.fn()} />);
    expect(screen.getByText('Friend activity')).toBeTruthy();
    expect(screen.getByText('Message')).toBeTruthy();
  });
});
