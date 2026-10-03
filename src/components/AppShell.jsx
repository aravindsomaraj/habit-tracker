import { NavLink, Link } from 'react-router';

const sections = [
  ['today', 'Today', 'M5 12l4 4L19 6'],
  ['progress', 'Progress', 'M5 20V10M12 20V4M19 20v-7'],
  ['social', 'Social', 'M16 20v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 20v-2a4 4 0 0 0-3-3.87M16 2.13a4 4 0 0 1 0 7.75'],
  ['calendar', 'Calendar', 'M7 5h10a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3ZM4 10h16M9 3v4M15 3v4'],
  ['manage', 'More', 'M4 8h10M18 8h2M4 16h2M10 16h10M18 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0M10 16a2 2 0 1 1-4 0 2 2 0 0 1 4 0'],
];

export function AppShell({ view, links, socialCount, profile, busy, authBusy, onNew, onTheme, onLogout, children }) {
  const now = new Date(), hour = now.getHours();
  const titles = { social: 'Social', profile: 'Profile', graph: 'Graph', proof: 'Proof' };
  const title = view === 'today' ? `${hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'} 👋` : titles[view] || sections.find(([key]) => key === view)?.[1];
  const avatar = profile?.display_name?.trim().slice(0, 1).toUpperCase() || '○';
  return <div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={(event) => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>Skip to content</a>
    <header className="app-top"><button className="round-button" onClick={onTheme} aria-label="Switch theme">◐</button><div><h1>{title}</h1><time dateTime={now.toLocaleDateString('en-CA')}>Today {now.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</time></div><div className="top-actions"><button className="round-button new-habit" disabled={busy} onClick={onNew} aria-label="New habit">+</button><Link className="round-button profile-button" to={links.profile} aria-label="Open profile">{avatar}</Link></div></header>
    <div className="route-stage" key={view}>{children}</div>
    <footer className="account-controls"><Link to={links.profile}>Profile</Link><button disabled={authBusy} onClick={onLogout}>Log out ↗</button></footer>
    <nav className="floating-nav" aria-label="Main navigation">{sections.map(([key, label, path]) => {
      const active = view === key || key === 'progress' && ['graph', 'proof'].includes(view) || key === 'social' && view === 'profile';
      return <NavLink key={key} to={links[key]} viewTransition aria-label={label === 'More' ? 'More — Habits' : label} className={active ? 'on' : ''}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d={path} /></svg><span>{label}</span>{key === 'social' && socialCount > 0 && <b className="nav-badge" aria-label={`${socialCount} social notifications`}>{socialCount > 9 ? '9+' : socialCount}</b>}
      </NavLink>;
    })}</nav>
  </div>;
}
