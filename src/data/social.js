export async function loadSocialData(client, userId) {
  const profileFields = 'id,handle,display_name,bio,discoverable,leaderboard_enabled';
  const profileResult = await client.from('profiles').select(profileFields).eq('id', userId).maybeSingle();
  if (profileResult.error) throw profileResult.error;
  const profile = profileResult.data || null;
  if (!profile) return { profile: null, friends: [], requests: [], shares: [], feed: [] };

  const friendshipResult = await client.from('friendships').select('id,requester_id,addressee_id,status,created_at')
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`).order('created_at', { ascending: false });
  if (friendshipResult.error) throw friendshipResult.error;
  const rows = friendshipResult.data || [];
  const ids = rows.map((row) => row.requester_id === userId ? row.addressee_id : row.requester_id);
  const peopleResult = ids.length
    ? await client.from('profiles').select(profileFields).in('id', ids)
    : { data: [], error: null };
  if (peopleResult.error) throw peopleResult.error;
  const people = Object.fromEntries((peopleResult.data || []).map((person) => [person.id, person]));
  const friends = rows.filter((row) => row.status === 'accepted').map((row) => {
    const person = people[row.requester_id === userId ? row.addressee_id : row.requester_id];
    return person && { ...person, friendship_id: row.id };
  }).filter(Boolean);
  const requests = rows.filter((row) => row.status === 'pending').map((row) => ({
    ...row,
    person: people[row.requester_id === userId ? row.addressee_id : row.requester_id],
  })).filter((row) => row.person);

  const sharesResult = await client.from('habit_shares').select('habit_id,viewer_id').eq('owner_id', userId);
  if (sharesResult.error) throw sharesResult.error;
  const feedResult = await client.from('social_activities').select('id,actor_id,habit_label,occurred_on,created_at')
    .neq('actor_id', userId).order('created_at', { ascending: false }).limit(50);
  if (feedResult.error) throw feedResult.error;
  const feedRows = feedResult.data || [];
  const actorIds = [...new Set(feedRows.map((row) => row.actor_id))];
  const actorsResult = actorIds.length
    ? await client.from('profiles').select(profileFields).in('id', actorIds)
    : { data: [], error: null };
  if (actorsResult.error) throw actorsResult.error;
  const actors = Object.fromEntries((actorsResult.data || []).map((person) => [person.id, person]));
  return {
    profile,
    friends,
    requests,
    shares: sharesResult.data || [],
    feed: feedRows.map((row) => ({ ...row, person: actors[row.actor_id] })).filter((row) => row.person),
  };
}

export async function saveProfile(client, userId, profile) {
  const result = await client.from('profiles').upsert({
    id: userId,
    display_name: profile.displayName,
    handle: profile.handle,
    bio: profile.bio || '',
    discoverable: profile.discoverable,
    leaderboard_enabled: profile.leaderboardEnabled,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' });
  if (result.error) throw result.error;
}

export async function loadLeaderboard(client, weekStart) {
  const result = await client.rpc('social_leaderboard_week', { week_start: weekStart });
  if (result.error) throw result.error;
  return result.data || [];
}

export async function loadUnreadChats(client) {
  const result = await client.rpc('social_unread_chats');
  if (result.error) throw result.error;
  return result.data || [];
}

export async function markChatRead(client, conversationId, throughTime) {
  const result = await client.rpc('mark_social_chat_read', { conversation: conversationId, through_time: throughTime });
  if (result.error) throw result.error;
}

export async function requestFriend(client, profile, handle) {
  const found = await client.from('profiles').select('id,handle').eq('handle', handle).maybeSingle();
  if (found.error) throw found.error;
  if (!found.data) throw new Error('No discoverable profile has that handle.');
  if (found.data.id === profile.id) throw new Error('You cannot add yourself.');
  const result = await client.from('friendships').insert({ requester_id: profile.id, addressee_id: found.data.id, status: 'pending' });
  if (result.error) throw result.error;
}

export async function friendshipRpc(client, action, id) {
  const calls = {
    accept: ['accept_friendship', { request_id: id }],
    remove: ['remove_friendship', { friendship_id: id }],
    block: ['block_friendship', { friendship_id: id }],
  };
  const [name, args] = calls[action];
  const result = await client.rpc(name, args);
  if (result.error) throw result.error;
}

export async function setHabitShare(client, ownerId, habitId, viewerId, active) {
  const result = active
    ? await client.from('habit_shares').insert({ habit_id: habitId, owner_id: ownerId, viewer_id: viewerId })
    : await client.from('habit_shares').delete().eq('habit_id', habitId).eq('owner_id', ownerId).eq('viewer_id', viewerId);
  if (result.error) throw result.error;
}

export async function startConversation(client, friendId) {
  const result = await client.rpc('start_direct_conversation', { friend_id: friendId });
  if (result.error) throw result.error;
  return result.data;
}

export async function loadMessages(client, conversationId) {
  const result = await client.from('chat_messages').select('id,sender_id,body,created_at')
    .eq('conversation_id', conversationId).order('created_at', { ascending: true }).limit(100);
  if (result.error) throw result.error;
  return result.data || [];
}

export async function sendMessage(client, conversationId, senderId, body) {
  const result = await client.from('chat_messages').insert({ conversation_id: conversationId, sender_id: senderId, body })
    .select('id,conversation_id,sender_id,body,created_at').single();
  if (result.error) throw result.error;
  return result.data;
}
