import {useEffect,useState} from 'react';
export default function UserManagement({client}) {
 const [users,setUsers]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(null);
 useEffect(()=>{let active=true;client.listUsers().then(value=>{if(active)setUsers(value);}).catch(reason=>{if(active)setError(reason.message);});return()=>{active=false;};},[client]);
 async function change(user) {
  if(!user.disabled && !window.confirm(`Disable access for ${user.email}? Their active sessions will end.`))return;
  setBusy(user.id);setError('');
  try {await (user.disabled?client.restoreUser(user.id):client.disableUser(user.id));setUsers(await client.listUsers());}
  catch(reason){setError(reason.message || 'Unable to update account.');}
  finally{setBusy(null);}
 }
 return <section className="card"><h2>Manage users</h2>{error && <p role="alert" className="error-message">{error}</p>}<ul>{users.map(user=><li key={user.id}><span>{user.email}</span> — {user.role==='owner'?'Owner':user.disabled?'Disabled':'Enabled'} {user.role!=='owner' && <button className="secondary" disabled={busy!==null} onClick={()=>change(user)}>{user.disabled?'Restore':'Disable'}</button>}</li>)}</ul></section>;
}
