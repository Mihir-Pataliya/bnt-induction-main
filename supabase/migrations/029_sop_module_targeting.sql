-- Add employment and staff-role targeting to the existing driver safety module catalogue.
ALTER TABLE public.sop_modules
  ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS target_role text NOT NULL DEFAULT 'all';

ALTER TABLE public.sop_modules DROP CONSTRAINT IF EXISTS sop_modules_audience_check;
ALTER TABLE public.sop_modules ADD CONSTRAINT sop_modules_audience_check
  CHECK (audience IN ('all', 'employee', 'contractor'));
ALTER TABLE public.sop_modules DROP CONSTRAINT IF EXISTS sop_modules_target_role_check;
ALTER TABLE public.sop_modules ADD CONSTRAINT sop_modules_target_role_check
  CHECK (target_role IN ('all', 'driver', 'warehouse', 'office'));

NOTIFY pgrst, 'reload schema';
