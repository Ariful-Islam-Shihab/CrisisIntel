import React from 'react';
import { Link, useNavigate } from 'react-router-dom';

export default function SocialOrg() {
  const nav = useNavigate();
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div className="md:col-span-1 bg-white p-5 rounded-lg shadow">
        <h2 className="text-xl font-semibold mb-3">Social Organization</h2>
        <p className="text-gray-600 mb-4">Quick actions</p>
        <div className="space-y-3">
          <button onClick={() => nav('/social-org/volunteers')} className="w-full py-2 px-3 bg-purple-600 text-white rounded">Volunteers</button>
          <button onClick={() => nav('/social-org/campaigns')} className="w-full py-2 px-3 bg-indigo-600 text-white rounded">Campaigns</button>
          <button onClick={() => nav('/social-org/donations')} className="w-full py-2 px-3 bg-emerald-600 text-white rounded">Donations</button>
        </div>
      </div>
      <div className="md:col-span-2 bg-white p-5 rounded-lg shadow">
        <h3 className="text-lg font-semibold mb-2">Overview</h3>
        <p className="text-gray-600">Use the buttons on the left to manage your volunteers, run campaigns, and review donations and expenses.</p>
      </div>
    </div>
  );
}
