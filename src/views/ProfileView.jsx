import { useEffect, useMemo, useState } from 'react';
import { stats, totalXP } from '../lib/tracker.js';
import { CommunityProfile, CommunitySettings } from '../components/Community.jsx';

export function initials(name = '') {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || '?';
}

function Avatar({ profile, large = false }) {
  return <span className={`profile-avatar${large ? ' large' : ''}`} aria-hidden="true">{initials(profile?.display_name)}</span>;
}

export function ProfileView({ social, user, habits, entries, profileId }) {
  const own = !profileId || profileId === social.profile?.id;
  if (!own && social.community && !social.friends.some(item => item.id === profileId)) return <CommunityProfile community={social.community} profileId={profileId} userId={social.profile?.id} />;
  if (own && social.profileStatus === 'loading') return <div className="card"><p className="sub">Loading profile settings…</p></div>;
  if (own && social.profileStatus === 'error') return <div className="card"><h2>Profile settings unavailable</h2><p role="alert">{social.profileError}</p><button className="pillbtn" onClick={social.refreshProfile}>Try again</button></div>;
  if (!own && social.status === 'loading') return <div className="card"><p className="sub">Loading profile…</p></div>;
  if (!own && social.status === 'error') return <div className="card"><h2>Profile is unavailable</h2><p className="sub">{social.error}</p></div>;

  if (profileId && profileId !== social.profile?.id) {
    const friend = social.friends.find((item) => item.id === profileId);
    if (!friend && social.community) return <CommunityProfile community={social.community} profileId={profileId} userId={social.profile?.id} />;
    if (!friend) return <div className="card"><h2>Profile unavailable</h2><p className="sub">Only accepted friends’ profiles can be opened here.</p></div>;
    const score = social.leaderboard.find((item) => item.user_id === friend.id);
    const recent = social.feed.filter((item) => item.actor_id === friend.id).slice(0, 5);
    return <>
      <section className="card profile-hero"><Avatar profile={friend} large /><div><h2>{friend.display_name}</h2><p className="sub">@{friend.handle}</p></div></section>
      {social.friendProfilesError && <p role="alert">{social.friendProfilesError}</p>}
      {friend.bio && <section className="card"><h2>About</h2><p>{friend.bio}</p></section>}
      <section className="card"><h2>Shared with you</h2><div className="profile-stats"><div><b>{score?.rank ? `#${score.rank}` : '—'}</b><span>weekly rank</span></div><div><b>{score?.completion_count || 0}</b><span>completions</span></div><div><b>{score?.active_days || 0}</b><span>active days</span></div></div><button className="cta" onClick={() => social.openChat(friend)}>Message {friend.display_name}</button></section>
      <section className="card"><h2>Recent activity</h2>{recent.length ? <div className="social-feed">{recent.map((item) => <div key={item.id}><span className="social-avatar">✓</span><p>Completed <b>{item.habit_label}</b><small>{item.occurred_on}</small></p></div>)}</div> : <p className="sub">No completion activity is currently shared with you.</p>}</section>
      {social.community && <CommunityProfile community={social.community} profileId={profileId} userId={social.profile?.id} compact />}
    </>;
  }

  return <><OwnProfile social={social} user={user} habits={habits} entries={entries} /><CommunitySettings community={social.community} /></>;
}

function OwnProfile({ social, user, habits, entries }) {
  const profile = social.profile;
  const [fields, setFields] = useState(() => valuesFor(profile));
  const [saving, setSaving] = useState(false);
  const [validation, setValidation] = useState('');
  useEffect(() => setFields(valuesFor(profile)), [profile]);
  const summary = useMemo(() => ({
    points: totalXP(habits, entries),
    completions: habits.reduce((sum, habit) => sum + stats(habit, entries).done, 0),
    streak: Math.max(0, ...habits.map((habit) => stats(habit, entries).streak)),
  }), [entries, habits]);
  const update = (field, value) => setFields((current) => ({ ...current, [field]: value }));

  async function submit(event) {
    event.preventDefault();
    const displayName = fields.displayName.trim(), handle = fields.handle.trim().toLowerCase().replace(/^@/, '');
    if (!displayName || displayName.length > 40 || !/^[a-z0-9_]{3,24}$/.test(handle)) {
      setValidation('Use a display name and a 3–24 character handle containing lowercase letters, numbers, or _.');
      return;
    }
    setValidation(''); setSaving(true);
    await social.updateProfile({ ...fields, displayName, handle, bio: fields.bio.trim() });
    setSaving(false);
  }

  return <>
    <section className="card profile-hero"><Avatar profile={profile || { display_name: fields.displayName }} large /><div><h2>{profile ? profile.display_name : 'Create your profile'}</h2><p className="sub">{profile ? `@${profile.handle}` : 'Join your accountability circle'}</p></div></section>
    {social.message && <p className="banner" role="status">{social.message}</p>}
    <section className="card"><h2>{profile ? 'Edit profile' : 'Set up your profile'}</h2><p className="sub">This is how accepted friends see you. Your email and habit details stay private.</p>
      <form onSubmit={submit} aria-busy={saving}>
        <fieldset className="profile-fields" disabled={saving}>
          <label className="f"><span>Display name</span><input required maxLength="40" autoComplete="nickname" value={fields.displayName} onChange={(event) => update('displayName', event.target.value)} /></label>
          <label className="f"><span>Handle</span><input required maxLength="24" autoComplete="username" placeholder="e.g. madhav" value={fields.handle} onChange={(event) => update('handle', event.target.value)} /></label>
          <label className="f"><span>Bio</span><textarea maxLength="160" placeholder="A little about what keeps you moving" value={fields.bio} onChange={(event) => update('bio', event.target.value)} /></label>
          <label className="profile-option"><input type="checkbox" checked={fields.discoverable} onChange={(event) => update('discoverable', event.target.checked)} /><span><b>Let people find my handle</b><small>Accepted friends can still see you if this is off.</small></span></label>
          <label className="profile-option"><input type="checkbox" checked={fields.leaderboardEnabled} onChange={(event) => update('leaderboardEnabled', event.target.checked)} /><span><b>Join the friends leaderboard</b><small>Only completions you share count toward your score.</small></span></label>
          {validation && <p className="banner" role="alert">{validation}</p>}
          <button className="cta" type="submit">{saving ? 'Saving…' : profile ? 'Save profile' : 'Create profile'}</button>
        </fieldset>
      </form>
    </section>
    <section className="card"><h2>Your private overview</h2><div className="profile-stats"><div><b>{summary.points}</b><span>all-time points</span></div><div><b>{summary.completions}</b><span>completions</span></div><div><b>{summary.streak}</b><span>best current streak</span></div></div><p className="tiny">Only you can see these totals.</p></section>
    <section className="card account-card"><h2>Account</h2><span>Email</span><b>{user?.email || 'Signed-in account'}</b></section>
  </>;
}

function valuesFor(profile) {
  return {
    displayName: profile?.display_name || '', handle: profile?.handle || '', bio: profile?.bio || '',
    discoverable: profile?.discoverable ?? true, leaderboardEnabled: profile?.leaderboard_enabled ?? false,
  };
}
