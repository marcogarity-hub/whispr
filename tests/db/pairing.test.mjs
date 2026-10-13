import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {withDatabase} from '../helpers/postgres.mjs';
const require=createRequire(import.meta.url);
const {createAuthStore,hashToken}=require('../../server/auth-store.cjs');
test('desktop pairing requires approval and delivers one revocable credential',async()=>{
 await withDatabase(async({rpcClient,client,newClient})=>{
  let now=new Date();const store=createAuthStore(rpcClient,{clock:()=>now});
  assert.equal(typeof store.startPairing,'function','pairing must be implemented');
  const user=await store.bindIdentity({subject:'bob',email:'bob@example.test',emailVerified:true,name:'Bob'});
  const pairing=await store.startPairing('local-device');
  assert.equal(JSON.stringify(await store.getPairing(pairing.pairingId)).includes(pairing.pollSecret),false);
  assert.equal((await store.pollPairing(pairing.pairingId,'wrong')).status,'invalid');
  assert.equal((await store.pollPairing(pairing.pairingId,pairing.pollSecret)).status,'pending');
  assert.equal((await store.pollPairing(pairing.pairingId,pairing.pollSecret)).status,'rate_limited');
  await store.approvePairing(pairing.pairingId,user.id);
  now=new Date(now.getTime()+1500);
  const result=await store.pollPairing(pairing.pairingId,pairing.pollSecret);
  assert.equal(result.status,'approved');assert.ok(result.token);
  assert.equal((await store.resolveSession(result.token)).kind,'desktop');
  assert.equal((await store.pollPairing(pairing.pairingId,pairing.pollSecret)).status,'invalid');
  assert.equal((await client.query('SELECT count(*)::int n FROM auth_sessions WHERE token_hash=$1',[result.token])).rows[0].n,0);
  await store.disableUser(user.id);assert.equal(await store.resolveSession(result.token),null);
  await store.restoreUser(user.id);
  const racing=await store.startPairing('local-device');await store.approvePairing(racing.pairingId,user.id);
  const second=newClient();await second.connect();
  try {
   const outcomes=await Promise.all([
    store.pollPairing(racing.pairingId,racing.pollSecret),
    second.query('SELECT auth_poll_pairing($1,$2,$3,$4,$5,$6) AS value',[racing.pairingId,hashToken(racing.pollSecret),now.toISOString(),'a'.repeat(64),'csrf',new Date(now.getTime()+86400000).toISOString()]).then(r=>r.rows[0].value)
   ]);
   assert.deepEqual(outcomes.map(r=>r.status).sort(),['approved','invalid']);
  }finally{await second.end();}
  const expired=await store.startPairing('local-device');now=new Date(now.getTime()+300000);
  assert.equal(await store.approvePairing(expired.pairingId,user.id),null);
  assert.equal((await store.pollPairing(expired.pairingId,expired.pollSecret)).status,'expired');
 });
});
