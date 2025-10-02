import React, { useState, useEffect } from 'react';
import api from '../api';

/**
 * Simpler CRUD-focused posts management page.
 * Shows only original posts (no shares/comments aggregation) for clarity when editing.
 */
export default function Posts() {
  const [posts, setPosts] = useState([]);
  const [body, setBody] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [editId, setEditId] = useState(null);
  const [editBody, setEditBody] = useState('');
  const [editImageUrl, setEditImageUrl] = useState('');

  useEffect(() => {
    // Reuse newsFeed endpoint; filter logic could be added if needed.
    api.newsFeed().then(r => setPosts(r.results));
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    await api.createPost(body, imageUrl || undefined);
    setBody('');
    setImageUrl('');
    api.newsFeed().then(r => setPosts(r.results));
  };

  const handleEdit = async (e) => {
    e.preventDefault();
    await api.updatePost(editId, editBody, editImageUrl || undefined);
    setEditId(null);
    setEditBody('');
    setEditImageUrl('');
    api.newsFeed().then(r => setPosts(r.results));
  };

  const handleDelete = async (id) => {
    await api.deletePost(id);
    api.newsFeed().then(r => setPosts(r.results));
  };

  return (
    <div className="grid grid-cols-4 gap-4">
      <div className="col-span-3 space-y-4">
        <div className="bg-white border border-gray-200 rounded-lg">
          <form onSubmit={handleCreate} className="p-4 space-y-4">
            <textarea className="p-4 w-full bg-gray-100 rounded-lg" value={body} onChange={e => setBody(e.target.value)} placeholder="Write a post..." />
            <div className="flex items-center space-x-3">
              <input className="flex-1 p-3 bg-gray-100 rounded-lg" value={imageUrl} onChange={e => setImageUrl(e.target.value)} placeholder="Image URL (optional)" />
              <button className="py-3 px-6 bg-purple-600 text-white rounded-lg">Create</button>
            </div>
          </form>
        </div>

        {editId && (
          <div className="bg-white border border-gray-200 rounded-lg">
            <form onSubmit={handleEdit} className="p-4 space-y-4">
              <textarea className="p-4 w-full bg-gray-100 rounded-lg" value={editBody} onChange={e => setEditBody(e.target.value)} placeholder="Edit post..." />
              <div className="flex items-center space-x-3">
                <input className="flex-1 p-3 bg-gray-100 rounded-lg" value={editImageUrl} onChange={e => setEditImageUrl(e.target.value)} placeholder="Image URL (optional)" />
                <button className="py-3 px-6 bg-purple-600 text-white rounded-lg">Save</button>
                <button type="button" className="py-3 px-6 bg-gray-100 rounded-lg" onClick={()=>setEditId(null)}>Cancel</button>
              </div>
            </form>
          </div>
        )}

        <div className="space-y-4">
          {posts.map(post => (
            <div key={post.id} className="p-4 bg-white border border-gray-200 rounded-lg">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className="w-10 h-10 rounded-full bg-gray-300" />
                  <div>
                    <p className="font-semibold">{post.author_name}</p>
                    <p className="text-xs text-gray-500">{new Date(post.created_at).toLocaleString()}</p>
                  </div>
                </div>
                <div className="space-x-2 text-sm">
                  <button className="py-1 px-3 bg-gray-100 rounded" onClick={()=>{setEditId(post.id);setEditBody(post.body);setEditImageUrl(post.image_url||'')}}>Edit</button>
                  <button className="py-1 px-3 bg-red-50 text-red-600 rounded" onClick={()=>handleDelete(post.id)}>Delete</button>
                </div>
              </div>
              <p className="whitespace-pre-line">{post.body}</p>
              {post.image_url && <img src={post.image_url} alt="post" className="mt-3 rounded-lg max-h-[420px] object-cover w-full" />}
            </div>
          ))}
        </div>
      </div>

      <div className="col-span-1 space-y-4">
        <div className="p-4 bg-white border border-gray-200 rounded-lg">
          <h3 className="mb-6 text-xl">Tips</h3>
          <p className="text-sm text-gray-600">Use this page to manage your own posts.</p>
        </div>
      </div>
    </div>
  );
}
