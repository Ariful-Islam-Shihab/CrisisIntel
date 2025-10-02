// Simple API client wrapper
const BASE = process.env.REACT_APP_API_BASE || '';

async function request(path, { method = 'GET', data, headers = {} } = {}) {
  const token = localStorage.getItem('authToken') || localStorage.getItem('token');
  const options = { method, headers: { ...headers } };
  if (token) {
    options.headers['X-Auth-Token'] = token;
  }
  if (data) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(data);
  }
  let resp;
  try {
    resp = await fetch(BASE + path, options);
  } catch (networkErr) {
    throw new Error(`Network error: ${networkErr.message}`);
  }
  const ct = resp.headers.get('content-type') || '';
  const isJson = ct.includes('application/json');
  if (!resp.ok) {
    let bodyText = '';
    try {
      bodyText = await resp.text();
    } catch (_) { /* ignore */ }
    let parsed;
    if (isJson && bodyText) {
      try { parsed = JSON.parse(bodyText); } catch (_) { /* ignore */ }
    }
    const detailRaw = parsed?.detail || parsed?.message || parsed?.error || parsed?.code || parsed?.status || bodyText || 'Unknown error';
    // If detail is an object, stringify minimally
    const detail = typeof detailRaw === 'string' ? detailRaw : JSON.stringify(detailRaw);
    if(path === '/api/users/me') {
      console.warn('Users/me failed', resp.status, detail);
    }
    throw new Error(`HTTP ${resp.status}: ${detail}`);
  }
  if (isJson) {
    try {
      return await resp.json();
    } catch (e) {
      throw new Error('Invalid JSON response');
    }
  }
  return resp.text();
}

export const api = {
  get: (p) => request(p),
  post: (p, data) => request(p, { method: 'POST', data }),
  delete: (p) => request(p, { method: 'DELETE' }),
};
