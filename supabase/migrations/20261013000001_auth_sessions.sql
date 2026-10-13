CREATE TABLE public.auth_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.users(id),
 token_hash text NOT NULL UNIQUE CHECK(length(token_hash)=64),
 csrf_token text NOT NULL, kind text NOT NULL CHECK(kind IN ('browser','desktop')),
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_sessions_user_id ON public.auth_sessions(user_id);
ALTER TABLE public.auth_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.auth_sessions FROM anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.auth_sessions TO service_role;

CREATE FUNCTION public.auth_bind_identity(p_subject text,p_email text,p_verified boolean,p_name text)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE account public.users; reserved public.users;
BEGIN
 IF p_verified IS DISTINCT FROM true OR coalesce(p_subject,'')='' OR coalesce(p_email,'')='' THEN RAISE EXCEPTION 'Verified identity required'; END IF;
 PERFORM pg_advisory_xact_lock(212,3);
 SELECT * INTO account FROM public.users WHERE google_subject=p_subject FOR UPDATE;
 IF FOUND THEN
   IF account.disabled THEN RAISE EXCEPTION 'Account disabled'; END IF;
   UPDATE public.users SET email=lower(p_email),name=coalesce(p_name,'') WHERE id=account.id RETURNING * INTO account;
 ELSE
   SELECT * INTO reserved FROM public.users WHERE role='owner' FOR UPDATE;
   IF lower(p_email)=reserved.email THEN
     IF reserved.google_subject IS NOT NULL THEN RAISE EXCEPTION 'Owner identity already bound'; END IF;
     UPDATE public.users SET google_subject=p_subject,name=coalesce(p_name,'') WHERE id=reserved.id RETURNING * INTO account;
   ELSE
     INSERT INTO public.users(google_subject,email,name) VALUES(p_subject,lower(p_email),coalesce(p_name,'')) RETURNING * INTO account;
   END IF;
 END IF;
 RETURN jsonb_build_object('id',account.id,'email',account.email,'name',account.name,'role',account.role,'disabled',account.disabled);
END $$;
CREATE FUNCTION public.auth_issue_session(p_user_id uuid,p_token_hash text,p_csrf_token text,p_kind text,p_expires_at timestamptz)
RETURNS uuid LANGUAGE plpgsql SET search_path=public AS $$
DECLARE account public.users; session_id uuid;
BEGIN
 SELECT * INTO account FROM public.users WHERE id=p_user_id FOR UPDATE;
 IF NOT FOUND OR account.disabled THEN RAISE EXCEPTION 'Account unavailable'; END IF;
 INSERT INTO public.auth_sessions(user_id,token_hash,csrf_token,kind,expires_at)
 VALUES(p_user_id,p_token_hash,p_csrf_token,p_kind,p_expires_at) RETURNING id INTO session_id;
 RETURN session_id;
END $$;
CREATE FUNCTION public.auth_resolve_session(p_token_hash text,p_now timestamptz)
RETURNS jsonb LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT jsonb_build_object('sessionId',s.id,'kind',s.kind,'csrfToken',s.csrf_token,
 'user',jsonb_build_object('id',u.id,'email',u.email,'name',u.name,'role',u.role,'disabled',u.disabled))
 FROM public.auth_sessions s JOIN public.users u ON u.id=s.user_id
 WHERE s.token_hash=p_token_hash AND s.expires_at>p_now AND NOT u.disabled;
$$;
CREATE FUNCTION public.auth_revoke_session(p_token_hash text) RETURNS void LANGUAGE sql SET search_path=public AS $$
 DELETE FROM public.auth_sessions WHERE token_hash=p_token_hash;
$$;
CREATE FUNCTION public.auth_set_disabled(p_user_id uuid,p_disabled boolean) RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE account public.users;
BEGIN
 SELECT * INTO account FROM public.users WHERE id=p_user_id FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF account.role='owner' THEN RAISE EXCEPTION 'Owner cannot be disabled'; END IF;
 UPDATE public.users SET disabled=p_disabled WHERE id=p_user_id RETURNING * INTO account;
 IF p_disabled THEN DELETE FROM public.auth_sessions WHERE user_id=p_user_id; END IF;
 RETURN jsonb_build_object('id',account.id,'email',account.email,'name',account.name,'role',account.role,'disabled',account.disabled);
END $$;
CREATE FUNCTION public.auth_list_users() RETURNS jsonb LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'email',email,'name',name,'role',role,'disabled',disabled) ORDER BY created_at),'[]'::jsonb) FROM public.users;
$$;
DO $$ DECLARE routine record; BEGIN
 FOR routine IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('auth_bind_identity','auth_issue_session','auth_resolve_session','auth_revoke_session','auth_set_disabled','auth_list_users') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',routine.signature);
 EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',routine.signature);
 END LOOP;
END $$;
