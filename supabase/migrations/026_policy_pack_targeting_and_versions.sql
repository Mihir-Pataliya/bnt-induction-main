-- Extend the existing policy and profile records. Each policy row represents
-- one immutable published version; policy_group_id ties versions together.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS staff_role text NOT NULL DEFAULT 'driver';
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_staff_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_staff_role_check
  CHECK (staff_role IN ('driver', 'warehouse', 'office'));

ALTER TABLE public.policies
  ADD COLUMN IF NOT EXISTS target_role text NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS policy_group_id uuid;
ALTER TABLE public.policies DROP CONSTRAINT IF EXISTS policies_target_role_check;
ALTER TABLE public.policies ADD CONSTRAINT policies_target_role_check
  CHECK (target_role IN ('all', 'driver', 'warehouse', 'office'));
UPDATE public.policies SET policy_group_id = id WHERE policy_group_id IS NULL;
ALTER TABLE public.policies ALTER COLUMN policy_group_id SET DEFAULT gen_random_uuid();
ALTER TABLE public.policies ALTER COLUMN policy_group_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS policies_group_version_idx ON public.policies(policy_group_id, published_at DESC);

-- Scope policy reads using the employment type stored on profiles, with the
-- contractor membership retained as a compatibility fallback.
DROP POLICY IF EXISTS policies_audience_select ON public.policies;
CREATE POLICY policies_audience_select ON public.policies FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid()) OR
    (coalesce(is_published, status = 'published', false) AND
      (audience = 'all' OR
       (audience = 'contractor' AND (coalesce((SELECT p.employment_type FROM public.profiles p WHERE p.id = auth.uid()), 'employee') = 'contractor' OR EXISTS (SELECT 1 FROM public.contractor_profiles cp WHERE cp.user_id = auth.uid()))) OR
       (audience = 'employee' AND NOT EXISTS (SELECT 1 FROM public.contractor_profiles cp WHERE cp.user_id = auth.uid()) AND coalesce((SELECT p.employment_type FROM public.profiles p WHERE p.id = auth.uid()), 'employee') = 'employee')) AND
      (target_role = 'all' OR target_role = coalesce((SELECT p.staff_role FROM public.profiles p WHERE p.id = auth.uid()), 'driver')))
  );
DROP POLICY IF EXISTS policies_audience_enforce ON public.policies;
CREATE POLICY policies_audience_enforce ON public.policies AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid()) OR
    (coalesce(is_published, status = 'published', false) AND
      (audience = 'all' OR
       (audience = 'contractor' AND (coalesce((SELECT p.employment_type FROM public.profiles p WHERE p.id = auth.uid()), 'employee') = 'contractor' OR EXISTS (SELECT 1 FROM public.contractor_profiles cp WHERE cp.user_id = auth.uid()))) OR
       (audience = 'employee' AND NOT EXISTS (SELECT 1 FROM public.contractor_profiles cp WHERE cp.user_id = auth.uid()) AND coalesce((SELECT p.employment_type FROM public.profiles p WHERE p.id = auth.uid()), 'employee') = 'employee')) AND
      (target_role = 'all' OR target_role = coalesce((SELECT p.staff_role FROM public.profiles p WHERE p.id = auth.uid()), 'driver')))
  );

CREATE OR REPLACE FUNCTION public.check_policy_signature_audience()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  signer_id text := coalesce(to_jsonb(NEW)->>'user_id', to_jsonb(NEW)->>'driver_id');
  policy_id_text text := coalesce(to_jsonb(NEW)->>'policy_version_id', to_jsonb(NEW)->>'policy_id');
  policy_audience text;
  policy_role text;
BEGIN
  IF signer_id IS NULL OR policy_id_text IS NULL THEN RAISE EXCEPTION 'Policy signature requires a signer and policy version'; END IF;
  IF signer_id <> auth.uid()::text AND NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Cannot sign a policy for another user'; END IF;
  SELECT audience, target_role INTO policy_audience, policy_role FROM public.policies WHERE id::text = policy_id_text AND coalesce(is_published, status = 'published', false);
  IF NOT FOUND THEN RAISE EXCEPTION 'Published policy version does not exist'; END IF;
  IF NOT public.is_admin(auth.uid()) THEN
    IF policy_audience = 'contractor' AND coalesce((SELECT p.employment_type FROM public.profiles p WHERE p.id::text = signer_id), 'employee') <> 'contractor' AND NOT EXISTS (SELECT 1 FROM public.contractor_profiles cp WHERE cp.user_id::text = signer_id) THEN RAISE EXCEPTION 'This policy is for a different employment type'; END IF;
    IF policy_audience = 'employee' AND (coalesce((SELECT p.employment_type FROM public.profiles p WHERE p.id::text = signer_id), 'employee') <> 'employee' OR EXISTS (SELECT 1 FROM public.contractor_profiles cp WHERE cp.user_id::text = signer_id)) THEN RAISE EXCEPTION 'This policy is for a different employment type'; END IF;
    IF policy_role <> 'all' AND policy_role IS DISTINCT FROM coalesce((SELECT p.staff_role FROM public.profiles p WHERE p.id::text = signer_id), 'driver') THEN RAISE EXCEPTION 'This policy is for a different staff role'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
