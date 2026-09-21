export function SharingModal({ habits, social, onClose }) {
  return <><h3>Share completion updates</h3><p className="sub">Choose which friends can see a habit being marked complete. Nothing else is shared.</p>{habits.map((habit) => <div className="share-habit" key={habit.id}><b>{habit.emoji} {habit.name}</b>{!social.friends.length && <span className="tiny">Add and accept a friend first.</span>}{social.friends.map((friend) => {
    const active = social.shares.some((share) => share.habit_id === habit.id && share.viewer_id === friend.id);
    return <label key={friend.id}><input type="checkbox" checked={active} onChange={(event) => social.setShare(habit.id, friend.id, event.target.checked)} /> {friend.display_name}</label>;
  })}</div>)}<div className="modal-actions"><button className="cta ghost" onClick={onClose}>Done</button></div></>;
}
