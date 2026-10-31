-- ============================================================
-- Fatigue Awareness Assessment
-- Separate from the induction quiz; uses its own tables and
-- assessment identifier so existing inductions are unaffected.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.fatigue_awareness_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id text NOT NULL DEFAULT 'fatigue_awareness',
  question text NOT NULL,
  options jsonb NOT NULL,
  correct_answer integer NOT NULL,
  explanation text,
  category text NOT NULL DEFAULT 'Fatigue Awareness',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fatigue_awareness_questions_assessment_idx
  ON public.fatigue_awareness_questions (assessment_id, sort_order);

CREATE TABLE IF NOT EXISTS public.fatigue_awareness_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assessment_id text NOT NULL DEFAULT 'fatigue_awareness',
  score integer NOT NULL,
  total_questions integer NOT NULL,
  passed boolean NOT NULL DEFAULT false,
  answers jsonb,
  completed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fatigue_awareness_results_user_idx
  ON public.fatigue_awareness_results (user_id, completed_at DESC);

ALTER TABLE public.fatigue_awareness_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fatigue_awareness_results ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.fatigue_awareness_questions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.fatigue_awareness_results FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.fatigue_awareness_questions TO service_role;
GRANT ALL ON public.fatigue_awareness_results TO service_role;

NOTIFY pgrst, 'reload schema';
