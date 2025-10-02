import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import api from '../api';

export default function PostDetail() {
  const { id } = useParams();
  const location = useLocation();
  const [data, setData] = useState(null);
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const highlightId = useMemo(() => {
    const p = new URLSearchParams(location.search);
    const v = p.get('highlight_comment');
    return v ? String(v) : null;
  }, [location.search]);
  const highlightRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [postRes, commentsRes] = await Promise.all([
          api.getPost(id),
          api.comments(id).catch(() => [])
        ]);
        if (!mounted) return;
        setData(postRes);
        const items = Array.isArray(commentsRes) ? commentsRes : (commentsRes.items || commentsRes.results || []);
        setComments(items);
      } catch (e) {
        setError(e.message || 'Failed to load');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [id]);

  useEffect(() => {
    if (!highlightId) return;
    if (highlightRef.current) {
      try { highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch {}
    }
  }, [comments, highlightId]);

  if (loading) return <div className="p-4 bg-white border rounded">Loading...</div>;
  if (error) return <div className="p-4 bg-white border rounded text-red-600">{error}</div>;
  if (!data) return null;

  return (
    <div className="p-4 bg-white border rounded space-y-4">
      <h2 className="text-xl font-semibold">Post #{data.post_id}</h2>
      <div className="text-sm text-gray-600">by {data.author_name || data.author_email}</div>
      <p className="whitespace-pre-wrap">{data.body}</p>
      {data.image_url && <img alt="post" src={data.image_url} className="max-w-md rounded border" />}

      <section>
        <h3 className="font-semibold mb-2">Comments</h3>
        <ul className="space-y-2">
          {comments.length === 0 && <li className="text-sm text-gray-500">No comments yet</li>}
          {comments.map((c) => {
            const cid = c.id ?? c.comment_id ?? c.pk;
            const isHighlight = highlightId && String(cid) === String(highlightId);
            return (
              <li key={cid}
                  ref={isHighlight ? highlightRef : null}
                  className={`p-3 border rounded bg-white ${isHighlight ? 'ring-2 ring-blue-400 bg-blue-50' : ''}`}>
                <div className="text-xs text-gray-500">{c.author_name || c.author || `User #${c.author_id ?? ''}`}</div>
                <div className="text-sm whitespace-pre-wrap">{c.body || c.text || c.content || ''}</div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
