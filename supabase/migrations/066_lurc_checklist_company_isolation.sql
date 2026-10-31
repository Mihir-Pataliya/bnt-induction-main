-- Company-wise isolation for COR form submissions, including the Loading,
-- Unloading & Restraint checklist.

ALTER TABLE public.cor_form_submissions
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.contractor_companies(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS cor_form_submissions_company_idx
  ON public.cor_form_submissions (company_id, form_code, submitted_at DESC);

UPDATE public.cor_form_submissions submissions
SET company_id = member.company_id
FROM public.contractor_profiles member
WHERE submissions.company_id IS NULL
  AND member.user_id = submissions.user_id;

CREATE OR REPLACE FUNCTION public.set_cor_submission_company()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  owner_company uuid;
BEGIN
  SELECT cp.company_id INTO owner_company
  FROM public.contractor_profiles cp
  WHERE cp.user_id = NEW.user_id
  LIMIT 1;
  IF NEW.company_id IS NULL THEN
    NEW.company_id := owner_company;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_cor_submission_company ON public.cor_form_submissions;
CREATE TRIGGER set_cor_submission_company
BEFORE INSERT OR UPDATE OF user_id, company_id ON public.cor_form_submissions
FOR EACH ROW EXECUTE FUNCTION public.set_cor_submission_company();

DROP POLICY IF EXISTS "cor_form_submissions_select" ON public.cor_form_submissions;
CREATE POLICY "cor_form_submissions_select"
ON public.cor_form_submissions FOR SELECT
USING (
  auth.uid() = user_id
  OR (
    public.is_admin(auth.uid())
    AND (
      NOT EXISTS (SELECT 1 FROM public.contractor_profiles viewer WHERE viewer.user_id = auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.contractor_profiles viewer
        JOIN public.contractor_profiles owner ON owner.company_id = viewer.company_id
        WHERE viewer.user_id = auth.uid() AND owner.user_id = cor_form_submissions.user_id
      )
    )
  )
);

DROP POLICY IF EXISTS "cor_form_submissions_admin_manage" ON public.cor_form_submissions;
CREATE POLICY "cor_form_submissions_admin_manage"
ON public.cor_form_submissions FOR ALL
USING (
  public.is_admin(auth.uid())
  AND (
    NOT EXISTS (SELECT 1 FROM public.contractor_profiles viewer WHERE viewer.user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.contractor_profiles viewer
      JOIN public.contractor_profiles owner ON owner.company_id = viewer.company_id
      WHERE viewer.user_id = auth.uid() AND owner.user_id = cor_form_submissions.user_id
    )
  )
)
WITH CHECK (
  public.is_admin(auth.uid())
  AND (
    NOT EXISTS (SELECT 1 FROM public.contractor_profiles viewer WHERE viewer.user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.contractor_profiles company_viewer
      JOIN public.contractor_profiles company_owner ON company_owner.company_id = company_viewer.company_id
      WHERE company_viewer.user_id = auth.uid() AND company_owner.user_id = cor_form_submissions.user_id
    )
  )
);

NOTIFY pgrst, 'reload schema';
