import React, { useEffect, useMemo, useRef, useState } from 'react';
import api from '../api';

// Lightweight floating chatbot for guidance and doctor-suggestion help.
// Appears on all pages via App.js.

const INITIAL_PROMPT = `Hi! I'm the Brain Rotter. I can help you use the app, or suggest what type of doctor to see based on your symptoms.\n\nExample:\n- "I'm having chest pain and shortness of breath"\n- "How do I request the fire service?"`;

function ChatbotVibeIcon({ size = 28 }) {
  const s = size;
  return (
    <svg width={s} height={s} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="cbg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#22D3EE" />
          <stop offset="50%" stopColor="#A78BFA" />
          <stop offset="100%" stopColor="#F472B6" />
        </linearGradient>
        <radialGradient id="bubbleFill" cx="50%" cy="40%" r="70%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="60%" stopColor="#F0F9FF" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#EDE9FE" stopOpacity="0.85" />
        </radialGradient>
        <filter id="softglow" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="2.2" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="neon" x="-80%" y="-80%" width="260%" height="260%">
          <feDropShadow dx="0" dy="0" stdDeviation="2.6" floodColor="#22D3EE" floodOpacity="0.6"/>
          <feDropShadow dx="0" dy="0" stdDeviation="2.2" floodColor="#A78BFA" floodOpacity="0.6"/>
          <feDropShadow dx="0" dy="0" stdDeviation="1.8" floodColor="#F472B6" floodOpacity="0.5"/>
        </filter>
      </defs>
      {/* Pulse ring */}
      <g opacity="0.6">
        <circle cx="32" cy="32" r="20" fill="none" stroke="url(#cbg)" strokeWidth="1.2" opacity="0.35">
          <animateTransform attributeName="transform" type="scale" from="1" to="1.12" dur="2.2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="0.35;0.1;0.35" dur="2.2s" repeatCount="indefinite" />
        </circle>
      </g>
      {/* Chat bubble container with tail */}
      <g filter="url(#softglow)">
        <path d="M12 14h40a8 8 0 0 1 8 8v14a8 8 0 0 1-8 8H30l-9 8v-8H12a8 8 0 0 1-8-8V22a8 8 0 0 1 8-8z" fill="url(#bubbleFill)" />
        {/* Tail */}
        <path d="M24 44 l-3 10 10-8" fill="#ffffff" fillOpacity="0.9" />
        <path d="M12 14h40a8 8 0 0 1 8 8v14a8 8 0 0 1-8 8H30l-9 8v-8H12a8 8 0 0 1-8-8V22a8 8 0 0 1 8-8z" fill="none" stroke="url(#cbg)" strokeWidth="2.4" filter="url(#neon)" />
        {/* Scanning border effect */}
        <path d="M12 14h40a8 8 0 0 1 8 8v14a8 8 0 0 1-8 8H30l-9 8v-8H12a8 8 0 0 1-8-8V22a8 8 0 0 1 8-8z"
              fill="none" stroke="url(#cbg)" strokeWidth="2" strokeDasharray="180 36" strokeLinecap="round" opacity="0.85">
          <animate attributeName="stroke-dashoffset" values="0;216" dur="3.6s" repeatCount="indefinite" />
        </path>
      </g>
      {/* Robot face inside bubble */}
      <g>
        {/* Antenna */}
        <line x1="32" y1="11" x2="32" y2="18" stroke="url(#cbg)" strokeWidth="2" strokeLinecap="round" />
        <circle cx="32" cy="9" r="3" fill="#A78BFA">
          <animate attributeName="r" values="2.6;3;2.6" dur="2.2s" repeatCount="indefinite" />
        </circle>
        {/* Face panel */}
        <rect x="20" y="24" width="24" height="16" rx="4" fill="#EEF2FF" stroke="url(#cbg)" strokeWidth="1.6" />
        {/* Eyes */}
        <circle cx="27" cy="32" r="2.4" fill="#22D3EE"/>
        <circle cx="37" cy="32" r="2.4" fill="#22D3EE"/>
        {/* Typing dots */}
        <g>
          <circle cx="26" cy="42" r="1.8" fill="#94A3B8">
            <animate attributeName="opacity" values="0.25;1;0.25" dur="1.1s" begin="0s" repeatCount="indefinite" />
          </circle>
          <circle cx="32" cy="42" r="1.8" fill="#94A3B8">
            <animate attributeName="opacity" values="0.25;1;0.25" dur="1.1s" begin="0.18s" repeatCount="indefinite" />
          </circle>
          <circle cx="38" cy="42" r="1.8" fill="#94A3B8">
            <animate attributeName="opacity" values="0.25;1;0.25" dur="1.1s" begin="0.36s" repeatCount="indefinite" />
          </circle>
        </g>
        {/* Orbiting sparkle */}
        <g transform="translate(32,32)">
          <circle r="1.4" fill="#fff">
            <animateTransform attributeName="transform" attributeType="XML" type="rotate" from="0" to="360" dur="4.8s" repeatCount="indefinite" />
            <animateTransform attributeName="transform" additive="sum" type="translate" values="20,0;0,20;-20,0;0,-20;20,0" dur="4.8s" repeatCount="indefinite" />
          </circle>
        </g>
      </g>
    </svg>
  );
}

function UserAvatar({ size = 28 }) {
  const s = size;
  return (
    <div style={{
      width: s, height: s, borderRadius: '50%',
      background: 'linear-gradient(135deg, #4F46E5, #22D3EE)',
      color: '#fff', display: 'grid', placeItems: 'center',
      fontSize: Math.round(s/2.4), fontWeight: 700
    }}>
      Y
    </div>
  );
}

function TypingDots({ color = '#6B7280' }) {
  return (
    <svg width="36" height="12" viewBox="0 0 36 12" xmlns="http://www.w3.org/2000/svg">
      <circle cx="6" cy="6" r="3" fill={color}>
        <animate attributeName="opacity" values="0.3;1;0.3" dur="1.1s" begin="0s" repeatCount="indefinite" />
      </circle>
      <circle cx="18" cy="6" r="3" fill={color}>
        <animate attributeName="opacity" values="0.3;1;0.3" dur="1.1s" begin="0.18s" repeatCount="indefinite" />
      </circle>
      <circle cx="30" cy="6" r="3" fill={color}>
        <animate attributeName="opacity" values="0.3;1;0.3" dur="1.1s" begin="0.36s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}

export default function AIChatbot() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState(() => [
    { role: 'assistant', content: INITIAL_PROMPT, ts: Date.now() }
  ]);
  // Model is provided by the backend; default empty to let backend choose an English-first model
  const [model, setModel] = useState('');
  const [models, setModels] = useState([]);
  const [pulling, setPulling] = useState(false);
  const [lastVia, setLastVia] = useState(null);
  const panelRef = useRef(null);
  const listRef = useRef(null);

  useEffect(() => {
    if (open && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [open, history]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Load installed models when opened
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const info = await api.aiModels();
        if (!alive) return;
        setModels(info?.installed || []);
        if (info?.chosen && !model) setModel(info.chosen);
      } catch (_) { /* ignore */ }
    }
    if (open) load();
    return () => { alive = false; };
  }, [open]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const newHist = [...history, { role: 'user', content: text, ts: Date.now() }];
    setHistory(newHist);
    setInput('');
    setBusy(true);
    try {
      const payload = newHist.map(({ role, content }) => ({ role, content }));
  const res = await api.aiChat(payload, model);
      const reply = res?.reply || 'Sorry, I could not generate a response right now.';
  setHistory(h => [...h, { role: 'assistant', content: reply, ts: Date.now() }]);
  setLastVia(res?.via || null);
    } catch (e) {
      setHistory(h => [...h, { role: 'assistant', content: 'Sorry, the assistant is currently unavailable.', ts: Date.now() }]);
    } finally {
      setBusy(false);
    }
  }

  const modelInstalled = useMemo(() => models.includes(model), [models, model]);

  async function pullSelected() {
    if (!model || pulling) return;
    setPulling(true);
    try {
      await api.aiPull(model);
      const info = await api.aiModels();
      setModels(info?.installed || []);
    } catch (e) {
      setHistory(h => [...h, { role: 'assistant', content: 'Model download failed. Try again later.', ts: Date.now() }]);
    } finally {
      setPulling(false);
    }
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <>
      {/* Floating toggle button */}
      <button
        aria-label="Open Brain Rotter"
        onClick={() => setOpen(o => !o)}
        style={{
          // Raised higher to avoid overlapping page-level send boxes / FABs
          position: 'fixed', right: '24px', bottom: '112px', zIndex: 1000,
          background: 'linear-gradient(135deg, rgba(167,139,250,0.25), rgba(34,211,238,0.25))',
          borderRadius: '24px',
          width: 76, height: 76, boxShadow: '0 18px 36px rgba(99,102,241,0.42)',
          border: '1px solid rgba(167,139,250,0.75)', display: 'grid', placeItems: 'center',
          backdropFilter: 'blur(10px)'
        }}
        title="Brain Rotter"
      >
        {open ? <span style={{fontSize:28,color:'#6B7280'}}>×</span> : <ChatbotVibeIcon size={44} />}
      </button>

      {/* Panel */}
      {open && (
        <div
          ref={panelRef}
          style={{
            // Keep panel above the raised toggle
            position: 'fixed', right: '24px', bottom: '180px', zIndex: 1000,
            width: '360px', maxWidth: '90vw', height: '480px', maxHeight: '70vh',
            background: 'white', borderRadius: '12px',
            boxShadow: '0 12px 28px rgba(0,0,0,0.18)',
            display: 'flex', flexDirection: 'column', overflow: 'hidden'
          }}
        >
          <div style={{ padding: '12px 14px', borderBottom: '1px solid #eee', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              <ChatbotVibeIcon size={28} />
              <div style={{ fontWeight: 700 }}>Brain Rotter</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                list="ai-models"
                value={model}
                onChange={e => setModel(e.target.value)}
                placeholder="Find model..."
                style={{ fontSize: 12, padding: '6px 8px', width: 180, border:'1px solid #ddd', borderRadius:6 }}
              />
              <datalist id="ai-models">
                {models.map(m => (<option key={m} value={m}>{m}</option>))}
                {['llama3.2:3b','qwen2.5:7b-instruct','mistral:7b-instruct','llama3.1:8b-instruct']
                  .filter(s => !models.includes(s))
                  .map(s => (<option key={s} value={s}>{s} (not installed)</option>))}
              </datalist>
              {!modelInstalled && (
                <button onClick={pullSelected} disabled={pulling} style={{ fontSize:12, padding:'6px 10px', background:'#10B981', color:'#fff', borderRadius:6 }}>
                  {pulling ? 'Downloading…' : 'Download'}
                </button>
              )}
              <button onClick={() => setOpen(false)} style={{ fontSize: 18, lineHeight: 1 }}>×</button>
            </div>
          </div>
          <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 10px' }}>
            {history.map((m, idx) => {
              const isUser = m.role === 'user';
              return (
                <div key={idx} style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start', marginBottom: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexDirection: isUser ? 'row-reverse' : 'row', maxWidth: '90%' }}>
                    {isUser ? <UserAvatar size={28} /> : <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#EEF2FF', display: 'grid', placeItems: 'center' }}><ChatbotVibeIcon size={18} /></div>}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start' }}>
                      <div style={{ fontSize: 11, color: '#6B7280', marginBottom: 4 }}>{isUser ? 'You' : 'Brain Rotter'}</div>
                      <div style={{
                        background: isUser ? '#4F46E5' : '#FFFFFF',
                        color: isUser ? '#FFFFFF' : '#111827',
                        border: isUser ? '1px solid #4338CA' : '1px solid #E5E7EB',
                        borderRadius: 16,
                        padding: '10px 12px',
                        boxShadow: '0 6px 14px rgba(0,0,0,0.06)',
                        maxWidth: '78%'
                      }}>
                        <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {busy && (
              <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: 12 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#EEF2FF', display: 'grid', placeItems: 'center' }}>
                    <ChatbotVibeIcon size={18} />
                  </div>
                  <div style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 16, padding: '8px 12px', boxShadow: '0 6px 14px rgba(0,0,0,0.06)' }}>
                    <TypingDots />
                  </div>
                </div>
              </div>
            )}
          </div>
          <div style={{ borderTop: '1px solid #eee', padding: 10 }}>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Type your question…"
              rows={2}
              style={{ width: '100%', resize: 'none', border: '1px solid #ddd', borderRadius: 8, padding: 8 }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
              <div style={{ fontSize: 12, color: '#6B7280' }}>
                {lastVia === 'fallback' ? 'Fallback mode in use.' : 'Using local model.'} Not medical advice.
              </div>
              <button onClick={send} disabled={busy || !input.trim()} style={{ background: '#4F46E5', color: 'white', borderRadius: 8, padding: '6px 12px' }}>
                Send
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
