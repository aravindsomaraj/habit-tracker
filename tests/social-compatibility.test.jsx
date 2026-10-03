import React, { StrictMode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSocial } from '../src/hooks/useSocial.js';
const api = vi.hoisted(() => ({ loadSocialData: vi.fn(), loadOwnSettings: vi.fn(), loadFriendProfiles: vi.fn(), loadLeaderboard: vi.fn(), loadUnreadChats: vi.fn(), saveProfile: vi.fn(), startConversation: vi.fn(), requestFriend: vi.fn(), markChatRead: vi.fn(), friendshipRpc: vi.fn(), setHabitShare: vi.fn() }));
vi.mock('../src/data/social.js', () => api);
const profile = { id: 'owner', handle: 'original', display_name: 'Owner' };
const friend = { id: 'friend', handle: 'friend', display_name: 'Friend' };
let client, channels, toast;
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const open = () => renderHook(() => useSocial(client, 'owner', toast, profile), { wrapper: StrictMode });
beforeEach(() => {
  vi.resetAllMocks(); channels = new Set(); toast = vi.fn();
  client = { channel: vi.fn(() => { const channel = { on: () => channel, subscribe: () => { channels.add(channel); return channel; } }; return channel; }), removeChannel: vi.fn(channel => channels.delete(channel)) };
  api.loadSocialData.mockResolvedValue({ profile, friends: [friend], requests: [], shares: [], feed: [] });
  api.loadOwnSettings.mockResolvedValue({ ...profile, bio: '', discoverable: true, leaderboard_enabled: false });
  api.loadFriendProfiles.mockResolvedValue([{ ...friend, bio: 'Reads daily' }]);
  api.loadLeaderboard.mockResolvedValue([]); api.loadUnreadChats.mockResolvedValue([]);
  api.startConversation.mockResolvedValue('conversation'); api.requestFriend.mockResolvedValue();
});
afterEach(cleanup);
describe('independent social feature lifecycles', () => {
  it('keeps Friends and chat usable when the leaderboard fails', async () => {
    api.loadLeaderboard.mockRejectedValue(new Error('Board unavailable'));
    const { result } = open();
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await waitFor(() => expect(result.current.leaderboardStatus).toBe('error'));
    expect(result.current.friends[0].id).toBe('friend');
    expect(result.current.profileStatus).toBe('ready');
    await act(async () => { await result.current.openChat(friend); await result.current.sendRequest('@new_friend'); });
    expect(result.current.chat.conversationId).toBe('conversation');
    expect(api.requestFriend).toHaveBeenCalledWith(client, expect.objectContaining({ id: 'owner' }), '@new_friend');
    expect(result.current.status).toBe('ready');
  });
  it('isolates owner settings, bio, and unread failures from friends/chat', async () => {
    api.loadOwnSettings.mockRejectedValue(new Error('Settings unavailable'));
    api.loadFriendProfiles.mockRejectedValue(new Error('Bios unavailable'));
    api.loadUnreadChats.mockRejectedValue(new Error('Unread unavailable'));
    const { result } = open();
    await waitFor(() => expect(result.current.profileStatus).toBe('error'));
    await waitFor(() => expect(result.current.friendProfilesError).toBe('Bios unavailable'));
    expect(result.current.unreadError).toBe('Unread unavailable');
    expect(result.current.profile.handle).toBe('original');
    expect(result.current.leaderboardStatus).toBe('ready');
    await act(async () => { await result.current.openChat(friend); });
    expect(result.current.chat.friend.id).toBe('friend'); expect(result.current.status).toBe('ready');
    api.loadOwnSettings.mockResolvedValue({ ...profile, discoverable: false });
    await act(async () => { await result.current.refreshProfile(); });
    expect(result.current.profile.discoverable).toBe(false);
  });
  it('updates the current identity after a profile save and prevents duplicate writes', async () => {
    const saved = deferred(); api.saveProfile.mockReturnValue(saved.promise);
    const { result } = open(); await waitFor(() => expect(result.current.profileStatus).toBe('ready'));
    let saving;
    act(() => { saving = result.current.updateProfile({ handle: 'renamed' }); });
    await act(async () => { expect(await result.current.updateProfile({ handle: 'renamed' })).toBe(false); });
    await act(async () => { saved.resolve({ ...profile, handle: 'renamed' }); await saving; });
    expect(api.saveProfile).toHaveBeenCalledTimes(1);
    expect(result.current.profile.handle).toBe('renamed');
    await act(async () => { await result.current.sendRequest('someone'); });
    expect(api.requestFriend).toHaveBeenCalledWith(client, expect.objectContaining({ handle: 'renamed' }), 'someone');
  });
  it('ignores out-of-order leaderboard responses', async () => {
    const old = deferred(), next = deferred();
    const { result } = open(); await waitFor(() => expect(result.current.leaderboardStatus).toBe('ready'));
    api.loadLeaderboard.mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
    act(() => { result.current.selectLeaderboardWeek('2026-09-14'); result.current.selectLeaderboardWeek('2026-09-21'); });
    await act(async () => { next.resolve([{ user_id: 'new' }]); });
    await act(async () => { old.resolve([{ user_id: 'old' }]); });
    expect(result.current.leaderboard).toEqual([{ user_id: 'new' }]);
    expect(result.current.leaderboardWeek).toBe('2026-09-21');
  });
  it('maintains one pair of subscriptions in Strict Mode and cleans them up', async () => {
    const { result, unmount } = open(); await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(channels.size).toBe(2);
    api.saveProfile.mockResolvedValue({ ...profile, handle: 'renamed' });
    await act(async () => { await result.current.updateProfile({ handle: 'renamed' }); });
    expect(channels.size).toBe(2);
    unmount(); expect(channels.size).toBe(0);
  });
  it('does not refresh or show a chat from an account that has unmounted', async () => {
    const pending = deferred(); api.startConversation.mockReturnValue(pending.promise);
    const { result, unmount } = open(); await waitFor(() => expect(result.current.status).toBe('ready'));
    let opening; act(() => { opening = result.current.openChat(friend); });
    unmount(); await act(async () => { pending.resolve('late'); await opening; });
    expect(channels.size).toBe(0); expect(result.current.chat).toBeNull();
  });
});
