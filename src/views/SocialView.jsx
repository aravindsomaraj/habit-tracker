import { useState } from 'react';
import { normalizeHandle } from '../lib/handles.js';

export function SocialView({ social, habits, onOpenSharing }) {
  if (social.status === 'loading') return <div className="card"><p className="sub">Loading your accountability circle…</p></div>;
  if (social.status === 'error') return <div className="card"><h2>Friends are not set up yet</h2><p className="sub">{social.error}</p></div>;
  if (!social.profile?.handle) return <div className="card"><h2>Set up Friends</h2><p className="sub">Reload to choose your handle before using Friends.</p></div>;
  const received = social.requests.filter((row) => row.addressee_id === social.profile.id);
  const sent = social.requests.filter((row) => row.requester_id === social.profile.id);
  return <>
    {social.message && <p className="banner" role="status">{social.message}</p>}
    <FriendInvite onSend={social.sendRequest} ownHandle={social.profile.handle} />
    <div className="grid two"><div className="card"><h2>Friends</h2>
      {!social.friends.length ? <p className="sub">No accepted friends yet.</p> : <div className="social-list">{social.friends.map((friend) => <div key={friend.id}><b>{friend.display_name}</b><span>{friend.handle ? `@${friend.handle}` : 'Handle not chosen'}</span><span className="social-actions"><button className="pillbtn" onClick={() => social.openChat(friend)}>Message</button><button className="pillbtn" onClick={() => { if (window.confirm('Remove this connection? All sharing between you will also be removed.')) social.updateFriendship('remove', friend.friendship_id); }}>Remove</button><button className="pillbtn danger-outline" onClick={() => { if (window.confirm('Block this person? They cannot send another request, and all sharing between you will be removed.')) social.updateFriendship('block', friend.friendship_id); }}>Block</button></span></div>)}</div>}
      {!!received.length && <><h3 className="social-heading">Requests for you</h3><div className="social-list">{received.map((row) => <div key={row.id}><b>{row.person.display_name}</b><span>{row.person.handle ? `@${row.person.handle}` : 'Handle not chosen'}</span><span className="social-actions"><button className="pillbtn" onClick={() => social.updateFriendship('accept', row.id)}>Accept</button><button className="pillbtn danger-outline" onClick={() => { if (window.confirm('Block this person? They cannot send another request, and all sharing between you will be removed.')) social.updateFriendship('block', row.id); }}>Block</button></span></div>)}</div></>}
      {!!sent.length && <><h3 className="social-heading">Sent</h3><div className="social-list">{sent.map((row) => <div key={row.id}><b>{row.person.display_name}</b><span>{row.person.handle ? `@${row.person.handle}` : 'Handle not chosen'}</span><button className="pillbtn" onClick={() => { if (window.confirm('Remove this connection? All sharing between you will also be removed.')) social.updateFriendship('remove', row.id); }}>Cancel</button></div>)}</div></>}
    </div><div className="card"><h2>Sharing</h2><p className="sub">Share only completion events. Values, notes, missed days, and proof photos are never included.</p><p className="social-summary">{social.shares.length} active habit-friend share{social.shares.length === 1 ? '' : 's'}</p>{habits.length ? <button className="pillbtn" onClick={onOpenSharing}>Manage sharing</button> : <p className="tiny">Create a habit first to share progress.</p>}</div></div>
    <div className="card"><h2>Friend activity</h2>{!social.feed.length ? <p className="sub">Shared completions from friends will appear here.</p> : <div className="social-feed">{social.feed.map((item) => <div key={item.id}><span className="social-avatar">✓</span><p><b>{item.person.display_name}</b> completed <b>{item.habit_label}</b><small>{item.occurred_on}</small></p></div>)}</div>}</div>
  </>;
}

function FriendInvite({ onSend, ownHandle }) {
  const [handle, setHandle] = useState('');
  return <div className="card"><h2>Your accountability circle</h2><p className="social-identity">@{ownHandle}</p><p className="sub">Invite someone by their exact handle. They must accept before they can see shared completions.</p><div className="social-invite"><input aria-label="Friend handle" maxLength="25" placeholder="Friend handle" autoComplete="off" value={handle} onChange={(event) => setHandle(event.target.value)} /><button className="cta" onClick={() => { const clean = normalizeHandle(handle); if (clean) onSend(clean); }}>Send request</button></div></div>;
}
