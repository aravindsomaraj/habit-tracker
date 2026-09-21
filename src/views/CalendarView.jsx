import { dateKey, entryOf, idxOf, today } from '../lib/tracker.js';

export function CalendarView({ habit, entries, cursor, onMove, onOpenDay }) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const startPad = first.getDay(), daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
  const currentKey = dateKey(today());
  const cells = [];
  for (let index = 0; index < startPad; index += 1) cells.push(<div key={`pad-${index}`} />);
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = new Date(cursor.getFullYear(), cursor.getMonth(), day), key = dateKey(date), index = idxOf(habit, key);
    const inRange = index >= 0 && index < habit.days, entry = entryOf(entries, habit, key);
    let classes = `day${inRange ? ' in' : ''}`;
    if (entry?.rest) classes += ' rest'; else if (entry?.done) classes += ' done'; else if (entry?.value) classes += ' partial'; else if (inRange && date < today()) classes += ' miss';
    if (key === currentKey) classes += ' today';
    const clickable = inRange && date <= today();
    cells.push(<div key={key} className={classes} style={clickable ? { cursor: 'pointer' } : undefined} onClick={clickable ? () => onOpenDay(key) : undefined}>{day}{entry?.photo && <span className="pin">📸</span>}</div>);
  }
  return <div className="card"><div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}><button className="pillbtn" onClick={() => onMove(-1)}>‹</button><h2 style={{ flex: 1, textAlign: 'center', margin: 0 }}>{cursor.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}</h2><button className="pillbtn" onClick={() => onMove(1)}>›</button></div>
    <p className="sub" style={{ textAlign: 'center' }}>{habit.emoji} {habit.name} — tap any past day to fill it in.</p><div className="cal">{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((label, index) => <div className="dow" key={`${label}-${index}`}>{label}</div>)}{cells}</div>
    <div className="callegend"><span><i style={{ background: 'var(--brand)' }} />Done</span><span><i style={{ background: 'var(--amber)' }} />Partial</span><span><i style={{ background: 'var(--pink)' }} />Missed</span><span><i style={{ background: 'var(--blue)' }} />Rest</span><span><i style={{ background: 'var(--violet)' }} />Today</span></div>
  </div>;
}
