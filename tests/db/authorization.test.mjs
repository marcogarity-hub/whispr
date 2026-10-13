import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {withDatabase} from '../helpers/postgres.mjs';
const require=createRequire(import.meta.url);
const {createApp}=require('../../server/app.cjs');
const {createAuthStore}=require('../../server/auth-store.cjs');
const {createRepository}=require('../../server/repository.cjs');
const {databaseClient}=require('../helpers/postgres-client.cjs');
test('server isolates data, refuses owner actions with 403, and revokes disabled users',async()=>{
 await withDatabase(async({client,rpcClient})=>{
  const store=createAuthStore(rpcClient);
  const owner=await store.bindIdentity({subject:'owner',email:'owner@example.test',emailVerified:true,name:'Owner'});
  const bob=await store.bindIdentity({subject:'bob',email:'bob@example.test',emailVerified:true,name:'Bob'});
  const ownerSession=await store.issueSession(owner.id,{kind:'browser'});
  const bobSession=await store.issueSession(bob.id,{kind:'browser'});
  const ownerAuth=await store.resolveSession(ownerSession.token),bobAuth=await store.resolveSession(bobSession.token);
  const headers=(session,auth)=>({cookie:`whispr_session=${session.token}`,origin:'http://localhost:5173','x-csrf-token':auth.csrfToken,'content-type':'application/json'});
  const app=createApp({repository:createRepository(databaseClient(client,rpcClient)),authStore:store,google:{},appOrigin:'http://localhost:5173',commit:'test'});
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base=`http://127.0.0.1:${server.address().port}`;
  const request=(path,options)=>fetch(base+path,options);
  try {
   assert.equal((await request('/api/transcript')).status,401);
   assert.equal((await request('/api/transcript',{headers:{authorization:'Basic c3R1ZGVudDpwYXNz'}})).status,401);
   let r=await request('/api/dictations',{method:'POST',headers:headers(ownerSession,ownerAuth),body:JSON.stringify({text:'owner words',mode:'exact',duration:1,userId:bob.id})});assert.equal(r.status,201);
   assert.equal((await request('/api/transcript',{headers:headers(bobSession,bobAuth)})).status,404);
   assert.equal((await request('/api/stats',{headers:headers(bobSession,bobAuth)})).status,200);
   assert.equal((await request('/api/users',{headers:headers(bobSession,bobAuth)})).status,403);
   assert.equal((await request(`/api/users/${owner.id}/disable`,{method:'POST',headers:headers(bobSession,bobAuth)})).status,403);
   assert.equal((await request(`/api/users/${owner.id}/disable`,{method:'POST',headers:headers(ownerSession,ownerAuth)})).status,403);
   assert.equal((await request(`/api/users/${bob.id}/disable`,{method:'POST',headers:headers(ownerSession,ownerAuth)})).status,200);
   assert.equal((await request('/api/stats',{headers:headers(bobSession,bobAuth)})).status,401);
   r=await request('/api/transcript',{headers:headers(ownerSession,ownerAuth)});assert.equal((await r.json()).text,'owner words');
   assert.equal((await request('/api/users/not-a-uuid/disable',{method:'POST',headers:headers(ownerSession,ownerAuth)})).status,400);
   assert.equal((await request('/api/users/11111111-1111-4111-8111-111111111111/disable',{method:'POST',headers:headers(ownerSession,ownerAuth)})).status,404);
  }finally{await new Promise(r=>server.close(r));}
 });
});
