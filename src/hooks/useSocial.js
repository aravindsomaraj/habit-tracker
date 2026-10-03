import { useCallback, useEffect, useRef, useState } from 'react';
import { changeAvatar, cleanupAvatar } from '../data/avatars.js';
import {
  findFriend, friendshipRpc, loadFriendProfiles, loadLeaderboard, loadOwnSettings, loadSocialData,
  loadUnreadChats, markChatRead, requestFriend, saveProfile,
  setHabitShare as writeHabitShare, startConversation,
} from '../data/social.js';

const emptyData = { friends: [], requests: [], shares: [], feed: [] };
export function weekStartKey(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = start.getDay();
  start.setDate(start.getDate() - (day === 0 ? 6 : day - 1));
  return `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
}

export function useSocial(client, userId, onToast, initialProfile) {
  const [data, setData] = useState(emptyData);
  // HandleGate supplies the authenticated identity. Settings become the current
  // profile after loading/saving, so a rename immediately reaches every caller.
  const [settings, setSettings] = useState(null);
  const profile = settings || initialProfile || data.profile;
  const [status, setStatus] = useState('loading'), [error, setError] = useState('');
  const [profileStatus, setProfileStatus] = useState('loading'), [profileError, setProfileError] = useState('');
  const [friendProfiles, setFriendProfiles] = useState([]), [friendProfilesError, setFriendProfilesError] = useState('');
  const [message, setMessage] = useState('');
  const [avatarBusy, setAvatarBusy] = useState(false), [avatarMessage, setAvatarMessage] = useState('');
  const [avatarCleanup, setAvatarCleanup] = useState([]), [profileSaving, setProfileSaving] = useState(false);
  const accountRef = useRef({ client, userId });
  accountRef.current = { client, userId };
  const [unread, setUnread] = useState({}), [unreadError, setUnreadError] = useState('');
  const [chat, setChat] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [leaderboardWeek, setLeaderboardWeek] = useState(weekStartKey);
  const [leaderboardStatus, setLeaderboardStatus] = useState('loading'), [leaderboardError, setLeaderboardError] = useState('');
  const weekRef = useRef(leaderboardWeek), generation = useRef(0), boardRequest = useRef(0), socialRequest = useRef(0), settingsRequest = useRef(0);
  const chatRef = useRef(null), profileRef = useRef(profile), dataRef = useRef(data), pending = useRef(new Set());
  profileRef.current = profile; dataRef.current = data; chatRef.current = chat;

  const refreshProfile = useCallback(async () => {
    if (pending.current.has('profile')) return;
    const current = generation.current, request = ++settingsRequest.current;
    setProfileStatus('loading'); setProfileError('');
    try {
      const result = await loadOwnSettings(client);
      if (current !== generation.current || request !== settingsRequest.current) return;
      setSettings(result); setProfileStatus('ready');
    } catch (failure) {
      if (current !== generation.current || request !== settingsRequest.current) return;
      setProfileStatus('error'); setProfileError(failure.message || 'Could not load profile settings.');
    }
  }, [client]);

  const refreshBoard = useCallback(async (week = weekRef.current) => {
    const current = generation.current, request = ++boardRequest.current;
    setLeaderboardStatus('loading'); setLeaderboardError('');
    try {
      const rows = await loadLeaderboard(client, week);
      if (current !== generation.current || request !== boardRequest.current) return;
      setLeaderboard(rows); setLeaderboardStatus('ready');
    } catch (failure) {
      if (current !== generation.current || request !== boardRequest.current) return;
      setLeaderboard([]); setLeaderboardStatus('error'); setLeaderboardError(failure.message || 'Could not load the leaderboard.');
    }
  }, [client]);

  const refreshUnread = useCallback(async () => {
    const current = generation.current;
    try {
      const rows = await loadUnreadChats(client);
      if (current !== generation.current) return;
      setUnread(Object.fromEntries(rows.map((row) => [row.conversation_id, row.sender_id]))); setUnreadError('');
    } catch (failure) {
      if (current === generation.current) setUnreadError(failure.message || 'Could not load unread counts.');
    }
  }, [client]);

  const load = useCallback(async () => {
    const current = generation.current, request = ++socialRequest.current;
    try {
      const loaded = await loadSocialData(client, userId, profileRef.current);
      if (current !== generation.current || request !== socialRequest.current) return;
      setData(loaded); setStatus('ready'); setError('');
      // A remote remove/block is learned through authorized refreshes. Close any
      // conversation whose friendship has disappeared, clearing its local history.
      setChat((currentChat) => {
        if (!currentChat) return null;
        const friend = loaded.friends.find((person) => person.id === currentChat.friend.id);
        return friend ? { ...currentChat, friend } : null;
      });
      // Bios have their own failure surface. Friends/chat need only identity.
      try {
        const people = await loadFriendProfiles(client, loaded.friends.map((friend) => friend.id));
        if (current !== generation.current || request !== socialRequest.current) return;
        setFriendProfiles(people); setFriendProfilesError('');
      } catch (failure) {
        if (current !== generation.current || request !== socialRequest.current) return;
        setFriendProfiles([]); setFriendProfilesError(failure.message || 'Friend bios are unavailable.');
      }
    } catch (failure) {
      if (current !== generation.current || request !== socialRequest.current) return;
      setStatus('error'); setError(failure.message || 'Could not load your social circle.');
    }
  }, [client, userId]);

  useEffect(() => {
    ++generation.current;
    setData(emptyData); setSettings(null); setUnread({}); setChat(null); setMessage('');
    pending.current = new Set();
    setAvatarBusy(false); setProfileSaving(false); setAvatarMessage(''); setAvatarCleanup([]);
    setStatus('loading'); setFriendProfiles([]); setFriendProfilesError('');
    setLeaderboard([]); setUnreadError('');
    load(); refreshProfile(); refreshBoard(); refreshUnread();
    return () => { ++generation.current; };
  }, [load, refreshProfile, refreshBoard, refreshUnread]);

  useEffect(() => {
    if (!profile?.id) return undefined;
    const current = generation.current;
    let refreshing = false;
    const refresh = async () => {
      if (current !== generation.current || document.visibilityState === 'hidden' || refreshing) return;
      refreshing = true;
      try { await Promise.all([load(), refreshBoard(), refreshUnread()]); }
      finally { refreshing = false; }
    };
    const inbox = client.channel(`chat-inbox:${profile.id}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages' }, ({ new: incoming }) => {
      if (current !== generation.current || !incoming) return;
      refresh();
      if (incoming.sender_id === userId || incoming.conversation_id === chatRef.current?.conversationId && document.visibilityState !== 'hidden') return;
      setUnread((value) => ({ ...value, [incoming.conversation_id]: incoming.sender_id }));
      const friend = dataRef.current.friends.find((item) => item.id === incoming.sender_id);
      onToast(`New message from ${friend ? friend.display_name : 'a friend'}`);
    }).subscribe();
    // Relationship/share/read-state DELETE payloads do not have row-level
    // authorization in Postgres Changes. Use RLS-scoped reads instead.
    const timer = window.setInterval(refresh, 30_000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
      client.removeChannel(inbox);
    };
  }, [client, profile?.id, userId, load, refreshBoard, refreshUnread, onToast]);

  const run = useCallback(async (key, action, successMessage = '') => {
    if (pending.current.has(key)) return false;
    const current = generation.current;
    pending.current.add(key);
    try {
      await action();
      if (current !== generation.current) return false;
      setMessage(successMessage); await load(); refreshBoard();
      return true;
    } catch (failure) {
      if (current === generation.current) setMessage(failure.message || 'Could not update Social.');
      return false;
    } finally { pending.current.delete(key); }
  }, [load, refreshBoard]);

  const updateProfile = useCallback(async (fields) => {
    if (pending.current.has('profile')) return false;
    const current = generation.current;
    pending.current.add('profile'); ++settingsRequest.current; setProfileSaving(true);
    try {
      const saved = await saveProfile(client, fields);
      if (current !== generation.current) return false;
      profileRef.current = saved; setSettings(saved); setProfileStatus('ready'); setProfileError('');
      setMessage('Profile updated.'); refreshBoard();
      return true;
    } catch (failure) {
      if (current === generation.current) setMessage(failure.message || 'Could not save your profile.');
      return false;
    } finally { if (current === generation.current) { pending.current.delete('profile'); setProfileSaving(false); } }
  }, [client, refreshBoard]);

  const updateAvatar = useCallback(async (file, cleanupPaths) => {
    if (pending.current.has('profile')) return false;
    const current = generation.current;
    const ensureCurrent = () => {
      if (current !== generation.current || accountRef.current.client !== client || accountRef.current.userId !== userId) {
        throw new Error('Your account changed. Reload your profile.');
      }
    };
    pending.current.add('profile'); ++settingsRequest.current;
    setAvatarBusy(true); setAvatarMessage('');
    try {
      if (cleanupPaths) {
        for (const path of cleanupPaths) {
          await cleanupAvatar(client, userId, path, ensureCurrent);
          ensureCurrent(); setAvatarCleanup((paths) => paths.filter((item) => item !== path));
        }
        setAvatarMessage('Unused photo files deleted.');
      } else {
        const result = await changeAvatar(client, userId, file, ensureCurrent);
        ensureCurrent(); ++settingsRequest.current;
        profileRef.current = result.profile; setSettings(result.profile);
        setProfileStatus('ready'); setProfileError('');
        setAvatarMessage(result.warning || (file === null ? 'Photo removed.' : 'Photo updated.'));
        if (result.cleanupPath) setAvatarCleanup((paths) => [...new Set([...paths, result.cleanupPath])]);
        // Own leaderboard identity updates immediately, even if its refresh fails.
        setLeaderboard((rows) => rows.map((row) => row.user_id === userId ? { ...row, avatar_path: result.profile.avatar_path } : row));
        refreshBoard();
      }
      return true;
    } catch (failure) {
      if (current === generation.current && accountRef.current.userId === userId && accountRef.current.client === client) {
        setAvatarMessage(failure.message || 'Could not change your photo.');
        if (failure.cleanupPath) setAvatarCleanup((paths) => [...new Set([...paths, failure.cleanupPath])]);
      }
      return false;
    } finally {
      if (current === generation.current) { pending.current.delete('profile'); setAvatarBusy(false); }
    }
  }, [client, userId, refreshBoard]);

  const sendRequest = useCallback((handle) => run(`request:${handle}`, () => requestFriend(client, profileRef.current, handle), 'Friend request sent.'), [client, run]);
  const searchFriend = useCallback((handle) => findFriend(client, profileRef.current, handle), [client]);
  const updateFriendship = useCallback((action, id) => run(`${action}:${id}`, async () => {
    await friendshipRpc(client, action, id);
    if (action !== 'accept') setChat(null);
  }, { accept: 'Friend request accepted.', remove: 'Friend removed and sharing cleared.', block: 'Person blocked and sharing cleared.' }[action]), [client, run]);
  const setShare = useCallback((habitId, viewerId, active) => run(`share:${habitId}:${viewerId}`, () => writeHabitShare(client, userId, habitId, viewerId, active)), [client, userId, run]);
  const openChat = useCallback(async (friend) => {
    const key = `chat:${friend.id}`, current = generation.current;
    if (pending.current.has(key)) return;
    pending.current.add(key);
    try {
      const conversationId = await startConversation(client, friend.id);
      if (current === generation.current) setChat({ conversationId, friend });
    } catch (failure) {
      if (current === generation.current) setMessage(failure.message || 'Could not open this chat.');
    } finally { pending.current.delete(key); }
  }, [client]);
  const markConversationRead = useCallback(async (conversationId, throughTime) => {
    const current = generation.current;
    try {
      await markChatRead(client, conversationId, throughTime);
      if (current === generation.current) setUnread((value) => { const next = { ...value }; delete next[conversationId]; return next; });
    } catch { /* Keep the badge; a later refresh can retry. */ }
  }, [client]);
  const selectLeaderboardWeek = useCallback((week) => { weekRef.current = week; setLeaderboardWeek(week); return refreshBoard(week); }, [refreshBoard]);
  const refreshCompletion = useCallback(() => { load(); refreshBoard(); }, [load, refreshBoard]);
  const friends = data.friends.map((friend) => ({ ...friend, bio: friendProfiles.find((person) => person.id === friend.id)?.bio }));
  return {
    client, avatarBusy, avatarMessage, avatarCleanup, updateAvatar, profileSaving, searchFriend,
    ...data, friends, profile, status, error, message, profileStatus, profileError, friendProfilesError, unreadError,
    unreadCount: Object.keys(unread).length, receivedCount: data.requests.filter((row) => row.addressee_id === userId).length,
    chat, leaderboard, leaderboardWeek, leaderboardStatus, leaderboardError,
    setMessage, setChat, updateProfile, refreshProfile, sendRequest, updateFriendship, setShare, openChat,
    markConversationRead, selectLeaderboardWeek, recordCompletion: refreshCompletion, removeCompletion: refreshCompletion,
  };
}
