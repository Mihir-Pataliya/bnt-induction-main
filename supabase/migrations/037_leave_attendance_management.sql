-- Leave requests and managed attendance history. Existing worksite attendance
-- rows remain intact and can continue to reference worksites and photos.
ALTER TABLE public.worksite_attendance
  ALTER COLUMN worksite_id DROP NOT NULL,
  ALTER COLUMN signin_photo_url DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS location_name text,
  ADD COLUMN IF NOT EXISTS vehicle_rego text,
  ADD COLUMN IF NOT EXISTS hours_driven_today numeric(4, 1),
  ADD COLUMN IF NOT EXISTS hours_rested_last_24h numeric(4, 1),
  ADD COLUMN IF NOT EXISTS fitness_declaration boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS legacy_id text,
  ADD COLUMN IF NOT EXISTS attendance_source text NOT NULL DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS edited_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS edited_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS worksite_attendance_legacy_id_idx
  ON public.worksite_attendance (legacy_id);
CREATE UNIQUE INDEX IF NOT EXISTS worksite_attendance_portal_active_idx
  ON public.worksite_attendance (user_id)
  WHERE status = 'signed_in' AND attendance_source = 'portal';

-- Attendance writes now go through the authenticated API, which enforces
-- ownership, registered vehicle checks, and audit logging.
REVOKE INSERT, UPDATE, DELETE ON public.worksite_attendance FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.worksite_attendance TO service_role;

CREATE TABLE IF NOT EXISTS public.leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  leave_type text NOT NULL CHECK (leave_type IN ('annual', 'personal', 'unpaid', 'other')),
  start_date date NOT NULL,
  end_date date NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 5 AND 2000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  decision_reason text,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS leave_requests_user_created_idx
  ON public.leave_requests (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS leave_requests_status_dates_idx
  ON public.leave_requests (status, start_date, end_date);

ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.leave_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.leave_requests TO service_role;

-- Serialize each employee's submissions and reject overlapping pending or
-- approved leave before inserting, including concurrent requests.
CREATE OR REPLACE FUNCTION public.submit_leave_request(
  p_user_id uuid,
  p_leave_type text,
  p_start_date date,
  p_end_date date,
  p_reason text
) RETURNS public.leave_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  created_request public.leave_requests;
BEGIN
  IF p_leave_type NOT IN ('annual', 'personal', 'unpaid', 'other')
    OR p_start_date IS NULL
    OR p_end_date IS NULL
    OR p_end_date < p_start_date
    OR length(trim(coalesce(p_reason, ''))) NOT BETWEEN 5 AND 2000 THEN
    RAISE EXCEPTION 'Invalid leave request.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  IF EXISTS (
    SELECT 1 FROM public.leave_requests lr
    WHERE lr.user_id = p_user_id
      AND lr.status IN ('pending', 'approved')
      AND daterange(lr.start_date, lr.end_date, '[]') && daterange(p_start_date, p_end_date, '[]')
  ) THEN
    RAISE EXCEPTION 'This leave request overlaps an existing pending or approved request.';
  END IF;

  INSERT INTO public.leave_requests (user_id, leave_type, start_date, end_date, reason)
  VALUES (p_user_id, p_leave_type, p_start_date, p_end_date, trim(p_reason))
  RETURNING * INTO created_request;

  RETURN created_request;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_leave_request(uuid, text, date, date, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_leave_request(uuid, text, date, date, text) TO service_role;

NOTIFY pgrst, 'reload schema';
