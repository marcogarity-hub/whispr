const express=require('express');
const {randomToken}=require('./auth-store.cjs');
const {readCookie,cookieOptions}=require('./session-auth.cjs');
const {wrap}=require('./routes.cjs');
function createAuthRoutes({store,google,auth,appOrigin,clock=()=>new Date()}) {
 const router=express.Router();
 router.get('/api/auth/google/start',wrap(async(request,response)=>{
  const state=randomToken(),binding=randomToken(),nonce=randomToken(),verifier=randomToken();
  await store.saveOAuthTransaction({state,binding,nonce,verifier,expiresAt:new Date(clock().getTime()+600000).toISOString()});
  response.cookie('whispr_oauth',binding,cookieOptions(appOrigin,600000));
  return response.redirect(google.authorizationUrl({state,nonce,verifier}));
 }));
 router.get('/api/auth/google/callback',wrap(async(request,response)=>{
  const binding=readCookie(request,'whispr_oauth');
  response.clearCookie('whispr_oauth',cookieOptions(appOrigin));
  try {
   const state=typeof request.query.state==='string'?request.query.state:'';
   if(!/^[\w-]{43}$/.test(state) || !/^[\w-]{43}$/.test(binding)) throw new Error('Invalid state');
   const transaction=await store.consumeOAuthTransaction({state,binding});
   if(!transaction || request.query.error || typeof request.query.code!=='string') throw new Error('Invalid transaction');
   const identity=await google.exchangeAndVerify({code:request.query.code,nonce:transaction.nonce,verifier:transaction.verifier});
   const user=await store.bindIdentity(identity);
   const session=await store.issueSession(user.id,{kind:'browser'});
   response.cookie('whispr_session',session.token,cookieOptions(appOrigin,7*86400000));
   return response.redirect('/');
  } catch {return response.redirect('/?authError=sign-in-failed');}
 }));
 router.get('/api/auth/me',auth.authenticate,(request,response)=>response.json({user:request.user,csrfToken:request.auth.csrfToken}));
 router.post('/api/auth/logout',auth.authenticate,auth.csrf,wrap(async(request,response)=>{
  await store.revokeSession(request.auth.token);
  response.clearCookie('whispr_session',cookieOptions(appOrigin));
  return response.status(204).end();
 }));
 return router;
}
module.exports={createAuthRoutes};
