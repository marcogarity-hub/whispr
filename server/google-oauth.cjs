const {createHash}=require('node:crypto');
const {OAuth2Client}=require('google-auth-library');
function createGoogleOAuth({clientId,clientSecret,appOrigin,transport}) {
 const origin=new URL(appOrigin);
 if(origin.origin!==appOrigin || (origin.protocol!=='https:' && appOrigin!=='http://localhost:5173')) throw new Error('Invalid application origin');
 if(!clientId || !clientSecret) throw new Error('Google credentials required');
 const redirectUri=`${appOrigin}/api/auth/google/callback`;
 const client=transport || new OAuth2Client(clientId,clientSecret,redirectUri);
 return {
  authorizationUrl({state,nonce,verifier}) {
   const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
   url.search=new URLSearchParams({client_id:clientId,redirect_uri:redirectUri,response_type:'code',scope:'openid email profile',state,nonce,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',access_type:'online'}).toString();
   return url.toString();
  },
  async exchangeAndVerify({code,nonce,verifier}) {
   const {tokens}=await client.getToken({code,codeVerifier:verifier,redirect_uri:redirectUri});
   if(!tokens.id_token) throw new Error('Identity token missing');
   const ticket=await client.verifyIdToken({idToken:tokens.id_token,audience:clientId});
   const payload=ticket.getPayload();
   if(!payload || payload.nonce!==nonce || payload.aud!==clientId || !['accounts.google.com','https://accounts.google.com'].includes(payload.iss) || !Number.isFinite(payload.exp) || payload.exp<=Date.now()/1000 || payload.email_verified!==true || !payload.email || !payload.sub) throw new Error('Invalid Google identity');
   return {subject:payload.sub,email:payload.email,emailVerified:true,name:payload.name || ''};
  }
 };
}
module.exports={createGoogleOAuth};
