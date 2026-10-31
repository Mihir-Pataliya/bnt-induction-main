-- Loading, Unloading & Restraint Compliance assessment schema.

CREATE TABLE IF NOT EXISTS public.loading_unloading_restraint_compliance_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assessment_id text NOT NULL DEFAULT 'loading_unloading_restraint_compliance',
  question text NOT NULL,
  options jsonb NOT NULL,
  correct_answer integer NOT NULL,
  explanation text,
  category text NOT NULL DEFAULT 'Loading, Unloading & Restraint Compliance',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS loading_unloading_restraint_compliance_questions_assessment_idx
  ON public.loading_unloading_restraint_compliance_questions (assessment_id, sort_order);

CREATE TABLE IF NOT EXISTS public.loading_unloading_restraint_compliance_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  assessment_id text NOT NULL DEFAULT 'loading_unloading_restraint_compliance',
  score integer NOT NULL,
  total_questions integer NOT NULL,
  passed boolean NOT NULL DEFAULT false,
  answers jsonb,
  assessor_feedback text,
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  completed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS loading_unloading_restraint_compliance_results_user_idx
  ON public.loading_unloading_restraint_compliance_results (user_id, completed_at DESC);

ALTER TABLE public.loading_unloading_restraint_compliance_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loading_unloading_restraint_compliance_results ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.loading_unloading_restraint_compliance_questions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.loading_unloading_restraint_compliance_results FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.loading_unloading_restraint_compliance_questions TO service_role;
GRANT ALL ON public.loading_unloading_restraint_compliance_results TO service_role;

NOTIFY pgrst, 'reload schema';
