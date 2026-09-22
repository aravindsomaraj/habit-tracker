import catHappy from '../../assets/images/cat-1.png';
import catMeh from '../../assets/images/cat-2.png';
import catSad from '../../assets/images/cat-3.png';
import { useEffect, useRef, useState } from 'react';
import {
  BADGES, dateKey, dayLabel, entryOf, fmt, idxOf, pct, pointsForDay, pointsHistory,
  stats, targetFor, today, totalXP,
} from '../lib/tracker.js';

const catImages = { happy: catHappy, meh: catMeh, sad: catSad };

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning, let's go 👋" : hour < 17 ? 'Afternoon check-in ☀️' : 'Evening wrap-up 🌙';
}

function catMood(done, total) { if (!total) return 'meh'; return done / total >= .7 ? 'happy' : done ? 'meh' : 'sad'; }
function catLine(mood, done, total) {
  if (mood === 'happy') return total && done === total ? 'All done — purring with pride 😻' : 'Great pace — keep it up 🐾';
  if (mood === 'meh') return 'Making some progress — a few more to go';
  return 'Nothing logged yet — one tick and the mood lifts';
}
function nudge(done, total, streak) {
  if (total && done === total) return '✅ Clean sweep. Come back tomorrow and the streak keeps climbing.';
  if (streak >= 7) return `🔥 ${streak} days deep — one tick today and the chain stays unbroken.`;
  if (done > 0) return `💪 ${done} down, ${total - done} to go. Finish the set.`;
  if (streak > 0) return `⏳ Nothing logged yet today. Your ${streak}-day streak is waiting on you.`;
  return '🌱 Start small. Day one only has to happen once.';
}

function PointsSparkline({ history }) {
  const max = Math.max(15, ...history.map((point) => point.p)) * 1.15;
  const width = 560, height = 130, pad = 8, plot = width - pad * 2;
  const points = history.map((point, index) => ({ x: pad + index / (history.length - 1) * plot, y: height - 24 - point.p / max * (height - 44), point }));
  const line = points.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  const area = `${line} L${points.at(-1).x.toFixed(1)} ${height - 24} L${points[0].x.toFixed(1)} ${height - 24} Z`;
  return <><div className="scrollx"><svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height}>
    <defs><linearGradient id="pspark" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--violet)" stopOpacity="0.35" /><stop offset="100%" stopColor="var(--violet)" stopOpacity="0" /></linearGradient></defs>
    <path d={area} fill="url(#pspark)" /><path d={line} fill="none" stroke="var(--violet)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    {points.map((point) => <circle key={point.point.k} cx={point.x} cy={point.y} r="3.2" fill="var(--violet)"><title>{dayLabel(point.point.d)}: {point.point.p} pts</title></circle>)}
    {points.filter((_, index) => index % 3 === 0).map((point) => <text key={point.point.k} x={point.x} y={height - 6} textAnchor="middle" fontSize="10" fontWeight="800" fill="var(--muted)" fontFamily="Nunito,sans-serif">{dayLabel(point.point.d)}</text>)}
  </svg></div><p className="tiny" style={{ marginTop: 4 }}>Points earned per day — last 14 days</p></>;
}

function EntryNumber({ value, placeholder, label, onSave }) {
  const confirmed = value ?? '';
  const [draft, setDraft] = useState(confirmed);
  useEffect(() => setDraft(confirmed), [confirmed]);
  async function commit() {
    if (String(draft) === String(confirmed)) return;
    const result = await onSave(draft === '' ? null : +draft);
    if (!result?.ok) setDraft(confirmed);
  }
  return <input aria-label={label} type="number" inputMode="decimal" value={draft} placeholder={placeholder} onChange={(event) => setDraft(event.target.value)} onBlur={commit} />;
}

function HabitRow({ habit, entry, task, target, entryDate, onSaveEntry, onToggle, onPhoto }) {
  const done = entry?.done;
  const previousDone = useRef(done);
  const [popping, setPopping] = useState(false);
  useEffect(() => {
    if (!previousDone.current && done) {
      setPopping(true);
      const timer = window.setTimeout(() => setPopping(false), 500);
      previousDone.current = done;
      return () => window.clearTimeout(timer);
    }
    previousDone.current = done;
    return undefined;
  }, [done]);
  return <div className="hrow">
    <div className="emoji">{habit.emoji}</div><div className="info"><div className="name">{habit.name}</div><div className="task">{task}</div></div>
    {entryDate && <div className="habit-controls">
      <div className="metricbox"><EntryNumber label={`${habit.name}: ${habit.unit}`} value={entry?.value} placeholder="0" onSave={(value) => onSaveEntry(habit, entryDate, { value })} /><span>{habit.unit}</span></div>
      <div className="metricbox" title={habit.metric}><EntryNumber label={`${habit.name}: ${habit.metric}`} value={entry?.metric} placeholder="–" onSave={(metric) => onSaveEntry(habit, entryDate, { metric })} /><span>{habit.metric}</span></div>
      <button className="iconbtn" title="Upload proof photo" onClick={() => onPhoto(habit, entryDate)}>{entry?.photo ? '🖼️' : '📷'}</button>
      <button aria-label={`Mark ${habit.name} ${done ? 'incomplete' : 'done'}`} aria-pressed={!!done} className={`tick ${done ? 'done' : ''} ${popping ? 'pop' : ''}`} onClick={() => onToggle(habit, entryDate, target)}>{done ? '✓ Done' : 'Mark done'}</button>
    </div>}
  </div>;
}

function BadgeShelf({ habit, entries }) {
  const summary = stats(habit, entries);
  return <div className="card trophy-card"><span className="eyebrow">THE COLLECTION</span><h2>Trophies</h2><p className="tiny">{habit.emoji} {habit.name}</p><p className="sub">Unlocked as you go. Switch habits on the Progress tab.</p>
    <div className="badges">{BADGES.map((badge) => { const got = badge.test(summary, habit); return <div key={badge.k} className={`badge ${got ? 'got' : ''}`}><div className="b">{got ? badge.icon : '🔒'}</div><small>{badge.t}</small></div>; })}</div>
  </div>;
}

export function TodayView({ habits, entries, selectedHabit, onSaveEntry, onToggle, onPhoto }) {
  const currentKey = dateKey(today());
  const doneToday = habits.filter((habit) => entryOf(entries, habit, currentKey)?.done).length;
  const todayPoints = pointsForDay(habits, entries, currentKey);
  const total = totalXP(habits, entries);
  const topStreak = Math.max(...habits.map((habit) => stats(habit, entries).streak));
  const mood = catMood(doneToday, habits.length);
  return <div className="today-layout">
    <div className="daily-stats" aria-label="Daily summary">
      <div><span>HABITS COMPLETED</span><strong>{doneToday}<small> / {habits.length}</small></strong><p>One check at a time</p></div>
      <div><span>TODAY'S POINTS</span><strong>{todayPoints.earned}<small> / {todayPoints.possible || 0}</small></strong><p>A fresh start each day</p></div>
      <div><span>LONGEST ACTIVE STREAK</span><strong>{topStreak}<small> days</small></strong><p>Keep showing up</p></div>
      <div><span>ALL-TIME POINTS</span><strong>{total}</strong><p>Every effort adds up</p></div>
    </div>
    <div className="daily-primary">
    <section className="card today-tasks">
      <div className="section-heading"><div><span className="eyebrow">01 / DAILY PRACTICE</span><h2>Today's tasks</h2></div><span className="count-label">{doneToday} of {habits.length} done</span></div>
      <p className="sub">Your habits. Your pace. Start with one.</p>
      {habits.map((habit) => {
        const index = idxOf(habit, currentKey);
        if (index < 0) return <HabitRow key={habit.id} habit={habit} task={`Starts ${dayLabel(new Date(`${habit.start}T00:00:00`))}`} />;
        if (index >= habit.days) return <HabitRow key={habit.id} habit={habit} task="Goal window finished 🎉" />;
        const entry = entryOf(entries, habit, currentKey) || {};
        const target = targetFor(habit, index);
        return <HabitRow key={habit.id} habit={habit} entry={entry} task={`Day ${index + 1} of ${habit.days} · ${fmt(target)} ${habit.unit}${entry.rest ? ' · 😌 rest day' : ''}`} target={target} entryDate={currentKey} onSaveEntry={onSaveEntry} onToggle={onToggle} onPhoto={onPhoto} />;
      })}
      <p className="task-footnote">10 points for completing a habit · +5 for reaching its target</p>
    </section>
    <section className="card history-card"><div className="section-heading"><div><span className="eyebrow">02 / THE BIGGER PICTURE</span><h2>Your rhythm</h2></div><span className="count-label">LAST 14 DAYS</span></div><p className="sub">Daily points across all your habits.</p><PointsSparkline history={pointsHistory(habits, entries, 14)} /></section>
    </div>
    <aside className="daily-aside">
      <section className="card daily-progress"><span className="eyebrow">A LITTLE CLOSER</span><h2>Today's progress</h2>
        <div className="completion-number">{pct(doneToday, habits.length)}<span>%</span></div>
        <div className="progress-blocks" role="progressbar" aria-label="Today's habit completion" aria-valuenow={pct(doneToday, habits.length)} aria-valuemin={0} aria-valuemax={100}>{Array.from({length:12},(_,i)=><i key={i} className={i < Math.round(doneToday / Math.max(habits.length,1) * 12) ? 'filled' : ''} />)}</div>
        <p className="tiny">{habits.length - doneToday} habit{habits.length - doneToday === 1 ? '' : 's'} left to complete today.</p>
        <div className="companion"><div className={`catbox mood-${mood}`}><img src={catImages[mood]} alt={`Mood: ${mood}`} /></div><div><strong>{greeting()}</strong><p>{catLine(mood, doneToday, habits.length)}</p></div></div>
        <div className="nudge">{nudge(doneToday, habits.length, topStreak)}</div>
      </section>
      <BadgeShelf habit={selectedHabit} entries={entries} />
    </aside>

  </div>;
}
