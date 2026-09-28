import { useState } from 'react';

const moods = [
  ['Joyful', '#ef7db5', 'M18 8a10 10 0 1 1 0 20 10 10 0 1 1 0-20zM42 8a10 10 0 1 1 0 20 10 10 0 1 1 0-20zM18 32a10 10 0 1 1 0 20 10 10 0 1 1 0-20zM42 32a10 10 0 1 1 0 20 10 10 0 1 1 0-20zM18 18h24v24H18z'],
  ['Calm', '#9b6bc9', 'M30 5a25 25 0 1 1 0 50 25 25 0 1 1 0-50z'],
  ['Energized', '#a98bd3', 'M6 20a10 10 0 0 1 14-9 10 10 0 0 1 20 0 10 10 0 0 1 14 9v24a10 10 0 0 1-10 10H16A10 10 0 0 1 6 44z'],
  ['Sensitive', '#47a3ff', 'M6 48V30C6 15 17 6 30 6s24 9 24 24v18a6 6 0 0 1-6 6H12a6 6 0 0 1-6-6z'],
  ['Stressed', '#4caf63', 'M30 6L55 50Q58 56 50 56H10Q2 56 5 50z'],
  ['Tired', '#f5a83a', 'M8 18a10 10 0 0 1 10-10h24a10 10 0 0 1 10 10v24a10 10 0 0 1-10 10H18A10 10 0 0 1 8 42z'],
];

export function MoodCheckIn({ userId, date }) {
  const key = `habit-mood:${userId}:${date}`;
  const [selected, setSelected] = useState(() => {
    try { return localStorage.getItem(key); } catch { return null; }
  });
  const [error, setError] = useState('');
  function select(label) {
    setSelected(label);
    try { localStorage.setItem(key, label); setError(''); } catch { setError('Your mood could not be saved on this device.'); }
  }
  return <section className="mood-section" aria-labelledby="mood-title"><h2 id="mood-title" className="section-title">How do you feel?</h2><p className="sub">A quick mood check-in for the day.</p>
    <div className="moods">{moods.map(([label, color, path], index) => <button key={label} className={`mood ${selected === label ? 'on' : ''}`} aria-pressed={selected === label} onClick={() => select(label)}>
      <svg viewBox="0 0 60 60" aria-hidden="true"><path d={path} fill={color} /><g transform={`translate(0 ${index === 4 ? 8 : 0})`} stroke="#16151f" strokeWidth="2.4" fill="none" strokeLinecap="round"><path d="M20 27q3 3 6 0M34 27q3 3 6 0M24 35q6 5 12 0" /></g></svg>{label}
    </button>)}</div><p className="mood-note">Saved on this device.</p>{error && <p role="status" className="sub">{error}</p>}
  </section>;
}
