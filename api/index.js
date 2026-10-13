// Supabase service-role credentials remain server-only in server/bootstrap.cjs.
const {bootstrap}=require('../server/bootstrap.cjs');
if(!process.env.VERCEL_GIT_COMMIT_SHA) throw new Error('VERCEL_GIT_COMMIT_SHA is required');
module.exports=bootstrap();
