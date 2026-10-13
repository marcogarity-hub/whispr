import {useEffect,useState} from 'react';
function pendingPairing() {
 const supplied=new URLSearchParams(window.location.search).get('pairing');
 if(supplied && /^[0-9a-f-]{36}$/i.test(supplied)) {window.sessionStorage.setItem('whisprPairing',supplied);return supplied;}
 return window.sessionStorage.getItem('whisprPairing');
}
export function rememberPairing() {return pendingPairing();}
export default function PairingApproval({client}) {
 const [id]=useState(pendingPairing),[pairing,setPairing]=useState(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{if(!id)return;let active=true;client.getPairing(id).then(value=>{if(active)setPairing(value);}).catch(error=>{if(active)setMessage(error.message);});return()=>{active=false;};},[id,client]);
 async function approve() {
  setBusy(true);
  try{await client.approvePairing(id);setPairing(null);setMessage('Desktop approved. You can return to Whispr.');window.sessionStorage.removeItem('whisprPairing');window.history.replaceState({},'',window.location.pathname);}
  catch(error){setMessage(error.message);}
  finally{setBusy(false);}
 }
 function cancel(){window.sessionStorage.removeItem('whisprPairing');window.history.replaceState({},'',window.location.pathname);setPairing(null);setMessage('Desktop sign-in was not approved.');}
 if(!id)return null;
 return <section className="card"><h2>Approve desktop sign-in</h2>{pairing && <><p>Only approve if you just started sign-in in Whispr desktop on your own device. Approval lets that app access your transcripts and usage as your account.</p><button disabled={busy} onClick={approve}>Approve Whispr desktop</button><button className="secondary" disabled={busy} onClick={cancel}>Cancel</button></>}{message && <p role="status">{message}</p>}</section>;
}
