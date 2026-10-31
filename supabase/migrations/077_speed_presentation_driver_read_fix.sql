-- Ensure authenticated drivers can read the published Speed Awareness presentation.
-- Uses TO authenticated instead of the deprecated auth.role() check.
DROP POLICY IF EXISTS "cor_form_submissions_speed_presentation_select" ON public.cor_form_submissions;
CREATE POLICY "cor_form_submissions_speed_presentation_select"
  ON public.cor_form_submissions FOR SELECT
  TO authenticated
  USING (form_code = 'SPEED_PRESENTATION');

GRANT SELECT ON public.cor_form_submissions TO authenticated;

NOTIFY pgrst, 'reload schema';