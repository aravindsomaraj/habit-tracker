export const TEMPLATES = [
  { k: 'steps', label: '🚶 Walking', emoji: '🚶', unit: 'steps', target: 10000, days: 90, metric: 'weight (kg)' },
  { k: 'gym', label: '🏋️ Gym', emoji: '🏋️', unit: 'minutes', target: 45, days: 90, metric: 'weight (kg)' },
  { k: 'read', label: '📚 Reading', emoji: '📚', unit: 'pages', target: 20, days: 60, metric: 'pages read' },
  { k: 'diet', label: '🥗 Diet', emoji: '🥗', unit: 'kcal', target: 1800, days: 60, metric: 'weight (kg)' },
  { k: 'reels', label: '🎬 Content', emoji: '🎬', unit: 'videos', target: 1, days: 30, metric: 'views' },
  { k: 'water', label: '💧 Water', emoji: '💧', unit: 'litres', target: 3, days: 30, metric: 'litres' },
  { k: 'custom', label: '✨ Custom', emoji: '🎯', unit: 'units', target: 1, days: 30, metric: 'value' },
];

export const BADGES = [
  { k: 'first', icon: '🌱', t: 'First day', test: (s) => s.done >= 1 },
  { k: 'w1', icon: '🔥', t: '7-day streak', test: (s) => s.best >= 7 },
  { k: 'w2', icon: '⚡', t: '14 in a row', test: (s) => s.best >= 14 },
  { k: 'half', icon: '🏅', t: 'Halfway', test: (s, h) => s.done >= h.days / 2 },
  { k: 'm1', icon: '💎', t: '30-day streak', test: (s) => s.best >= 30 },
  { k: 'sharp', icon: '🎯', t: '25 targets hit', test: (s) => s.hitTarget >= 25 },
  { k: 'done', icon: '👑', t: 'Goal complete', test: (s, h) => s.done >= h.days },
];

export function dateKey(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function parseKey(value) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function today() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

export function addDays(date, amount) {
  const result = new Date(date.getTime());
  result.setDate(result.getDate() + amount);
  result.setHours(0, 0, 0, 0);
  return result;
}

export const dayDiff = (from, to) => Math.round((to - from) / 86400000);
export const pct = (amount, total) => total ? Math.max(0, Math.min(100, Math.round(amount / total * 100))) : 0;
export const dayLabel = (date) => date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

export function fmt(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '0';
  return (Math.round(value * 100) / 100).toLocaleString('en-IN');
}

export function phases(habit) {
  const count = Math.max(3, Math.min(6, Math.round(habit.days / 14))) || 3;
  const per = Math.ceil(habit.days / count);
  const start = habit.ramp ? 0.5 : 1;
  const result = [];
  for (let index = 0; index < count; index += 1) {
    const fraction = count === 1 ? 1 : start + (1 - start) * (index / (count - 1));
    const target = Math.max(1, Math.round(habit.target * fraction * 100) / 100);
    const from = index * per;
    const to = Math.min(habit.days, (index + 1) * per) - 1;
    if (from > to) break;
    result.push({
      i: index, from, to, target,
      label: `Phase ${index + 1} · ${fmt(target)} ${habit.unit}/day`,
      dates: `${dayLabel(addDays(parseKey(habit.start), from))} → ${dayLabel(addDays(parseKey(habit.start), to))}`,
    });
  }
  return result;
}

export function targetFor(habit, dayIndex) {
  return phases(habit).find((phase) => dayIndex >= phase.from && dayIndex <= phase.to)?.target ?? habit.target;
}

export const idxOf = (habit, key) => dayDiff(parseKey(habit.start), parseKey(key));
export const entryOf = (entries, habit, key) => entries[habit.id]?.[key] ?? null;

export function stats(habit, entries) {
  const habitEntries = entries[habit.id] || {};
  const current = today();
  const start = parseKey(habit.start);
  const elapsed = Math.max(0, Math.min(habit.days, dayDiff(start, current) + 1));
  let done = 0, sum = 0, missed = 0, rest = 0, xp = 0, hitTarget = 0;
  for (let index = 0; index < habit.days; index += 1) {
    const entry = habitEntries[dateKey(addDays(start, index))];
    if (entry?.rest) { rest += 1; continue; }
    if (entry?.done) {
      done += 1; xp += 10;
      if (typeof entry.value === 'number' && entry.value >= targetFor(habit, index)) { xp += 5; hitTarget += 1; }
    }
    if (typeof entry?.value === 'number') sum += entry.value;
    if (index < dayDiff(start, current) && !entry?.done) missed += 1;
  }
  let streak = 0, cursor = new Date(current), guard = 0;
  while (guard++ < 800) {
    const entry = habitEntries[dateKey(cursor)];
    if (entry?.done) { streak += 1; cursor = addDays(cursor, -1); continue; }
    if (entry?.rest) { cursor = addDays(cursor, -1); continue; }
    if (dateKey(cursor) === dateKey(current)) { cursor = addDays(cursor, -1); continue; }
    break;
  }
  let best = 0, run = 0;
  for (let index = 0; index < habit.days; index += 1) {
    const entry = habitEntries[dateKey(addDays(start, index))];
    if (entry?.rest) continue;
    if (entry?.done) { run += 1; best = Math.max(best, run); } else run = 0;
  }
  let goalTotal = 0;
  for (let index = 0; index < habit.days; index += 1) goalTotal += targetFor(habit, index);
  return {
    elapsed, done, missed, rest, sum, streak, best, goalTotal, xp, hitTarget,
    remaining: Math.max(0, habit.days - done - missed),
    consistency: pct(done, Math.max(1, dayDiff(start, current) + 1 - rest)),
  };
}

export const totalXP = (habits, entries) => habits.reduce((sum, habit) => sum + stats(habit, entries).xp, 0);

export function levelOf(xp) {
  let lvl = 1, need = 100, into = xp;
  while (into >= need) { into -= need; lvl += 1; need = Math.round(need * 1.25); }
  return { lvl, into, need };
}

export function habitsActiveOn(habits, key) {
  return habits.filter((habit) => { const index = idxOf(habit, key); return index >= 0 && index < habit.days; });
}

export function pointsForDay(habits, entries, key) {
  let earned = 0, possible = 0;
  habitsActiveOn(habits, key).forEach((habit) => {
    possible += 15;
    const entry = entryOf(entries, habit, key);
    if (entry?.rest) { possible -= 15; return; }
    if (entry?.done) {
      earned += 10;
      if (typeof entry.value === 'number' && entry.value >= targetFor(habit, idxOf(habit, key))) earned += 5;
    }
  });
  return { earned, possible };
}

export function pointsHistory(habits, entries, days) {
  const current = today();
  return Array.from({ length: days }, (_, index) => {
    const date = addDays(current, -(days - 1 - index));
    const key = dateKey(date);
    return { d: date, k: key, p: pointsForDay(habits, entries, key).earned };
  });
}
