import { NavLink } from 'react-router';
import { Brand } from './WorldBanner.jsx';
import woodland from '../../assets/images/woodland.svg';

const sections = [
  ['today', 'Today', 'M3 3h10v10H3z M5 8h2v2h2V6h2'],
  ['progress', 'Progress', 'M2 11h3v3H2z M7 7h3v7H7z M12 2h3v12h-3z'],
  ['calendar', 'Calendar', 'M2 4h12v10H2z M5 1v5 M11 1v5 M2 8h12'],
  ['graph', 'Graph', 'M2 2v12h12 M4 10h3V7h4V4h3'],
  ['proof', 'Proof', 'M2 4h12v10H2z M5 4V2h6v2 M6 7h4v4H6z'],
  ['social', 'Friends', 'M3 2h4v4H3z M10 3h3v3h-3z M1 9h8v5H1z M11 9h4v5h-4'],
  ['manage', 'Habits', 'M2 3h3v3H2z M8 4h6 M2 10h3v3H2z M8 11h6'],
];

export function AppShell({ view, links, unreadCount, busy, authBusy, onNew, onTheme, onLogout, children }) {
  const title = sections.find(([key]) => key === view)?.[1] || 'Today';
  return <div className="app-shell">
    <a className="skip-link" href="#main-content" onClick={(event) => { event.preventDefault(); document.getElementById('main-content')?.focus(); }}>Skip to content</a>
    <aside className="sidebar">
      <Brand />
      <span className="nav-caption">YOUR JOURNAL</span>
      <nav className="journal-nav" aria-label="Main navigation">{sections.map(([key, label, path]) => <NavLink key={key} to={links[key]} viewTransition className={view === key ? 'on' : ''}>
        <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" shapeRendering="crispEdges"><path d={path} /></svg><span>{label}</span>
        {key === 'social' && unreadCount > 0 && <span className="tab-badge" aria-label="Unread messages">{unreadCount > 9 ? '9+' : unreadCount}</span>}
      </NavLink>)}</nav>
      <div className="sidebar-bottom"><img src={woodland} alt="" /><p>A little further,<br /><strong>every day.</strong></p><div className="sidebar-controls"><button onClick={onTheme}>◐ Theme</button><button disabled={authBusy} onClick={onLogout}>Log out ↗</button></div></div>
    </aside>
    <div className="workspace">
      <div className="workspace-meta"><span>FIELD NOTES <span aria-hidden="true">/</span> {title.toUpperCase()}</span><time dateTime={new Date().toLocaleDateString('en-CA')}>{new Date().toLocaleDateString('en-IN', { weekday:'short', day:'numeric', month:'short', year:'numeric' })}</time></div>
      <section className="route-stage" key={view}>
        <header className="workspace-heading"><div><h1>{view === 'today' ? 'Make room for the everyday.' : title}</h1><p>{view === 'today' ? 'A few small things. A little closer to who you want to be.' : 'Your habits, one page at a time.'}</p></div><button className="cta" disabled={busy} onClick={onNew}>+ New habit</button></header>
        {children}
      </section>
      <footer className="world-footer"><span>HABIT TRACKER · YOUR FIELD JOURNAL</span><span>Progress over perfection.</span></footer>
    </div>
  </div>;
}
