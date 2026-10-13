const test=require('node:test');
const assert=require('node:assert/strict');
let createGoogleOAuth;
try { ({createGoogleOAuth}=require('../server/google-oauth.cjs')); } catch(error) {if(error.code!=='MODULE_NOT_FOUND') throw error;}
const config={clientId:'client.test',clientSecret:'test-only',appOrigin:'http://localhost:5173'};
test('Google login requests only identity scopes with PKCE and fixed callback',()=>{
 assert.equal(typeof createGoogleOAuth,'function');
 const oauth=createGoogleOAuth(config);
 const url=new URL(oauth.authorizationUrl({state:'state',nonce:'nonce',verifier:'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'}));
 assert.equal(url.origin,'https://accounts.google.com');
 assert.equal(url.searchParams.get('scope'),'openid email profile');
 assert.equal(url.searchParams.get('redirect_uri'),'http://localhost:5173/api/auth/google/callback');
 assert.equal(url.searchParams.get('code_challenge_method'),'S256');
 assert.equal(url.searchParams.get('code_challenge'),'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
 assert.equal(url.searchParams.get('access_type'),'online');
 assert.equal(url.searchParams.get('nonce'),'nonce');
});
test('Google exchange rejects wrong nonce, audience, issuer, expiry or unverified email',async()=>{
 assert.equal(typeof createGoogleOAuth,'function');
 const payload={sub:'subject',email:'user@example.test',email_verified:true,name:'User',nonce:'nonce',aud:'client.test',iss:'https://accounts.google.com',exp:9999999999};
 const transport={async getToken(options){assert.equal(options.codeVerifier,'verifier');return {tokens:{id_token:'provider-token'}};},async verifyIdToken(options){assert.equal(options.audience,'client.test');return {getPayload:()=>payload};}};
 const oauth=createGoogleOAuth({...config,transport});
 assert.deepEqual(await oauth.exchangeAndVerify({code:'code',nonce:'nonce',verifier:'verifier'}),{subject:'subject',email:'user@example.test',emailVerified:true,name:'User'});
 for(const [key,bad] of [['nonce','wrong'],['aud','wrong'],['iss','https://evil.test'],['exp',1],['email_verified',false]]) {
   const previous=payload[key];payload[key]=bad;
   await assert.rejects(oauth.exchangeAndVerify({code:'code',nonce:'nonce',verifier:'verifier'}));
   payload[key]=previous;
 }
});
