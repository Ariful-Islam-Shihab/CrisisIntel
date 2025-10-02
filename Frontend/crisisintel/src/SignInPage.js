import React, { useState } from 'react';
import './SignInPage.css';

export default function SignInPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!username || !password) {
      setError('Please enter both username and password.');
      return;
    }
    // Simulate sign in logic
    setError('');
    alert(`Signed in as ${username}`);
  };

  return (
    <div className="login-container">
      <form className="login-form" onSubmit={handleSubmit}>
        <h2>Sign In</h2>
        {error && <div className="error">{error}</div>}
        <div className="form-group">
          <label htmlFor="username">Username</label>
          <input
            type="text"
            id="username"
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="Enter your username"
          />
        </div>
        <div className="form-group">
          <label htmlFor="password">Password</label>
          <input
            type="password"
            id="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Enter your password"
          />
        </div>
        <div style={{display:'flex', gap:'0.75rem', alignItems:'center', marginTop:'0.5rem'}}>
          <button type="submit" className="login-btn" style={{flex:1}}>Sign In</button>
          <button
            type="button"
            className="login-btn secondary-btn"
            style={{flex:1, background:'#6b7280'}}
            onClick={() => { window.location.href = '/register'; }}
          >
            Register
          </button>
        </div>
      </form>
    </div>
  );
}
