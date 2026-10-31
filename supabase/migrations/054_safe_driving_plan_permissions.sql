-- Keep existing COR form access unchanged while limiting Safe Driving Plans to
-- administrators and the driver assigned in cor_form_submissions.user_id.
DROP POLICY IF EXISTS "cor_form_submissions_select" ON public.cor_form_submissions;
CREATE POLICY "cor_form_submissions_select"
  ON public.cor_form_submissions FOR SELECT
  USING (
    auth.role() = 'authenticated'
    AND (
      form_code <> 'SDP'
      OR (user_id = auth.uid() AND status <> 'Draft')
      OR public.is_admin(auth.uid())
    )
  );

-- Drivers may submit other COR forms as before, but only administrators may
-- create or assign a Safe Driving Plan.
DROP POLICY IF EXISTS "cor_form_submissions_insert_own" ON public.cor_form_submissions;
CREATE POLICY "cor_form_submissions_insert_own"
  ON public.cor_form_submissions FOR INSERT
  WITH CHECK (auth.uid() = user_id AND form_code <> 'SDP');

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

DROP TRIGGER IF EXISTS safe_driving_plan_driver_fields_guard ON public.cor_form_submissions;
CREATE TRIGGER safe_driving_plan_driver_fields_guard
  BEFORE UPDATE ON public.cor_form_submissions
  FOR EACH ROW
  WHEN (OLD.form_code = 'SDP')
  EXECUTE FUNCTION public.enforce_safe_driving_plan_driver_fields();

NOTIFY pgrst, 'reload schema';
