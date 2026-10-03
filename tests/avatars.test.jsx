import React from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Avatar } from '../src/components/Avatar.jsx';
import { ProfileView } from '../src/views/ProfileView.jsx';
import { SocialView } from '../src/views/SocialView.jsx';
import { ChatModal } from '../src/components/ChatModal.jsx';
import { changeAvatar, cleanupAvatar } from '../src/data/avatars.js';
import { useSocial } from '../src/hooks/useSocial.js';
const api = vi.hoisted(() => Object.fromEntries(['findFriend','friendshipRpc','loadFriendProfiles','loadLeaderboard','loadOwnSettings','loadSocialData','loadUnreadChats','markChatRead','requestFriend','saveProfile','setHabitShare','startConversation','loadMessages','sendMessage'].map(name => [name,vi.fn()])));
vi.mock('../src/data/social.js', () => api);
const owner='10000000-0000-0000-0000-000000000001', friendId='10000000-0000-0000-0000-000000000002';
const oldPath=`${owner}/20000000-0000-0000-0000-000000000001.png`;
const friendPath=`${friendId}/20000000-0000-0000-0000-000000000002.png`;
const baseProfile={id:owner,handle:'test_owner',display_name:'Test Owner',bio:'Bio',discoverable:true,leaderboard_enabled:true,avatar_path:null};
const friend={id:friendId,handle:'friend',display_name:'Friend Name',bio:'Friend bio',avatar_path:friendPath,friendship_id:'friendship'};
const file=(type='image/png',size=10)=>({name:'photo.png',type,size});
const deferred=()=>{let resolve; const promise=new Promise(r=>{resolve=r;}); return {promise,resolve};};
let profile, client, storage, calls, toast;
const url=path=>`https://project.supabase.co/storage/v1/object/public/avatars/${path}`;
beforeEach(()=>{
  vi.resetAllMocks(); profile={...baseProfile}; calls=[]; toast=vi.fn();
  storage={
    upload:vi.fn(async(path)=>{calls.push(['upload',path]); return {error:null};}),
    remove:vi.fn(async(paths)=>{calls.push(['remove',...paths]); return {data:[],error:null};}),
    getPublicUrl:vi.fn(path=>({data:{publicUrl:url(path)}})),
  };
  client={storage:{from:vi.fn(bucket=>{expect(bucket).toBe('avatars');return storage;})},rpc:vi.fn(async(name,args)=>{
    if(name==='own_profile_settings') return {data:[{...profile}],error:null};
    if(name==='set_profile_avatar') {calls.push(['metadata',args.new_avatar_path]);profile={...profile,avatar_path:args.new_avatar_path};return {data:[{...profile}],error:null};}
    throw new Error(`Unexpected RPC ${name}`);
  }),channel:vi.fn(()=>{const channel={on:()=>channel,subscribe:()=>channel};return channel;}),removeChannel:vi.fn()};
  api.loadOwnSettings.mockImplementation(async()=>({...profile}));
  api.loadSocialData.mockResolvedValue({friends:[friend],requests:[],shares:[],feed:[]});
  api.loadFriendProfiles.mockResolvedValue([friend]); api.loadLeaderboard.mockResolvedValue([]); api.loadUnreadChats.mockResolvedValue([]);
  api.loadMessages.mockResolvedValue([]);
});
afterEach(cleanup);
function Harness(){const social=useSocial(client,owner,toast,baseProfile);return <ProfileView social={social} habits={[]} entries={{}} user={{id:owner}}/>;}
async function openProfile(){render(<Harness/>); await screen.findByLabelText('Profile photo');}
const selectFile=(selected=file())=>fireEvent.change(screen.getByLabelText('Profile photo'),{target:{files:[selected]}});
const photo=()=>screen.getByRole('img',{name:"Test Owner's avatar"});

describe('shared Avatar',()=>{
  it('renders consistent initials for legacy NULL profiles and handles',()=>{
    const view=render(<Avatar profile={baseProfile}/>);expect(photo().textContent).toBe('TO');
    view.rerender(<Avatar profile={{handle:'reader'}}/>);expect(screen.getByRole('img').textContent).toBe('R');
    view.rerender(<Avatar/>);expect(screen.getByRole('img',{name:'Default avatar'}).textContent).toBe('?');
  });
  it('renders a public image, falls back after failure, and tries a replacement immediately',()=>{
    const view=render(<Avatar client={client} profile={{...profile,avatar_path:oldPath}}/>);
    expect(photo().getAttribute('src')).toBe(url(oldPath));fireEvent.error(photo());expect(photo().textContent).toBe('TO');
    const next=oldPath.replace('.png','.webp');view.rerender(<Avatar client={client} profile={{...profile,avatar_path:next}}/>);
    expect(photo().getAttribute('src')).toBe(url(next));
  });
  it('never treats arbitrary URLs, traversal or another UUID as avatar metadata',()=>{
    const view=render(<Avatar client={client} profile={{...profile,avatar_path:'https://attacker.test/photo.png'}}/>);
    expect(photo().tagName).toBe('SPAN');
    view.rerender(<Avatar client={client} profile={{...profile,avatar_path:friendPath}}/>);
    expect(photo().tagName).toBe('SPAN');expect(storage.getPublicUrl).not.toHaveBeenCalled();
  });
});

describe('avatar storage orchestration',()=>{
  it('validates and uploads a UUID-scoped versioned object before metadata, then removes the old object',async()=>{
    profile.avatar_path=oldPath;
    const result=await changeAvatar(client,owner,file('image/webp'));
    const next=result.profile.avatar_path;
    expect(next).toMatch(new RegExp(`^${owner}/[0-9a-f-]{36}\\.webp$`));expect(next).not.toBe(oldPath);
    expect(storage.upload).toHaveBeenCalledWith(next,file('image/webp'),{contentType:'image/webp',upsert:false});
    expect(calls).toEqual([['upload',next],['metadata',next],['remove',oldPath]]);
    expect(client.rpc).toHaveBeenCalledWith('set_profile_avatar',{new_avatar_path:next,expected_avatar_path:oldPath});
  });
  it.each([['image/gif',10],['image/svg+xml',10],['text/html',10],['constructor',10],['image/png',0],['image/png',5242881]])('rejects %s / %s bytes before any network request',async(type,size)=>{
    await expect(changeAvatar(client,owner,file(type,size))).rejects.toThrow();
    expect(client.rpc).not.toHaveBeenCalled();expect(storage.upload).not.toHaveBeenCalled();
  });
  it.each(['image/jpeg','image/png','image/webp'])('accepts a 5 MB %s file',async type=>{
    await changeAvatar(client,owner,file(type,5242880));expect(storage.upload).toHaveBeenCalledOnce();
  });
  it('keeps the old object and metadata if an upload fails',async()=>{
    profile.avatar_path=oldPath;storage.upload.mockResolvedValue({error:new Error('Upload offline')});
    await expect(changeAvatar(client,owner,file())).rejects.toThrow('Upload offline');
    expect(profile.avatar_path).toBe(oldPath);expect(storage.remove).not.toHaveBeenCalled();expect(calls).toEqual([]);
  });
  it('cleans only the new upload when metadata is rejected',async()=>{
    profile.avatar_path=oldPath;
    client.rpc.mockImplementation(async name=>name==='set_profile_avatar'?{error:new Error('Save denied')}:{data:[{...profile}]});
    await expect(changeAvatar(client,owner,file())).rejects.toThrow('Save denied');
    expect(profile.avatar_path).toBe(oldPath);
    expect(storage.remove).toHaveBeenCalledWith([storage.upload.mock.calls[0][0]]);
  });
  it('reconciles a committed write after a lost RPC response without deleting the current image',async()=>{
    profile.avatar_path=oldPath;
    client.rpc.mockImplementation(async(name,args)=>{
      if(name==='set_profile_avatar'){profile.avatar_path=args.new_avatar_path;return {error:new Error('Network lost')};}
      return {data:[{...profile}]};
    });
    const result=await changeAvatar(client,owner,file());
    expect(result.profile.avatar_path).toBe(storage.upload.mock.calls[0][0]);expect(storage.remove).toHaveBeenCalledWith([oldPath]);
  });
  it('keeps an upload when commit status cannot be determined and offers safe cleanup later',async()=>{
    client.rpc.mockResolvedValueOnce({data:[{...profile}]}).mockResolvedValueOnce({error:new Error('Offline')}).mockResolvedValueOnce({error:new Error('Offline')});
    await expect(changeAvatar(client,owner,file())).rejects.toMatchObject({cleanupPath:expect.stringContaining(owner),message:expect.stringContaining('Could not confirm')});
    expect(storage.remove).not.toHaveBeenCalled();
  });
  it('refuses cleanup of a file still referenced by the current profile',async()=>{
    profile.avatar_path=oldPath;await expect(cleanupAvatar(client,owner,oldPath)).rejects.toThrow('current photo');expect(storage.remove).not.toHaveBeenCalled();
  });
  it('clears metadata before removal, and treats an already missing file as removed',async()=>{
    profile.avatar_path=oldPath;const result=await changeAvatar(client,owner,null);
    expect(calls).toEqual([['metadata',null],['remove',oldPath]]);expect(result.profile.avatar_path).toBeNull();expect(result.warning).toBe('');
  });
  it('does not delete the existing file when clearing metadata fails',async()=>{
    profile.avatar_path=oldPath;client.rpc.mockImplementation(async name=>name==='set_profile_avatar'?{error:new Error('Cannot clear')}:{data:[{...profile}]});
    await expect(changeAvatar(client,owner,null)).rejects.toThrow('Cannot clear');expect(storage.remove).not.toHaveBeenCalled();expect(profile.avatar_path).toBe(oldPath);
  });
  it('reports a partial removal without restoring a now-cleared pointer',async()=>{
    profile.avatar_path=oldPath;storage.remove.mockResolvedValue({error:new Error('Offline')});
    const result=await changeAvatar(client,owner,null);
    expect(result.profile.avatar_path).toBeNull();expect(result.cleanupPath).toBe(oldPath);expect(result.warning).toContain('could not be deleted');
  });
});

describe('profile avatar controls',()=>{
  it('uploads from Profile and renders the saved image without a refresh',async()=>{
    await openProfile();expect(photo().textContent).toBe('TO');selectFile();
    await waitFor(()=>expect(photo().getAttribute('src')).toBe(url(profile.avatar_path)));
    expect(screen.getByText('Photo updated.')).toBeTruthy();expect(screen.getByText('Change photo')).toBeTruthy();
  });
  it('retains the previous image until a replacement succeeds, then changes the URL immediately',async()=>{
    profile.avatar_path=oldPath;const pending=deferred();storage.upload.mockReturnValue(pending.promise);await openProfile();selectFile();
    await waitFor(()=>expect(storage.upload).toHaveBeenCalledOnce());expect(photo().getAttribute('src')).toBe(url(oldPath));
    expect(screen.getByText('Updating photo…').disabled).toBe(true);expect(screen.getByText('Remove photo').disabled).toBe(true);
    await act(async()=>{pending.resolve({error:null});});
    await waitFor(()=>expect(photo().getAttribute('src')).not.toBe(url(oldPath)));
    expect(photo().getAttribute('src')).toBe(url(profile.avatar_path));
  });
  it.each([['image/png',5242881,'5 MB'],['text/plain',5,'JPEG, PNG, or WebP']])('shows useful validation for %s / %s',async(type,size,message)=>{
    await openProfile();selectFile(file(type,size));await screen.findByText(new RegExp(`Choose.*${message}`));expect(storage.upload).not.toHaveBeenCalled();
  });
  it('shows upload failure and retains fallback',async()=>{
    storage.upload.mockResolvedValue({error:new Error('Upload unavailable')});await openProfile();selectFile();await screen.findByText('Upload unavailable');expect(photo().textContent).toBe('TO');
  });
  it('removes a photo and immediately returns to the fallback',async()=>{
    profile.avatar_path=oldPath;await openProfile();fireEvent.click(screen.getByText('Remove photo'));await screen.findByText('Photo removed.');expect(photo().textContent).toBe('TO');expect(screen.getByText('Upload photo')).toBeTruthy();
  });
  it('keeps the image and exposes metadata-removal failures',async()=>{
    profile.avatar_path=oldPath;client.rpc.mockImplementation(async name=>name==='set_profile_avatar'?{error:new Error('Remove failed')}:{data:[{...profile}]});
    await openProfile();fireEvent.click(screen.getByText('Remove photo'));await screen.findByText('Remove failed');expect(photo().getAttribute('src')).toBe(url(oldPath));expect(storage.remove).not.toHaveBeenCalled();
  });
  it('shows and retries failed old-file cleanup after removal',async()=>{
    profile.avatar_path=oldPath;storage.remove.mockResolvedValueOnce({error:new Error('Offline')});await openProfile();fireEvent.click(screen.getByText('Remove photo'));
    await screen.findByText(/previous public file could not be deleted/);expect(photo().textContent).toBe('TO');fireEvent.click(screen.getByText('Retry file cleanup'));
    await screen.findByText('Unused photo files deleted.');expect(storage.remove).toHaveBeenCalledTimes(2);expect(screen.queryByText('Retry file cleanup')).toBeNull();
  });
  it('does not reset an unsaved profile settings draft when the avatar changes',async()=>{
    await openProfile();fireEvent.change(screen.getByLabelText('Display name'),{target:{value:'Unsaved name'}});selectFile();await screen.findByText('Photo updated.');expect(screen.getByLabelText('Display name').value).toBe('Unsaved name');
  });
  it('prevents duplicate writes and settings writes while an avatar is in flight',async()=>{
    const pending=deferred();storage.upload.mockReturnValue(pending.promise);
    const {result}=renderHook(()=>useSocial(client,owner,toast,baseProfile));await waitFor(()=>expect(result.current.profileStatus).toBe('ready'));
    let first;act(()=>{first=result.current.updateAvatar(file());});
    await act(async()=>{expect(await result.current.updateAvatar(file())).toBe(false);expect(await result.current.updateProfile({displayName:'Race'})).toBe(false);});
    await waitFor(()=>expect(storage.upload).toHaveBeenCalledOnce());expect(api.saveProfile).not.toHaveBeenCalled();
    await act(async()=>{pending.resolve({error:null});await first;});expect(result.current.avatarBusy).toBe(false);
  });
  it('does not start an avatar upload while existing profile settings are being saved',async()=>{
    const pending=deferred();api.saveProfile.mockReturnValue(pending.promise);
    const {result}=renderHook(()=>useSocial(client,owner,toast,baseProfile));await waitFor(()=>expect(result.current.profileStatus).toBe('ready'));
    let saving;act(()=>{saving=result.current.updateProfile({displayName:'New name'});});
    await act(async()=>{expect(await result.current.updateAvatar(file())).toBe(false);});
    expect(storage.upload).not.toHaveBeenCalled();expect(result.current.profileSaving).toBe(true);
    await act(async()=>{pending.resolve({...profile,display_name:'New name'});await saving;});expect(result.current.profileSaving).toBe(false);
  });
  it('refreshes the open chat avatar when an authorized Social read learns a new path',async()=>{
    api.startConversation.mockResolvedValue('conversation');
    const {result}=renderHook(()=>useSocial(client,owner,toast,baseProfile));await waitFor(()=>expect(result.current.status).toBe('ready'));
    await act(async()=>{await result.current.openChat(friend);});
    const next=friendPath.replace('.png','.webp');
    api.loadSocialData.mockResolvedValue({friends:[{...friend,avatar_path:next}],requests:[],shares:[],feed:[]});
    await act(async()=>{result.current.recordCompletion();});
    expect(result.current.chat.friend.avatar_path).toBe(next);expect(result.current.chat.conversationId).toBe('conversation');
  });
  it('ignores an upload after switching accounts and never calls the new account metadata RPC',async()=>{
    const pending=deferred();storage.upload.mockReturnValue(pending.promise);
    const {result,rerender}=renderHook(({id})=>useSocial(client,id,toast,{...baseProfile,id}),{initialProps:{id:owner}});
    await waitFor(()=>expect(result.current.profileStatus).toBe('ready'));
    let uploading;act(()=>{uploading=result.current.updateAvatar(file());});await waitFor(()=>expect(storage.upload).toHaveBeenCalledOnce());
    profile={...baseProfile,id:friendId};rerender({id:friendId});
    await act(async()=>{pending.resolve({error:null});await uploading;});
    expect(client.rpc.mock.calls.some(([name])=>name==='set_profile_avatar')).toBe(false);expect(result.current.profile.id).toBe(friendId);expect(result.current.avatarMessage).toBe('');
  });
});

function socialFixture(){return {client,profile,status:'ready',profileStatus:'ready',friends:[friend],requests:[],feed:[],shares:[],leaderboard:[],leaderboardWeek:'2026-09-21',leaderboardStatus:'ready',searchFriend:vi.fn().mockResolvedValue(friend),sendRequest:vi.fn().mockResolvedValue(true)};}
describe('public identity surfaces',()=>{
  it('renders accepted friend profile avatars',()=>{
    render(<ProfileView social={socialFixture()} profileId={friendId}/>);expect(screen.getByRole('img',{name:"Friend Name's avatar"}).getAttribute('src')).toBe(url(friendPath));
  });
  it('renders Friends, pending requests, and exact-handle search results through Avatar',async()=>{
    const social=socialFixture();social.requests=[{id:'pending',requester_id:owner,addressee_id:friendId,person:friend}];
    render(<MemoryRouter><SocialView social={social} habits={[]} section="friends"/></MemoryRouter>);
    expect(screen.getAllByRole('img',{name:"Friend Name's avatar"})).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Friend handle'),{target:{value:'friend'}});fireEvent.click(screen.getByText('Find profile'));
    await waitFor(()=>expect(screen.getAllByRole('img',{name:"Friend Name's avatar"})).toHaveLength(3));
    for(const avatar of screen.getAllByRole('img'))expect(avatar.getAttribute('src')).toBe(url(friendPath));
    fireEvent.change(screen.getByLabelText('Friend handle'),{target:{value:'different'}});expect(screen.getAllByRole('img')).toHaveLength(2);
  });
  it('discards stale search results after the handle changes',async()=>{
    const social=socialFixture(), pending=deferred();social.searchFriend.mockReturnValue(pending.promise);
    render(<MemoryRouter><SocialView social={social} habits={[]} section="friends"/></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Friend handle'),{target:{value:'friend'}});fireEvent.click(screen.getByText('Find profile'));fireEvent.change(screen.getByLabelText('Friend handle'),{target:{value:'other'}});
    await act(async()=>{pending.resolve(friend);});expect(screen.getAllByRole('img')).toHaveLength(1);
  });
  it('renders leaderboard avatars using the UUID user_id',()=>{
    const social=socialFixture();social.leaderboard=[{...friend,id:undefined,user_id:friendId,rank:1,completion_count:2,active_days:1}];
    render(<MemoryRouter><SocialView social={social} habits={[]} section="leaderboard"/></MemoryRouter>);expect(screen.getByRole('img',{name:"Friend Name's avatar"}).getAttribute('src')).toBe(url(friendPath));
  });
  it('renders the direct-chat identity avatar',async()=>{
    render(<ChatModal client={client} profile={profile} chat={{friend,conversationId:'chat'}} onRead={vi.fn()} onClose={vi.fn()}/>);
    await screen.findByText('No messages yet. Say hello.');expect(screen.getByRole('img',{name:"Friend Name's avatar"}).getAttribute('src')).toBe(url(friendPath));
  });
});
