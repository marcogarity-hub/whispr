import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { withDatabase } from '../helpers/postgres.mjs';
const require=createRequire(import.meta.url);
let createAuthStore;
try { ({createAuthStore}=require('../../server/auth-store.cjs')); } catch(error) { if(error.code!=='MODULE_NOT_FOUND') throw error; }

test('identity binding, session expiry, owner protection and revocation use real transactions',async()=>{
  assert.equal(typeof createAuthStore,'function','authentication store must exist');
  await withDatabase(async({client,rpcClient,newClient})=>{
    let now=new Date('2026-10-13T00:00:00Z');
    const store=createAuthStore(rpcClient,{clock:()=>now});
    await assert.rejects(store.bindIdentity({subject:'evil',email:'owner@example.test',emailVerified:false,name:'Evil'}));
    await client.query('SET ROLE service_role');
    const concurrent=newClient();await concurrent.connect();
    let owner;
    try {
      const results=await Promise.all([
        store.bindIdentity({subject:'owner-subject',email:'owner@example.test',emailVerified:true,name:'Owner'}),
        concurrent.query("SELECT auth_bind_identity('owner-subject','owner@example.test',true,'Owner') AS account")
      ]);
      owner=results[0];assert.equal(results[1].rows[0].account.id,owner.id);
    } finally {await concurrent.end();}
    assert.equal((await client.query("SELECT count(*)::int n FROM users WHERE role='owner'")).rows[0].n,1);
    assert.equal(owner.role,'owner');
    const bob=await store.bindIdentity({subject:'bob',email:'bob@example.test',emailVerified:true,name:'Bob'});
    assert.equal(bob.role,'user');
    const changed=await store.bindIdentity({subject:'bob',email:'changed@example.test',emailVerified:true,name:'Bob'});
    assert.equal(changed.id,bob.id);
    await assert.rejects(store.bindIdentity({subject:'different-owner',email:'owner@example.test',emailVerified:true,name:'Other'}));
    const session=await store.issueSession(bob.id,{kind:'browser'});
    assert.equal((await store.resolveSession(session.token)).user.id,bob.id);
    const row=(await client.query('SELECT token_hash FROM auth_sessions WHERE user_id=$1',[bob.id])).rows[0];
    assert.notEqual(row.token_hash,session.token);
    assert.equal(row.token_hash.length,64);
    now=new Date('2026-10-20T00:00:00Z');
    assert.equal(await store.resolveSession(session.token),null);
    now=new Date('2026-10-13T00:00:00Z');
    const desktop=await store.issueSession(bob.id,{kind:'desktop'});
    await store.disableUser(bob.id);
    assert.equal(await store.resolveSession(desktop.token),null);
    await store.restoreUser(bob.id);
    assert.equal(await store.resolveSession(desktop.token),null);
    await assert.rejects(store.disableUser(owner.id));
    const next=await store.issueSession(bob.id,{kind:'browser'});
    await store.revokeSession(next.token);
    assert.equal(await store.resolveSession(next.token),null);
    assert.equal((await store.listUsers()).length,2);
    const listed=JSON.stringify(await store.listUsers());
    assert.equal(listed.includes('owner-subject'),false);
    assert.equal(listed.includes('token_hash'),false);
  });
});
