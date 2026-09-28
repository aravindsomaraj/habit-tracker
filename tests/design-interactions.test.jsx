import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TodayView } from '../src/views/TodayView.jsx';
import { MoodCheckIn } from '../src/components/MoodCheckIn.jsx';
import { addDays, dateKey, today } from '../src/lib/tracker.js';

const habit = { id: 'walking', name: 'Walking', emoji: '🚶', target: 10000, unit: 'steps', days: 90, start: dateKey(addDays(today(), -14)), metric: 'weight (kg)', ramp: false };
afterEach(() => { cleanup(); localStorage.clear(); });

describe('redesigned Today interactions', () => {
  it('saves metrics and sends completion and proof actions through the existing callbacks', async () => {
    const onSaveEntry = vi.fn().mockResolvedValue({ ok: true }), onToggle = vi.fn(), onPhoto = vi.fn();
    render(<TodayView userId="owner" habits={[habit]} entries={{}} selectedHabit={habit} onSaveEntry={onSaveEntry} onToggle={onToggle} onPhoto={onPhoto} />);
    const input = screen.getByRole('spinbutton', { name: 'Walking: steps' });
    fireEvent.change(input, { target: { value: '7500' } });
    fireEvent.blur(input);
    await waitFor(() => expect(onSaveEntry).toHaveBeenCalledWith(habit, dateKey(today()), { value: 7500 }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark Walking done' }));
    expect(onToggle).toHaveBeenCalledWith(habit, dateKey(today()), 10000);
    fireEvent.click(screen.getByRole('button', { name: 'Upload proof photo for Walking' }));
    expect(onPhoto).toHaveBeenCalledWith(habit, dateKey(today()));
  });

  it('opens the selected day with its own entries and keeps future days disabled', () => {
    const onToggle = vi.fn();
    const sunday = addDays(today(), -today().getDay());
    const key = dateKey(sunday);
    render(<TodayView userId="owner" habits={[habit]} entries={{ walking: { [key]: { value: 4000, done: true } } }} selectedHabit={habit} onSaveEntry={vi.fn()} onToggle={onToggle} onPhoto={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: sunday.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }) }));
    expect(screen.getByRole('spinbutton', { name: 'Walking: steps' }).value).toBe('4000');
    fireEvent.click(screen.getByRole('button', { name: 'Mark Walking incomplete' }));
    expect(onToggle).toHaveBeenCalledWith(habit, key, 10000);
    for (let i = today().getDay() + 1; i < 7; i++) {
      const future = addDays(sunday, i);
      expect(screen.getByRole('button', { name: future.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' }) }).disabled).toBe(true);
    }
  });

  it('keeps future and finished habits visible without completion controls', () => {
    const future = { ...habit, id: 'future', name: 'Future', start: dateKey(addDays(today(), 2)) };
    const finished = { ...habit, id: 'finished', name: 'Finished', days: 1 };
    render(<TodayView habits={[future, finished]} entries={{}} selectedHabit={future} onSaveEntry={vi.fn()} onToggle={vi.fn()} onPhoto={vi.fn()} />);
    expect(screen.getByText('Future')).toBeTruthy();
    expect(screen.getByText('Goal window finished 🎉')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Mark .* done/ })).toBeNull();
    expect(screen.getByText(/0 of 0 habits done/)).toBeTruthy();
  });

  it('persists mood per user and date', () => {
    const first = render(<MoodCheckIn userId="one" date="2026-09-28" />);
    fireEvent.click(screen.getByRole('button', { name: 'Calm' }));
    first.unmount();
    const again = render(<MoodCheckIn userId="one" date="2026-09-28" />);
    expect(screen.getByRole('button', { name: 'Calm' }).getAttribute('aria-pressed')).toBe('true');
    again.unmount();
    const other = render(<MoodCheckIn userId="two" date="2026-09-28" />);
    expect(screen.getByRole('button', { name: 'Calm' }).getAttribute('aria-pressed')).toBe('false');
    other.unmount();
    render(<MoodCheckIn userId="one" date="2026-09-29" />);
    expect(screen.getByRole('button', { name: 'Calm' }).getAttribute('aria-pressed')).toBe('false');
  });
});
