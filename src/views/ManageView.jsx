import { fmt, pct, stats } from '../lib/tracker.js';

export function ManageView({ habits, entries, onDelete, onNew }) {
  return <div className="card"><h2>Your habits</h2><p className="sub">Finished a goal or want to drop one? Delete it here — daily entries and proof photos go with it.</p>{habits.map((habit) => {
    const summary = stats(habit, entries);
    return <div className="hrow" key={habit.id}><div className="emoji">{habit.emoji}</div><div className="info"><div className="name">{habit.name}</div><div className="task">{fmt(habit.target)} {habit.unit}/day · {habit.days} days · {summary.done} done · {pct(summary.done, habit.days)}% complete · {summary.xp} pts</div><div className="bar" style={{ marginTop: 8, height: 10 }}><i style={{ width: `${pct(summary.done, habit.days)}%` }} /></div></div><button className="cta danger" onClick={() => onDelete(habit)}>Delete</button></div>;
  })}<button className="cta" onClick={onNew} style={{ marginTop: 6 }}>+ Add another habit</button></div>;
}
