import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {withDatabase} from '../helpers/postgres.mjs';
test('write freeze blocks old deployment writes until explicit resume',async()=>{
 assert.equal(existsSync(new URL('../../supabase/operations/freeze_writes.sql',import.meta.url)),true,'release write-freeze operation must exist');
 await withDatabase(async({client})=>{
  const owner=(await client.query("SELECT id FROM users WHERE role='owner'")).rows[0].id;
  const freeze=await readFile(new URL('../../supabase/operations/freeze_writes.sql',import.meta.url),'utf8');
  const resume=await readFile(new URL('../../supabase/operations/resume_writes.sql',import.meta.url),'utf8');
  await client.query(freeze);await client.query('SET ROLE service_role');
  await assert.rejects(client.query("SELECT save_dictation($1,'blocked','exact',1,now())",[owner]),/permission denied/);
  await assert.rejects(client.query("DELETE FROM transcripts WHERE id=1"),/permission denied/);
  await assert.rejects(client.query("UPDATE transcripts SET text='blocked' WHERE id=1"),/permission denied/);
  await client.query('RESET ROLE');await client.query(resume);await client.query('SET ROLE service_role');
  await client.query("SELECT save_dictation($1,'saved safely','exact',1,now())",[owner]);
  assert.equal((await client.query('SELECT text FROM transcripts WHERE user_id=$1',[owner])).rows[0].text,'saved safely');
 });
});
