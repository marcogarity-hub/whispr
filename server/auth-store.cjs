const { randomBytes, createHash } = require('node:crypto');
const randomToken = () => randomBytes(32).toString('base64url');
const hashToken = token => createHash('sha256').update(token).digest('hex');
function createAuthStore(client, { clock = () => new Date() } = {}) {
  async function call(name,args) {
    const {data,error}=await client.rpc(name,args);
    if(error) throw error;
    return data;
  }
  return {
    async startPairing(requestKey) {
      const pollSecret=randomToken();
      const pairing=await call('auth_start_pairing',{p_secret_hash:hashToken(pollSecret),p_request_key:hashToken(requestKey),p_now:clock().toISOString()});
      return pairing?{...pairing,pollSecret}:null;
    },
    getPairing(id) {return call('auth_get_pairing',{p_id:id,p_now:clock().toISOString()});},
    approvePairing(id,userId) {return call('auth_approve_pairing',{p_id:id,p_user_id:userId,p_now:clock().toISOString()});},
    async pollPairing(id,secret) {
      const token=randomToken(),expiresAt=new Date(clock().getTime()+7*86400000).toISOString();
      const result=await call('auth_poll_pairing',{p_id:id,p_secret_hash:hashToken(secret),p_now:clock().toISOString(),p_token_hash:hashToken(token),p_csrf_token:randomToken(),p_expires_at:expiresAt});
      return result.status==='approved'?{...result,token,expiresAt}:result;
    },
    saveOAuthTransaction({state,binding,nonce,verifier,expiresAt}) {
      return call('auth_save_oauth',{p_state_hash:hashToken(state),p_browser_hash:hashToken(binding),p_nonce:nonce,p_verifier:verifier,p_expires_at:expiresAt});
    },
    consumeOAuthTransaction({state,binding}) {
      return call('auth_consume_oauth',{p_state_hash:hashToken(state),p_browser_hash:hashToken(binding),p_now:clock().toISOString()});
    },
    bindIdentity({subject,email,emailVerified,name}) {
      return call('auth_bind_identity',{p_subject:subject,p_email:email,p_verified:emailVerified,p_name:name || ''});
    },
    async issueSession(userId,{kind}) {
      const token=randomToken();
      const csrfToken=randomToken();
      const expiresAt=new Date(clock().getTime()+7*24*60*60*1000).toISOString();
      await call('auth_issue_session',{p_user_id:userId,p_token_hash:hashToken(token),p_csrf_token:csrfToken,p_kind:kind,p_expires_at:expiresAt});
      return {token,expiresAt};
    },
    resolveSession(token) {
      if(typeof token!=='string' || !/^[\w-]{43}$/.test(token)) return Promise.resolve(null);
      return call('auth_resolve_session',{p_token_hash:hashToken(token),p_now:clock().toISOString()});
    },
    revokeSession(token) {return call('auth_revoke_session',{p_token_hash:hashToken(token)});},
    disableUser(id) {return call('auth_set_disabled',{p_user_id:id,p_disabled:true});},
    restoreUser(id) {return call('auth_set_disabled',{p_user_id:id,p_disabled:false});},
    listUsers() {return call('auth_list_users',{});}
  };
}
module.exports={createAuthStore,hashToken,randomToken};
