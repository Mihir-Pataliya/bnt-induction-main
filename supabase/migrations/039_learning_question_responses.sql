ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS learning_question_responses jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE OR REPLACE FUNCTION public.save_learning_question_response(
  p_user_id uuid,
  p_section_id text,
  p_question_id text,
  p_response text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.profiles
  SET learning_question_responses = jsonb_set(
    coalesce(learning_question_responses, '{}'::jsonb),
    ARRAY[p_section_id],
    jsonb_set(
      coalesce(learning_question_responses -> p_section_id, '{}'::jsonb),
      ARRAY[p_question_id],
      to_jsonb(p_response),
      true
    ),
    true
  ),
  updated_at = now()
  WHERE id = p_user_id;
$$;

REVOKE ALL ON FUNCTION public.save_learning_question_response(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_learning_question_response(uuid, text, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
