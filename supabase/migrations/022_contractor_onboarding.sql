-- Shared contractor company records, worker links, onboarding metadata,
-- role-targeted policies, and private contractor insurance documents.

CREATE TABLE IF NOT EXISTS public.contractor_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text NOT NULL DEFAULT '',
  trading_name text NOT NULL DEFAULT '',
  abn text NOT NULL DEFAULT '',
  contact_person text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  nhvas_accreditation text NOT NULL DEFAULT 'None',
  nhvas_number text NOT NULL DEFAULT '',
  public_liability_policy text NOT NULL DEFAULT '',
  public_liability_expiry date,
  public_liability_file_path text,
  public_liability_status text NOT NULL DEFAULT 'pending' CHECK (public_liability_status IN ('pending', 'approved', 'rejected')),
  public_liability_rejection_reason text,
  workers_comp_policy text NOT NULL DEFAULT '',
  workers_comp_expiry date,
  workers_comp_file_path text,
  workers_comp_status text NOT NULL DEFAULT 'pending' CHECK (workers_comp_status IN ('pending', 'approved', 'rejected')),
  workers_comp_rejection_reason text,
  primary_depot text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'Pending Review',
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.contractor_profiles
  ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.contractor_companies(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS worker_position text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS worker_start_date date;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS employment_type text NOT NULL DEFAULT 'employee';
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_employment_type_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_employment_type_check
  CHECK (employment_type IN ('employee', 'contractor'));

-- Move existing per-user company data into one shared row per ABN. Rows without
-- an ABN remain separate, preserving data rather than guessing company identity.
WITH legacy AS (
  SELECT cp.*,
         nullif(regexp_replace(coalesce(cp.abn, ''), '\D', '', 'g'), '') AS normalized_abn
  FROM public.contractor_profiles cp
), grouped AS (
  SELECT DISTINCT ON (coalesce(normalized_abn, 'user:' || user_id::text)) *
  FROM legacy
  ORDER BY coalesce(normalized_abn, 'user:' || user_id::text), updated_at DESC NULLS LAST
)
INSERT INTO public.contractor_companies (
  company_name, trading_name, abn, contact_person, email, phone, address,
  nhvas_accreditation, nhvas_number, public_liability_policy,
  public_liability_expiry, public_liability_file_path, workers_comp_policy,
  workers_comp_expiry, workers_comp_file_path, primary_depot, status, created_by
)
SELECT company_name, trading_name, coalesce(normalized_abn, abn), contact_person,
       email, phone, address, nhvas_accreditation, nhvas_number,
       public_liability_policy, public_liability_expiry,
       CASE WHEN public_liability_file_url LIKE '%/contractor-documents/%'
         THEN substring(public_liability_file_url from '/contractor-documents/(.+)$')
         ELSE public_liability_file_url END,
       workers_comp_policy, workers_comp_expiry,
       CASE WHEN workers_comp_file_url LIKE '%/contractor-documents/%'
         THEN substring(workers_comp_file_url from '/contractor-documents/(.+)$')
         ELSE workers_comp_file_url END,
       primary_depot, status, user_id
FROM grouped
WHERE NOT EXISTS (
  SELECT 1 FROM public.contractor_companies cc
  WHERE (grouped.normalized_abn IS NOT NULL AND regexp_replace(cc.abn, '\D', '', 'g') = grouped.normalized_abn)
     OR (grouped.normalized_abn IS NULL AND cc.created_by = grouped.user_id)
);

UPDATE public.contractor_profiles cp
SET company_id = cc.id
FROM public.contractor_companies cc
WHERE cp.company_id IS NULL
  AND ((nullif(regexp_replace(coalesce(cp.abn, ''), '\D', '', 'g'), '') IS NOT NULL
        AND regexp_replace(cc.abn, '\D', '', 'g') = regexp_replace(cp.abn, '\D', '', 'g'))
    OR (nullif(regexp_replace(coalesce(cp.abn, ''), '\D', '', 'g'), '') IS NULL
        AND cc.created_by = cp.user_id));

UPDATE public.profiles p SET employment_type = 'contractor'
WHERE EXISTS (SELECT 1 FROM public.contractor_profiles cp WHERE cp.user_id = p.id);

CREATE UNIQUE INDEX IF NOT EXISTS contractor_companies_abn_unique
  ON public.contractor_companies (regexp_replace(abn, '\D', '', 'g'))
  WHERE nullif(regexp_replace(abn, '\D', '', 'g'), '') IS NOT NULL;

-- Existing users can see a company only after an admin links them as a worker.
ALTER TABLE public.contractor_companies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contractor_companies_select ON public.contractor_companies;
CREATE POLICY contractor_companies_select ON public.contractor_companies FOR SELECT
  USING (public.is_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.contractor_profiles cp
    WHERE cp.company_id = contractor_companies.id AND cp.user_id = auth.uid()
  ));
DROP POLICY IF EXISTS contractor_companies_insert ON public.contractor_companies;
CREATE POLICY contractor_companies_insert ON public.contractor_companies FOR INSERT
  WITH CHECK (created_by = auth.uid());
DROP POLICY IF EXISTS contractor_companies_update ON public.contractor_companies;
CREATE POLICY contractor_companies_update ON public.contractor_companies FOR UPDATE
  USING (public.is_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.contractor_profiles cp
    WHERE cp.company_id = contractor_companies.id AND cp.user_id = auth.uid()
  ))
  WITH CHECK (public.is_admin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.contractor_profiles cp
    WHERE cp.company_id = contractor_companies.id AND cp.user_id = auth.uid()
  ));

-- Restrict contractor insurance documents to authenticated, company-linked
-- users and admins. The bucket itself must not serve public object URLs.
UPDATE storage.buckets SET public = false WHERE id = 'contractor-documents';

CREATE OR REPLACE FUNCTION public.can_read_contractor_document(owner_folder text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE owner_id uuid;
BEGIN
  IF public.is_admin(auth.uid()) THEN RETURN true; END IF;
  IF owner_folder !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN false; END IF;
  owner_id := owner_folder::uuid;
  IF owner_id = auth.uid() THEN RETURN true; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.contractor_profiles viewer
    JOIN public.contractor_profiles owner ON owner.company_id = viewer.company_id
    WHERE viewer.user_id = auth.uid() AND owner.user_id = owner_id
      AND viewer.company_id IS NOT NULL
  );
END;
$$;
REVOKE ALL ON FUNCTION public.can_read_contractor_document(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_contractor_document(text) TO authenticated;

DROP POLICY IF EXISTS contractor_documents_select ON storage.objects;
CREATE POLICY contractor_documents_select ON storage.objects FOR SELECT
  USING (bucket_id = 'contractor-documents' AND public.can_read_contractor_document((storage.foldername(name))[1]));

ALTER TABLE public.policies
  ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'all';
ALTER TABLE public.policies DROP CONSTRAINT IF EXISTS policies_audience_check;
ALTER TABLE public.policies ADD CONSTRAINT policies_audience_check
  CHECK (audience IN ('all', 'employee', 'contractor'));

ALTER TABLE public.policies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS policies_audience_select ON public.policies;
CREATE POLICY policies_audience_select ON public.policies FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR audience = 'all' OR
    (audience = 'contractor' AND EXISTS (SELECT 1 FROM public.contractor_profiles cp WHERE cp.user_id = auth.uid())) OR
    (audience = 'employee' AND NOT EXISTS (SELECT 1 FROM public.contractor_profiles cp WHERE cp.user_id = auth.uid())));
DROP POLICY IF EXISTS policies_audience_enforce ON public.policies;
CREATE POLICY policies_audience_enforce ON public.policies AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.is_admin(auth.uid()) OR audience = 'all' OR
    (audience = 'contractor' AND EXISTS (SELECT 1 FROM public.contractor_profiles cp WHERE cp.user_id = auth.uid())) OR
    (audience = 'employee' AND NOT EXISTS (SELECT 1 FROM public.contractor_profiles cp WHERE cp.user_id = auth.uid())));

CREATE OR REPLACE FUNCTION public.guard_contractor_membership_company()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() = 'service_role' OR public.is_admin(auth.uid()) THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.company_id IS DISTINCT FROM OLD.company_id THEN
    RAISE EXCEPTION 'Only an administrator can move a contractor between companies';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.company_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.contractor_companies cc WHERE cc.id = NEW.company_id AND cc.created_by = auth.uid()
    ) THEN
    RAISE EXCEPTION 'You may only create a membership in a company you created';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS contractor_membership_company_guard ON public.contractor_profiles;
CREATE TRIGGER contractor_membership_company_guard
  BEFORE INSERT OR UPDATE OF company_id ON public.contractor_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_contractor_membership_company();

CREATE OR REPLACE FUNCTION public.guard_profile_employment_type()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.employment_type IS DISTINCT FROM OLD.employment_type
     AND coalesce(auth.role(), '') <> 'service_role' AND NOT public.is_admin(auth.uid())
     AND NOT (NEW.employment_type = 'contractor' AND NEW.id = auth.uid() AND EXISTS (
       SELECT 1 FROM public.contractor_profiles cp WHERE cp.user_id = NEW.id
     )) THEN
    RAISE EXCEPTION 'Only an administrator can change employment type';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS profile_employment_type_guard ON public.profiles;
CREATE TRIGGER profile_employment_type_guard
  BEFORE UPDATE OF employment_type ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_employment_type();

-- Enforce both user ownership and audience at the database boundary for
-- policy-signature writes, independent of any client-side filtering.
CREATE OR REPLACE FUNCTION public.check_policy_signature_audience()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE policy_audience text;
BEGIN
  IF NEW.driver_id IS DISTINCT FROM auth.uid() AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Cannot sign a policy for another user';
  END IF;
  SELECT audience INTO policy_audience FROM public.policies WHERE id = NEW.policy_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Policy version does not exist'; END IF;
  IF policy_audience = 'contractor' AND NOT EXISTS (
      SELECT 1 FROM public.contractor_profiles cp WHERE cp.user_id = NEW.driver_id
    ) AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'This policy is for contractors';
  ELSIF policy_audience = 'employee' AND EXISTS (
      SELECT 1 FROM public.contractor_profiles cp WHERE cp.user_id = NEW.driver_id
    ) AND NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'This policy is for employees';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS policy_signature_audience_guard ON public.policy_signatures;
CREATE TRIGGER policy_signature_audience_guard
  BEFORE INSERT OR UPDATE ON public.policy_signatures
  FOR EACH ROW EXECUTE FUNCTION public.check_policy_signature_audience();
