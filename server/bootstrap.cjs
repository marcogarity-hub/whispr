const {createClient}=require('@supabase/supabase-js');
const {createRepository}=require('./repository.cjs');
const {createAuthStore}=require('./auth-store.cjs');
const {createGoogleOAuth}=require('./google-oauth.cjs');
const {createApp}=require('./app.cjs');
function bootstrap(environment=process.env) {
 for(const name of ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','APP_ORIGIN','OWNER_EMAIL']) if(!environment[name])throw new Error(`${name} is required`);
 const client=createClient(environment.SUPABASE_URL,environment.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
 return createApp({repository:createRepository(client),authStore:createAuthStore(client),google:createGoogleOAuth({clientId:environment.GOOGLE_CLIENT_ID,clientSecret:environment.GOOGLE_CLIENT_SECRET,appOrigin:environment.APP_ORIGIN}),appOrigin:environment.APP_ORIGIN,commit:environment.VERCEL_GIT_COMMIT_SHA || 'local'});
}
module.exports={bootstrap};
