export function SharingModal({ habits, social, onClose }) {
  const community = social.community;
  if (community) return <><h3>Share completion updates</h3><p className="sub">Friend sharing and community publishing are independent. Only habit names and completion dates are shared.</p>
    {community.settingsStatus === 'error' && <p role="alert">{community.settingsError}</p>}
    {!community.enabled && <p className="sub">Enable community participation in Profile to publish to everyone signed in.</p>}
    {community.message && <p role="status">{community.message}</p>}
    {habits.map(habit => <div className="share-habit" key={habit.id}><b>{habit.emoji} {habit.name}</b><label><input type="checkbox" checked={community.habits.some(row => row.habit_id === habit.id)} disabled={!community.enabled || community.settingsStatus !== 'ready' || community.busy} onChange={event => { const enabled = event.target.checked; if (!enabled || window.confirm(`Publish future completions of "${habit.name}" to everyone signed in? Your habit name will be visible.`)) community.setHabit(habit.id, enabled); }} /> Community: publish new completions</label><span className="tiny">Unchecking removes this habit’s community updates.</span>
      {social.friends.map(friend => <label key={friend.id}><input type="checkbox" checked={social.shares.some(share => share.habit_id === habit.id && share.viewer_id === friend.id)} onChange={event => social.setShare(habit.id, friend.id, event.target.checked)} /> Friend: {friend.display_name}</label>)}
    </div>)}<div className="modal-actions"><button className="cta ghost" onClick={onClose}>Done</button></div></>;
  return <><h3>Share completion updates</h3><p className="sub">Choose which friends can see a habit being marked complete. Nothing else is shared.</p>{habits.map((habit) => <div className="share-habit" key={habit.id}><b>{habit.emoji} {habit.name}</b>{!social.friends.length && <span className="tiny">Add and accept a friend first.</span>}{social.friends.map((friend) => {
    const active = social.shares.some((share) => share.habit_id === habit.id && share.viewer_id === friend.id);
    return <label key={friend.id}><input type="checkbox" checked={active} onChange={(event) => social.setShare(habit.id, friend.id, event.target.checked)} /> {friend.display_name}</label>;
  })}</div>)}<div className="modal-actions"><button className="cta ghost" onClick={onClose}>Done</button></div></>;
}
