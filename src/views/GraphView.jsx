import { addDays, dateKey, dayDiff, dayLabel, entryOf, fmt, parseKey, targetFor, today } from '../lib/tracker.js';

function LineChart({ points, field, targetField, flip }) {
  const values = points.filter((point) => point[field] != null).map((point) => point[field]);
  if (targetField) points.forEach((point) => values.push(point[targetField]));
  if (!values.length) return <div className="empty">Log a few days and the graph fills in 📈</div>;
  const max = Math.max(...values) * 1.15, min = 0;
  const width = flip ? 420 : 620, height = flip ? Math.max(320, points.length * 16) : 280, pad = 44;
  const x = (point) => flip ? pad + ((point[field] ?? 0) - min) / (max - min || 1) * (width - pad - 16) : pad + point.i / Math.max(1, points.length - 1) * (width - pad - 16);
  const y = (point) => flip ? 20 + point.i / Math.max(1, points.length - 1) * (height - 40) : height - 30 - ((point[field] ?? 0) - min) / (max - min || 1) * (height - 60);
  const have = points.filter((point) => point[field] != null);
  const path = have.map((point, index) => `${index ? 'L' : 'M'}${x(point).toFixed(1)} ${y(point).toFixed(1)}`).join(' ');
  const targetPath = targetField ? points.map((point, index) => {
    const target = { [field]: point[targetField], i: point.i };
    return `${index ? 'L' : 'M'}${x(target).toFixed(1)} ${y(target).toFixed(1)}`;
  }).join(' ') : '';
  const step = Math.max(1, Math.ceil(points.length / 7));
  return <><div className="scrollx"><svg viewBox={`0 0 ${width} ${height}`} width={width} height={height}>
    {Array.from({ length: 5 }, (_, index) => {
      const value = min + (max - min) * index / 4;
      if (!flip) { const lineY = height - 30 - index / 4 * (height - 60); return <g key={index}><line x1={pad} y1={lineY} x2={width - 16} y2={lineY} stroke="var(--line)" strokeWidth="1" /><text x={pad - 8} y={lineY + 4} textAnchor="end" fontSize="10" fontWeight="800" fill="var(--muted)" fontFamily="Nunito,sans-serif">{fmt(value)}</text></g>; }
      const lineX = pad + index / 4 * (width - pad - 16); return <g key={index}><line x1={lineX} y1="16" x2={lineX} y2={height - 20} stroke="var(--line)" strokeWidth="1" /><text x={lineX} y={height - 6} textAnchor="middle" fontSize="10" fontWeight="800" fill="var(--muted)" fontFamily="Nunito,sans-serif">{fmt(value)}</text></g>;
    })}
    {targetPath && <path d={targetPath} fill="none" stroke="var(--violet)" strokeWidth="2" strokeDasharray="6 6" />}
    <path d={path} fill="none" stroke="var(--brand)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    {have.map((point) => <circle key={point.i} cx={x(point)} cy={y(point)} r="4" fill="var(--brand)"><title>{dayLabel(point.d)}: {fmt(point[field])}</title></circle>)}
    {points.filter((point) => point.i % step === 0).map((point) => !flip
      ? <text key={point.i} x={x(point)} y={height - 10} textAnchor="middle" fontSize="10" fontWeight="800" fill="var(--muted)" fontFamily="Nunito,sans-serif">{dayLabel(point.d)}</text>
      : <text key={point.i} x={pad - 6} y={y(point) + 3} textAnchor="end" fontSize="10" fontWeight="800" fill="var(--muted)" fontFamily="Nunito,sans-serif">{dayLabel(point.d)}</text>)}
  </svg></div>{targetField && <div className="tiny" style={{ marginTop: 8 }}><span style={{ color: 'var(--brand)' }}>■</span> logged &nbsp; <span style={{ color: 'var(--violet)' }}>▬</span> target</div>}</>;
}

export function GraphView({ habit, entries, flip, onFlip }) {
  const start = parseKey(habit.start), span = Math.min(habit.days, Math.max(7, dayDiff(start, today()) + 1));
  const points = Array.from({ length: span }, (_, index) => {
    const date = addDays(start, index), entry = entryOf(entries, habit, dateKey(date));
    return { i: index, d: date, v: typeof entry?.value === 'number' ? entry.value : null, tgt: targetFor(habit, index), m: typeof entry?.metric === 'number' ? entry.metric : null };
  });
  return <><div className="card"><div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}><div style={{ flex: 1 }}><h2>{habit.unit} per day</h2><p className="sub" style={{ margin: 0 }}>Your logged {habit.unit} against the phase target.</p></div><button className="pillbtn" onClick={onFlip}>🔄 Flip axes</button></div><div style={{ marginTop: 14 }}><LineChart points={points} field="v" targetField="tgt" flip={flip} /></div></div>
    {points.some((point) => point.m != null) && <div className="card"><h2>{habit.metric} over time</h2><p className="sub">Your measurable side-metric.</p><LineChart points={points} field="m" flip={flip} /></div>}
  </>;
}
