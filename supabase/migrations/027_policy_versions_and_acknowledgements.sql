-- The existing policy_versions table is the authoritative revision record.
-- Seed one version for any already-published policy that has none.
INSERT INTO public.policy_versions (policy_id, version_label, content, published_at)
SELECT p.id,
       coalesce(nullif(p.version_label, ''), nullif(p.version, ''), '1.0'),
       coalesce(p.content, ''),
       coalesce(p.published_at, now())
FROM public.policies p
WHERE coalesce(p.is_published, p.status = 'published', false)
  AND NOT EXISTS (SELECT 1 FROM public.policy_versions pv WHERE pv.policy_id = p.id);

ALTER TABLE public.policy_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS policy_versions_targeted_select ON public.policy_versions;
CREATE POLICY policy_versions_targeted_select ON public.policy_versions FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid()) OR EXISTS (
      SELECT 1 FROM public.policies p WHERE p.id = policy_versions.policy_id
    )
  );
DROP POLICY IF EXISTS policy_versions_admin_insert ON public.policy_versions;
CREATE POLICY policy_versions_admin_insert ON public.policy_versions FOR INSERT TO authenticated
  WITH CHECK (public.is_admin(auth.uid()));

-- policy_signatures.policy_version_id references policy_versions.id.
-- Enforce worker targeting through the parent policy record.
CREATE OR REPLACE FUNCTION public.check_policy_signature_audience()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  signer_id text := coalesce(to_jsonb(NEW)->>'user_id', to_jsonb(NEW)->>'driver_id');
  version_id_text text := coalesce(to_jsonb(NEW)->>'policy_version_id', to_jsonb(NEW)->>'policy_id');
  policy_audience text;
  policy_role text;
BEGIN
  IF signer_id IS NULL OR version_id_text IS NULL THEN
    RAISE EXCEPTION 'Policy signature requires a signer and policy version';
  END IF;
  IF signer_id <> auth.uid()::text AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Cannot sign a policy for another user';
  END IF;

  SELECT p.audience, p.target_role INTO policy_audience, policy_role
  FROM public.policy_versions pv
  JOIN public.policies p ON p.id = pv.policy_id
  WHERE pv.id::text = version_id_text
    AND coalesce(p.is_published, p.status = 'published', false);
  IF NOT FOUND THEN RAISE EXCEPTION 'Published policy version does not exist'; END IF;

  IF NOT public.is_admin(auth.uid()) THEN
    IF policy_audience = 'contractor'
       AND coalesce((SELECT pr.employment_type FROM public.profiles pr WHERE pr.id::text = signer_id), 'employee') <> 'contractor'
       AND NOT EXISTS (SELECT 1 FROM public.contractor_profiles cp WHERE cp.user_id::text = signer_id) THEN
      RAISE EXCEPTION 'This policy is for contractors';
    END IF;
    IF policy_audience = 'employee'
       AND (coalesce((SELECT pr.employment_type FROM public.profiles pr WHERE pr.id::text = signer_id), 'employee') <> 'employee'
            OR EXISTS (SELECT 1 FROM public.contractor_profiles cp WHERE cp.user_id::text = signer_id)) THEN
      RAISE EXCEPTION 'This policy is for employees';
    END IF;
    IF policy_role <> 'all'
       AND policy_role IS DISTINCT FROM coalesce((SELECT pr.staff_role FROM public.profiles pr WHERE pr.id::text = signer_id), 'driver') THEN
      RAISE EXCEPTION 'This policy is for a different staff role';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
