-- The current database stores signatures as (user_id, policy_version_id).
-- Keep the trigger compatible with deployments using the older names too.
CREATE OR REPLACE FUNCTION public.check_policy_signature_audience()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  policy_audience text;
  signer_id text;
  signed_policy_version_id text;
BEGIN
  signer_id := coalesce(to_jsonb(NEW)->>'user_id', to_jsonb(NEW)->>'driver_id');
  signed_policy_version_id := coalesce(to_jsonb(NEW)->>'policy_version_id', to_jsonb(NEW)->>'policy_id');

  IF signer_id IS NULL OR signed_policy_version_id IS NULL THEN
    RAISE EXCEPTION 'Policy signature requires a signer and policy version';
  END IF;

  IF signer_id <> auth.uid()::text AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Cannot sign a policy for another user';
  END IF;

  SELECT audience INTO policy_audience
  FROM public.policies
  WHERE id::text = signed_policy_version_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Policy version does not exist';
  END IF;

  IF policy_audience = 'contractor'
     AND NOT EXISTS (
       SELECT 1 FROM public.contractor_profiles cp
       WHERE cp.user_id::text = signer_id
     )
     AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'This policy is for contractors';
  ELSIF policy_audience = 'employee'
     AND EXISTS (
       SELECT 1 FROM public.contractor_profiles cp
       WHERE cp.user_id::text = signer_id
     )
     AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'This policy is for employees';
  END IF;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
