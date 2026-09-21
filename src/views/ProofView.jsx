import { dayLabel, fmt, parseKey } from '../lib/tracker.js';
import { ProofImage } from '../components/ProofImage.jsx';

export function ProofView({ client, userId, habit, entries, onRemove }) {
  const habitEntries = entries[habit.id] || {};
  const keys = Object.keys(habitEntries).filter((key) => habitEntries[key].photo).sort();
  if (!keys.length) return <div className="card"><h2>Proof shots</h2><p className="sub">Upload progress pics from the Today tab or a calendar day — body shots, finished pages, posted reels.</p><div className="empty"><div className="big">📸</div>Nothing uploaded yet</div></div>;
  return <div className="card"><h2>{habit.emoji} Proof shots</h2><p className="sub">{keys.length} uploads · oldest to newest</p><div className="gal">{keys.map((key) => {
    const entry = habitEntries[key];
    return <figure key={key}><ProofImage client={client} userId={userId} path={entry.photo} alt={`Proof from ${key}`} /><figcaption>{dayLabel(parseKey(key))}{entry.value != null && <><br />{fmt(entry.value)} {habit.unit}</>}</figcaption><button className="pillbtn" onClick={() => onRemove(habit, key)}>Remove</button></figure>;
  })}</div></div>;
}
