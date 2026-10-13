function createDesktopAuth({apiUrl,openExternal,fetchImpl=globalThis.fetch,clock=()=>Date.now(),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}) {
 const origin=new URL(apiUrl).origin;
 if(origin!==apiUrl || (!origin.startsWith('https:') && origin!=='http://localhost:5173'))throw new Error('Invalid desktop API origin');
 let token='',pending=false,generation=0;
 const allowed={GET:[/^\/auth\/me$/, /^\/transcript$/, /^\/stats$/, /^\/users$/],POST:[/^\/auth\/logout$/, /^\/dictations$/, /^\/sessions$/, /^\/users\/[0-9a-f-]{36}\/(disable|restore)$/],PUT:[/^\/transcript$/],DELETE:[/^\/transcript$/]};
 async function fetchResult(path,method,body,credential='') {
  const response=await fetchImpl(`${origin}/api${path}`,{method,headers:{...(credential?{authorization:`Bearer ${credential}`} : {}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
  const payload=response.status===204?null:await response.json().catch(()=>({}));
  return {ok:response.ok,status:response.status,payload};
 }
 async function requestApi({path,method='GET',body}) {
  if(typeof path!=='string' || !allowed[method]?.some(rule=>rule.test(path)))throw new Error('Unsupported desktop API operation');
  const result=await fetchResult(path,method,body,token);
  if(result.status===401)token='';
  return result;
 }
 async function signIn() {
  if(pending)throw new Error('Sign-in is already in progress');
  pending=true;const current=++generation;
  try {
   const response=await fetchResult('/auth/pairing/start','POST',{});
   if(!response.ok)throw new Error(response.payload.error || 'Unable to start sign-in');
   const pairing=response.payload;
   const approval=new URL(pairing.approvalUrl);
   if(approval.origin!==origin || approval.pathname!=='/' || approval.searchParams.get('pairing')!==pairing.pairingId)throw new Error('Invalid browser approval URL');
   await openExternal(approval.toString());
   const deadline=Math.min(Date.parse(pairing.expiresAt),clock()+300000);
   while(clock()<deadline && generation===current) {
    const result=await fetchResult('/auth/pairing/poll','POST',{pairingId:pairing.pairingId,pollSecret:pairing.pollSecret});
    if(result.ok && result.payload.status==='approved') {if(generation!==current)throw new Error('Sign-in cancelled');token=result.payload.token;return getStatus();}
    if(!result.ok && result.status!==429)throw new Error('Sign-in expired or was refused. Please try again.');
    await sleep(1500);
   }
   throw new Error('Sign-in expired or was cancelled.');
  }finally{pending=false;}
 }
 async function getStatus(){if(!token)return {user:null};const result=await requestApi({path:'/auth/me',method:'GET'});return {user:result.ok?result.payload.user:null};}
 async function logout() {
  generation++;
  if(token){const result=await requestApi({path:'/auth/logout',method:'POST'});if(!result.ok && result.status!==401)throw new Error('Unable to sign out');}
  token='';return {ok:true};
 }
 return {signIn,getStatus,logout,requestApi,getAuthorization:()=>token?`Bearer ${token}`:''};
}
module.exports={createDesktopAuth};
