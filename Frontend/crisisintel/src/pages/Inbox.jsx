import React, { useEffect, useState } from 'react';
import api from '../api';

export default function Inbox() {
  const [convs, setConvs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState(null); // conversation id
  const [msgs, setMsgs] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const me = JSON.parse(localStorage.getItem('me') || 'null');

  const loadConvs = async () => {
    setLoading(true);
    try {
      const res = await api.listConversations();
      const items = Array.isArray(res?.items) ? res.items : [];
      setConvs(items);
      if (!sel && items[0]?.id) {
        await selectConv(items[0].id);
      }
    } catch (e) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Failed to load inbox' }}));
    } finally {
      setLoading(false);
    }
  };

  const selectConv = async (id) => {
    setSel(id);
    try {
      const res = await api.conversationHistory(id);
      setMsgs(Array.isArray(res?.items) ? res.items : []);
    } catch (e) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Failed to load messages' }}));
    }
  };

  const send = async () => {
    const body = text.trim();
    if (!body || !sel) return;
    setBusy(true);
    try {
      const res = await api.sendConversationMessage(sel, body);
      const m = { id: res?.message_id || Date.now(), sender_user_id: me?.id, body, created_at: new Date().toISOString() };
      setMsgs(prev => [...prev, m]);
      setText('');
      await loadConvs();
    } catch (e) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Failed to send' }}));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { loadConvs(); /* eslint-disable-next-line */ }, []);

  return (
    <div className="bg-white border border-gray-200 rounded-lg h-[70vh] flex">
      {/* Left: conversation list */}
      <div className="w-80 border-r overflow-y-auto">
        <div className="p-3 font-semibold border-b">Chats</div>
        {loading && <div className="p-3 text-sm text-gray-500">Loading…</div>}
        {(!loading && convs.length === 0) && <div className="p-3 text-sm text-gray-500">No conversations yet.</div>}
        {convs.map(c => (
          <div key={c.id} className={`p-3 cursor-pointer hover:bg-gray-50 ${sel===c.id ? 'bg-gray-50' : ''}`} onClick={() => selectConv(c.id)}>
            <div className="text-sm font-medium">{c.partner_name || 'Conversation'}</div>
            <div className="text-xs text-gray-500 truncate">{c.last_message || ''}</div>
          </div>
        ))}
      </div>
      {/* Right: messages */}
      <div className="flex-1 flex flex-col">
        <div className="p-3 border-b font-semibold">{(convs.find(x => x.id===sel)?.partner_name) || 'Messages'}</div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {msgs.map(m => (
            <div key={m.id} className={`text-sm ${m.sender_user_id === me?.id ? 'text-right' : ''}`}>
              <div className={`inline-block px-2 py-1 rounded ${m.sender_user_id === me?.id ? 'bg-purple-600 text-white' : 'bg-gray-200'}`}>{m.body}</div>
              {m.created_at && <div className="text-[10px] text-gray-400">{new Date(m.created_at).toLocaleString()}</div>}
            </div>
          ))}
        </div>
        <div className="p-3 border-t flex items-center space-x-2">
          <input className="flex-1 border rounded px-3 py-2 text-sm" placeholder="Write a message…" value={text} onChange={e=>setText(e.target.value)} onKeyDown={e=>{ if(e.key==='Enter'){ e.preventDefault(); send(); } }} />
          <button className="px-3 py-2 rounded bg-gray-800 text-white text-sm" disabled={busy || !text.trim() || !sel} onClick={send}>{busy ? '...' : 'Send'}</button>
        </div>
      </div>
    </div>
  );
}
