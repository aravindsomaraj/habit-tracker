export const HABIT_COLUMNS = 'id,name,emoji,target,unit,days,start_date,metric,ramp,created_at';
export const ENTRY_COLUMNS = 'id,habit_id,entry_date,done,rest,value,metric,photo_path,updated_at';

export const habitFromRow = (row) => ({
  id: row.id,
  name: row.name,
  emoji: row.emoji,
  target: Number(row.target),
  unit: row.unit,
  days: row.days,
  start: row.start_date,
  metric: row.metric,
  ramp: row.ramp,
  createdAt: Date.parse(row.created_at),
});

export const entryFromRow = (row) => ({
  done: !!row.done,
  rest: !!row.rest,
  value: row.value == null ? null : Number(row.value),
  metric: row.metric == null ? null : Number(row.metric),
  ts: Date.parse(row.updated_at),
  photo: row.photo_path || null,
});

export async function readPages(makeQuery, isCurrent = () => true) {
  let rows = [], offset = 0;
  while (isCurrent()) {
    const result = await makeQuery().range(offset, offset + 499);
    if (result.error) throw result.error;
    if (!result.data.length) break;
    rows = rows.concat(result.data);
    offset += result.data.length;
  }
  return rows;
}

export async function loadHabitData(client, userId, isCurrent = () => true) {
  const rows = await readPages(
    () => client.from('habits').select(HABIT_COLUMNS).eq('user_id', userId).order('created_at').order('id'),
    isCurrent,
  );
  const habits = rows.map(habitFromRow);
  const entries = Object.fromEntries(habits.map((habit) => [habit.id, {}]));
  for (let index = 0; index < habits.length && isCurrent(); index += 100) {
    const ids = habits.slice(index, index + 100).map((habit) => habit.id);
    const daily = await readPages(
      () => client.from('habit_entries').select(ENTRY_COLUMNS).in('habit_id', ids).order('id'),
      isCurrent,
    );
    daily.forEach((row) => { entries[row.habit_id][row.entry_date] = entryFromRow(row); });
  }
  return { habits, entries };
}

export async function insertHabit(client, userId, habit) {
  const result = await client.from('habits').insert({
    user_id: userId,
    name: habit.name,
    emoji: habit.emoji,
    target: habit.target,
    unit: habit.unit,
    days: habit.days,
    start_date: habit.start,
    metric: habit.metric,
    ramp: habit.ramp,
    created_at: new Date().toISOString(),
  }).select(HABIT_COLUMNS).single();
  if (result.error) throw result.error;
  return habitFromRow(result.data);
}

export async function writeEntryRow(client, habit, entryDate, patch) {
  const row = { habit_id: habit.id, entry_date: entryDate, updated_at: new Date().toISOString() };
  ['done', 'rest', 'value', 'metric'].forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(patch, field)) row[field] = patch[field];
  });
  if (Object.prototype.hasOwnProperty.call(patch, 'photo')) row.photo_path = patch.photo;
  const result = await client.from('habit_entries').upsert(row, {
    onConflict: 'habit_id,entry_date',
    defaultToNull: false,
  }).select(ENTRY_COLUMNS).single();
  if (result.error) throw result.error;
  return entryFromRow(result.data);
}

export async function deleteHabitRow(client, userId, habitId) {
  const result = await client.from('habits').delete().eq('id', habitId).eq('user_id', userId).select('id').single();
  if (result.error) throw result.error;
}
