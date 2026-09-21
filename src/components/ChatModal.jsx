import { useEffect, useRef, useState } from 'react';
import { loadMessages, sendMessage } from '../data/social.js';

function mergeMessage(messages, incoming) {
  return messages.some((message) => message.id === incoming.id) ? messages : [...messages, incoming];
}

export function ChatModal({ client, profile, chat, onClose }) {
  const [messages, setMessages] = useState([]), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [body, setBody] = useState(''), [sending, setSending] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    let active = true;
    setLoading(true);
    loadMessages(client, chat.conversationId).then((rows) => { if (active) { setMessages(rows); setLoading(false); } }).catch((loadError) => { if (active) { setError(loadError.message || 'Please retry.'); setLoading(false); } });
    const channel = client.channel(`chat:${chat.conversationId}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `conversation_id=eq.${chat.conversationId}` }, (payload) => {
      if (active) setMessages((current) => mergeMessage(current, payload.new));
    }).subscribe();
    return () => { active = false; client.removeChannel(channel); };
  }, [chat.conversationId, client]);
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [messages]);

  async function submit(event) {
    event.preventDefault();
    const text = body.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      const saved = await sendMessage(client, chat.conversationId, profile.id, text);
      setMessages((current) => mergeMessage(current, saved)); setBody('');
    } catch (sendError) { window.alert(sendError.message || 'Could not send your message.'); }
    finally { setSending(false); }
  }
  return <><div className="chat-head"><div><h3>Chat with {chat.friend.display_name}</h3><p className="sub">Only you and {chat.friend.display_name} can read these messages.</p></div><button className="pillbtn" onClick={onClose}>Close</button></div>
    <div ref={box} className="chat-messages" role="log" aria-live="polite">{loading ? <p className="tiny">Loading messages…</p> : error ? <p className="tiny">Could not load messages. {error}</p> : !messages.length ? <p className="tiny">No messages yet. Say hello.</p> : messages.map((message) => {
      const mine = message.sender_id === profile.id;
      return <div className={`chat-message ${mine ? 'mine' : ''}`} key={message.id}><span>{message.body}</span><small>{mine ? 'You' : chat.friend.display_name} · {new Date(message.created_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</small></div>;
    })}</div>
    <form className="chat-compose" onSubmit={submit}><input maxLength="2000" autoComplete="off" placeholder="Write a message" required disabled={sending} value={body} onChange={(event) => setBody(event.target.value)} /><button className="cta" type="submit" disabled={sending}>Send</button></form>
  </>;
}
