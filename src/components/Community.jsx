import { useEffect, useState } from 'react';
import { Link } from 'react-router';

export function CommunitySettings({ community }) {
  if (!community) return null;
  return <section className="card"><h2>Community participation</h2><p className="sub">Publish selected habit completions to everyone signed in. Your display name, handle, and bio will be visible. Values, notes, photos, and private totals stay private.</p>
    {community.settingsStatus === 'error' ? <><p role="alert">{community.settingsError}</p><button className="pillbtn" onClick={community.refreshPreferences}>Try again</button></> : <label className="profile-option"><input type="checkbox" checked={community.enabled} disabled={community.settingsStatus !== 'ready' || community.busy} onChange={event => { const enabled = event.target.checked; if (enabled || window.confirm('Disable community participation and remove your published updates?')) community.setEnabled(enabled); }} /><span><b>Participate in the community</b><small>Enable this, then choose habits in Social → Manage sharing. Existing completions are never backfilled.</small></span></label>}
    {community.message && <p role="status">{community.message}</p>}
  </section>;
}

export function CommunityCards({ items, community, userId }) {
  const [reporting, setReporting] = useState(null), [reason, setReason] = useState('spam');
  return <div className="community-feed">{items.map(item => <article className="community-card" key={item.id}>
    <Link className="community-person" to={`/profile/${item.actor_id}`}><span className="social-avatar" aria-hidden="true">{item.display_name?.[0] || '?'}</span><span><b>{item.display_name}</b><small>@{item.handle}</small></span></Link>
    <p>Completed <b>{item.habit_label}</b></p><time dateTime={item.occurred_on}>{item.occurred_on}</time>
    {item.actor_id !== userId && <div className="community-actions"><button className="pillbtn" disabled={community.busy} onClick={() => { setReporting(item.id); setReason('spam'); }}>Report</button><button className="pillbtn" disabled={community.busy} onClick={() => { if (window.confirm('Block this user? Your updates will be hidden from each other. Existing sharing and chat will be removed.')) community.block(item.actor_id); }}>Block</button></div>}
    {reporting === item.id && <form className="community-report" onSubmit={async event => { event.preventDefault(); if (await community.report(item.id, reason)) setReporting(null); }}><label>Report reason<select value={reason} onChange={event => setReason(event.target.value)}><option value="spam">Spam</option><option value="harassment">Harassment</option><option value="inappropriate">Inappropriate content</option></select></label><button className="pillbtn" disabled={community.busy}>Submit report</button><button type="button" className="pillbtn" onClick={() => setReporting(null)}>Cancel</button></form>}
  </article>)}</div>;
}

export function CommunityFeed({ community, userId, onOpenSharing }) {
  useEffect(() => {
    community.refresh();
    const focus = () => { if (document.visibilityState !== 'hidden') community.refresh(); };
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, [community.refresh]);
  return <section className="card"><div className="section-heading"><h2>Community updates</h2><button className="pillbtn" disabled={community.status === 'loading'} onClick={() => community.refresh()}>Refresh</button></div><p className="sub">New completions people chose to publish, newest first.</p>
    {!community.enabled && <p className="sub">You can explore without publishing. <Link to="/profile">Enable participation in Profile</Link> to share your own progress.</p>}
    {community.enabled && <button className="pillbtn" onClick={onOpenSharing}>Choose habits to publish</button>}
    {community.message && <p className="banner" role="status">{community.message}</p>}
    {community.error && <p className="banner" role="alert">{community.error}</p>}
    <CommunityCards items={community.feed} community={community} userId={userId} />
    {community.status === 'loading' && <p role="status">Loading community updates…</p>}
    {community.status === 'ready' && !community.feed.length && <div className="empty"><p>No community updates yet. Publish your next completion to get things started.</p></div>}
    {community.hasMore && <button className="pillbtn" disabled={community.status === 'loading'} onClick={() => community.refresh(true)}>Load more</button>}
  </section>;
}

export function CommunityProfile({ community, profileId, userId, compact = false }) {
  const [result, setResult] = useState(null), [error, setError] = useState(''), [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true; setResult(null); setError('');
    community.loadProfile(profileId).then(value => { if (active) setResult(value); }).catch(failure => { if (active) setError(failure.message || 'Profile unavailable.'); });
    return () => { active = false; };
  }, [community.loadProfile, profileId, revision]);
  if (error) return <section className="card"><h2>Profile unavailable</h2><p role="alert">{error}</p><button className="pillbtn" onClick={() => setRevision(value => value + 1)}>Try again</button></section>;
  if (!result) return <section className="card"><p>Loading community profile…</p></section>;
  if (!result.profile) return compact ? null : <section className="card"><h2>Profile unavailable</h2><p>This person is not currently visible in the community.</p></section>;
  const actions = {
    ...community,
    block: async target => { const ok = await community.block(target); if (ok) setRevision(value => value + 1); return ok; },
    report: async (id, reason) => { const ok = await community.report(id, reason); if (ok) setRevision(value => value + 1); return ok; },
  };
  return <>
    {!compact && <section className="card"><h2>{result.profile.display_name}</h2><p className="sub">@{result.profile.handle}</p><p>{result.profile.bio}</p><p className="tiny">Community profile</p>
      {profileId !== userId && <button className="pillbtn" disabled={community.busy} onClick={() => { if (window.confirm('Block this user? Your updates will be hidden from each other. Existing sharing and chat will be removed.')) actions.block(profileId); }}>Block user</button>}
    </section>}
    <section className="card"><h2>Recent community activity</h2><CommunityCards items={result.feed} community={actions} userId={userId} />{!result.feed.length && <p className="sub">No recent community updates.</p>}{community.message && <p role="status">{community.message}</p>}</section>
  </>;
}
