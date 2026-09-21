import { addDays, dateKey, entryOf, fmt, idxOf, parseKey, pct, phases, stats, today } from '../lib/tracker.js';

const Stat = ({ value, label }) => <div className="stat"><b>{value}</b><span>{label}</span></div>;

function rangeStats(habit, entries, back) {
  let done = 0, sum = 0;
  for (let index = back; index >= 0; index -= 1) {
    const entry = entryOf(entries, habit, dateKey(addDays(today(), -index)));
    if (entry) { if (entry.done) done += 1; if (typeof entry.value === 'number') sum += entry.value; }
  }
  return { done, sum };
}

function Donut({ percent, summary }) {
  const circumference = 2 * Math.PI * 54;
  return <><svg viewBox="0 0 140 140" width="200" height="200" role="img" aria-label={`Overall progress ${percent}%`}>
    <circle cx="70" cy="70" r="54" fill="none" stroke="var(--line)" strokeWidth="16" />
    <circle cx="70" cy="70" r="54" fill="none" stroke="var(--brand)" strokeWidth="16" strokeLinecap="round" strokeDasharray={circumference.toFixed(1)} strokeDashoffset={(circumference - circumference * percent / 100).toFixed(1)} transform="rotate(-90 70 70)" />
    <text x="70" y="66" textAnchor="middle" fontSize="30" fontWeight="900" fill="var(--ink)" fontFamily="Nunito,sans-serif">{percent}%</text><text x="70" y="86" textAnchor="middle" fontSize="11" fontWeight="800" fill="var(--muted)" fontFamily="Nunito,sans-serif">GOAL COMPLETE</text>
  </svg><div className="tiny" style={{ marginTop: 10, textAlign: 'center' }}>{summary.done} done · {summary.missed} missed · {summary.remaining} to go</div></>;
}

function WeekBars({ habit, entries }) {
  const bars = [];
  for (let week = 7; week >= 0; week -= 1) {
    let done = 0;
    const end = addDays(today(), -week * 7);
    for (let index = 0; index < 7; index += 1) if (entryOf(entries, habit, dateKey(addDays(end, -index)))?.done) done += 1;
    bars.push({ done, label: week === 0 ? 'This wk' : `-${week}w` });
  }
  const width = 560, height = 170, barWidth = width / bars.length;
  return <div className="scrollx"><svg viewBox={`0 0 ${width} ${height}`} width={width} height={height}>{bars.map((bar, index) => {
    const barHeight = bar.done / 7 * 110, x = index * barWidth + barWidth * .2, y = 130 - barHeight;
    return <g key={bar.label}><rect x={x} y={y} width={barWidth * .6} height={Math.max(2, barHeight)} rx="7" fill="var(--brand)" /><text x={x + barWidth * .3} y={y - 6} textAnchor="middle" fontSize="12" fontWeight="900" fill="var(--muted)" fontFamily="Nunito,sans-serif">{bar.done}</text><text x={x + barWidth * .3} y="152" textAnchor="middle" fontSize="11" fontWeight="800" fill="var(--muted)" fontFamily="Nunito,sans-serif">{bar.label}</text></g>;
  })}</svg></div>;
}

export function ProgressView({ habit, entries }) {
  const summary = stats(habit, entries), plan = phases(habit), currentKey = dateKey(today());
  const overall = pct(summary.done, habit.days), week = rangeStats(habit, entries, 6), month = rangeStats(habit, entries, 29);
  return <>
    <div className="card"><h2>{habit.emoji} {habit.name}</h2><p className="sub">Goal: {fmt(habit.target)} {habit.unit} a day for {habit.days} days · started {new Date(`${habit.start}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</p>
      <div className="grid two"><div style={{ display: 'grid', placeItems: 'center' }}><Donut percent={overall} summary={summary} /></div><div><div className="statgrid"><Stat value={summary.streak} label="day streak" /><Stat value={`${summary.done}/${habit.days}`} label="days done" /><Stat value={`${summary.consistency}%`} label="consistency" /><Stat value={summary.best} label="best streak" /><Stat value={summary.xp} label="points earned" /></div>
        <div style={{ marginTop: 14 }}><div className="tiny">Total logged: {fmt(summary.sum)} / {fmt(summary.goalTotal)} {habit.unit}</div><div className="bar" style={{ marginTop: 6 }}><i style={{ width: `${pct(summary.sum, summary.goalTotal)}%`, background: 'var(--violet)' }} /></div></div>
        <div style={{ marginTop: 14 }}><div className="tiny">This week: {week.done}/7 days · {fmt(week.sum)} {habit.unit}</div><div className="bar" style={{ marginTop: 6 }}><i style={{ width: `${pct(week.done, 7)}%`, background: 'var(--blue)' }} /></div></div>
        <div style={{ marginTop: 14 }}><div className="tiny">Last 30 days: {month.done}/30 days · {fmt(month.sum)} {habit.unit}</div><div className="bar" style={{ marginTop: 6 }}><i style={{ width: `${pct(month.done, 30)}%`, background: 'var(--amber)' }} /></div></div>
      </div></div>
    </div>
    <div className="card"><h2>Your step-by-step plan</h2><p className="sub">The goal, broken into phases that ramp up.</p>{plan.map((phase) => {
      const index = idxOf(habit, currentKey), active = index >= phase.from && index <= phase.to, clear = index > phase.to;
      let hit = 0;
      for (let day = phase.from; day <= phase.to; day += 1) if (entryOf(entries, habit, dateKey(addDays(parseKey(habit.start), day)))?.done) hit += 1;
      return <div key={phase.i} className={`step ${active ? 'active' : ''} ${clear ? 'clear' : ''}`}><div className="dot">{clear ? '✓' : phase.i + 1}</div><div style={{ flex: 1 }}><div className="t">{phase.label}</div><div className="d">{phase.dates} · {hit}/{phase.to - phase.from + 1} days done</div><div className="bar" style={{ marginTop: 8, height: 10 }}><i style={{ width: `${pct(hit, phase.to - phase.from + 1)}%` }} /></div></div></div>;
    })}</div>
    <div className="card"><h2>Weekly rhythm</h2><p className="sub">Days completed in each of the last 8 weeks.</p><WeekBars habit={habit} entries={entries} /></div>
  </>;
}
