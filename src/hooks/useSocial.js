import { useCallback, useEffect, useRef, useState } from 'react';
import {
  friendshipRpc, loadLeaderboard, loadSocialData, loadUnreadChats, markChatRead,
  requestFriend, saveProfile, setHabitShare as writeHabitShare, startConversation,
} from '../data/social.js';

const emptyData = { profile: null, friends: [], requests: [], shares: [], feed: [] };

export function weekStartKey(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = start.getDay();
  start.setDate(start.getDate() - (day === 0 ? 6 : day - 1));
  return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
}

export function useSocial(client, userId, onToast) {
  const [data, setData] = useState(emptyData);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [unread, setUnread] = useState({});
  const [chat, setChat] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [leaderboardWeek, setLeaderboardWeek] = useState(weekStartKey);
  const [leaderboardStatus, setLeaderboardStatus] = useState('loading');
  const [leaderboardError, setLeaderboardError] = useState('');
  const leaderboardWeekRef = useRef(leaderboardWeek);
  const generation = useRef(0);
  const chatRef = useRef(null);
  const dataRef = useRef(data);
  const pending = useRef(new Set());
  useEffect(() => { dataRef.current = data; }, [data]);
  useEffect(() => { chatRef.current = chat; }, [chat]);

  const load = useCallback(async (current, visibleMessage = '') => {
    setError('');
    try {
      const loaded = await loadSocialData(client, userId);
      let unreadRows = [], board = [];
      if (loaded.profile) {
        [unreadRows, board] = await Promise.all([loadUnreadChats(client), loadLeaderboard(client, leaderboardWeekRef.current)]);
      }
      if (current !== generation.current) return;
      setData(loaded);
      setUnread(Object.fromEntries(unreadRows.map((row) => [row.conversation_id, row.sender_id])));
      setLeaderboard(board);
      setLeaderboardStatus('ready');
      setLeaderboardError('');
      setStatus('ready');
      setMessage(visibleMessage);
    } catch (loadError) {
      if (current !== generation.current) return;
      setStatus('error');
      setError(`Social features require the latest social database migration. ${loadError.message || 'Please try again.'}`);
    }
  }, [client, userId]);

  useEffect(() => {
    const current = ++generation.current;
    setData(emptyData);
    setUnread({});
    setChat(null);
    setLeaderboard([]);
    setLeaderboardStatus('loading');
    setMessage('');
    load(current);
    return () => { generation.current += 1; };
  }, [load]);

  useEffect(() => {
    if (!data.profile) return undefined;
    const current = generation.current;
    const inbox = client.channel(`chat-inbox:${data.profile.id}`).on(
      'postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' },
      (payload) => {
        if (current !== generation.current) return;
        const incoming = payload.new;
        if (!incoming || incoming.sender_id === data.profile.id || incoming.conversation_id === chatRef.current?.conversationId) return;
        setUnread((value) => ({ ...value, [incoming.conversation_id]: incoming.sender_id }));
        const friend = dataRef.current.friends.find((item) => item.id === incoming.sender_id);
        onToast(`New message from ${friend ? friend.display_name : 'a friend'}`);
      },
    ).subscribe();
    const updates = client.channel(`social-updates:${data.profile.id}`).on(
      'postgres_changes', { event: '*', schema: 'public', table: 'social_activities' },
      () => { if (current === generation.current) load(current); },
    ).on(
      'postgres_changes', { event: '*', schema: 'public', table: 'friendships' },
      () => { if (current === generation.current) load(current); },
    ).on(
      'postgres_changes', { event: '*', schema: 'public', table: 'habit_shares' },
      () => { if (current === generation.current) load(current); },
    ).subscribe();
    return () => { client.removeChannel(inbox); client.removeChannel(updates); };
  }, [client, data.profile, load, onToast]);

  const run = useCallback(async (key, action, successMessage = '') => {
    if (pending.current.has(key)) return false;
    pending.current.add(key);
    try {
      await action();
      await load(generation.current, successMessage);
      return true;
    } catch (actionError) {
      setMessage(actionError.message || 'Could not update Social.');
      return false;
    } finally {
      pending.current.delete(key);
    }
  }, [load]);

  const updateProfile = useCallback(async (profile) => {
    if (pending.current.has('profile')) return false;
    pending.current.add('profile');
    try {
      await saveProfile(client, userId, profile);
      await load(generation.current, dataRef.current.profile ? 'Profile updated.' : 'Profile created.');
      return true;
    } catch (profileError) {
      setMessage(profileError.message || 'Could not save your profile.');
      return false;
    } finally {
      pending.current.delete('profile');
    }
  }, [client, load, userId]);

  const sendRequest = useCallback((handle) => run(`request:${handle}`,
    () => requestFriend(client, dataRef.current.profile, handle), 'Friend request sent.'), [client, run]);
  const updateFriendship = useCallback((action, id) => {
    const messages = { accept: 'Friend request accepted.', remove: 'Friend removed and sharing cleared.', block: 'Person blocked and sharing cleared.' };
    return run(`${action}:${id}`, () => friendshipRpc(client, action, id), messages[action]);
  }, [client, run]);
  const setShare = useCallback((habitId, viewerId, active) => run(`share:${habitId}:${viewerId}`,
    () => writeHabitShare(client, dataRef.current.profile.id, habitId, viewerId, active)), [client, run]);

  const openChat = useCallback(async (friend) => {
    if (pending.current.has(`chat:${friend.id}`)) return;
    pending.current.add(`chat:${friend.id}`);
    try {
      const conversationId = await startConversation(client, friend.id);
      setChat({ conversationId, friend });
    } catch (chatError) {
      setMessage(chatError.message || 'Could not open this chat.');
    } finally {
      pending.current.delete(`chat:${friend.id}`);
    }
  }, [client]);

  const markConversationRead = useCallback(async (conversationId, throughTime) => {
    try {
      await markChatRead(client, conversationId, throughTime);
      setUnread((value) => { const next = { ...value }; delete next[conversationId]; return next; });
    } catch { /* A later refresh will restore and retry unread state. */ }
  }, [client]);

  const selectLeaderboardWeek = useCallback(async (week) => {
    leaderboardWeekRef.current = week;
    setLeaderboardWeek(week);
    setLeaderboardStatus('loading');
    setLeaderboardError('');
    try {
      const rows = await loadLeaderboard(client, week);
      setLeaderboard(rows);
      setLeaderboardStatus('ready');
    } catch (boardError) {
      setLeaderboardStatus('error');
      setLeaderboardError(boardError.message || 'Could not load the leaderboard.');
    }
  }, [client]);

  const receivedCount = data.requests.filter((row) => row.addressee_id === data.profile?.id).length;
  return {
    ...data, status, error, message, unreadCount: Object.keys(unread).length, receivedCount, chat,
    leaderboard, leaderboardWeek, leaderboardStatus, leaderboardError,
    setMessage, setChat, updateProfile,
    createProfile: (displayName, handle) => updateProfile({ displayName, handle, bio: '', discoverable: true, leaderboardEnabled: false }),
    sendRequest, updateFriendship, setShare, openChat, markConversationRead, selectLeaderboardWeek,
    recordCompletion: () => load(generation.current), removeCompletion: () => load(generation.current),
  };
}
