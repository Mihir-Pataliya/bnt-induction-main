-- Store a separate individual commencement decision. Clearance is written only
-- through the authenticated service API, which rechecks live onboarding data.
ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS work_clearance_status text NOT NULL DEFAULT 'Not Approved',
  ADD COLUMN IF NOT EXISTS work_clearance_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS work_clearance_approved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.drivers DROP CONSTRAINT IF EXISTS drivers_work_clearance_status_check;
ALTER TABLE public.drivers ADD CONSTRAINT drivers_work_clearance_status_check
  CHECK (work_clearance_status IN ('Not Approved', 'Approved to Commence Work'));

CREATE OR REPLACE FUNCTION public.guard_driver_work_clearance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (TG_OP = 'INSERT' AND (NEW.work_clearance_status <> 'Not Approved' OR NEW.work_clearance_approved_at IS NOT NULL OR NEW.work_clearance_approved_by IS NOT NULL)) OR
     (TG_OP = 'UPDATE' AND (NEW.work_clearance_status IS DISTINCT FROM OLD.work_clearance_status OR
     NEW.work_clearance_approved_at IS DISTINCT FROM OLD.work_clearance_approved_at OR
     NEW.work_clearance_approved_by IS DISTINCT FROM OLD.work_clearance_approved_by)) THEN
    IF coalesce(auth.role(), '') <> 'service_role' THEN
      RAISE EXCEPTION 'Work clearance must be changed through the authorized admin API';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS driver_work_clearance_guard ON public.drivers;
CREATE TRIGGER driver_work_clearance_guard
  BEFORE INSERT OR UPDATE ON public.drivers
  FOR EACH ROW EXECUTE FUNCTION public.guard_driver_work_clearance();

NOTIFY pgrst, 'reload schema';
