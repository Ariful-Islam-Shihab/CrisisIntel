import React, { useEffect, useState } from 'react';
import { api } from '../api/client';

export default function FoodDonations() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [item, setItem] = useState('');
  const [quantity, setQuantity] = useState('');
  const [organizationId, setOrganizationId] = useState('');
  const [organizations, setOrganizations] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  function normalizeList(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.items)) return data.items;
    if (data && Array.isArray(data.results)) return data.results;
    return [];
  }

  async function load() {
    try {
      setLoading(true);
      const data = await api.get('/api/food/donations/list');
      setItems(normalizeList(data));
      setError(null);
    } catch (e) {
      setError(e.message || 'Failed loading donations');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }
  async function loadOrganizations() {
    try {
      const data = await api.get('/api/social/organizations/list');
      const list = Array.isArray(data?.results) ? data.results : (Array.isArray(data?.items) ? data.items : []);
      setOrganizations(list);
    } catch (e) {
      // ignore silently
      setOrganizations([]);
    }
  }
  useEffect(() => { load(); loadOrganizations(); }, []);

  async function handleCreate(e) {
    e.preventDefault();
    if (!item) return;
    try {
      setSubmitting(true);
      const payload = { item, quantity: quantity ? parseInt(quantity,10): 1 };
      if (organizationId) payload.organization_id = parseInt(organizationId,10);
      await api.post('/api/food/donations', payload);
      setItem('');
      setQuantity('');
      setOrganizationId('');
      await load();
    } catch (e) {
      setError(e.message || 'Create failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ padding: '1rem' }}>
      <h2>Food Donations</h2>
      {loading && <p>Loading...</p>}
      {error && <p style={{ color: 'red' }}>{String(error)}</p>}
      <form onSubmit={handleCreate} style={{ marginBottom: '1rem' }}>
        <input placeholder="Item" value={item} onChange={e => setItem(e.target.value)} />{' '}
        <input placeholder="Quantity" value={quantity} onChange={e => setQuantity(e.target.value)} style={{ width: '6rem' }} />{' '}
        <select value={organizationId} onChange={e => setOrganizationId(e.target.value)}>
          <option value="">-- Organization (optional) --</option>
          {organizations.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>{' '}
        <button disabled={submitting || !item}>{submitting ? 'Saving...' : 'Add Donation'}</button>
      </form>
      <table border="1" cellPadding="4">
        <thead><tr><th>ID</th><th>Item</th><th>Qty</th><th>Status</th><th>Organization</th></tr></thead>
        <tbody>
          {items.map(d => (
            <tr key={d.id}><td>{d.id}</td><td>{d.item}</td><td>{d.quantity}</td><td>{d.status}</td><td>{d.organization_id || ''}</td></tr>
          ))}
          {!items.length && !loading && !error && <tr><td colSpan="5">No donations yet</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
