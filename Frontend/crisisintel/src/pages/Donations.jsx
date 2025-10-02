import React, { useEffect, useState } from 'react';
import api from '../api';

export default function Donations() {
  const me = JSON.parse(localStorage.getItem('me') || 'null');
  const [list, setList] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [summary, setSummary] = useState(null);
  const [cid, setCid] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [expAmount, setExpAmount] = useState('');
  const [expCategory, setExpCategory] = useState('');
  const [expDesc, setExpDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [myCampaigns, setMyCampaigns] = useState([]);
  const [campLoading, setCampLoading] = useState(false);
  const [campError, setCampError] = useState(null);

  const load = async (campaign_id) => {
    if (!campaign_id) return;
    try {
      const d = await api.campaignListDonations(campaign_id);
      setList(d.results || []);
      const e = await api.campaignListExpenses(campaign_id);
      setExpenses(e.results || []);
      const s = await api.campaignFinanceSummary(campaign_id);
      setSummary(s);
    } catch {}
  };

  useEffect(() => { if (cid) load(cid); }, [cid]);

  // Load campaigns owned by current user to pick from
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setCampError(null); setCampLoading(true);
      try {
        const r = await api.request('/campaigns/list');
        const all = r.results || [];
        const mine = all.filter(c => c.owner_user_id === me?.id);
        if (!cancelled) setMyCampaigns(mine);
      } catch (e) {
        if (!cancelled) setCampError(e.message || 'Failed to load campaigns');
      } finally {
        if (!cancelled) setCampLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [me?.id]);

  const donate = async () => {
    if (!cid) return;
    const amt = Number(amount);
    if (!amt || isNaN(amt) || amt <= 0) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: 'Enter a valid positive donation amount.' } }));
      return;
    }
    setBusy(true);
    try {
      await api.campaignAddDonation(Number(cid), amt, 'BDT', note || null);
      setAmount(''); setNote('');
      await load(cid);
    } catch (e) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Donation failed' } }));
    } finally { setBusy(false); }
  };

  const addExpense = async () => {
    if (!cid) return;
    const amt = Number(expAmount);
    if (!amt || isNaN(amt) || amt <= 0) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: 'Enter a valid positive expense amount.' } }));
      return;
    }
    setBusy(true);
    try {
      await api.campaignAddExpense(Number(cid), amt, 'BDT', expCategory || null, expDesc || null);
      setExpAmount(''); setExpCategory(''); setExpDesc('');
      await load(cid);
    } catch (e) {
      window.dispatchEvent(new CustomEvent('api-error', { detail: { message: e.message || 'Expense add failed' } }));
    } finally { setBusy(false); }
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
      {/* My Campaigns list (picker) */}
      <div className="bg-white p-5 rounded-lg shadow">
        <h2 className="text-xl font-semibold mb-3">My Campaigns</h2>
        {campLoading && <div className="text-sm text-gray-500">Loading…</div>}
        {campError && <div className="text-sm text-red-600">{campError}</div>}
        {!campLoading && !campError && myCampaigns.length === 0 && (
          <div className="text-sm text-gray-600">
            No campaigns yet. <a href="/social-org/campaigns" className="text-purple-700 underline">Create one</a>.
          </div>
        )}
        <ul className="mt-2 space-y-2 max-h-[460px] overflow-auto">
          {myCampaigns.map(c => {
            const selected = String(cid) === String(c.id);
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => setCid(String(c.id))}
                  className={`w-full text-left border rounded px-3 py-2 ${selected ? 'border-purple-600 bg-purple-50' : 'border-gray-200 hover:bg-gray-50'}`}
                  title={`Select ${c.title}`}
                >
                  <div className="font-semibold truncate">{c.title || `Campaign #${c.id}`}</div>
                  <div className="text-xs text-gray-500">#{c.id} · {c.status}{c.location_text ? ` · ${c.location_text}` : ''}</div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Campaign Finance actions */}
      <div className="bg-white p-5 rounded-lg shadow">
        <h2 className="text-xl font-semibold mb-3">Campaign Finance</h2>
        {/* Selected campaign display (chosen from left list) */}
        <div className="w-full border rounded px-3 py-2 mb-4 bg-gray-50">
          {cid ? (
            <div className="text-sm">Selected: <span className="font-semibold">#{cid}</span> {(() => { const c = myCampaigns.find(x => String(x.id) === String(cid)); return c ? `· ${c.title}` : ''; })()}</div>
          ) : (
            <div className="text-sm text-gray-500">Select a campaign from the list on the left.</div>
          )}
        </div>

        <div className="mb-6">
          <h3 className="font-semibold mb-2">Add Donation</h3>
          <input value={amount} onChange={e => setAmount(e.target.value)} className="w-full border rounded px-3 py-2 mb-2" placeholder="Amount (BDT)" />
          <input value={note} onChange={e => setNote(e.target.value)} className="w-full border rounded px-3 py-2 mb-2" placeholder="Note (optional)" />
          <button disabled={busy} onClick={donate} className="w-full py-2 bg-emerald-600 text-white rounded">Donate</button>
        </div>

        <div>
          <h3 className="font-semibold mb-2">Add Expense</h3>
          <input value={expAmount} onChange={e => setExpAmount(e.target.value)} className="w-full border rounded px-3 py-2 mb-2" placeholder="Amount (BDT)" />
          <input value={expCategory} onChange={e => setExpCategory(e.target.value)} className="w-full border rounded px-3 py-2 mb-2" placeholder="Category (e.g., Food, Transport)" />
          <input value={expDesc} onChange={e => setExpDesc(e.target.value)} className="w-full border rounded px-3 py-2 mb-2" placeholder="Description (optional)" />
          <button disabled={busy} onClick={addExpense} className="w-full py-2 bg-red-600 text-white rounded">Add Expense</button>
          <div className="text-xs text-gray-500 mt-1">Owners only; others will see a permission error.</div>
        </div>
      </div>

      <div className="bg-white p-5 rounded-lg shadow md:col-span-2">
        <h3 className="font-semibold mb-3">Finance Summary</h3>
        {summary ? (
          <div className="mb-4 text-sm text-gray-700">
            <div>Total Donations: <span className="font-semibold">{summary.total_donations} {summary.currency}</span></div>
            <div>Total Expenses: <span className="font-semibold">{summary.total_expenses} {summary.currency}</span></div>
            <div>Balance: <span className="font-semibold">{summary.balance} {summary.currency}</span></div>
          </div>
        ) : (
          <div className="mb-4 text-gray-500">Select a campaign to view summary.</div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <h4 className="font-semibold mb-2">Recent Donations</h4>
            <div className="space-y-2 max-h-[400px] overflow-auto">
              {list.length === 0 && <div className="text-gray-500">No donations yet.</div>}
              {list.map(d => (
                <div key={d.id} className="border rounded p-3 flex items-center justify-between">
                  <div>
                    <div className="font-semibold">{d.amount} {d.currency}</div>
                    <div className="text-xs text-gray-500">By User #{d.donor_user_id || '—'} at {d.created_at}</div>
                  </div>
                  <div className="text-sm text-gray-600">{d.note || ''}</div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h4 className="font-semibold mb-2">Recent Expenses</h4>
            <div className="space-y-2 max-h-[400px] overflow-auto">
              {expenses.length === 0 && <div className="text-gray-500">No expenses yet.</div>}
              {expenses.map(x => (
                <div key={x.id} className="border rounded p-3 flex items-center justify-between">
                  <div>
                    <div className="font-semibold">{x.amount} {x.currency}</div>
                    <div className="text-xs text-gray-500">{x.category || 'General'} | By User #{x.spender_user_id || '—'} at {x.created_at}</div>
                  </div>
                  <div className="text-sm text-gray-600">{x.description || ''}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
