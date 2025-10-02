import React, { useState } from 'react';
import '../ui.css';
import api from '../api';
import Button from '../components/ui/Button';
import Input from '../components/ui/Input';
import Card from '../components/ui/Card';

export default function SignInPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [touched, setTouched] = useState({});

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Please enter both email and password.');
      return;
    }
    try {
      setError('');
      const res = await api.login({ email: email.trim().toLowerCase(), password });
      // Basic sanity check that tokens are persisted
      const savedToken = localStorage.getItem('authToken');
      const savedCsrf = localStorage.getItem('csrfToken');
      if (res?.user && savedToken && savedCsrf) {
        // Best-effort: update last known location to improve crisis proximity features
        try {
          if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(async (pos) => {
              const { latitude, longitude } = pos.coords || {};
              if (typeof latitude === 'number' && typeof longitude === 'number') {
                try { await api.request('/location/update', 'POST', { lat: latitude, lng: longitude }, { silent: true }); } catch {}
              }
              window.location.href = '/feed';
            }, () => { window.location.href = '/feed'; }, { enableHighAccuracy: true, timeout: 5000 });
          } else {
            window.location.href = '/feed';
          }
        } catch { window.location.href = '/feed'; }
      } else if (res?.user && !savedToken) {
        console.error('Login succeeded but authToken not saved');
        setError('Login succeeded but failed to save session. Please retry.');
      } else {
        setError('Login failed. Check your credentials.');
      }
    } catch (err) {
      setError(err.message || 'Login failed');
    }
  };

  return (
    <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',padding:'var(--space-6)'}}>
      <div style={{maxWidth:420, width:'100%'}}>
        <Card title="Sign In" subtitle="Access your CrisisIntel account">
          <form onSubmit={handleSubmit} className="stack">
            {error && <div className="alert danger" style={{marginBottom:'var(--space-2)'}}>{error}</div>}
            <Input label="Email" type="email" value={email} onChange={e=>{ setEmail(e.target.value); }} onBlur={()=>setTouched(t=>({...t,email:true}))} placeholder="you@example.com" required error={touched.email && !email ? 'Email required' : ''} />
            <Input label="Password" type="password" value={password} onChange={e=>{ setPassword(e.target.value); }} onBlur={()=>setTouched(t=>({...t,password:true}))} placeholder="••••••••" required error={touched.password && !password ? 'Password required' : ''} />
            <div className="inline gap-3 mt-2" style={{justifyContent:'space-between'}}>
              <Button type="submit" variant="primary" block>Sign In</Button>
              <Button type="button" variant="outline" block onClick={()=>window.location.href='/register'}>Register</Button>
            </div>
          </form>
        </Card>
        <div className="hint mt-3" style={{textAlign:'center'}}>Need access to Fire Department tools? Sign in then enable from dashboard.</div>
      </div>
    </div>
  );
}
