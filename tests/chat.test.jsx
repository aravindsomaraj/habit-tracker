import React, { StrictMode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatModal } from '../src/components/ChatModal.jsx';
const api=vi.hoisted(()=>({loadMessages:vi.fn(),sendMessage:vi.fn()}));
vi.mock('../src/data/social.js',()=>api);
let client, active, onRead;
const chat={conversationId:'conversation',friend:{id:'friend',display_name:'Friend'}};
const message=(id,body,sender='friend')=>({id,body,sender_id:sender,conversation_id:'conversation',created_at:`2026-09-21T00:00:0${id}Z`});
const emit=(row)=>act(()=>{for(const handler of active.values()) handler({new:row});});
const open=()=>render(<StrictMode><ChatModal client={client} profile={{id:'owner',handle:'owner'}} chat={chat} onClose={vi.fn()} onRead={onRead}/></StrictMode>);
beforeEach(()=>{
  vi.resetAllMocks();active=new Map();onRead=vi.fn();
  Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});
  client={channel:vi.fn(()=>{let handler;const channel={on:(_event,_filter,callback)=>{handler=callback;return channel;},subscribe:()=>{active.set(channel,handler);return channel;}};return channel;}),removeChannel:vi.fn(channel=>active.delete(channel))};
  api.loadMessages.mockResolvedValue([message('1','Earlier message')]);
  api.sendMessage.mockResolvedValue(message('2','Hello','owner'));
});
afterEach(cleanup);
describe('direct chat after Social integration',()=>{
  it('loads history, persists read positions, deduplicates live messages and cleans up Strict Mode subscriptions',async()=>{
    const {unmount}=open();await screen.findByText('Earlier message');expect(active.size).toBe(1);
    expect(onRead).toHaveBeenCalledWith('conversation','2026-09-21T00:00:01Z');
    emit(message('2','Live message'));emit(message('2','Live message'));
    expect(screen.getAllByText('Live message')).toHaveLength(1);
    expect(onRead).toHaveBeenCalledWith('conversation','2026-09-21T00:00:02Z');
    unmount();expect(active.size).toBe(0);
  });
  it('sends using stable UUIDs and deduplicates the Realtime echo',async()=>{
    open();await screen.findByText('Earlier message');
    fireEvent.change(screen.getByPlaceholderText('Write a message'),{target:{value:' Hello '}});
    fireEvent.submit(screen.getByRole('button',{name:'Send'}).closest('form'));
    await screen.findByText('Hello');emit(message('2','Hello','owner'));
    expect(api.sendMessage).toHaveBeenCalledWith(client,'conversation','owner','Hello');
    expect(screen.getAllByText('Hello')).toHaveLength(1);
  });
  it('does not lose a live message arriving while initial history is in flight',async()=>{
    let resolve;const pending=new Promise(done=>{resolve=done;});api.loadMessages.mockReturnValue(pending);
    open();emit(message('2','Arrived during load'));
    await act(async()=>resolve([message('1','Earlier message')]));
    expect(screen.getByText('Arrived during load')).toBeTruthy();
    expect(screen.getByText('Earlier message')).toBeTruthy();
  });
  it('keeps load errors within chat and does not mark hidden messages as read',async()=>{
    Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});
    api.loadMessages.mockRejectedValue(new Error('Offline'));
    open();await screen.findByText(/Could not load messages/);emit(message('2','Hidden message'));
    await waitFor(()=>expect(onRead).not.toHaveBeenCalled());
  });
});
