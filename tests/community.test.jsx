import React, { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCommunity } from '../src/hooks/useCommunity.js';
import { CommunityFeed, CommunitySettings, CommunityProfile } from '../src/components/Community.jsx';
import { SharingModal } from '../src/components/SharingModal.jsx';
const api = vi.hoisted(() => ({loadCommunityPreferences:vi.fn(),loadCommunityFeed:vi.fn(),loadCommunityProfile:vi.fn(),setCommunityEnabled:vi.fn(),setCommunityHabit:vi.fn(),blockCommunityUser:vi.fn(),reportCommunityActivity:vi.fn()}));
vi.mock('../src/data/community.js', () => api);
const row = {id:'activity',actor_id:'other',display_name:'Other',handle:'other',habit_label:'Read',occurred_on:'2026-10-04',created_at:'2026-10-04T00:00:00Z'};
const deferred = () => { let resolve; const promise = new Promise(done => {resolve=done;}); return {resolve,promise}; };
beforeEach(() => {
  vi.resetAllMocks(); api.loadCommunityPreferences.mockResolvedValue({enabled:false,habits:[]}); api.loadCommunityFeed.mockResolvedValue([row]);
});
afterEach(cleanup);
const client = {};
const open = () => renderHook(() => useCommunity(client,'owner',vi.fn()),{wrapper:StrictMode});
describe('community loading and publishing', () => {
  it('loads preferences without publishing or fetching a global feed until requested',async () => {
    const {result}=open(); await waitFor(() => expect(result.current.settingsStatus).toBe('ready'));
    expect(result.current.enabled).toBe(false); expect(api.loadCommunityFeed).not.toHaveBeenCalled(); expect(api.setCommunityEnabled).not.toHaveBeenCalled();
    await act(async () => { await result.current.refresh(); }); expect(result.current.feed).toEqual([row]);
  });
  it('ignores stale feed responses and duplicate pagination submissions',async () => {
    const {result}=open(); await waitFor(() => expect(result.current.settingsStatus).toBe('ready'));
    const slow=deferred(); api.loadCommunityFeed.mockReturnValueOnce(slow.promise).mockResolvedValueOnce([{...row,id:'new'}]);
    let loading; act(() => {loading=result.current.refresh();});
    await act(async () => {await result.current.refresh();});
    await act(async () => {slow.resolve([row]); await loading;}); expect(result.current.feed[0].id).toBe('new');
    const page=deferred(); api.loadCommunityFeed.mockReturnValueOnce(page.promise); let paging;
    act(() => {paging=result.current.refresh(true);}); await act(async () => {await result.current.refresh(true);});
    expect(api.loadCommunityFeed).toHaveBeenCalledTimes(3);
    await act(async () => {page.resolve([{...row,id:'new'},row]); await paging;}); expect(result.current.feed.map(item=>item.id)).toEqual(['new','activity']);
  });
  it('prevents duplicate writes and preserves preferences on failed opt-in',async () => {
    const {result}=open(); await waitFor(() => expect(result.current.settingsStatus).toBe('ready'));
    const save=deferred(); api.setCommunityEnabled.mockReturnValue(save.promise); let saving;
    act(() => {saving=result.current.setEnabled(true);}); await act(async () => {expect(await result.current.setEnabled(true)).toBe(false);});
    api.loadCommunityPreferences.mockResolvedValue({enabled:true,habits:[]});
    await act(async () => {save.resolve(); await saving;}); expect(result.current.enabled).toBe(true); expect(api.setCommunityEnabled).toHaveBeenCalledTimes(1);
    api.setCommunityEnabled.mockRejectedValueOnce(new Error('Offline'));
    await act(async () => {expect(await result.current.setEnabled(false)).toBe(false);}); expect(result.current.enabled).toBe(true); expect(result.current.message).toBe('Offline');
  });
  it('renders community updates and sends a selected report reason',async () => {
    const community={refresh:vi.fn(),enabled:false,feed:[row],status:'ready',hasMore:true,busy:false,report:vi.fn().mockResolvedValue(true),block:vi.fn()};
    render(<MemoryRouter><CommunityFeed community={community} userId="owner" /></MemoryRouter>);
    expect(screen.getByRole('link',{name:/Other/}).getAttribute('href')).toBe('/profile/other');
    fireEvent.click(screen.getByRole('button',{name:'Load more'})); expect(community.refresh).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole('button',{name:'Report'})); fireEvent.change(screen.getByRole('combobox'),{target:{value:'harassment'}});
    fireEvent.click(screen.getByRole('button',{name:'Submit report'})); await waitFor(() => expect(community.report).toHaveBeenCalledWith('activity','harassment'));
  });
  it('disables community habit publishing until opted in while preserving friend choices',() => {
    const community={enabled:false,habits:[],settingsStatus:'ready',busy:false};
    render(<SharingModal habits={[{id:'habit',name:'Read'}]} social={{community,friends:[{id:'friend',display_name:'Friend'}],shares:[],setShare:vi.fn()}} onClose={vi.fn()} />);
    expect(screen.getByRole('checkbox',{name:'Community: publish new completions'}).disabled).toBe(true);
    expect(screen.getByRole('checkbox',{name:'Friend: Friend'}).disabled).toBe(false);
  });
  it('keeps settings unavailable on errors and shows no fabricated opt-in control',() => {
    render(<CommunitySettings community={{settingsStatus:'error',settingsError:'Unavailable',refreshPreferences:vi.fn()}} />);
    expect(screen.getByRole('alert').textContent).toBe('Unavailable'); expect(screen.queryByRole('checkbox')).toBeNull();
  });
  it('loads a community profile directly from its route without friendship',async () => {
    const loadProfile=vi.fn().mockResolvedValue({profile:{id:'other',display_name:'Other',handle:'other',bio:'Reads'},feed:[row]});
    render(<MemoryRouter><CommunityProfile community={{loadProfile,busy:false,block:vi.fn(),report:vi.fn()}} profileId="other" userId="owner" /></MemoryRouter>);
    expect(await screen.findByRole('heading',{name:'Other'})).toBeTruthy(); expect(screen.getByText('Reads')).toBeTruthy(); expect(loadProfile).toHaveBeenCalledWith('other');
  });
});
