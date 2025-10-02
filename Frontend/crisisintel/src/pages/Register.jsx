import {useState} from 'react';
import api from '../api';

/**
 * Registration page.
 * Minimal form posting directly to api.register; on success shows message instructing user to sign in.
 */
export default function Register(){
  const [form,setForm]=useState({email:'',password:'',full_name:'',role:'regular'});
  const [msg,setMsg]=useState();
  const [error,setError]=useState();
  const [submitting,setSubmitting]=useState(false);
  const submit=async e=>{
    e.preventDefault();
    setError(undefined); setMsg(undefined);
    try {
      setSubmitting(true);
      await api.register(form);
      setMsg('Registered. You can now sign in.');
    } catch (err) {
      // err is Error from api client, but guard anyway
      const raw = err && (err.message || err.toString());
      setError(raw);
    } finally {
      setSubmitting(false);
    }
  };
  return <div className="panel">
  <h2>Register</h2>
  {error && <div className="error" style={{color:'red'}}>{String(error)}</div>}
  {msg&&<div className="info">{msg}</div>}
    <form onSubmit={submit} className="inline-form">
      {/* Basic inputs */}
      {['email','password','full_name'].map(f=> (
        <input key={f} placeholder={f} type={f==='password'?'password':'text'} value={form[f]} onChange={e=>setForm({...form,[f]:e.target.value})} />
      ))}
      {/* Role options correspond to backend accepted simple string field */}
      <select value={form.role} onChange={e=>setForm({...form,role:e.target.value})}>
        <option value="regular">Regular</option>
        <option value="hospital">Hospital</option>
        <option value="social_org">Social Org</option>
        <option value="fire_service">Fire Service</option>
        <option value="blood_bank">Blood Bank</option>
        <option value="admin">Admin</option>
      </select>
      <button className="btn btn-primary" disabled={submitting}>{submitting? 'Submitting...' : 'Register'}</button>
    </form>
  </div>;
}
