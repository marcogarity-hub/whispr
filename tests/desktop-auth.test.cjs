const test=require('node:test');const assert=require('node:assert/strict');
let createDesktopAuth;
try{({createDesktopAuth}=require('../electron/auth.cjs'));}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}
test('desktop opens configured browser approval and keeps bearer credentials out of status',async()=>{
 assert.equal(typeof createDesktopAuth,'function');
 const calls=[],opened=[];let polls=0;
 const auth=createDesktopAuth({apiUrl:'https://whispr-flow-clone.vercel.app',openExternal:async url=>opened.push(url),sleep:async()=>{},fetchImpl:async(url,options)=>{
  calls.push({url,options});
  let payload;
  if(url.endsWith('/start'))payload={pairingId:'pair',pollSecret:'secret',approvalUrl:'https://whispr-flow-clone.vercel.app/?pairing=pair',expiresAt:new Date(Date.now()+300000).toISOString()};
  else if(url.endsWith('/poll'))payload=++polls===1?{status:'pending'}:{status:'approved',token:'desktop-token'};
  else if(url.endsWith('/me'))payload={user:{id:'bob',role:'user',email:'bob@example.test'}};
  else payload={};
  return new Response(JSON.stringify(payload),{status:200});
 }});
 await auth.signIn();assert.equal(opened.length,1);assert.equal(opened[0].includes('secret'),false);
 assert.equal(auth.getAuthorization(),'Bearer desktop-token');assert.equal(JSON.stringify(await auth.getStatus()).includes('desktop-token'),false);
 assert.equal((await auth.requestApi({path:'/auth/me',method:'GET'})).payload.user.id,'bob');
 await assert.rejects(auth.requestApi({path:'https://evil.test',method:'GET'}),/Unsupported/);
 await auth.logout();assert.equal(auth.getAuthorization(),'');assert.equal(calls.at(-1).options.headers.authorization,'Bearer desktop-token');
});
