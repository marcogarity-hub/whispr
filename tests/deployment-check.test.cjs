const test=require('node:test');const assert=require('node:assert/strict');
let checkDeployment;try{({checkDeployment}=require('../scripts/check-deployment.cjs'));}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}
test('release smoke check rejects stale versions and unprotected APIs',async()=>{
 assert.equal(typeof checkDeployment,'function');
 let commit='abc123',protectedStatus=401,healthStatus=200,challenge='';
 const fetchImpl=async url=>new Response(JSON.stringify(url.endsWith('/api/version')?{commit}:{ok:true}),{status:url.endsWith('/api/health')?healthStatus:url.endsWith('/api/version')?200:protectedStatus,headers:challenge?{'www-authenticate':challenge}:{}});
 await checkDeployment('https://example.test','abc123',{fetchImpl});
 commit='old';await assert.rejects(checkDeployment('https://example.test','abc123',{fetchImpl}),/commit/i);commit='abc123';
 protectedStatus=200;await assert.rejects(checkDeployment('https://example.test','abc123',{fetchImpl}),/401/);protectedStatus=401;
 healthStatus=500;await assert.rejects(checkDeployment('https://example.test','abc123',{fetchImpl}),/health/i);healthStatus=200;
 challenge='Basic realm="Whispr"';await assert.rejects(checkDeployment('https://example.test','abc123',{fetchImpl}),/Basic/);
});
