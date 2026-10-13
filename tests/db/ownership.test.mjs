import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

// This catches data loss and unscoped SQL writes using actual PostgreSQL.
test('ownership migration preserves legacy rows and isolates two users', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'whispr-ownership-'));
  const database = new EmbeddedPostgres({ databaseDir: join(directory, 'db'), user: 'postgres', password: 'local-test-only', port: 55434, persistent: false, onLog: () => {}, onError: () => {} });
  let client;
  try {
    await database.initialise();
    await database.start();
    client = database.getPgClient();
    await client.connect();
    await client.query('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
    const migrations = new URL('../../supabase/migrations/', import.meta.url);
    await client.query(await readFile(new URL('20261008000000_init.sql', migrations), 'utf8'));
    await client.query("SELECT save_dictation('legacy words', 'exact', 3, '2026-10-08T00:00:00Z'); INSERT INTO sessions(duration,status,error_message,created_at) VALUES(2,'error','microphone','2026-10-08T00:00:01Z');");
    const before = (await client.query('SELECT text,created_at,updated_at FROM transcripts')).rows[0];
    const files = (await readdir(migrations)).filter(name => name.includes('user_ownership')).sort();
    if (files.length) {
      await client.query('BEGIN');
      await assert.rejects(client.query(await readFile(new URL(files[0], migrations), 'utf8')), /owner_email is required/);
      await client.query('ROLLBACK');
      assert.equal((await client.query("SELECT to_regclass('public.users') AS users")).rows[0].users, null);
      await client.query('BEGIN');
      await client.query("SELECT set_config('whispr.owner_email','owner@example.test',true)");
      await client.query(await readFile(new URL(files[0], migrations), 'utf8'));
      await client.query('ROLLBACK');
      assert.equal((await client.query("SELECT to_regclass('public.users') AS users")).rows[0].users, null);
      assert.equal((await client.query('SELECT count(*)::int n FROM sessions')).rows[0].n, 2);
    }
    for (const file of files) {
      await client.query('BEGIN');
      await client.query("SELECT set_config('whispr.owner_email','owner@example.test',true)");
      await client.query(await readFile(new URL(file, migrations), 'utf8'));
      await client.query('COMMIT');
    }
    assert.equal((await client.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='transcripts' AND column_name='user_id'")).rows[0].n, 1, 'transcripts must have an owner column');
    const owner = (await client.query("SELECT id FROM users WHERE role='owner'")).rows[0].id;
    assert.deepEqual((await client.query('SELECT text,created_at,updated_at FROM transcripts WHERE user_id=$1',[owner])).rows[0], before);
    assert.equal((await client.query('SELECT count(*)::int n FROM sessions WHERE user_id=$1',[owner])).rows[0].n, 2);
    const bob = (await client.query("INSERT INTO users(google_subject,email,name) VALUES('bob','bob@example.test','Bob') RETURNING id")).rows[0].id;
    assert.equal((await client.query('SELECT get_stats($1) AS stats',[bob])).rows[0].stats.sessionCount, 0);
    await client.query("SELECT save_dictation($1,'bob words','exact',4,'2026-10-13T00:00:00Z')",[bob]);
    assert.equal((await client.query('SELECT count(*)::int n FROM transcripts')).rows[0].n, 2);
    assert.equal((await client.query('SELECT text FROM transcripts WHERE user_id=$1',[owner])).rows[0].text, 'legacy words');
    assert.equal((await client.query('SELECT get_stats($1) AS stats',[owner])).rows[0].stats.sessionCount, 2);
    assert.equal((await client.query('SELECT get_stats($1) AS stats',[bob])).rows[0].stats.totalWords, 2);
    assert.equal((await client.query("SELECT to_regprocedure('public.get_stats()') AS old")).rows[0].old, null);
    assert.equal((await client.query("SELECT has_function_privilege('anon','public.get_stats(uuid)','execute') AS allowed")).rows[0].allowed, false);
    await assert.rejects(client.query("SELECT save_dictation(NULL,'bad','exact',1,now())"), /user/i);
  } finally {
    await client?.end();
    await database.stop();
  }
});
