-- ============================================================
-- COR form submissions (F-04, F-05, F-08, F-09 and future forms)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cor_form_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  form_code text NOT NULL,
  form_title text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'Submitted' CHECK (status IN ('Submitted', 'Under Review', 'Resolved')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  review_notes text
);

CREATE INDEX IF NOT EXISTS cor_form_submissions_user_idx
  ON public.cor_form_submissions (user_id, submitted_at DESC);

CREATE INDEX IF NOT EXISTS cor_form_submissions_form_idx
  ON public.cor_form_submissions (form_code, submitted_at DESC);

ALTER TABLE public.cor_form_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cor_form_submissions_select" ON public.cor_form_submissions;
CREATE POLICY "cor_form_submissions_select"
  ON public.cor_form_submissions FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "cor_form_submissions_insert_own" ON public.cor_form_submissions;
CREATE POLICY "cor_form_submissions_insert_own"
  ON public.cor_form_submissions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "cor_form_submissions_admin_manage" ON public.cor_form_submissions;
CREATE POLICY "cor_form_submissions_admin_manage"
  ON public.cor_form_submissions FOR ALL
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

GRANT ALL ON public.cor_form_submissions TO service_role;

NOTIFY pgrst, 'reload schema';
