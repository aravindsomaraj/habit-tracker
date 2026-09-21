import { useCallback, useEffect, useMemo, useState } from 'react';
import { Banner } from '../components/Banner.jsx';
import { ChatModal } from '../components/ChatModal.jsx';
import { Confetti, Toast } from '../components/Toast.jsx';
import { DeleteHabitModal, DayModal, NewHabitModal } from '../components/HabitModals.jsx';
import { HabitPicker } from '../components/HabitPicker.jsx';
import { Modal } from '../components/Modal.jsx';
import { SharingModal } from '../components/SharingModal.jsx';
import { useHabits } from '../hooks/useHabits.js';
import { useSocial } from '../hooks/useSocial.js';
import { entryOf, stats } from '../lib/tracker.js';
import { CalendarView } from '../views/CalendarView.jsx';
import { GraphView } from '../views/GraphView.jsx';
import { ManageView } from '../views/ManageView.jsx';
import { ProgressView } from '../views/ProgressView.jsx';
import { ProofView } from '../views/ProofView.jsx';
import { SocialView } from '../views/SocialView.jsx';
import { TodayView } from '../views/TodayView.jsx';

const tabs = [
  ['today', '✅ Today'], ['progress', '📊 Progress'], ['calendar', '📅 Calendar'],
  ['graph', '📈 Graph'], ['proof', '📸 Proof'], ['social', '🤝 Friends'], ['manage', '⚙️ Habits'],
];

export function TrackerApp({ auth }) {
  const userId = auth.session.user.id;
  const store = useHabits(auth.client, userId);
  const [view, setView] = useState('today'), [selected, setSelected] = useState(null);
  const [calendar, setCalendar] = useState(() => new Date()), [flip, setFlip] = useState(false);
  const [draftTemplate, setDraftTemplate] = useState('steps');
  const [modal, setModal] = useState(null), [toast, setToast] = useState(''), [burst, setBurst] = useState(0);
  const showToast = useCallback((text) => setToast(text), []);
  const clearToast = useCallback(() => setToast(''), []);
  const social = useSocial(auth.client, userId, showToast);

  useEffect(() => {
    if (!store.habits.length) { setSelected(null); return; }
    if (!store.habits.some((habit) => habit.id === selected)) setSelected(store.habits[0].id);
  }, [selected, store.habits]);

  useEffect(() => {
    try { const saved = localStorage.getItem('sl_theme'); if (saved) document.documentElement.setAttribute('data-theme', saved); } catch { /* Browser storage may be unavailable. */ }
  }, []);

  const habit = useMemo(() => store.habits.find((item) => item.id === selected) || store.habits[0], [selected, store.habits]);
  const closeModal = useCallback(() => { setModal(null); social.setChat(null); }, [social.setChat]);

  function toggleTheme() {
    const root = document.documentElement, current = root.getAttribute('data-theme');
    const dark = current ? current === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    const next = dark ? 'light' : 'dark'; root.setAttribute('data-theme', next);
    try { localStorage.setItem('sl_theme', next); } catch { /* Theme still applies for this session. */ }
  }

  async function toggle(habitItem, entryDate, target) {
    const previous = entryOf(store.entries, habitItem, entryDate) || {};
    const patch = { done: !previous.done, rest: false };
    if (!previous.done && previous.value == null) patch.value = target;
    const result = await store.saveEntry(habitItem, entryDate, patch);
    if (!result.ok) return;
    if (previous.done) { social.removeCompletion(habitItem, entryDate); return; }
    social.recordCompletion(habitItem, entryDate);
    const nextEntries = { ...store.entries, [habitItem.id]: { ...(store.entries[habitItem.id] || {}), [entryDate]: result.entry } };
    const summary = stats(habitItem, nextEntries), bonus = patch.value != null && patch.value >= target;
    setBurst((value) => value + 1); window.setTimeout(() => setBurst(0), 3000);
    showToast(summary.streak && summary.streak % 7 === 0 ? `🔥 ${summary.streak}-day streak!` : `+${bonus ? 15 : 10} pts${bonus ? ' — target hit!' : ''}`);
  }

  function choosePhoto(habitItem, entryDate, closeAfter = false) {
    if (store.status !== 'ready' || store.busy) return;
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'image/jpeg,image/png,image/webp';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const result = await store.uploadPhoto(habitItem, entryDate, file);
      if (result.ok && closeAfter) closeModal();
    };
    input.click();
  }

  async function removePhoto(habitItem, entryDate, closeAfter = false) {
    if (!window.confirm('Remove this proof photo?')) return;
    const result = await store.removePhoto(habitItem, entryDate);
    if (result.ok && closeAfter) closeModal();
  }

  let content;
  if (store.status === 'loading') content = <div className="card"><p className="sub">Loading your habits…</p></div>;
  else if (store.status === 'error') content = <div className="card"><p className="sub">Your habits could not be loaded. Reload to retry.</p></div>;
  else if (view === 'social') content = <SocialView social={social} habits={store.habits} onOpenSharing={() => setModal({ type: 'sharing' })} />;
  else if (!store.habits.length) content = <div className="card"><div className="empty"><div className="big">🎯</div><h2>No habits yet</h2><p className="sub">Tell me the habit and the goal — I'll break it into daily steps you can tick off.</p><button className="cta" onClick={() => setModal({ type: 'new' })}>Create my first habit</button></div></div>;
  else {
    const picker = ['progress', 'calendar', 'graph', 'proof'].includes(view) ? <HabitPicker habits={store.habits} selected={habit.id} onPick={setSelected} /> : null;
    const views = {
      today: <TodayView habits={store.habits} entries={store.entries} selectedHabit={habit} onSaveEntry={store.saveEntry} onToggle={toggle} onPhoto={choosePhoto} />,
      progress: <ProgressView habit={habit} entries={store.entries} />,
      calendar: <CalendarView habit={habit} entries={store.entries} cursor={calendar} onMove={(amount) => setCalendar((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1))} onOpenDay={(entryDate) => setModal({ type: 'day', habit, entryDate })} />,
      graph: <GraphView habit={habit} entries={store.entries} flip={flip} onFlip={() => setFlip((value) => !value)} />,
      proof: <ProofView client={auth.client} userId={userId} habit={habit} entries={store.entries} onRemove={removePhoto} />,
      manage: <ManageView habits={store.habits} entries={store.entries} onDelete={(habitItem) => setModal({ type: 'delete', habit: habitItem })} onNew={() => setModal({ type: 'new' })} />,
    };
    content = <>{picker}{views[view] || views.manage}</>;
  }

  const dayEntry = modal?.type === 'day' ? entryOf(store.entries, modal.habit, modal.entryDate) || {} : null;
  return <>
    <div className="wrap">
      <header className="top"><div className="logo"><span className="mark">🔥</span> Habit Tracker</div><div className="spacer" /><button className="pillbtn" onClick={toggleTheme}>🌗 Theme</button><button className="cta" disabled={store.busy || store.status !== 'ready'} onClick={() => setModal({ type: 'new' })}>+ New habit</button><button className="pillbtn" disabled={auth.busy} onClick={auth.logout}>Log out</button></header>
      <Banner>{auth.accountMessage}</Banner><Banner>{store.message}</Banner>
      <nav className="tabs">{tabs.map(([key, label]) => <button key={key} className={view === key ? 'on' : ''} onClick={() => setView(key)}>{label}{key === 'social' && social.unreadCount > 0 && <span className="tab-badge" aria-label="Unread messages">{social.unreadCount > 9 ? '9+' : social.unreadCount}</span>}</button>)}</nav>
      <main inert={store.busy || store.status === 'loading' ? '' : undefined}>{content}</main>
    </div>
    {(modal || social.chat) && <Modal onClose={closeModal} busy={store.busy}><Banner>{store.message}</Banner>
      {social.chat ? <ChatModal client={auth.client} profile={social.profile} chat={social.chat} onClose={closeModal} /> : modal.type === 'new' ? <NewHabitModal initialTemplate={draftTemplate} onTemplateChange={setDraftTemplate} onCancel={closeModal} onCreate={async (draft) => { const result = await store.createHabit(draft); if (result.ok) { setSelected(result.habit.id); setView('progress'); closeModal(); } }} /> : modal.type === 'delete' ? <DeleteHabitModal habit={modal.habit} onClose={closeModal} onDelete={async () => { const result = await store.deleteHabit(modal.habit); if (result.ok) closeModal(); }} /> : modal.type === 'sharing' ? <SharingModal habits={store.habits} social={social} onClose={closeModal} /> : modal.type === 'day' ? <DayModal client={auth.client} userId={userId} habit={modal.habit} entryDate={modal.entryDate} entry={dayEntry} onClose={closeModal} onPhoto={() => choosePhoto(modal.habit, modal.entryDate, true)} onRemovePhoto={() => removePhoto(modal.habit, modal.entryDate, true)} onRest={async () => { const result = await store.saveEntry(modal.habit, modal.entryDate, { done: false, rest: true }); if (result.ok) { social.removeCompletion(modal.habit, modal.entryDate); closeModal(); showToast('😌 Rest day — streak protected'); } }} onSave={async (patch) => { const result = await store.saveEntry(modal.habit, modal.entryDate, patch); if (result.ok) { social.recordCompletion(modal.habit, modal.entryDate); closeModal(); } }} /> : null}
    </Modal>}
    <Toast message={toast} onDone={clearToast} /><Confetti burst={burst} />
  </>;
}
