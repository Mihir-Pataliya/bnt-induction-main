-- ============================================================
-- Allow draft status for cor_form_submissions (driver records)
-- ============================================================

ALTER TABLE public.cor_form_submissions
  DROP CONSTRAINT IF EXISTS cor_form_submissions_status_check;

DO $$
DECLARE
  allowed_statuses text;
BEGIN
  SELECT string_agg(quote_literal(status), ', ' ORDER BY status)
    INTO allowed_statuses
    FROM (
      SELECT DISTINCT status FROM public.cor_form_submissions
      UNION
      SELECT unnest(ARRAY['Draft', 'Submitted', 'Under Review', 'Resolved']::text[])
    ) statuses;

  EXECUTE format(
    'ALTER TABLE public.cor_form_submissions ADD CONSTRAINT cor_form_submissions_status_check CHECK (status IN (%s))',
    allowed_statuses
  );
END;
$$;

DROP POLICY IF EXISTS "cor_form_submissions_update_own" ON public.cor_form_submissions;
CREATE POLICY "cor_form_submissions_update_own"
  ON public.cor_form_submissions FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

NOTIFY pgrst, 'reload schema';