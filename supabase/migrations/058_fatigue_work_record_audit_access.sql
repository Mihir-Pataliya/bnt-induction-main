-- Reassign existing Admin F-10 audits to their driver so the driver can read
-- the result through the same user-owned submission row.
UPDATE public.cor_form_submissions AS submission
SET user_id = driver.id,
    status = 'Resolved',
    reviewed_at = COALESCE(submission.reviewed_at, submission.submitted_at)
FROM public.profiles AS driver
WHERE submission.form_code = 'F-10'
  AND submission.payload ->> 'source' = 'admin'
  AND lower(submission.payload ->> 'driverId') = driver.id::text;

DROP POLICY IF EXISTS "cor_form_submissions_select" ON public.cor_form_submissions;
CREATE POLICY "cor_form_submissions_select"
  ON public.cor_form_submissions FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND (
      (
        form_code = 'F-10'
        AND (user_id = auth.uid() OR public.is_admin(auth.uid()))
      )
      OR (
        form_code <> 'F-10'
        AND (
          form_code <> 'SDP'
          OR (user_id = auth.uid() AND status <> 'Draft')
          OR public.is_admin(auth.uid())
        )
      )
    )
  );

DROP POLICY IF EXISTS "cor_form_submissions_insert_own" ON public.cor_form_submissions;
CREATE POLICY "cor_form_submissions_insert_own"
  ON public.cor_form_submissions FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND form_code <> 'SDP'
    AND (form_code <> 'F-10' OR payload ->> 'source' = 'driver')
  );

DROP POLICY IF EXISTS "cor_form_submissions_update_own" ON public.cor_form_submissions;
CREATE POLICY "cor_form_submissions_update_own"
  ON public.cor_form_submissions FOR UPDATE
  USING (
    auth.uid() = user_id
    AND (form_code <> 'F-10' OR payload ->> 'source' = 'driver')
  )
  WITH CHECK (
    auth.uid() = user_id
    AND (form_code <> 'F-10' OR payload ->> 'source' = 'driver')
  );

NOTIFY pgrst, 'reload schema';
