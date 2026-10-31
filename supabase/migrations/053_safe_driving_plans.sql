-- ============================================================
-- Safe Driving Plans reuse cor_form_submissions (form_code = 'SDP')
-- Expand allowed statuses for the Safe Driving Plan workflow.
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
      SELECT unnest(ARRAY[
        'Draft',
        'Assigned',
        'Awaiting Driver Acknowledgement',
        'Awaiting Scheduler Acknowledgement',
        'Trip Change Reported',
        'Acknowledged',
        'Submitted',
        'Under Review',
        'Resolved'
      ]::text[])
    ) statuses;

  EXECUTE format(
    'ALTER TABLE public.cor_form_submissions ADD CONSTRAINT cor_form_submissions_status_check CHECK (status IN (%s))',
    allowed_statuses
  );
END;
$$;

NOTIFY pgrst, 'reload schema';
