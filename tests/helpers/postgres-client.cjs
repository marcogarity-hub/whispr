// Minimal PostgREST adapter issues actual SQL, not canned rows.
function databaseClient(client,rpcClient) {
 return { ...rpcClient,from(table) {
  if(!['transcripts','sessions'].includes(table)) throw new Error('Unexpected table');
  let action='select',values={},filters=[];
  const builder={select(){return builder;},eq(k,v){filters.push([k,v]);return builder;},update(v){action='update';values=v;return builder;},delete(){action='delete';return builder;},insert(v){action='insert';values=v;return builder;},
   async execute(single=false) {
    try {
     const params=[];const bind=v=>{params.push(v);return `$${params.length}`;};
     let sql;
     if(action==='insert')sql=`INSERT INTO ${table}(${Object.keys(values).join(',')}) VALUES(${Object.values(values).map(bind).join(',')}) RETURNING *`;
     else {const set=action==='update'?` SET ${Object.entries(values).map(([k,v])=>`${k}=${bind(v)}`).join(',')}`:'';const where=filters.map(([k,v])=>`${k}=${bind(v)}`).join(' AND ');sql=`${action==='select'?'SELECT * FROM':action==='delete'?'DELETE FROM':'UPDATE'} ${table}${set}${where?' WHERE '+where:''}${action==='select'?'':' RETURNING *'}`;}
     const result=await client.query(sql,params);return {data:single?(result.rows[0] || null):result.rows,error:null};
    }catch(error){return {data:null,error};}
   },maybeSingle(){return builder.execute(true);},single(){return builder.execute(true);},then(resolve,reject){return builder.execute().then(resolve,reject);}};
  return builder;
 }};
}

module.exports={databaseClient};
