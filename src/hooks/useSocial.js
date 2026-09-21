import { useCallback, useEffect, useRef, useState } from 'react';
import {
  friendshipRpc, loadSocialData, publishCompletion, requestFriend, saveProfile,
  setHabitShare as writeHabitShare, startConversation, unpublishCompletion,
} from '../data/social.js';

const emptyData = { profile: null, friends: [], requests: [], shares: [], feed: [] };

export function useSocial(client, userId, onToast) {
  const [data, setData] = useState(emptyData);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [unread, setUnread] = useState({});
  const [chat, setChat] = useState(null);
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
      if (current !== generation.current) return;
      setData(loaded);
      setStatus('ready');
      setMessage(visibleMessage);
    } catch (loadError) {
      if (current !== generation.current) return;
      setStatus('error');
      setError(`Social features require the social database migration. ${loadError.message || 'Please try again.'}`);
    }
  }, [client, userId]);

  useEffect(() => {
    const current = ++generation.current;
    setData(emptyData);
    setUnread({});
    setChat(null);
    setMessage('');
    load(current);
    return () => { generation.current += 1; };
  }, [load]);

  useEffect(() => {
    if (!data.profile) return undefined;
    const current = generation.current;
    const channel = client.channel(`chat-inbox:${data.profile.id}`).on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'chat_messages' },
      (payload) => {
        if (current !== generation.current) return;
        const incoming = payload.new;
        if (!incoming || incoming.sender_id === data.profile.id || incoming.conversation_id === chatRef.current?.conversationId) return;
        setUnread((value) => ({ ...value, [incoming.conversation_id]: true }));
        const friend = dataRef.current.friends.find((item) => item.id === incoming.sender_id);
        onToast(`New message from ${friend ? friend.display_name : 'a friend'}`);
      },
    ).subscribe();
    return () => { client.removeChannel(channel); };
  }, [client, data.profile, onToast]);

  const run = useCallback(async (key, action, successMessage = '') => {
    if (pending.current.has(key)) return false;
    pending.current.add(key);
    try {
      await action();
      await load(generation.current, successMessage);
      return true;
    } catch (actionError) {
      setMessage(actionError.message || 'Could not update Friends.');
      return false;
    } finally {
      pending.current.delete(key);
    }
  }, [load]);

  const createProfile = useCallback(async (displayName, handle) => {
    if (pending.current.has('profile')) return false;
    pending.current.add('profile');
    try {
      await saveProfile(client, userId, displayName, handle);
      await load(generation.current, 'Profile saved.');
      return true;
    } catch (profileError) {
      window.alert(profileError.message || 'Could not save your profile.');
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
      setUnread((value) => { const next = { ...value }; delete next[conversationId]; return next; });
      setChat({ conversationId, friend });
    } catch (chatError) {
      setMessage(chatError.message || 'Could not open this chat.');
    } finally {
      pending.current.delete(`chat:${friend.id}`);
    }
  }, [client]);

  const recordCompletion = useCallback(async (habit, entryDate) => {
    const current = dataRef.current;
    if (!current.profile || !current.shares.some((share) => share.habit_id === habit.id)) return;
    try { await publishCompletion(client, current.profile.id, habit, entryDate); } catch { /* Entry persistence remains the source of truth. */ }
  }, [client]);
  const removeCompletion = useCallback(async (habit, entryDate) => {
    const profile = dataRef.current.profile;
    if (!profile) return;
    try { await unpublishCompletion(client, profile.id, habit.id, entryDate); } catch { /* Best-effort social mirror. */ }
  }, [client]);

  return {
    ...data, status, error, message, unreadCount: Object.keys(unread).length, chat,
    setMessage, setChat, createProfile, sendRequest, updateFriendship, setShare, openChat,
    recordCompletion, removeCompletion,
  };
}
