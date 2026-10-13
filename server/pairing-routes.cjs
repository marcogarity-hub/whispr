const express=require('express');const {wrap}=require('./routes.cjs');
const validId=value=>typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
function createPairingRoutes({store,auth,appOrigin}) {
 const router=express.Router();
 router.post('/api/auth/pairing/start',wrap(async(q,r)=>{
  if(q.get('origin') && q.get('origin')!==appOrigin)return r.status(403).json({error:'Invalid origin'});
  const pairing=await store.startPairing(q.ip || 'unknown');
  return pairing?r.json({...pairing,approvalUrl:`${appOrigin}/?pairing=${pairing.pairingId}`}):r.status(429).json({error:'Too many sign-in requests. Try again shortly.'});
 }));
 router.get('/api/auth/pairing/approve',auth.authenticate,wrap(async(q,r)=>{
  if(!validId(q.query.id))return r.status(400).json({error:'Invalid pairing ID'});
  const pairing=await store.getPairing(q.query.id);
  return pairing?r.json(pairing):r.status(404).json({error:'Pairing expired or already approved'});
 }));
 router.post('/api/auth/pairing/approve',auth.authenticate,auth.csrf,wrap(async(q,r)=>{
  if(q.auth.bearer)return r.status(403).json({error:'Approve in your browser'});
  if(!validId(q.body?.pairingId))return r.status(400).json({error:'Invalid pairing ID'});
  const result=await store.approvePairing(q.body.pairingId,q.user.id);
  return result?r.json(result):r.status(404).json({error:'Pairing expired or already approved'});
 }));
 router.post('/api/auth/pairing/poll',wrap(async(q,r)=>{
  if(!validId(q.body?.pairingId) || typeof q.body?.pollSecret!=='string' || !/^[\w-]{43}$/.test(q.body.pollSecret))return r.status(400).json({error:'Invalid pairing request'});
  const result=await store.pollPairing(q.body.pairingId,q.body.pollSecret);
  return r.status(result.status==='rate_limited'?429:result.status==='invalid' || result.status==='expired'?404:200).json(result);
 }));
 return router;
}
module.exports={createPairingRoutes};
