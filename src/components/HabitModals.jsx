import { useState } from 'react';
import { ProofImage } from './ProofImage.jsx';
import { TEMPLATES, dateKey, fmt, idxOf, targetFor, today } from '../lib/tracker.js';

export function NewHabitModal({ initialTemplate = 'steps', onTemplateChange, onCancel, onCreate }) {
  const [templateKey, setTemplateKey] = useState(initialTemplate);
  const template = TEMPLATES.find((item) => item.k === templateKey);
  const [fields, setFields] = useState(() => fieldsFor(template));
  function selectTemplate(nextKey) {
    const next = TEMPLATES.find((item) => item.k === nextKey);
    setTemplateKey(nextKey); setFields(fieldsFor(next));
    onTemplateChange?.(nextKey);
  }
  const update = (name, value) => setFields((current) => ({ ...current, [name]: value }));
  function submit() {
    onCreate({
      name: fields.name.trim() || 'My habit', emoji: fields.emoji.trim() || '🎯',
      target: Math.max(.1, +fields.target || 1), unit: fields.unit.trim() || 'units',
      days: Math.max(1, Math.min(730, Math.round(+fields.days) || 30)), start: fields.start || dateKey(today()),
      metric: fields.metric.trim() || 'value', ramp: fields.ramp,
    });
  }
  return <><h3>New habit</h3><div className="chips">{TEMPLATES.map((item) => <button key={item.k} className={`chip ${item.k === templateKey ? 'on' : ''}`} onClick={() => selectTemplate(item.k)}>{item.label}</button>)}</div>
    <label className="f"><span>Habit name</span><input value={fields.name} onChange={(event) => update('name', event.target.value)} placeholder="e.g. Walk 10k steps" /></label>
    <div className="row2"><label className="f"><span>Daily goal</span><input type="number" value={fields.target} onChange={(event) => update('target', event.target.value)} /></label><label className="f"><span>Unit</span><input value={fields.unit} onChange={(event) => update('unit', event.target.value)} /></label></div>
    <div className="row2"><label className="f"><span>Duration (days)</span><input type="number" value={fields.days} onChange={(event) => update('days', event.target.value)} /></label><label className="f"><span>Start date</span><input type="date" value={fields.start} onChange={(event) => update('start', event.target.value)} /></label></div>
    <label className="f"><span>Extra metric to track</span><input value={fields.metric} onChange={(event) => update('metric', event.target.value)} placeholder="weight (kg), views, bodyfat %" /></label>
    <label className="f"><span>Emoji</span><input value={fields.emoji} onChange={(event) => update('emoji', event.target.value)} maxLength="4" style={{ width: 90 }} /></label>
    <label className="f" style={{ display: 'flex', gap: 10, alignItems: 'center' }}><input type="checkbox" checked={fields.ramp} onChange={(event) => update('ramp', event.target.checked)} style={{ width: 20, height: 20 }} /><span style={{ margin: 0, textTransform: 'none', letterSpacing: 0, fontSize: 14, color: 'var(--ink)' }}>Ease in — start at half the goal and ramp up</span></label>
    <div className="modal-actions"><button className="cta ghost" onClick={onCancel}>Cancel</button><button className="cta" onClick={submit}>Create plan</button></div>
  </>;
}

function fieldsFor(template) {
  return { name: template.k === 'custom' ? '' : template.label.replace(/^\S+\s/, ''), target: template.target, unit: template.unit, days: template.days, start: dateKey(today()), metric: template.metric, emoji: template.emoji, ramp: true };
}

export function DayModal({ client, userId, habit, entryDate, entry, onClose, onSave, onRest, onPhoto, onRemovePhoto }) {
  const [value, setValue] = useState(entry?.value ?? ''), [metric, setMetric] = useState(entry?.metric ?? '');
  const index = idxOf(habit, entryDate);
  return <><h3>{new Date(`${entryDate}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}</h3><p className="sub">{habit.emoji} {habit.name} · day {index + 1} target {fmt(targetFor(habit, index))} {habit.unit}</p>
    <div className="row2"><label className="f"><span>{habit.unit} done</span><input type="number" value={value} onChange={(event) => setValue(event.target.value)} /></label><label className="f"><span>{habit.metric}</span><input type="number" value={metric} onChange={(event) => setMetric(event.target.value)} /></label></div>
    {entry?.photo && <ProofImage client={client} userId={userId} path={entry.photo} alt={`Proof from ${entryDate}`} />}
    <button className="cta ghost" onClick={onPhoto}>📷 {entry?.photo ? 'Replace' : 'Add'} proof photo</button>{entry?.photo && <button className="pillbtn" onClick={onRemovePhoto}>Remove photo</button>}<button className="cta ghost" style={{ marginLeft: 8 }} onClick={onRest}>😌 Rest day</button>
    <p className="tiny" style={{ marginTop: 10 }}>A rest day pauses your streak instead of breaking it — planned time off beats guilt.</p><div className="modal-actions"><button className="cta ghost" onClick={onClose}>Close</button><button className="cta" onClick={() => onSave({ value: value === '' ? null : +value, metric: metric === '' ? null : +metric, done: true, rest: false })}>{entry?.done ? 'Update' : 'Mark done'}</button></div>
  </>;
}

export function DeleteHabitModal({ habit, onClose, onDelete }) {
  return <><h3>Delete &quot;{habit.name}&quot;?</h3><p className="sub">Every daily entry and proof photo for this habit is removed for good.</p><div className="modal-actions"><button className="cta ghost" onClick={onClose}>Keep it</button><button className="cta danger" onClick={onDelete}>Delete forever</button></div></>;
}
