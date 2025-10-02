import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';

export default function CrisisList() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('current'); // 'current' | 'completed'
  const me = JSON.parse(localStorage.getItem('me') || 'null');
  const isAdmin = !!(me && ((me.role||'').toLowerCase().includes('admin') || me.is_admin || me.isAdmin));

  const load = useCallback(async (which) => {
    setLoading(true); setError(null);
    let mounted = true;
    try {
      const params = { all: 1 };
      // Hint backend if it supports status filtering; we'll still filter on client for reliability
  if (which === 'completed') params.status = 'mitigated,closed,cancelled';
  if (which === 'current') params.status = 'open,monitoring';
      const data = await api.listCrises(params);
      if (!mounted) return;
      const listRaw = data.results || [];
      const statusOf = (c) => String(c.status || '').toLowerCase();
      const currentSet = new Set(['open','monitoring']);
      const completedSynonyms = new Set(['mitigated','closed','cancelled','completed','resolved','ended','inactive']);
      const list = listRaw.filter(c => {
        const s = statusOf(c);
        if (which === 'current') return currentSet.has(s);
        // completed: explicit synonyms OR anything not current (fallback)
        return completedSynonyms.has(s) || (s && !currentSet.has(s));
      });
      // Sort latest-first for consistency
      list.sort((a,b)=>{
        const at = new Date(a.created_at || a.opened_at || 0).getTime();
        const bt = new Date(b.created_at || b.opened_at || 0).getTime();
        return bt - at;
      });
      setItems(list);
    } catch (e) {
      setError(e.message || 'Failed to load crises');
    } finally {
      setLoading(false);
    }
    return () => { mounted = false; };
  }, []);

  useEffect(() => { load(tab); }, [tab, load]);

  if (loading) return <div>Loading crises…</div>;
  if (error) return <div className="text-red-600">{error}</div>;

  return (
    <div className="bg-white p-6 rounded shadow">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xl font-semibold">Crises</h2>
        {isAdmin && (
          <Link to="/crises/new" className="text-sm text-indigo-600 hover:underline">Create</Link>
        )}
      </div>
      <div className="flex items-center gap-2 mb-4">
        <button
          className={`px-3 py-1 rounded ${tab==='current' ? 'bg-indigo-600 text-white' : 'bg-gray-100'}`}
          onClick={() => setTab('current')}
        >Current</button>
        <button
          className={`px-3 py-1 rounded ${tab==='completed' ? 'bg-indigo-600 text-white' : 'bg-gray-100'}`}
          onClick={() => setTab('completed')}
        >Completed</button>
      </div>
      {items.length === 0 ? (
        <div>
          <p className="mb-2">{tab==='completed' ? 'No completed crises.' : 'No current crises.'}</p>
          {isAdmin && (
            <Link to="/crises/new" className="inline-block text-sm text-indigo-600 hover:underline">Create a crisis</Link>
          )}
        </div>
      ) : (
        <div className="divide-y">
          {items.map((c) => (
            <Link key={c.crisis_id} to={`/crises/${c.crisis_id}`} className="block py-3 hover:bg-gray-50">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium">{c.title}</div>
                  <div className="text-sm text-gray-600">Status: {c.status} • Type: {c.incident_type} • Severity: {c.severity || 'n/a'}</div>
                </div>
                <div className="text-sm text-gray-500">Radius: {c.radius_km ?? '—'} km</div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
