-- Support the user-facing Safe Driving Plan signing lifecycle:
-- Draft -> Assigned -> Acknowledged (driver signed) -> Completed (both signed).
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
        'Acknowledged',
        'Completed',
        'Awaiting Driver Acknowledgement',
        'Awaiting Scheduler Acknowledgement',
        'Trip Change Reported',
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

CREATE OR REPLACE FUNCTION public.enforce_safe_driving_plan_driver_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.form_code = 'SDP'
     AND auth.role() = 'authenticated'
     AND NOT public.is_admin(auth.uid()) THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR OLD.status NOT IN ('Assigned', 'Acknowledged', 'Awaiting Driver Acknowledgement', 'Awaiting Scheduler Acknowledgement', 'Trip Change Reported')
       OR NEW.form_code IS DISTINCT FROM OLD.form_code
       OR NEW.form_title IS DISTINCT FROM OLD.form_title
       OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
       OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
       OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
       OR NEW.review_notes IS DISTINCT FROM OLD.review_notes
       OR (NEW.payload - ARRAY['driverChecklist', 'tripChangeReport', 'declarations', 'status'])
          IS DISTINCT FROM
          (OLD.payload - ARRAY['driverChecklist', 'tripChangeReport', 'declarations', 'status'])
       OR ((NEW.payload -> 'declarations') - 'driver')
          IS DISTINCT FROM
          ((OLD.payload -> 'declarations') - 'driver')
       OR NEW.status NOT IN ('Acknowledged', 'Awaiting Scheduler Acknowledgement', 'Trip Change Reported')
       OR NEW.payload ->> 'status' IS DISTINCT FROM NEW.status
       OR (
         NEW.status IN ('Acknowledged', 'Awaiting Scheduler Acknowledgement')
         AND NEW.payload #>> '{declarations,driver,acknowledged}' IS DISTINCT FROM 'true'
       ) THEN
      RAISE EXCEPTION 'Drivers may only update their Safe Driving Plan checklist, trip change report, and acknowledgement';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
