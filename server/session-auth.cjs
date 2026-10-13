const {timingSafeEqual}=require('node:crypto');
const {wrap}=require('./routes.cjs');
function readCookie(request,name) {
 const values=(request.get('cookie') || '').split(';').map(v=>v.trim()).filter(v=>v.startsWith(`${name}=`));
 return values.length===1?values[0].slice(name.length+1):'';
}
function cookieOptions(appOrigin,maxAge) {return {httpOnly:true,sameSite:'lax',secure:appOrigin.startsWith('https:'),path:'/',maxAge};}
function createSessionAuth({store,appOrigin}) {
 const authenticate=wrap(async(request,response,next)=>{
  const header=request.get('authorization');
  const bearer=header?.startsWith('Bearer ');
  const token=bearer?header.slice(7):readCookie(request,'whispr_session');
  if(header && !bearer) return response.status(401).json({error:'Sign in required'});
  const session=await store.resolveSession(token);
  if(!session || session.kind!==(bearer?'desktop':'browser')) return response.status(401).json({error:'Sign in required'});
  request.user=session.user;request.auth={...session,token,bearer};
  return next();
 });
 function csrf(request,response,next) {
  if(request.auth?.bearer) return next();
  const actual=request.get('x-csrf-token') || '';
  const expected=request.auth?.csrfToken || '';
  if(request.get('origin')!==appOrigin || !actual || Buffer.byteLength(actual)!==Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(actual),Buffer.from(expected))) return response.status(403).json({error:'Request verification failed'});
  return next();
 }
 function owner(request,response,next) {
  if(request.user?.role!=='owner') return response.status(403).json({error:'Owner access required'});
  return next();
 }
 return {authenticate,csrf,owner};
}
module.exports={createSessionAuth,readCookie,cookieOptions};
