import { DecorativeShapes } from '../components/DecorativeShapes.jsx';
import { MoodCheckIn } from '../components/MoodCheckIn.jsx';
import catHappy from '../../assets/images/cat-1.png';
import catMeh from '../../assets/images/cat-2.png';
import catSad from '../../assets/images/cat-3.png';
import { useEffect, useRef, useState } from 'react';
import {
  BADGES, addDays, habitsActiveOn, parseKey, dateKey, dayLabel, entryOf, fmt, idxOf, pct, pointsForDay, pointsHistory,
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
    <div className="emoji">{habit.emoji}</div><div className="info"><h3 className="name">{habit.name}</h3><div className="task">{task}</div></div>
    {entryDate && <button className={`check-circle ${done ? "done" : ""}`} aria-label={`Toggle ${habit.name} completion`} aria-pressed={!!done} onClick={() => onToggle(habit, entryDate, target)}>{done ? "✓" : ""}</button>}
    {entryDate && <div className="habit-controls">
      <div className="metricbox"><EntryNumber label={`${habit.name}: ${habit.unit}`} value={entry?.value} placeholder={String(target)} onSave={(value) => onSaveEntry(habit, entryDate, { value })} /><span>{habit.unit}</span></div>
      {habit.metric && <div className="metricbox" title={habit.metric}><EntryNumber label={`${habit.name}: ${habit.metric}`} value={entry?.metric} placeholder="–" onSave={(metric) => onSaveEntry(habit, entryDate, { metric })} /><span>{habit.metric}</span></div>}
      <button className="iconbtn" aria-label={`Upload proof photo for ${habit.name}`} title="Upload proof photo" onClick={() => onPhoto(habit, entryDate)}>{entry?.photo ? '🖼️' : '📷'}</button>
      <button aria-label={`Mark ${habit.name} ${done ? 'incomplete' : 'done'}`} aria-pressed={!!done} className={`tick ${done ? 'done' : ''} ${popping ? 'pop' : ''}`} onClick={() => onToggle(habit, entryDate, target)}>{done ? 'Undo' : 'Mark done'}</button>
    </div>}
    {entryDate && <p className="habit-points">{done ? `+${10 + (entry.value >= target ? 5 : 0)} pts earned` : "10 pts for done · +5 for reaching the target"}</p>}
  </div>;
}

function BadgeShelf({ habit, entries }) {
  const summary = stats(habit, entries);
  return <div className="card trophy-card"><span className="eyebrow">THE COLLECTION</span><h2>Trophies</h2><p className="tiny">{habit.emoji} {habit.name}</p><p className="sub">Unlocked as you go. Switch habits on the Progress tab.</p>
    <div className="badges">{BADGES.map((badge) => { const got = badge.test(summary, habit); return <div key={badge.k} className={`badge ${got ? 'got' : ''}`}><div className="b">{got ? badge.icon : '🔒'}</div><small>{badge.t}</small></div>; })}</div>
  </div>;
}

export function TodayView({ userId = 'local', habits, entries, selectedHabit, onSaveEntry, onToggle, onPhoto }) {
  const [selectedDate, setSelectedDate] = useState(() => dateKey(today()));
  const currentKey = selectedDate;
  const active = habitsActiveOn(habits, currentKey);
  const doneToday = active.filter((habit) => entryOf(entries, habit, currentKey)?.done).length;
  const todayPoints = pointsForDay(habits, entries, currentKey);
  const total = totalXP(habits, entries);
  const topStreak = Math.max(0, ...habits.map((habit) => stats(habit, entries).streak));
  const mood = catMood(doneToday, active.length);
  const selectedDay = parseKey(currentKey);
  const week = Array.from({ length: 7 }, (_, index) => addDays(selectedDay, index - selectedDay.getDay()));
  return <div className="today-layout">
    <section className="challenge" aria-label="Daily summary">
      <DecorativeShapes /><h2>{currentKey === dateKey(today()) ? "Today's challenge" : 'Fill in the day'}</h2>
      <p>{doneToday} of {active.length} habits done · {currentKey === dateKey(today()) ? 'clear them before midnight' : dayLabel(selectedDay)}</p>
      <div className="challenge-chips"><span>{todayPoints.earned} / {todayPoints.possible} pts {currentKey === dateKey(today()) ? 'today' : 'earned'}</span><span>🔥 {topStreak} days</span></div>
      <div className="bar" role="progressbar" aria-label="Daily points" aria-valuenow={pct(todayPoints.earned, todayPoints.possible)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${pct(todayPoints.earned, todayPoints.possible)}%` }} /></div>
      <div className="challenge-tip">{nudge(doneToday, active.length, topStreak)}</div>
    </section>
    <div className="week-strip" aria-label="Choose a day">{week.map((date) => {
      const key = dateKey(date), complete = habits.some((habit) => entryOf(entries, habit, key)?.done);
      return <button key={key} className={key === currentKey ? 'on' : ''} aria-label={date.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })} aria-pressed={key === currentKey} disabled={date > today()} onClick={() => setSelectedDate(key)}><small>{complete ? '★' : date.toLocaleDateString('en-IN', { weekday: 'short' })}</small><b>{date.getDate()}</b></button>;
    })}</div>
    <div className="daily-primary">
    <section className="card today-tasks">
      <h2 className="section-title">Your plan</h2>
      <p className="sub">10 pts for done, +5 more for hitting the full target. Resets tomorrow.</p>
      {habits.map((habit) => {
        const index = idxOf(habit, currentKey);
        if (index < 0) return <HabitRow key={habit.id} habit={habit} task={`Starts ${dayLabel(new Date(`${habit.start}T00:00:00`))}`} />;
        if (index >= habit.days) return <HabitRow key={habit.id} habit={habit} task="Goal window finished 🎉" />;
        const entry = entryOf(entries, habit, currentKey) || {};
        const target = targetFor(habit, index);
        return <HabitRow key={`${habit.id}:${currentKey}`} habit={habit} entry={entry} task={`Day ${index + 1} of ${habit.days} · ${fmt(target)} ${habit.unit}${entry.rest ? ' · 😌 rest day' : ''}`} target={target} entryDate={currentKey} onSaveEntry={onSaveEntry} onToggle={onToggle} onPhoto={onPhoto} />;
      })}
    </section>
    <MoodCheckIn key={`${userId}:${currentKey}`} userId={userId} date={currentKey} />
    <section className="card history-card"><div className="section-heading"><div><h2>Your rhythm</h2></div><span className="count-label">LAST 14 DAYS</span></div><p className="sub">Daily points across all your habits.</p><PointsSparkline history={pointsHistory(habits, entries, 14)} /></section>
    </div>
    <aside className="daily-aside">
      <section className="card daily-progress"><span className="eyebrow">A LITTLE CLOSER</span><h2>{currentKey === dateKey(today()) ? "Today's progress" : 'Day progress'}</h2>
        <div className="completion-number">{pct(doneToday, active.length)}<span>%</span></div>
        <div className="progress-blocks" role="progressbar" aria-label="Today's habit completion" aria-valuenow={pct(doneToday, active.length)} aria-valuemin={0} aria-valuemax={100}>{Array.from({length:12},(_,i)=><i key={i} className={i < Math.round(doneToday / Math.max(active.length,1) * 12) ? 'filled' : ''} />)}</div>
        <p className="tiny">{active.length - doneToday} habit{active.length - doneToday === 1 ? '' : 's'} left to complete {currentKey === dateKey(today()) ? 'today' : 'on this day'}.</p>
        <div className="companion"><div className={`catbox mood-${mood}`}><img src={catImages[mood]} alt={`Mood: ${mood}`} /></div><div><strong>{greeting()}</strong><p>{catLine(mood, doneToday, active.length)}</p></div></div>
        <div className="nudge">{nudge(doneToday, active.length, topStreak)}</div>
      </section>
      <p className="all-time-points">{fmt(total)} all-time points</p>
      <BadgeShelf habit={selectedHabit} entries={entries} />
    </aside>

  </div>;
}
