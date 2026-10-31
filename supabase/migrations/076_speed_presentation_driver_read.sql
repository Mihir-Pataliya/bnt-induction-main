-- The Speed Awareness presentation is published by an administrator and is shared
-- with authenticated drivers regardless of which administrator saved it.
DROP POLICY IF EXISTS "cor_form_submissions_speed_presentation_select" ON public.cor_form_submissions;
CREATE POLICY "cor_form_submissions_speed_presentation_select"
  ON public.cor_form_submissions FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND form_code = 'SPEED_PRESENTATION'
  );

NOTIFY pgrst, 'reload schema';
