CREATE TABLE public.oauth_transactions (
 state_hash text PRIMARY KEY, browser_hash text NOT NULL,
 nonce text NOT NULL, verifier text NOT NULL, expires_at timestamptz NOT NULL
);
ALTER TABLE public.oauth_transactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.oauth_transactions FROM anon,authenticated;
GRANT SELECT,INSERT,DELETE ON public.oauth_transactions TO service_role;
CREATE FUNCTION public.auth_save_oauth(p_state_hash text,p_browser_hash text,p_nonce text,p_verifier text,p_expires_at timestamptz)
RETURNS void LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 DELETE FROM public.oauth_transactions WHERE expires_at<now();
 INSERT INTO public.oauth_transactions VALUES(p_state_hash,p_browser_hash,p_nonce,p_verifier,p_expires_at);
END $$;
CREATE FUNCTION public.auth_consume_oauth(p_state_hash text,p_browser_hash text,p_now timestamptz)
RETURNS jsonb LANGUAGE sql SET search_path=public AS $$
 WITH consumed AS (DELETE FROM public.oauth_transactions WHERE state_hash=p_state_hash AND browser_hash=p_browser_hash AND expires_at>p_now RETURNING nonce,verifier)
 SELECT to_jsonb(consumed) FROM consumed;
$$;
REVOKE ALL ON FUNCTION public.auth_save_oauth(text,text,text,text,timestamptz),public.auth_consume_oauth(text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.auth_save_oauth(text,text,text,text,timestamptz),public.auth_consume_oauth(text,text,timestamptz) TO service_role;
