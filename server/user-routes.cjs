const express=require('express');
const {wrap}=require('./routes.cjs');
function createUserRoutes({store,auth}) {
 const router=express.Router();
 router.use('/api/users',auth.authenticate,auth.owner);
 router.get('/api/users',wrap(async(_q,r)=>r.json(await store.listUsers())));
 for(const action of ['disable','restore']) router.post(`/api/users/:id/${action}`,auth.csrf,wrap(async(q,r)=>{
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q.params.id))return r.status(400).json({error:'Invalid user ID'});
  if(q.params.id===q.user.id) return r.status(403).json({error:'Owner account cannot be changed'});
  const user=await (action==='disable'?store.disableUser(q.params.id):store.restoreUser(q.params.id));
  return user?r.json(user):r.status(404).json({error:'User not found'});
 }));
 return router;
}
module.exports={createUserRoutes};
