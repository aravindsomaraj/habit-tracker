import { Avatar } from '../components/Avatar.jsx';
import { useEffect, useRef, useState } from 'react';
import { normalizeHandle } from '../lib/handles.js';
import { Link, NavLink } from 'react-router';
import { weekStartKey } from '../hooks/useSocial.js';
import { CommunityFeed } from '../components/Community.jsx';

const socialTabs = [
  ['/social/activity', 'Activity'],
  ['/social/leaderboard', 'Leaderboard'],
  ['/social/friends', 'Friends'],
  ['/profile', 'Profile'],
];

export function SocialView({ social, habits, section = 'activity', onOpenSharing }) {
  if (section !== 'leaderboard' && !(section === 'activity' && social.community) && social.status === 'loading') return <div className="card"><p className="sub">Loading your social circle…</p></div>;
  if (section !== 'leaderboard' && !(section === 'activity' && social.community) && social.status === 'error') return <div className="card"><h2>Social is not set up yet</h2><p className="sub">{social.error}</p></div>;
  if (!social.profile?.handle) return <div className="card social-welcome"><span className="social-welcome-icon">👋</span><h2>Build habits with people you trust</h2><p className="sub">Reload to choose your handle before using Social.</p></div>;
  return <>
    <nav className="social-tabs" aria-label="Social sections">{socialTabs.map(([path, label]) => <NavLink key={path} to={path} className={({ isActive }) => isActive ? 'on' : ''}>{label}{label === 'Friends' && social.receivedCount > 0 && <span className="tab-badge">{social.receivedCount}</span>}</NavLink>)}</nav>
    {social.unreadError && <p className="banner" role="status">Unread counts are unavailable. You can still open chats.</p>}
    {social.message && <p className="banner" role="status">{social.message}</p>}
    {section === 'leaderboard' ? <Leaderboard social={social} /> : section === 'friends' ? <Friends social={social} habits={habits} onOpenSharing={onOpenSharing} /> : <Activity social={social} onOpenSharing={onOpenSharing} />}
  </>;
}

function Activity({ social, onOpenSharing }) {
  const [audience, setAudience] = useState('community');
  if (social.community) return <>
    <div className="feed-tabs" role="group" aria-label="Activity audience"><button className={`pillbtn ${audience === 'community' ? 'on' : ''}`} aria-pressed={audience === 'community'} onClick={() => setAudience('community')}>Community</button><button className={`pillbtn ${audience === 'friends' ? 'on' : ''}`} aria-pressed={audience === 'friends'} onClick={() => setAudience('friends')}>Friends</button></div>
    {audience === 'community' ? <CommunityFeed community={social.community} userId={social.profile.id} onOpenSharing={onOpenSharing} /> : <FriendActivity social={social} />}
  </>;
  return <FriendActivity social={social} />;
}

function FriendActivity({ social }) {
  if (social.status === 'loading') return <section className="card"><p>Loading friend activity…</p></section>;
  if (social.status === 'error') return <section className="card"><p role="alert">{social.error}</p></section>;
  const mine = (social.leaderboard || []).find((row) => row.user_id === social.profile.id);
  return <>
    <section className="social-hero"><span className="eyebrow">YOUR CIRCLE THIS WEEK</span><h2>{mine ? `You’re #${mine.rank}` : 'Show up together'}</h2><p>{mine ? `${mine.completion_count} shared completion${Number(mine.completion_count) === 1 ? '' : 's'} across ${mine.active_days} active day${Number(mine.active_days) === 1 ? '' : 's'}.` : social.profileStatus === 'error' ? 'Profile settings are temporarily unavailable.' : social.profile.leaderboard_enabled ? 'Share a completion to enter this week’s ranking.' : 'Turn on leaderboard participation in Profile when you’re ready.'}</p><Link className="cta" to="/social/leaderboard">View leaderboard</Link></section>
    <section className="card"><div className="section-heading"><div><h2>Friend activity</h2><p className="sub">Progress your friends chose to share with you.</p></div><Link className="text-link" to="/social/friends">Friends</Link></div>{!social.feed.length ? <div className="empty"><div className="big">🌱</div><p>No shared completions yet.</p><Link className="pillbtn" to="/social/friends">Add a friend</Link></div> : <div className="social-feed">{social.feed.map((item) => <div key={item.id}><Avatar client={social.client} profile={item.person} /><p><Link to={`/profile/${item.actor_id}`}><b>{item.person.display_name}</b></Link> completed <b>{item.habit_label}</b><small>{item.occurred_on}</small></p></div>)}</div>}</section>
  </>;
}

function Leaderboard({ social }) {
  const currentWeek = weekStartKey();
  const end = shiftDate(social.leaderboardWeek, 6);
  return <section className="card leaderboard-card"><div className="section-heading"><div><h2>Weekly leaderboard</h2><p className="sub">Shared with you · {formatDate(social.leaderboardWeek)}–{formatDate(end)}</p></div></div>
    <div className="leaderboard-controls"><button className="pillbtn" onClick={() => social.selectLeaderboardWeek(shiftDate(social.leaderboardWeek, -7))}>Previous</button><button className="pillbtn" disabled={social.leaderboardWeek >= currentWeek} onClick={() => social.selectLeaderboardWeek(shiftDate(social.leaderboardWeek, 7))}>Next</button></div>
    <p className="tiny">Only accepted friends who opted in appear. Scores count completion events explicitly shared with you.</p>
    {social.leaderboardStatus === 'loading' ? <p className="sub">Loading ranks…</p> : social.leaderboardStatus === 'error' ? <p className="banner" role="alert">{social.leaderboardError}</p> : !social.leaderboard.length ? <div className="empty"><div className="big">🏁</div><p>No one has joined this week’s leaderboard yet.</p><Link className="pillbtn" to="/profile">Check my profile settings</Link></div> : <ol className="leaderboard-list">{social.leaderboard.map((row) => {
      const mine = row.user_id === social.profile.id;
      return <li key={row.user_id} className={mine ? 'mine' : ''}><span className="leader-rank">{Number(row.rank) <= 3 ? ['🥇','🥈','🥉'][Number(row.rank) - 1] : `#${row.rank}`}</span><Avatar client={social.client} profile={row} /><span className="leader-person"><b>{mine ? 'You' : row.display_name}</b><small>@{row.handle} · {row.active_days} active day{Number(row.active_days) === 1 ? '' : 's'}</small></span><strong>{row.completion_count}<small>done</small></strong></li>;
    })}</ol>}
  </section>;
}

function Friends({ social, habits, onOpenSharing }) {
  const [handle, setHandle] = useState('');
  const [found, setFound] = useState(null), [searchError, setSearchError] = useState(''), [searching, setSearching] = useState(false);
  const searchVersion = useRef(0), searchPending = useRef(false);
  useEffect(() => () => { ++searchVersion.current; }, []);
  function changeHandle(value) {
    ++searchVersion.current; searchPending.current = false;
    setHandle(value); setFound(null); setSearchError(''); setSearching(false);
  }
  async function search() {
    if (searchPending.current) return;
    const version = ++searchVersion.current;
    searchPending.current = true; setSearching(true); setFound(null); setSearchError('');
    try {
      const person = await social.searchFriend(handle);
      if (version === searchVersion.current) setFound(person);
    } catch (error) {
      if (version === searchVersion.current) setSearchError(error.message || 'Could not find that profile.');
    } finally {
      if (version === searchVersion.current) { searchPending.current = false; setSearching(false); }
    }
  }
  const received = social.requests.filter((row) => row.addressee_id === social.profile.id);
  const sent = social.requests.filter((row) => row.requester_id === social.profile.id);
  function request(event) {
    event.preventDefault();
    const clean = normalizeHandle(handle);
    if (clean) social.sendRequest(clean).then((ok) => { if (ok) changeHandle(''); });
  }
  return <>
    <section className="card"><h2>Grow your circle</h2><p className="social-identity">@{social.profile.handle}</p><p className="sub">Invite someone by their exact handle. They must accept before sharing or chat begins.</p><form className="social-invite" onSubmit={request}><input aria-label="Friend handle" maxLength="25" placeholder="Friend handle" autoComplete="off" value={handle} onChange={(event) => changeHandle(event.target.value)} /><button type="button" className="pillbtn" disabled={searching || !handle.trim()} onClick={search}>{searching ? 'Finding…' : 'Find profile'}</button><button className="cta">Send request</button></form>{searchError && <p role="alert">{searchError}</p>}{found && <div className="avatar-search-result"><Avatar client={social.client} profile={found} /><span><b>{found.display_name}</b><small>@{found.handle}</small></span></div>}</section>
    {!!received.length && <section className="card request-card"><h2>Requests for you</h2><div className="social-list">{received.map((row) => <div key={row.id}><span className="request-person"><Avatar client={social.client} profile={row.person} /><span><b>{row.person.display_name}</b><small>{row.person.handle ? `@${row.person.handle}` : 'Handle not chosen'}</small></span></span><span className="social-actions"><button className="pillbtn" onClick={() => social.updateFriendship('accept', row.id)}>Accept</button><button className="pillbtn danger-outline" onClick={() => { if (window.confirm('Block this person? They cannot send another request.')) social.updateFriendship('block', row.id); }}>Block</button></span></div>)}</div></section>}
    <section className="card"><h2>Friends</h2>{!social.friends.length ? <p className="sub">No accepted friends yet.</p> : <div className="social-list">{social.friends.map((friend) => <div key={friend.id}><Link className="friend-name with-avatar" to={`/profile/${friend.id}`}><Avatar client={social.client} profile={friend} /><span><b>{friend.display_name}</b><small>{friend.handle ? `@${friend.handle}` : 'Handle not chosen'}</small></span></Link><span className="social-actions"><button className="pillbtn" onClick={() => social.openChat(friend)}>Message</button><button className="pillbtn" onClick={() => { if (window.confirm('Remove this connection? All sharing and chat between you will be removed.')) social.updateFriendship('remove', friend.friendship_id); }}>Remove</button><button className="pillbtn danger-outline" onClick={() => { if (window.confirm('Block this person? All sharing and chat between you will be removed.')) social.updateFriendship('block', friend.friendship_id); }}>Block</button></span></div>)}</div>}
      {!!sent.length && <><h3 className="social-heading">Sent requests</h3><div className="social-list">{sent.map((row) => <div key={row.id}><span className="request-person"><Avatar client={social.client} profile={row.person} /><span><b>{row.person.display_name}</b><small>{row.person.handle ? `@${row.person.handle}` : 'Handle not chosen'}</small></span></span><button className="pillbtn" onClick={() => social.updateFriendship('remove', row.id)}>Cancel</button></div>)}</div></>}
    </section>
    <section className="card"><h2>Sharing</h2><p className="sub">Choose which friends see completion events for each habit. Values, missed days, notes, and photos stay private.</p><p className="social-summary">{social.shares.length} active share{social.shares.length === 1 ? '' : 's'}</p>{habits.length ? <button className="pillbtn" onClick={onOpenSharing}>Manage sharing</button> : <p className="tiny">Create a habit first to share progress.</p>}</section>
  </>;
}

function shiftDate(key, days) {
  const date = new Date(`${key}T00:00:00`); date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function formatDate(key) { return new Date(`${key}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }); }
