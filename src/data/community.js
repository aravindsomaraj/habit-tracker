async function rpc(client, name, args) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw error;
  return data;
}
export async function loadCommunityPreferences(client, userId) {
  const loadHabits = async () => await client.from('community_habits').select('habit_id').eq('owner_id', userId);
  const [enabled, result] = await Promise.all([
    rpc(client, 'community_preferences'),
    loadHabits(),
  ]);
  if (result.error) throw result.error;
  return { enabled: enabled === true, habits: result.data || [] };
}
export const setCommunityEnabled = (client, enabled) => rpc(client, 'set_community_enabled', { enabled });
export const setCommunityHabit = (client, habit, enabled) => rpc(client, 'set_community_habit', { habit, enabled });
export const blockCommunityUser = (client, target) => rpc(client, 'block_community_user', { target });
export const reportCommunityActivity = (client, activity, reason) => rpc(client, 'report_community_activity', { activity, report_reason: reason });
export async function loadCommunityFeed(client, cursor = null, actor = null) {
  return await rpc(client, 'community_feed', { before_time: cursor?.created_at || null, before_id: cursor?.id || null, page_size: 20, actor }) || [];
}
export async function loadCommunityProfile(client, target) {
  const [people, feed] = await Promise.all([rpc(client, 'community_profile', { target }), loadCommunityFeed(client, null, target)]);
  return { profile: people?.[0] || null, feed };
}
