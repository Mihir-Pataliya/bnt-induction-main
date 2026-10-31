CREATE OR REPLACE FUNCTION public.reset_expired_inductions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE caller_role text;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    SELECT role INTO caller_role
    FROM public.profiles
    WHERE id = auth.uid();

    IF caller_role IS DISTINCT FROM 'admin' THEN
      RAISE EXCEPTION 'Unauthorized: admin role required to reset expired inductions';
    END IF;
  END IF;

  UPDATE public.induction_progress ip
  SET completed = false,
      current_step = 1,
      completion_percentage = 0,
      updated_at = now()
  FROM public.certificates c
  JOIN public.induction_versions iv ON iv.id = c.induction_version_id
  WHERE ip.user_id = c.user_id
    AND iv.is_current = false
    AND ip.completed = true;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_expired_inductions() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reset_expired_inductions() TO authenticated, service_role;
