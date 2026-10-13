-- Run inside a transaction after SET LOCAL whispr.owner_email = 'verified-owner-email'.
-- Production writes must be paused before applying; old unscoped functions are removed.
DO $$ BEGIN
  IF coalesce(trim(current_setting('whispr.owner_email', true)), '') = '' THEN
    RAISE EXCEPTION 'whispr.owner_email is required';
  END IF;
END $$;

CREATE TABLE public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  google_subject text UNIQUE,
  email text NOT NULL,
  name text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('owner','user')),
  disabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (role <> 'owner' OR NOT disabled)
);
CREATE UNIQUE INDEX one_owner ON public.users(role) WHERE role = 'owner';
INSERT INTO public.users(email, role)
VALUES(lower(trim(current_setting('whispr.owner_email'))), 'owner');
ALTER TABLE public.transcripts ADD COLUMN user_id uuid REFERENCES public.users(id);
ALTER TABLE public.sessions ADD COLUMN user_id uuid REFERENCES public.users(id);
UPDATE public.transcripts SET user_id = (SELECT id FROM public.users WHERE role='owner');
UPDATE public.sessions SET user_id = (SELECT id FROM public.users WHERE role='owner');
ALTER TABLE public.transcripts ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.sessions ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE public.transcripts DROP CONSTRAINT transcripts_pkey;
ALTER TABLE public.transcripts ADD PRIMARY KEY(user_id,id);
CREATE INDEX sessions_user_id ON public.sessions(user_id);
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.users, public.transcripts, public.sessions FROM anon, authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.users, public.transcripts, public.sessions TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.sessions_id_seq TO service_role;
DROP FUNCTION public.save_dictation(text,text,double precision,timestamptz);
DROP FUNCTION public.get_stats();

CREATE FUNCTION public.save_dictation(p_user_id uuid, p_text text, p_mode text, p_duration double precision, p_timestamp timestamptz)
RETURNS jsonb LANGUAGE plpgsql SET search_path = public AS $$
DECLARE saved_transcript public.transcripts; saved_session public.sessions;
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'user ID is required'; END IF;
  IF p_text IS NULL OR length(trim(p_text)) = 0 OR p_mode IS NULL OR p_mode NOT IN ('exact','polished')
    OR p_duration IS NULL OR p_duration < 0 OR p_duration = 'Infinity'::float8 OR p_duration = 'NaN'::float8
    OR p_timestamp IS NULL THEN RAISE EXCEPTION 'invalid dictation'; END IF;
  INSERT INTO public.transcripts(user_id,id,text,mode,word_count,created_at,updated_at)
  VALUES(p_user_id,1,trim(p_text),p_mode,array_length(regexp_split_to_array(trim(p_text),'[[:space:]]+'),1),p_timestamp,p_timestamp)
  ON CONFLICT(user_id,id) DO UPDATE SET text=EXCLUDED.text, mode=EXCLUDED.mode,
    word_count=EXCLUDED.word_count, updated_at=EXCLUDED.updated_at
  RETURNING * INTO saved_transcript;
  INSERT INTO public.sessions(user_id,duration,word_count,status,created_at)
  VALUES(p_user_id,p_duration,saved_transcript.word_count,'success',p_timestamp)
  RETURNING * INTO saved_session;
  RETURN jsonb_build_object('transcript',to_jsonb(saved_transcript),'session',to_jsonb(saved_session));
END $$;
CREATE FUNCTION public.get_stats(p_user_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = public AS $$
BEGIN
  IF p_user_id IS NULL THEN RAISE EXCEPTION 'user ID is required'; END IF;
  RETURN (SELECT jsonb_build_object(
    'totalWords', coalesce(sum(word_count) FILTER(WHERE status='success'),0),
    'totalDurationSeconds',coalesce(sum(duration),0),
    'sessionCount',count(*),
    'successRate',coalesce(100.0*count(*) FILTER(WHERE status='success')/nullif(count(*),0),0)
  ) FROM public.sessions WHERE user_id=p_user_id);
END $$;
REVOKE ALL ON FUNCTION public.save_dictation(uuid,text,text,double precision,timestamptz) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_stats(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.save_dictation(uuid,text,text,double precision,timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_stats(uuid) TO service_role;
