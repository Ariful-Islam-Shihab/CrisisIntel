import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api';

export default function FireRequestDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let mounted = true;
    api.getFireRequest(id)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [id]);

  if (loading) return <div className="p-4 bg-white border rounded">Loading...</div>;
  if (error) return <div className="p-4 bg-white border rounded text-red-600">{error}</div>;
  if (!data) return null;

  return (
    <div className="p-4 bg-white border rounded space-y-2">
      <h2 className="text-xl font-semibold">Fire Request #{data.id}</h2>
      <div className="text-sm text-gray-600">Status: {data.status}</div>
      <div className="text-sm text-gray-600">Description: {data.description}</div>
      <div className="text-sm text-gray-600">Location: {data.lat ?? '—'}, {data.lng ?? '—'}</div>
    </div>
  );
}
