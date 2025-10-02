import React, { useEffect, useState, useRef } from 'react';
import { api } from '../api/client';
import './FireTeams.css';
import '../ui.css';
import Button from './ui/Button';
import Input from './ui/Input';
import Select from './ui/Select';
import Card from './ui/Card';
import Badge from './ui/Badge';

export default function FireTeams() {
  const [departments, setDepartments] = useState([]);
  const [deptId, setDeptId] = useState('');
  const [teams, setTeams] = useState([]);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [name, setName] = useState('');
  const [status, setStatus] = useState('available');
  const [submitting, setSubmitting] = useState(false);
  const [teamEditing, setTeamEditing] = useState({}); // team_id -> { name,status,saving }
  const [teamMembers, setTeamMembers] = useState({}); // team_id -> members array
  const [teamMembersLoading, setTeamMembersLoading] = useState({});
  const [teamAddMember, setTeamAddMember] = useState({}); // team_id -> staff_id to add
  const [expandedTeams, setExpandedTeams] = useState({}); // team_id -> boolean
  const [currentUser, setCurrentUser] = useState(null);
  // Default to staff-first workflow: enroll staff, then create teams
  const [activeTab, setActiveTab] = useState('staff'); // 'teams' | 'staff'
  const [staffLoading, setStaffLoading] = useState(false);
  const [staffError, setStaffError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const searchDebounce = useRef();
  const [addingStaff, setAddingStaff] = useState(false);
  const [newStaff, setNewStaff] = useState({ user_id: '', role: '', display_name: '' });
  const [editing, setEditing] = useState({}); // key user_id -> { role,status,display_name,saving }
  const [showDebug, setShowDebug] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const isFireRole = currentUser && typeof currentUser.role === 'string' && currentUser.role.toLowerCase().includes('fire');

  async function loadCurrentUser() {
    try {
      const data = await api.get('/api/users/me');
      setCurrentUser(data || null);
    } catch (e) {
      console.warn('Failed to load current user', e);
      setCurrentUser(null);
    }
  }

  function normalizeDeptList(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.results)) return data.results;
    if (Array.isArray(data.items)) return data.items;
    return [];
  }
  function normalizeTeams(data) {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.items)) return data.items;
    if (Array.isArray(data.results)) return data.results;
    return [];
  }

  async function loadDepartments() {
    try {
      setError(null);
      const data = await api.get('/api/fire/departments/list');
      let list = normalizeDeptList(data);
      // Restrict visibility to own department (non-admin)
      const isAdmin = currentUser && String(currentUser.role).toLowerCase() === 'admin';
      if (currentUser && !isAdmin) {
        list = list.filter(d => d.user_id === currentUser.id);
      }
      setDepartments(list);
      // Auto-select owned department only
      if (list.length) {
        const owned = list.find(d => d.user_id === currentUser?.id) || list[0];
        if (!deptId || !list.find(d => String(d.id) === String(deptId))) {
          setDeptId(String(owned.id));
        }
      } else {
        setDeptId('');
      }
    } catch (e) {
      setError(e.message || 'Failed loading departments');
    }
  }

  async function loadTeams(selectedId = deptId) {
    if (!selectedId) { setTeams([]); return; }
    try {
      setLoading(true);
      setError(null);
      const data = await api.get(`/api/fire/departments/${selectedId}/teams/list`);
      setTeams(normalizeTeams(data));
    } catch (e) {
      setError(e.message || 'Failed loading teams');
      setTeams([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadTeamMembers(teamId){
    if(!deptId) return;
    setTeamMembersLoading(m=>({...m,[teamId]:true}));
    try {
      const data = await api.get(`/api/fire/departments/${deptId}/teams/${teamId}/members/list`);
      setTeamMembers(m=>({...m,[teamId]:(data.items||[])}));
    } catch(e){
      setTeamMembers(m=>({...m,[teamId]:[]}));
    } finally {
      setTeamMembersLoading(m=>({...m,[teamId]:false}));
    }
  }

  function beginTeamEdit(t){
    setTeamEditing(ed=>({...ed,[t.id]:{ name:t.name, status:t.status, saving:false }}));
  }
  function cancelTeamEdit(id){ setTeamEditing(ed=>{ const c={...ed}; delete c[id]; return c; }); }
  function changeTeamEdit(id, field, value){ setTeamEditing(ed=>({...ed,[id]:{...ed[id],[field]:value}})); }
  async function saveTeamEdit(id){
    const ed = teamEditing[id]; if(!ed) return;
    try {
      changeTeamEdit(id,'saving',true);
      await api.post(`/api/fire/departments/${deptId}/teams/${id}`, { name: ed.name, status: ed.status });
      cancelTeamEdit(id); await loadTeams(deptId);
    } catch(e){ setError(e.message||'Failed updating team'); changeTeamEdit(id,'saving',false); }
  }
  async function deleteTeam(id){
    if(!window.confirm('Delete this team?')) return;
    try { await api.delete(`/api/fire/departments/${deptId}/teams/${id}`); await loadTeams(deptId); }
    catch(e){ setError(e.message||'Failed deleting team'); }
  }
  async function addMember(teamId){
    const staffId = teamAddMember[teamId]; if(!staffId) return;
    try {
      await api.post(`/api/fire/departments/${deptId}/teams/${teamId}/members/add`, { staff_id: parseInt(staffId,10) });
      setTeamAddMember(m=>({...m,[teamId]:''}));
      await loadTeamMembers(teamId); await loadTeams(deptId);
    } catch(e){ setError(e.message||'Failed adding member'); }
  }
  async function removeMember(teamId, member){
    if(!window.confirm('Remove this member from team?')) return;
    try { await api.delete(`/api/fire/departments/${deptId}/teams/${teamId}/members/${member.id}/remove`); await loadTeamMembers(teamId); await loadTeams(deptId);} catch(e){ setError(e.message||'Failed removing member'); }
  }

  function toggleExpand(team){
    setExpandedTeams(prev => {
      const next = { ...prev, [team.id]: !prev[team.id] };
      if(!prev[team.id]){ // expanding
        if(!teamMembers[team.id]) loadTeamMembers(team.id);
      }
      return next;
    });
  }

  async function loadStaff(selectedId = deptId){
    if(!selectedId) { setStaff([]); return; }
    try {
      setStaffLoading(true); setStaffError(null);
      const data = await api.get(`/api/fire/departments/${selectedId}/staff/list`);
      const items = (data && (data.items || data.results || data.staff)) || [];
      setStaff(items);
    } catch(e){
      setStaffError(e.message || 'Failed loading staff');
      setStaff([]);
    } finally { setStaffLoading(false); }
  }

  // Load user first, then departments once user is known (so we can filter to owned)
  useEffect(() => { loadCurrentUser(); }, []);
  useEffect(() => { if (currentUser) loadDepartments(); }, [currentUser]);
  useEffect(() => { if (deptId) { loadTeams(deptId); if(activeTab==='staff') loadStaff(deptId);} }, [deptId]);
  useEffect(() => { if(activeTab==='staff' && deptId) loadStaff(deptId); }, [activeTab]);
  // Keep selected dept valid if list changes
  useEffect(() => {
    if (deptId && !departments.find(d => String(d.id) === String(deptId))) {
      if (departments.length) setDeptId(String(departments[0].id));
      else setDeptId('');
    }
  }, [departments]);

  function handleSearchChange(e){
    const v = e.target.value; setSearchQuery(v);
    if(searchDebounce.current) clearTimeout(searchDebounce.current);
    if(!v){ setSearchResults([]); return; }
    searchDebounce.current = setTimeout(async () => {
      try {
        const data = await api.get(`/api/users/search?q=${encodeURIComponent(v)}`);
        setSearchResults(data.results || []);
      } catch(e){ setSearchResults([]); }
    }, 300);
  }

  async function handleAddStaff(e){
    e.preventDefault();
    if(!deptId || !newStaff.user_id) return;
    try {
      setAddingStaff(true);
      await api.post(`/api/fire/departments/${deptId}/staff/add`, {
        user_id: parseInt(newStaff.user_id,10),
        role: newStaff.role || null,
        display_name: newStaff.display_name || null,
      });
      setNewStaff({ user_id:'', role:'', display_name:'' }); setSearchQuery(''); setSearchResults([]);
      await loadStaff(deptId);
    } catch(e){ setStaffError(e.message || 'Failed adding staff'); }
    finally { setAddingStaff(false); }
  }

  function beginEdit(s){
    setEditing(ed => ({...ed, [s.user_id]: { role: s.role || '', status: s.status || 'active', display_name: s.display_name || '', saving:false }}));
  }
  function cancelEdit(user_id){
    setEditing(ed => { const c = {...ed}; delete c[user_id]; return c; });
  }
  function changeEdit(user_id, field, value){
    setEditing(ed => ({...ed, [user_id]: {...ed[user_id], [field]: value }}));
  }
  async function saveEdit(user_id){
    const ed = editing[user_id]; if(!ed) return;
    try {
      changeEdit(user_id,'saving',true);
      await api.post(`/api/fire/departments/${deptId}/staff/${user_id}/update`, {
        role: ed.role || null,
        status: ed.status || null,
        display_name: ed.display_name || null
      });
      cancelEdit(user_id);
      await loadStaff(deptId);
    } catch(e){ setStaffError(e.message || 'Failed saving'); changeEdit(user_id,'saving',false); }
  }
  async function removeStaff(user_id){
    if(!window.confirm('Remove this staff member?')) return;
    try { await api.delete(`/api/fire/departments/${deptId}/staff/${user_id}/remove`); await loadStaff(deptId); }
    catch(e){ setStaffError(e.message || 'Failed removing'); }
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!deptId || !name) return;
    try {
      setSubmitting(true);
      await api.post(`/api/fire/departments/${deptId}/teams/add`, { name, status });
      setName('');
      setStatus('available');
      await loadTeams(deptId);
    } catch (e) {
      setError(e.message || 'Create failed');
    } finally {
      setSubmitting(false);
    }
  }

  const selectedDept = departments.find(d => String(d.id) === String(deptId));
  const isOwner = selectedDept && currentUser && selectedDept.user_id === currentUser.id;
  // Broaden fire service detection (role may vary, e.g., 'fire_service', 'fire_admin')
  const isFireService = currentUser && typeof currentUser.role === 'string' && currentUser.role.toLowerCase().includes('fire');
  // Fallback: allow management if single-department model and user is fire service with at least one dept
  const canManage = isOwner || (isFireService && !!selectedDept && departments.length === 1);
  const hasAnyDept = departments.length > 0;

  // Automatically ensure a department exists for fire_service user (single-department model)
  useEffect(() => {
    async function ensureDepartment(){
      if(!currentUser || currentUser.role !== 'fire_service') return;
      try {
        const data = await api.get('/api/fire/departments/list');
        const list = normalizeDeptList(data);
        if(!list.length){
          // create a department named after the user's email prefix (fallback)
            const baseName = (currentUser.email || 'Department').split('@')[0];
            const res = await api.post('/api/fire/departments', { name: baseName + ' Department' });
            await loadDepartments();
            if(res && res.id) setDeptId(String(res.id));
        }
      } catch(e){ /* silent */ }
    }
    ensureDepartment();
  }, [currentUser]);

  return (
    <div style={{ padding: '1rem' }}>
      <Card tight className="mb-3" title="Fire Department Management" subtitle="Staff enrollment & team organization">
        <div className="inline" style={{justifyContent:'space-between', width:'100%'}}>
          <div className="tabs">
            <button className={activeTab==='teams'?'active':''} onClick={()=>setActiveTab('teams')}>Teams</button>
            <button className={activeTab==='staff'?'active':''} onClick={()=>setActiveTab('staff')}>Staff</button>
          </div>
          <div style={{marginLeft:'auto'}}>
            <Button size="sm" variant="outline" onClick={()=>setShowDebug(s=>!s)}>{showDebug?'Hide':'Show'} Debug</Button>
          </div>
        </div>
      </Card>
      {showDebug && (
        <pre style={{background:'#222',color:'#eee',padding:'0.5rem',fontSize:'0.65rem',overflowX:'auto'}}>
{JSON.stringify({
  deptId,
  currentUser,
  departments,
  selectedDept,
  flags:{ isOwner, isFireService, canManage }
}, null, 2)}
        </pre>
      )}
      {!isFireService && currentUser && (
        <div style={{marginBottom:'1rem',background:'#fff3cd',padding:'0.75rem',border:'1px solid #ffeeba'}}>
          <strong>Fire Department features not enabled.</strong><br />
          <button disabled={upgrading} onClick={async ()=>{ try { setUpgrading(true); await api.post('/api/users/upgrade/fire-service', {}); await loadCurrentUser(); await loadDepartments(); } catch(e){ setError(e.message || 'Upgrade failed'); } finally { setUpgrading(false); } }}>{upgrading?'Enabling...':'Enable Fire Department Management'}</button>
        </div>
      )}
      {/* Guidance messages reflecting staff-first workflow */}
      {activeTab==='staff' && !hasAnyDept && isFireService && (
        <p style={{color:'#555', fontStyle:'italic'}}>Creating your department... this will appear automatically. Once ready, start enrolling staff below.</p>
      )}
      {activeTab==='staff' && selectedDept && canManage && (
        <p style={{color:'#555', fontStyle:'italic'}}>Enroll staff members first. After that, switch to the Teams tab to form operational teams.</p>
      )}
      {activeTab==='staff' && selectedDept && !canManage && (
        <p style={{color:'#777', fontStyle:'italic'}}>You can view the staff roster. Only the department owner can modify it.</p>
      )}
      {activeTab==='teams' && selectedDept && isOwner && staff.length===0 && (
        <p style={{color:'#777', fontStyle:'italic'}}>Add staff first (in the Staff tab) before organizing them into teams.</p>
      )}
      {activeTab==='teams' && !selectedDept && (
        <p style={{color:'#555', fontStyle:'italic'}}>Department provisioning is in progress. Return to Staff tab momentarily.</p>
      )}
      {error && <p style={{ color: 'red' }}>{String(error)}</p>}
      {selectedDept && (
        <div style={{ marginBottom: '0.5rem', fontSize:'0.9rem', color:'#333' }}>
          <strong>Department:</strong> {selectedDept.name} {isOwner && '(you are owner)'} <button style={{marginLeft:'0.5rem'}} onClick={() => loadDepartments()}>Reload</button>
        </div>
      )}
      {activeTab==='teams' && canManage ? (
        <Card tight className="mb-3" title="Create Team" subtitle="Organize staff into operational units">
          <form onSubmit={handleCreate} className="form-grid cols-2" style={{alignItems:'end'}}>
            <Input label="Team Name" value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Alpha" required />
            <Select label="Status" value={status} onChange={e=>setStatus(e.target.value)} options={[{value:'available',label:'available'},{value:'busy',label:'busy'},{value:'offline',label:'offline'}]} />
            <div style={{gridColumn:'1 / span 2'}} className="inline gap-3">
              <Button type="submit" variant="primary" loading={submitting} disabled={!name || !deptId}>Add Team</Button>
              <Button type="button" onClick={()=>{ setName(''); setStatus('available'); }} variant="outline" disabled={submitting}>Reset</Button>
            </div>
          </form>
        </Card>
      ) : (
        (activeTab==='teams' && selectedDept && !canManage && <p style={{ fontStyle: 'italic' }}>You are not the owner of this department; team creation disabled.</p>)
      )}
      {activeTab==='teams' && (
        <div>
          {loading && <p>Loading teams...</p>}
          {!loading && !teams.length && <p className="inline-hint">No teams found.</p>}
          <div className="teams-grid">
            {teams.map(t => {
              const ed = teamEditing[t.id];
              const editingMode = !!ed;
              const members = teamMembers[t.id] || [];
              const loadingMembers = teamMembersLoading[t.id];
              const expanded = !!expandedTeams[t.id];
              const memberCount = typeof t.member_count !== 'undefined' ? t.member_count : members.length;
              return (
                <div key={t.id} className={"team-card" + (editingMode ? ' editing' : '')}>
                  <div className="team-card-header">
                    <div className="team-card-header-row">
                      <div className="team-title" title={`Team ID: ${t.id}`}>{editingMode ? (
                        <input value={ed.name} onChange={e=>changeTeamEdit(t.id,'name',e.target.value)} style={{fontSize:'0.75rem',padding:'4px 6px'}} />
                      ) : t.name}</div>
                      <div className="team-meta">
                        <span className={`status-badge status-${editingMode?ed.status:t.status}`}>{editingMode?ed.status:t.status}</span>
                        <span className="member-chip" title="Member count">{memberCount} {memberCount===1?'Member':'Members'}</span>
                      </div>
                    </div>
                    <div className="team-meta">
                      <span className="muted small">Created</span>
                      <span className="small">{t.created_at}</span>
                    </div>
                    {editingMode && (
                      <div className="team-edit-row">
                        <select value={ed.status} onChange={e=>changeTeamEdit(t.id,'status',e.target.value)}>
                          <option value="available">available</option>
                          <option value="busy">busy</option>
                          <option value="offline">offline</option>
                        </select>
                      </div>
                    )}
                    <div className="team-actions">
                      {!editingMode && canManage && <>
                        <button className="primary" onClick={()=>beginTeamEdit(t)}>Edit</button>
                        <button className="danger" onClick={()=>deleteTeam(t.id)}>Delete</button>
                        <button onClick={()=>{ toggleExpand(t); }}> {expanded? 'Hide Members':'View Members'} </button>
                        <button onClick={()=>loadTeams(deptId)}>↻</button>
                      </>}
                      {editingMode && <>
                        <button className="primary" disabled={ed.saving} onClick={()=>saveTeamEdit(t.id)}>{ed.saving?'Saving...':'Save'}</button>
                        <button disabled={ed.saving} onClick={()=>cancelTeamEdit(t.id)}>Cancel</button>
                      </>}
                    </div>
                  </div>
                  {expanded && (
                    <div className="members-panel">
                      <div className="members-inner">
                        {loadingMembers && <p className="small muted">Loading members...</p>}
                        {!loadingMembers && (
                          <>
                            {canManage && (
                              <div className="add-member-row">
                                <select value={teamAddMember[t.id]||''} onChange={e=>setTeamAddMember(m=>({...m,[t.id]:e.target.value}))}>
                                  <option value="">-- Add Staff --</option>
                                  {staff.map(s=> <option key={s.id || s.user_id} value={s.id}>{s.display_name || s.user_email || s.user_full_name || s.user_id}</option>)}
                                </select>
                                <button disabled={!teamAddMember[t.id]} onClick={()=>addMember(t.id)}>Add</button>
                                <button onClick={()=>loadTeamMembers(t.id)}>Reload</button>
                              </div>
                            )}
                            <div>
                              {members.length ? (
                                <table className="members-table">
                                  <thead>
                                    <tr><th>ID</th><th>User</th><th>Display</th><th>Role</th><th>Status</th><th></th></tr>
                                  </thead>
                                  <tbody>
                                    {members.map(m => (
                                      <tr key={m.id}>
                                        <td>{m.id}</td>
                                        <td>{m.user_email || m.user_full_name || m.user_id}</td>
                                        <td>{m.display_name || ''}</td>
                                        <td>{m.role || ''}</td>
                                        <td>{m.status}</td>
                                        <td>{canManage && <button onClick={()=>removeMember(t.id, m)}>✕</button>}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              ) : <div className="members-empty">No members yet.</div>}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {activeTab==='staff' && (
        <div style={{marginTop:'1rem'}}>
          {staffError && <p style={{color:'red'}}>{staffError}</p>}
          {(!departments.length && isFireService) && (
            <div style={{marginBottom:'0.5rem'}}>
              <button onClick={async ()=>{ if(!departments.length){
                try { const baseName = (currentUser?.email || 'Department').split('@')[0]; await api.post('/api/fire/departments', { name: baseName + ' Department' }); await loadDepartments(); }
                catch(err){ setError(err.message || 'Failed creating department'); }
              } }} disabled={!currentUser}>Create Department</button>
            </div>
          )}
          {(canManage || (isFireService && !departments.length)) && (
            <Card tight className="mb-3" title="Add Staff Member" subtitle="Search users then assign optional details">
              <form onSubmit={handleAddStaff} className="form-grid cols-2">
                <Input label="Search" placeholder="Search users" value={searchQuery} onChange={handleSearchChange} hint={searchResults.length?`${searchResults.length} result(s)`:''} />
                <div className="field">
                  <label>User</label>
                  <select className="input" value={newStaff.user_id} onChange={e=>setNewStaff(s=>({...s,user_id:e.target.value}))}>
                    <option value="">-- Select User --</option>
                    {searchResults.map(u => <option key={u.id} value={u.id}>{u.email}{u.full_name?` (${u.full_name})`:''}</option>)}
                  </select>
                </div>
                <Input label="Display Name" placeholder="Display Name" value={newStaff.display_name} onChange={e=>setNewStaff(s=>({...s,display_name:e.target.value}))} />
                <Input label="Role" placeholder="Role" value={newStaff.role} onChange={e=>setNewStaff(s=>({...s,role:e.target.value}))} />
                <div style={{gridColumn:'1 / span 2'}} className="inline gap-3 mt-2">
                  <Button type="submit" variant="primary" loading={addingStaff} disabled={!newStaff.user_id}>Add</Button>
                  <Button type="button" variant="outline" onClick={()=>{ setNewStaff({ user_id:'', role:'', display_name:'' }); setSearchQuery(''); setSearchResults([]); }} disabled={addingStaff}>Clear</Button>
                </div>
              </form>
            </Card>
          )}
          {staffLoading && <p>Loading staff...</p>}
          <Card tight title="Staff Roster" subtitle="Manage active personnel">
            <table className="table">
              <thead><tr><th>User</th><th>Display Name</th><th>Role</th><th>Status</th><th style={{width:'140px'}}>Actions</th></tr></thead>
              <tbody>
                {staff.map(s => {
                  const ed = editing[s.user_id];
                  const editingMode = !!ed;
                  return (
                    <tr key={s.user_id}>
                      <td>{s.user_email || s.user_full_name || s.user_id}</td>
                      <td>{editingMode ? <input className="input" value={ed.display_name} onChange={e=>changeEdit(s.user_id,'display_name',e.target.value)} /> : (s.display_name || '')}</td>
                      <td>{editingMode ? <input className="input" value={ed.role} onChange={e=>changeEdit(s.user_id,'role',e.target.value)} style={{width:'7rem'}} /> : (s.role || '')}</td>
                      <td>{editingMode ? (
                        <select className="input" value={ed.status} onChange={e=>changeEdit(s.user_id,'status',e.target.value)}>
                          <option value="active">active</option>
                          <option value="inactive">inactive</option>
                        </select>
                      ) : s.status}</td>
                      <td>
                        {isOwner && !editingMode && <div className="inline gap-2">
                          <Button size="sm" variant="outline" onClick={()=>beginEdit(s)}>Edit</Button>
                          <Button size="sm" variant="danger" onClick={()=>removeStaff(s.user_id)}>Remove</Button>
                        </div>}
                        {isOwner && editingMode && <div className="inline gap-2">
                          <Button size="sm" variant="primary" loading={ed.saving} disabled={ed.saving} onClick={()=>saveEdit(s.user_id)}>{ed.saving?'Saving':'Save'}</Button>
                          <Button size="sm" variant="outline" disabled={ed.saving} onClick={()=>cancelEdit(s.user_id)}>Cancel</Button>
                        </div>}
                      </td>
                    </tr>
                  );
                })}
                {!staff.length && !staffLoading && <tr><td colSpan="5">No staff found</td></tr>}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </div>
  );
}
