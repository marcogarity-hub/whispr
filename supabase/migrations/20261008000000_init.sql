CREATE TABLE public.transcripts (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  text text NOT NULL CHECK (length(trim(text)) > 0),
  mode text NOT NULL CHECK (mode IN ('exact', 'polished')),
  word_count integer NOT NULL CHECK (word_count >= 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE TABLE public.sessions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  duration double precision NOT NULL CHECK (duration >= 0),
  word_count integer NOT NULL DEFAULT 0 CHECK (word_count >= 0),
  status text NOT NULL CHECK (status IN ('success', 'error')),
  error_message text,
  created_at timestamptz NOT NULL
);
ALTER TABLE public.transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.save_dictation(p_text text, p_mode text, p_duration double precision, p_timestamp timestamptz)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE saved_transcript public.transcripts; saved_session public.sessions;
BEGIN
  IF length(trim(p_text)) = 0 OR p_mode NOT IN ('exact', 'polished') OR p_duration < 0 THEN
    RAISE EXCEPTION 'invalid dictation';
  END IF;
  INSERT INTO public.transcripts (id, text, mode, word_count, created_at, updated_at)
  VALUES (1, trim(p_text), p_mode, array_length(regexp_split_to_array(trim(p_text), '[[:space:]]+'), 1), p_timestamp, p_timestamp)
  ON CONFLICT (id) DO UPDATE SET text = EXCLUDED.text, mode = EXCLUDED.mode,
    word_count = EXCLUDED.word_count, updated_at = EXCLUDED.updated_at
  RETURNING * INTO saved_transcript;
  INSERT INTO public.sessions (duration, word_count, status, created_at)
  VALUES (p_duration, saved_transcript.word_count, 'success', p_timestamp)
  RETURNING * INTO saved_session;
  RETURN jsonb_build_object('transcript', to_jsonb(saved_transcript), 'session', to_jsonb(saved_session));
END;
$$;

CREATE FUNCTION public.get_stats() RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'totalWords', coalesce(sum(word_count) FILTER (WHERE status = 'success'), 0),
    'totalDurationSeconds', coalesce(sum(duration), 0),
    'sessionCount', count(*),
    'successRate', coalesce(100.0 * count(*) FILTER (WHERE status = 'success') / nullif(count(*), 0), 0)
  ) FROM public.sessions;
$$;
REVOKE ALL ON FUNCTION public.save_dictation(text, text, double precision, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_dictation(text, text, double precision, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_stats() TO service_role;
