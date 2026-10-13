import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {withDatabase} from '../helpers/postgres.mjs';
const require=createRequire(import.meta.url);
const {createAuthStore}=require('../../server/auth-store.cjs');
let createAuthRoutes,createSessionAuth;
try {({createAuthRoutes}=require('../../server/auth-routes.cjs'));({createSessionAuth}=require('../../server/session-auth.cjs'));}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}
const express=require('express');
test('OAuth is bound to browser, single-use, expiring, and yields CSRF-protected sessions',async()=>{
 assert.equal(typeof createAuthRoutes,'function','HTTP authentication routes must exist');
 await withDatabase(async({rpcClient})=>{
  let now=new Date('2026-10-13T00:00:00Z');
  const store=createAuthStore(rpcClient,{clock:()=>now});
  let exchangeCalls=0;
  const google={authorizationUrl:({state})=>`https://accounts.google.com/?state=${state}`,async exchangeAndVerify(){exchangeCalls++;return {subject:'owner-subject',email:'owner@example.test',emailVerified:true,name:'Owner'};}};
  const app=express();app.use(express.json());
  const auth=createSessionAuth({store,appOrigin:'http://localhost:5173'});
  app.use(createAuthRoutes({store,google,auth,appOrigin:'http://localhost:5173',clock:()=>now}));
  app.post('/private',auth.authenticate,auth.csrf,(_q,r)=>r.json({ok:true}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  const request=(path,options={})=>fetch(`${base}${path}`,{redirect:'manual',...options});
  const begin=async()=>{const r=await request('/api/auth/google/start');assert.equal(r.status,302);assert.match(r.headers.get('set-cookie'),/HttpOnly/);return {state:new URL(r.headers.get('location')).searchParams.get('state'),cookie:r.headers.get('set-cookie').split(';')[0]};};
  try {
   const first=await begin();
   let response=await request(`/api/auth/google/callback?state=${first.state}&code=valid`);
   assert.equal(response.headers.get('location'),'/?authError=sign-in-failed');assert.equal(exchangeCalls,0);
   response=await request(`/api/auth/google/callback?state=${first.state}&code=valid`,{headers:{cookie:first.cookie}});
   assert.equal(response.status,302);assert.equal(response.headers.get('location'),'/');assert.equal(exchangeCalls,1);
   const cookie=response.headers.getSetCookie().find(c=>c.startsWith('whispr_session=')).split(';')[0];
   assert.match(response.headers.getSetCookie().find(c=>c.startsWith('whispr_session=')),/SameSite=Lax/);
   const me=await (await request('/api/auth/me',{headers:{cookie}})).json();assert.equal(me.user.role,'owner');assert.ok(me.csrfToken);
   assert.equal((await request('/private',{method:'POST',headers:{cookie,origin:'http://localhost:5173'}})).status,403);
   assert.equal((await request('/private',{method:'POST',headers:{cookie,origin:'https://evil.test','x-csrf-token':me.csrfToken}})).status,403);
   assert.equal((await request('/private',{method:'POST',headers:{cookie,origin:'http://localhost:5173','x-csrf-token':me.csrfToken}})).status,200);
   await request(`/api/auth/google/callback?state=${first.state}&code=valid`,{headers:{cookie:first.cookie}});assert.equal(exchangeCalls,1);
   const expired=await begin();now=new Date('2026-10-13T00:10:00Z');
   await request(`/api/auth/google/callback?state=${expired.state}&code=valid`,{headers:{cookie:expired.cookie}});assert.equal(exchangeCalls,1);
   const cancel=await begin();await request(`/api/auth/google/callback?state=${cancel.state}&error=access_denied`,{headers:{cookie:cancel.cookie}});assert.equal(exchangeCalls,1);
   assert.equal((await request('/api/auth/logout',{method:'POST',headers:{cookie,origin:'http://localhost:5173','x-csrf-token':me.csrfToken}})).status,204);
   assert.equal((await request('/api/auth/me',{headers:{cookie}})).status,401);
  }finally{await new Promise(r=>server.close(r));}
 });
});
