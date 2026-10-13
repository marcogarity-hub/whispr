CREATE TABLE public.desktop_pairings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), secret_hash text NOT NULL,
 request_key text NOT NULL, user_id uuid REFERENCES public.users(id),
 created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, next_poll_at timestamptz NOT NULL
);
ALTER TABLE public.desktop_pairings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.desktop_pairings FROM anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.desktop_pairings TO service_role;
CREATE FUNCTION public.auth_start_pairing(p_secret_hash text,p_request_key text,p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE pairing public.desktop_pairings;
BEGIN
 PERFORM pg_advisory_xact_lock(212,4);
 DELETE FROM public.desktop_pairings WHERE expires_at<=p_now;
 IF (SELECT count(*) FROM public.desktop_pairings)>500 OR
 (SELECT count(*) FROM public.desktop_pairings WHERE request_key=p_request_key AND created_at>p_now-interval '1 minute')>=10 THEN RETURN NULL; END IF;
 INSERT INTO public.desktop_pairings(secret_hash,request_key,created_at,expires_at,next_poll_at)
 VALUES(p_secret_hash,p_request_key,p_now,p_now+interval '5 minutes',p_now) RETURNING * INTO pairing;
 RETURN jsonb_build_object('pairingId',pairing.id,'expiresAt',pairing.expires_at);
END $$;
CREATE FUNCTION public.auth_get_pairing(p_id uuid,p_now timestamptz) RETURNS jsonb LANGUAGE sql STABLE SET search_path=public AS $$
 SELECT jsonb_build_object('pairingId',id,'expiresAt',expires_at,'appName','Whispr desktop')
 FROM public.desktop_pairings WHERE id=p_id AND user_id IS NULL AND expires_at>p_now;
$$;
CREATE FUNCTION public.auth_approve_pairing(p_id uuid,p_user_id uuid,p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE result uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_user_id AND NOT disabled) THEN RETURN NULL; END IF;
 UPDATE public.desktop_pairings SET user_id=p_user_id WHERE id=p_id AND user_id IS NULL AND expires_at>p_now RETURNING id INTO result;
 IF result IS NULL THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('approved',true);
END $$;
CREATE FUNCTION public.auth_poll_pairing(p_id uuid,p_secret_hash text,p_now timestamptz,p_token_hash text,p_csrf_token text,p_expires_at timestamptz)
RETURNS jsonb LANGUAGE plpgsql SET search_path=public AS $$
DECLARE pairing public.desktop_pairings; account public.users;
BEGIN
 SELECT * INTO pairing FROM public.desktop_pairings WHERE id=p_id AND secret_hash=p_secret_hash FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('status','invalid'); END IF;
 IF pairing.expires_at<=p_now THEN DELETE FROM public.desktop_pairings WHERE id=p_id; RETURN jsonb_build_object('status','expired'); END IF;
 IF pairing.next_poll_at>p_now THEN RETURN jsonb_build_object('status','rate_limited'); END IF;
 IF pairing.user_id IS NULL THEN
  UPDATE public.desktop_pairings SET next_poll_at=p_now+interval '1 second' WHERE id=p_id;
  RETURN jsonb_build_object('status','pending');
 END IF;
 SELECT * INTO account FROM public.users WHERE id=pairing.user_id FOR UPDATE;
 DELETE FROM public.desktop_pairings WHERE id=p_id;
 IF account.disabled THEN RETURN jsonb_build_object('status','invalid'); END IF;
 PERFORM public.auth_issue_session(account.id,p_token_hash,p_csrf_token,'desktop',p_expires_at);
 RETURN jsonb_build_object('status','approved');
END $$;
DO $$ DECLARE routine record; BEGIN
 FOR routine IN SELECT oid::regprocedure signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('auth_start_pairing','auth_get_pairing','auth_approve_pairing','auth_poll_pairing') LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',routine.signature);
 EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',routine.signature);
 END LOOP;
END $$;
