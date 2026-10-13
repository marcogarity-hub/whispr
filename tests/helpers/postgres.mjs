import { readFile, readdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
export async function withDatabase(run,{ownerEmail='owner@example.test'}={}) {
  const directory=await mkdtemp(join(tmpdir(),'whispr-auth-'));
  const database=new EmbeddedPostgres({databaseDir:join(directory,'db'),user:'postgres',password:'local-test-only',port:55435,persistent:false,onLog:()=>{},onError:()=>{}});
  let client;
  try {
    await database.initialise(); await database.start();
    client=database.getPgClient(); await client.connect();
    await client.query('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS');
    const dir=new URL('../../supabase/migrations/',import.meta.url);
    for(const name of (await readdir(dir)).filter(n=>n.endsWith('.sql')).sort()) {
      await client.query('BEGIN');
      await client.query("SELECT set_config('whispr.owner_email',$1,true)",[ownerEmail]);
      await client.query(await readFile(new URL(name,dir),'utf8'));
      await client.query('COMMIT');
    }
    // Exercise the same RPC boundary as Supabase with real SQL transactions.
    const rpcClient={async rpc(name,args={}) {
      if(!/^[a-z_]+$/.test(name)) throw new Error('Invalid RPC');
      try {
        const values=Object.values(args);
        const placeholders=Object.keys(args).map((key,i)=>`${key} => $${i+1}`).join(',');
        const result=await client.query(`SELECT public.${name}(${placeholders}) AS value`,values);
        return {data:result.rows[0].value,error:null};
      } catch(error) { return {data:null,error}; }
    }};
    await run({client,rpcClient,newClient:()=>database.getPgClient()});
  } finally {await client?.end();await database.stop();}
}
