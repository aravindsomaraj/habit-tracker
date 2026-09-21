export function HabitPicker({ habits, selected, onPick }) {
  if (habits.length < 2) return null;
  return <div className="sel">{habits.map((habit) => <button key={habit.id} className={habit.id === selected ? 'on' : ''} onClick={() => onPick(habit.id)}>{habit.emoji} {habit.name}</button>)}</div>;
}
