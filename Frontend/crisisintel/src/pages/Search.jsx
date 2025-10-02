import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api';

/**
 * Search page – queries backend LIKE-based search across posts, doctors, hospitals.
 * Simple synchronous form; no debounce to keep logic clear.
 */
export default function Search() {
  const [q, setQ] = useState('');
  const [res, setRes] = useState(null);
  const [loading, setLoading] = useState(false);

  const submit = async e => {
    e.preventDefault();
    setLoading(true);
    try {
      const r = await api.search(q);
      setRes(r);
    } catch {
      setRes(null);
    }
    setLoading(false);
  };

  const linkFor = (cat, item) => {
    switch (cat) {
      case 'users': return `/users/${item.id}`;
      case 'posts': return `/posts/${item.id || item.post_id || item.id}`;
      case 'doctors': return `/doctors/${item.id}`;
      case 'hospitals': return `/hospitals/${item.id}`;
      case 'fire_departments': return `/fire-departments/${item.id}`;
      case 'fire_requests': return `/fire/requests/${item.id}`;
      default: return '#';
    }
  };

  const labelFor = (cat, item) => {
    if (cat === 'users') return (item.full_name || item.email) || JSON.stringify(item);
    if (cat === 'posts') return item.body || JSON.stringify(item);
    if (cat === 'doctors') return item.name || JSON.stringify(item);
    if (cat === 'hospitals') return item.name || JSON.stringify(item);
    if (cat === 'fire_departments') return item.name || JSON.stringify(item);
    if (cat === 'fire_requests') return item.description || JSON.stringify(item);
    return JSON.stringify(item);
  };

  return (
    <div className="grid grid-cols-4 gap-4">
      <div className="main-left col-span-3 space-y-4">
        <div className="bg-white border border-gray-200 rounded-lg">
          <form onSubmit={submit} className="p-4 flex space-x-4">
            <input className="p-4 w-full bg-gray-100 rounded-lg" value={q} onChange={e => setQ(e.target.value)} placeholder="What are you looking for?" />
            <button className="inline-block py-4 px-6 bg-purple-600 text-white rounded-lg">Search</button>
          </form>
        </div>

        {loading && <div className="p-4 bg-white border border-gray-200 rounded-lg">Searching...</div>}

        {res && (
          <div className="space-y-4">
            {['users','posts','doctors','hospitals','fire_departments','fire_requests'].map(cat => (
              <div key={cat} className="p-4 bg-white border border-gray-200 rounded-lg">
                <h3 className="font-semibold mb-2 uppercase text-xs tracking-wide">{cat.replace('_',' ')}</h3>
                <ul className="list-disc ml-6 text-sm">
                  {(res[cat]||[]).length === 0 && (
                    <li className="list-none text-gray-500">No results</li>
                  )}
                  {(res[cat]||[]).map(item => (
                    <li key={item.id}>
                      <Link className="text-purple-700 hover:underline" to={linkFor(cat, item)}>
                        {labelFor(cat, item)}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="main-right col-span-1 space-y-4">
        <div className="p-4 bg-white border border-gray-200 rounded-lg">
          <h3 className="mb-6 text-xl">People you may know</h3>
          <div className="space-y-4 text-sm text-gray-600">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="w-10 h-10 rounded-full bg-gray-300" />
                <p><strong>Placeholder</strong></p>
              </div>
              <a href="#" className="py-2 px-3 bg-purple-600 text-white text-xs rounded-lg">Show</a>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="w-10 h-10 rounded-full bg-gray-300" />
                <p><strong>Placeholder</strong></p>
              </div>
              <a href="#" className="py-2 px-3 bg-purple-600 text-white text-xs rounded-lg">Show</a>
            </div>
          </div>
        </div>

        <div className="p-4 bg-white border border-gray-200 rounded-lg">
          <h3 className="mb-6 text-xl">Trends</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <p className="text-xs">
                  <strong>#crisis</strong><br/>
                  <span className="text-gray-500">— posts</span>
                </p>
              </div>
              <a href="#" className="py-2 px-3 bg-purple-600 text-white text-xs rounded-lg">Explore</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
