import { NavLink, Link } from 'react-router';

const sections = [
  ['today', 'Today', 'M5 12l4 4L19 6'],
  ['progress', 'Progress', 'M5 20V10M12 20V4M19 20v-7'],
  ['calendar', 'Calendar', 'M7 5h10a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3ZM4 10h16M9 3v4M15 3v4'],
  ['graph', 'Graph', 'M4 18l5-6 4 3 7-9'],
  ['proof', 'Proof', 'M6 7h3l1.5-3h3L15 7h3a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3v-7a3 3 0 0 1 3-3ZM15.5 13.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0'],
  ['manage', 'More', 'M4 8h10M18 8h2M4 16h2M10 16h10M18 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0M10 16a2 2 0 1 1-4 0 2 2 0 0 1 4 0'],
];

export function AppShell({ handle, view, links, unreadCount, busy, authBusy, onNew, onTheme, onLogout, children }) {
  const now = new Date(), hour = now.getHours();
  const title = view === 'today' ? `${hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'} 👋` : view === 'social' ? 'Friends' : sections.find(([key]) => key === view)?.[1];
  return <div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={(event) => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>Skip to content</a>
    <header className="app-top"><button className="round-button" onClick={onTheme} aria-label="Switch theme">◐</button><div><h1>{title}</h1><time dateTime={now.toLocaleDateString('en-CA')}>Today {now.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</time></div><button className="round-button new-habit" disabled={busy} onClick={onNew} aria-label="New habit">+</button></header>
    <div className="route-stage" key={view}>{children}</div>
    <footer className="account-controls">{handle && <Link to={links.social} className="account-handle" aria-label={`Your handle: @${handle}`}>@{handle}</Link>}<Link to={links.social}>Friends {unreadCount > 0 && <span className="tab-badge" aria-label="Unread messages">{unreadCount > 9 ? '9+' : unreadCount}</span>}</Link><button disabled={authBusy} onClick={onLogout}>Log out ↗</button></footer>
    <nav className="floating-nav" aria-label="Main navigation">{sections.map(([key, label, path]) => {
      const active = view === key || key === 'manage' && view === 'social';
      return <NavLink key={key} to={links[key]} viewTransition aria-label={label === 'More' ? 'More — Habits' : label} className={active ? 'on' : ''}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d={path} /></svg><span>{label}</span>
      </NavLink>;
    })}</nav>
  </div>;
}
