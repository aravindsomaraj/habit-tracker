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

function EntryNumber({ value, placeholder, onSave }) {
  const confirmed = value ?? '';
  const [draft, setDraft] = useState(confirmed);
  useEffect(() => setDraft(confirmed), [confirmed]);
  async function commit() {
    if (String(draft) === String(confirmed)) return;
    const result = await onSave(draft === '' ? null : +draft);
    if (!result?.ok) setDraft(confirmed);
  }
  return <input type="number" inputMode="decimal" value={draft} placeholder={placeholder} onChange={(event) => setDraft(event.target.value)} onBlur={commit} />;
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
    {entryDate && <>
      <div className="metricbox"><EntryNumber value={entry?.value} placeholder="0" onSave={(value) => onSaveEntry(habit, entryDate, { value })} /><span>{habit.unit}</span></div>
      <div className="metricbox" title={habit.metric}><EntryNumber value={entry?.metric} placeholder="–" onSave={(metric) => onSaveEntry(habit, entryDate, { metric })} /><span>{habit.metric}</span></div>
      <button className="iconbtn" title="Upload proof photo" onClick={() => onPhoto(habit, entryDate)}>{entry?.photo ? '🖼️' : '📷'}</button>
      <button className={`tick ${done ? 'done' : ''} ${popping ? 'pop' : ''}`} onClick={() => onToggle(habit, entryDate, target)}>{done ? '✓' : ''}</button>
    </>}
  </div>;
}

function BadgeShelf({ habit, entries }) {
  const summary = stats(habit, entries);
  return <div className="card"><h2>🏆 Trophies — {habit.emoji} {habit.name}</h2><p className="sub">Unlocked as you go. Switch habits on the Progress tab.</p>
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
  return <>
    <div className="card"><div className="catwrap"><div className={`catbox mood-${mood}`}><img src={catImages[mood]} alt={`Mood: ${mood}`} /></div><div style={{ flex: 1, minWidth: 180 }}><div className="catlabel">{catLine(mood, doneToday, habits.length)}</div><strong style={{ fontSize: 15, display: 'block', marginTop: 2 }}>{greeting()}</strong></div></div>
      <div className="xpwrap" style={{ marginTop: 14 }}><div className="lvl" style={{ background: 'var(--brand)', boxShadow: '0 4px 0 var(--brand-dark)' }}><b>{todayPoints.earned}</b><span>TODAY</span></div><div style={{ flex: 1, minWidth: 190 }}><div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}><strong style={{ fontSize: 15 }}>Today's points</strong><span className="tiny">{todayPoints.earned} / {todayPoints.possible || 0} pts today</span></div><div className="xpbar"><i style={{ width: `${pct(todayPoints.earned, todayPoints.possible || 1)}%`, background: 'linear-gradient(90deg,var(--brand),var(--brand-dark))' }} /></div></div><div className="flame">🔥 {topStreak} day{topStreak === 1 ? '' : 's'}</div></div>
      <p className="sub" style={{ margin: '14px 0 6px' }}>{today().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })} · {doneToday} of {habits.length} done today</p><div className="bar"><i style={{ width: `${pct(doneToday, habits.length)}%` }} /></div><div className="nudge">{nudge(doneToday, habits.length, topStreak)}</div>
    </div>
    <div className="card"><h2>Today's tasks</h2><p className="sub">Clear these to fill today's bar — 10 pts for done, +5 more for hitting the full target. Resets tomorrow.</p>
      {habits.map((habit) => {
        const index = idxOf(habit, currentKey);
        if (index < 0) return <HabitRow key={habit.id} habit={habit} task={`Starts ${dayLabel(new Date(`${habit.start}T00:00:00`))}`} />;
        if (index >= habit.days) return <HabitRow key={habit.id} habit={habit} task="Goal window finished 🎉" />;
        const entry = entryOf(entries, habit, currentKey) || {};
        const target = targetFor(habit, index);
        return <HabitRow key={habit.id} habit={habit} entry={entry} task={`Day ${index + 1} of ${habit.days} · ${fmt(target)} ${habit.unit}${entry.rest ? ' · 😌 rest day' : ''}`} target={target} entryDate={currentKey} onSaveEntry={onSaveEntry} onToggle={onToggle} onPhoto={onPhoto} />;
      })}
    </div>
    <div className="card"><h2>🏦 All-time points</h2><p className="sub">Never resets — this is what today's points turn into.</p><div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}><div className="lvl" style={{ background: 'var(--violet)', boxShadow: '0 4px 0 #6d3fd6' }}><b>{total}</b><span>TOTAL</span></div><div className="tiny" style={{ flex: 1, minWidth: 160 }}>Every point you've ever earned, across every habit — this bar only grows.</div></div><PointsSparkline history={pointsHistory(habits, entries, 14)} /></div>
    <BadgeShelf habit={selectedHabit} entries={entries} />
  </>;
}
