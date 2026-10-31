-- Add secure contractor financial records and review metadata without exposing
-- bank details through the shared contractor_companies read policy.
CREATE TABLE IF NOT EXISTS public.contractor_financial_details (
  company_id uuid PRIMARY KEY REFERENCES public.contractor_companies(id) ON DELETE CASCADE,
  bank_account_name text NOT NULL DEFAULT '',
  bank_bsb text NOT NULL DEFAULT '',
  bank_account_number text NOT NULL DEFAULT '',
  gst_registered boolean,
  gst_effective_date date,
  business_details_confirmed_at timestamptz,
  business_details_confirmed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  tax_declaration_at timestamptz,
  tax_declaration_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  insurance_declaration_at timestamptz,
  insurance_declaration_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  vehicle_declaration_at timestamptz,
  vehicle_declaration_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.contractor_financial_details ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contractor_financial_admin_only ON public.contractor_financial_details;
CREATE POLICY contractor_financial_admin_only ON public.contractor_financial_details
  FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
REVOKE ALL ON public.contractor_financial_details FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.contractor_financial_details TO authenticated;

-- Consistent check digits at the storage boundary; blank ACN stays optional.
CREATE OR REPLACE FUNCTION public.valid_australian_abn(value text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE d text := regexp_replace(coalesce(value, ''), '\D', '', 'g');
        weights integer[] := ARRAY[10,1,3,5,7,9,11,13,15,17,19]; sum_value integer := 0; i integer;
BEGIN
  IF length(d) <> 11 THEN RETURN false; END IF;
  FOR i IN 1..11 LOOP sum_value := sum_value + ((substring(d from i for 1)::integer - CASE WHEN i = 1 THEN 1 ELSE 0 END) * weights[i]); END LOOP;
  RETURN sum_value % 89 = 0;
END; $$;
CREATE OR REPLACE FUNCTION public.valid_australian_acn(value text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE d text := regexp_replace(coalesce(value, ''), '\D', '', 'g'); sum_value integer := 0; i integer;
BEGIN
  IF length(d) <> 9 THEN RETURN false; END IF;
  FOR i IN 1..8 LOOP sum_value := sum_value + substring(d from i for 1)::integer * (9 - i); END LOOP;
  RETURN substring(d from 9 for 1)::integer = ((10 - (sum_value % 10)) % 10);
END; $$;
ALTER TABLE public.contractor_companies DROP CONSTRAINT IF EXISTS contractor_companies_abn_check_digit;
ALTER TABLE public.contractor_companies ADD CONSTRAINT contractor_companies_abn_check_digit
  CHECK (nullif(regexp_replace(coalesce(abn, ''), '\D', '', 'g'), '') IS NULL OR public.valid_australian_abn(abn)) NOT VALID;
ALTER TABLE public.contractor_companies DROP CONSTRAINT IF EXISTS contractor_companies_acn_check_digit;
ALTER TABLE public.contractor_companies ADD CONSTRAINT contractor_companies_acn_check_digit
  CHECK (nullif(regexp_replace(coalesce(acn, ''), '\D', '', 'g'), '') IS NULL OR public.valid_australian_acn(acn)) NOT VALID;

-- Per-document review audit fields for existing company evidence.
ALTER TABLE public.contractor_companies
  ADD COLUMN IF NOT EXISTS public_liability_reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS public_liability_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS workers_comp_reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS workers_comp_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS agreement_reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS agreement_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS nhvas_file_path text,
  ADD COLUMN IF NOT EXISTS nhvas_expiry date,
  ADD COLUMN IF NOT EXISTS nhvas_status text NOT NULL DEFAULT 'missing' CHECK (nhvas_status IN ('missing','pending','approved','rejected')),
  ADD COLUMN IF NOT EXISTS nhvas_rejection_reason text,
  ADD COLUMN IF NOT EXISTS nhvas_reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS nhvas_reviewed_at timestamptz;

-- Vehicle evidence belongs to the registered vehicle and is reviewable by admins.
ALTER TABLE public.driver_vehicles
  ADD COLUMN IF NOT EXISTS rego_document_path text,
  ADD COLUMN IF NOT EXISTS rego_document_status text NOT NULL DEFAULT 'missing' CHECK (rego_document_status IN ('missing','pending','approved','rejected')),
  ADD COLUMN IF NOT EXISTS rego_document_rejection_reason text,
  ADD COLUMN IF NOT EXISTS rego_document_reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS rego_document_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS insurance_document_path text,
  ADD COLUMN IF NOT EXISTS insurance_document_expiry date,
  ADD COLUMN IF NOT EXISTS insurance_document_status text NOT NULL DEFAULT 'missing' CHECK (insurance_document_status IN ('missing','pending','approved','rejected')),
  ADD COLUMN IF NOT EXISTS insurance_document_rejection_reason text,
  ADD COLUMN IF NOT EXISTS insurance_document_reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS insurance_document_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS inspection_document_path text,
  ADD COLUMN IF NOT EXISTS inspection_document_expiry date,
  ADD COLUMN IF NOT EXISTS inspection_document_status text NOT NULL DEFAULT 'missing' CHECK (inspection_document_status IN ('missing','pending','approved','rejected')),
  ADD COLUMN IF NOT EXISTS inspection_document_rejection_reason text,
  ADD COLUMN IF NOT EXISTS inspection_document_reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS inspection_document_reviewed_at timestamptz;

-- File replacements retain a pointer and review snapshot for the previous copy.
CREATE TABLE IF NOT EXISTS public.contractor_document_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES public.contractor_companies(id) ON DELETE CASCADE,
  vehicle_id text REFERENCES public.driver_vehicles(id) ON DELETE CASCADE,
  document_kind text NOT NULL,
  file_path text NOT NULL,
  expiry_date date,
  review_status text NOT NULL,
  rejection_reason text,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  archived_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((company_id IS NOT NULL AND vehicle_id IS NULL) OR (company_id IS NULL AND vehicle_id IS NOT NULL))
);
ALTER TABLE public.contractor_document_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS contractor_document_history_select ON public.contractor_document_history;
CREATE POLICY contractor_document_history_select ON public.contractor_document_history FOR SELECT TO authenticated USING (
  public.is_admin(auth.uid()) OR
  (company_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.contractor_profiles cp WHERE cp.company_id = contractor_document_history.company_id AND cp.user_id = auth.uid())) OR
  (vehicle_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.driver_vehicles v WHERE v.id = contractor_document_history.vehicle_id AND v.user_id = auth.uid()))
);
REVOKE ALL ON public.contractor_document_history FROM anon, authenticated;
GRANT SELECT ON public.contractor_document_history TO authenticated;

CREATE OR REPLACE FUNCTION public.archive_contractor_company_document()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cols text[] := ARRAY['public_liability','workers_comp','agreement','nhvas']; k text; old_path text;
BEGIN
  FOREACH k IN ARRAY cols LOOP
    old_path := to_jsonb(OLD)->>(k || '_file_path');
    IF nullif(old_path, '') IS NOT NULL AND old_path IS DISTINCT FROM (to_jsonb(NEW)->>(k || '_file_path')) THEN
      INSERT INTO public.contractor_document_history(company_id, document_kind, file_path, expiry_date, review_status, rejection_reason, reviewed_by, reviewed_at)
      VALUES (OLD.id, k, old_path, nullif(to_jsonb(OLD)->>(k || '_expiry'), '')::date, coalesce(to_jsonb(OLD)->>(k || '_status'), 'pending'), to_jsonb(OLD)->>(k || '_rejection_reason'), nullif(to_jsonb(OLD)->>(k || '_reviewed_by'), '')::uuid, nullif(to_jsonb(OLD)->>(k || '_reviewed_at'), '')::timestamptz);
    END IF;
  END LOOP;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS contractor_company_document_history ON public.contractor_companies;
CREATE TRIGGER contractor_company_document_history BEFORE UPDATE ON public.contractor_companies
  FOR EACH ROW EXECUTE FUNCTION public.archive_contractor_company_document();

CREATE OR REPLACE FUNCTION public.archive_contractor_vehicle_document()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.rego_document_path IS NOT NULL AND OLD.rego_document_path IS DISTINCT FROM NEW.rego_document_path THEN
    INSERT INTO public.contractor_document_history(vehicle_id, document_kind, file_path, expiry_date, review_status, rejection_reason, reviewed_by, reviewed_at)
    VALUES (OLD.id, 'rego', OLD.rego_document_path, OLD.rego_expiry_date, OLD.rego_document_status, OLD.rego_document_rejection_reason, OLD.rego_document_reviewed_by, OLD.rego_document_reviewed_at);
  END IF;
  IF OLD.insurance_document_path IS NOT NULL AND OLD.insurance_document_path IS DISTINCT FROM NEW.insurance_document_path THEN
    INSERT INTO public.contractor_document_history(vehicle_id, document_kind, file_path, expiry_date, review_status, rejection_reason, reviewed_by, reviewed_at)
    VALUES (OLD.id, 'insurance', OLD.insurance_document_path, OLD.insurance_document_expiry, OLD.insurance_document_status, OLD.insurance_document_rejection_reason, OLD.insurance_document_reviewed_by, OLD.insurance_document_reviewed_at);
  END IF;
  IF OLD.inspection_document_path IS NOT NULL AND OLD.inspection_document_path IS DISTINCT FROM NEW.inspection_document_path THEN
    INSERT INTO public.contractor_document_history(vehicle_id, document_kind, file_path, expiry_date, review_status, rejection_reason, reviewed_by, reviewed_at)
    VALUES (OLD.id, 'inspection', OLD.inspection_document_path, OLD.inspection_document_expiry, OLD.inspection_document_status, OLD.inspection_document_rejection_reason, OLD.inspection_document_reviewed_by, OLD.inspection_document_reviewed_at);
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS contractor_vehicle_document_history ON public.driver_vehicles;
CREATE TRIGGER contractor_vehicle_document_history BEFORE UPDATE ON public.driver_vehicles
  FOR EACH ROW EXECUTE FUNCTION public.archive_contractor_vehicle_document();

CREATE OR REPLACE FUNCTION public.guard_driver_vehicle_document_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE evidence_changed boolean := false;
BEGIN
  IF coalesce(auth.role(), '') = 'service_role' OR public.is_admin(auth.uid()) THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.rego_document_status <> 'missing' OR NEW.insurance_document_status <> 'missing' OR NEW.inspection_document_status <> 'missing' THEN
      RAISE EXCEPTION 'Vehicle compliance evidence must be reviewed by an administrator';
    END IF;
    RETURN NEW;
  END IF;
  evidence_changed := NEW.rego_document_path IS DISTINCT FROM OLD.rego_document_path OR NEW.rego_expiry_date IS DISTINCT FROM OLD.rego_expiry_date OR
    NEW.insurance_document_path IS DISTINCT FROM OLD.insurance_document_path OR NEW.insurance_document_expiry IS DISTINCT FROM OLD.insurance_document_expiry OR
    NEW.inspection_document_path IS DISTINCT FROM OLD.inspection_document_path OR NEW.inspection_document_expiry IS DISTINCT FROM OLD.inspection_document_expiry;
  IF evidence_changed THEN
    IF NEW.rego_document_path IS DISTINCT FROM OLD.rego_document_path OR NEW.rego_expiry_date IS DISTINCT FROM OLD.rego_expiry_date THEN NEW.rego_document_status := 'pending'; NEW.rego_document_reviewed_by := NULL; NEW.rego_document_reviewed_at := NULL; END IF;
    IF NEW.insurance_document_path IS DISTINCT FROM OLD.insurance_document_path OR NEW.insurance_document_expiry IS DISTINCT FROM OLD.insurance_document_expiry THEN NEW.insurance_document_status := 'pending'; NEW.insurance_document_reviewed_by := NULL; NEW.insurance_document_reviewed_at := NULL; END IF;
    IF NEW.inspection_document_path IS DISTINCT FROM OLD.inspection_document_path OR NEW.inspection_document_expiry IS DISTINCT FROM OLD.inspection_document_expiry THEN NEW.inspection_document_status := 'pending'; NEW.inspection_document_reviewed_by := NULL; NEW.inspection_document_reviewed_at := NULL; END IF;
  ELSIF NEW.rego_document_status IS DISTINCT FROM OLD.rego_document_status OR NEW.rego_document_reviewed_by IS DISTINCT FROM OLD.rego_document_reviewed_by OR NEW.rego_document_reviewed_at IS DISTINCT FROM OLD.rego_document_reviewed_at OR
    NEW.insurance_document_status IS DISTINCT FROM OLD.insurance_document_status OR NEW.insurance_document_reviewed_by IS DISTINCT FROM OLD.insurance_document_reviewed_by OR NEW.insurance_document_reviewed_at IS DISTINCT FROM OLD.insurance_document_reviewed_at OR
    NEW.inspection_document_status IS DISTINCT FROM OLD.inspection_document_status OR NEW.inspection_document_reviewed_by IS DISTINCT FROM OLD.inspection_document_reviewed_by OR NEW.inspection_document_reviewed_at IS DISTINCT FROM OLD.inspection_document_reviewed_at THEN
    RAISE EXCEPTION 'Only an administrator can change vehicle document review status';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS driver_vehicle_document_review_guard ON public.driver_vehicles;
CREATE TRIGGER driver_vehicle_document_review_guard BEFORE INSERT OR UPDATE ON public.driver_vehicles
  FOR EACH ROW EXECUTE FUNCTION public.guard_driver_vehicle_document_review();

CREATE OR REPLACE FUNCTION public.guard_contractor_company_review_fields()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE compliance_changed boolean := false;
BEGIN
  IF coalesce(auth.role(), '') = 'service_role' OR public.is_admin(auth.uid()) THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'Pending Review' OR NEW.public_liability_status IS DISTINCT FROM 'pending' OR
       NEW.workers_comp_status IS DISTINCT FROM 'pending' OR NEW.agreement_status IS DISTINCT FROM 'missing' OR NEW.nhvas_status IS DISTINCT FROM 'missing' THEN
      RAISE EXCEPTION 'New contractor companies must start pending admin review';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    compliance_changed := NEW.public_liability_file_path IS DISTINCT FROM OLD.public_liability_file_path OR NEW.public_liability_expiry IS DISTINCT FROM OLD.public_liability_expiry OR NEW.public_liability_policy IS DISTINCT FROM OLD.public_liability_policy OR
      NEW.workers_comp_file_path IS DISTINCT FROM OLD.workers_comp_file_path OR NEW.workers_comp_expiry IS DISTINCT FROM OLD.workers_comp_expiry OR NEW.workers_comp_policy IS DISTINCT FROM OLD.workers_comp_policy OR
      NEW.agreement_file_path IS DISTINCT FROM OLD.agreement_file_path OR NEW.agreement_expiry IS DISTINCT FROM OLD.agreement_expiry OR
      NEW.nhvas_file_path IS DISTINCT FROM OLD.nhvas_file_path OR NEW.nhvas_expiry IS DISTINCT FROM OLD.nhvas_expiry OR NEW.nhvas_accreditation IS DISTINCT FROM OLD.nhvas_accreditation OR NEW.nhvas_number IS DISTINCT FROM OLD.nhvas_number;
    IF compliance_changed THEN
      NEW.status := 'Pending Review';
      IF NEW.public_liability_file_path IS DISTINCT FROM OLD.public_liability_file_path OR NEW.public_liability_expiry IS DISTINCT FROM OLD.public_liability_expiry OR NEW.public_liability_policy IS DISTINCT FROM OLD.public_liability_policy THEN NEW.public_liability_status := 'pending'; NEW.public_liability_reviewed_by := NULL; NEW.public_liability_reviewed_at := NULL; END IF;
      IF NEW.workers_comp_file_path IS DISTINCT FROM OLD.workers_comp_file_path OR NEW.workers_comp_expiry IS DISTINCT FROM OLD.workers_comp_expiry OR NEW.workers_comp_policy IS DISTINCT FROM OLD.workers_comp_policy THEN NEW.workers_comp_status := 'pending'; NEW.workers_comp_reviewed_by := NULL; NEW.workers_comp_reviewed_at := NULL; END IF;
      IF NEW.agreement_file_path IS DISTINCT FROM OLD.agreement_file_path OR NEW.agreement_expiry IS DISTINCT FROM OLD.agreement_expiry THEN NEW.agreement_status := 'pending'; NEW.agreement_reviewed_by := NULL; NEW.agreement_reviewed_at := NULL; END IF;
      IF NEW.nhvas_file_path IS DISTINCT FROM OLD.nhvas_file_path OR NEW.nhvas_expiry IS DISTINCT FROM OLD.nhvas_expiry OR NEW.nhvas_accreditation IS DISTINCT FROM OLD.nhvas_accreditation OR NEW.nhvas_number IS DISTINCT FROM OLD.nhvas_number THEN NEW.nhvas_status := CASE WHEN NEW.nhvas_accreditation = 'None' THEN 'missing' ELSE 'pending' END; NEW.nhvas_reviewed_by := NULL; NEW.nhvas_reviewed_at := NULL; END IF;
    END IF;
  END IF;
  IF NOT compliance_changed AND (
    NEW.status IS DISTINCT FROM OLD.status OR
    NEW.public_liability_status IS DISTINCT FROM OLD.public_liability_status OR NEW.public_liability_reviewed_by IS DISTINCT FROM OLD.public_liability_reviewed_by OR NEW.public_liability_reviewed_at IS DISTINCT FROM OLD.public_liability_reviewed_at OR
    NEW.workers_comp_status IS DISTINCT FROM OLD.workers_comp_status OR NEW.workers_comp_reviewed_by IS DISTINCT FROM OLD.workers_comp_reviewed_by OR NEW.workers_comp_reviewed_at IS DISTINCT FROM OLD.workers_comp_reviewed_at OR
    NEW.agreement_status IS DISTINCT FROM OLD.agreement_status OR NEW.agreement_reviewed_by IS DISTINCT FROM OLD.agreement_reviewed_by OR NEW.agreement_reviewed_at IS DISTINCT FROM OLD.agreement_reviewed_at OR
    NEW.nhvas_status IS DISTINCT FROM OLD.nhvas_status OR NEW.nhvas_reviewed_by IS DISTINCT FROM OLD.nhvas_reviewed_by OR NEW.nhvas_reviewed_at IS DISTINCT FROM OLD.nhvas_reviewed_at
  ) THEN RAISE EXCEPTION 'Only an administrator can change company review status'; END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS contractor_company_review_guard ON public.contractor_companies;
CREATE TRIGGER contractor_company_review_guard BEFORE INSERT OR UPDATE ON public.contractor_companies
  FOR EACH ROW EXECUTE FUNCTION public.guard_contractor_company_review_fields();

-- The existing private bucket holds new vehicle files. Only owner/admin can read.
CREATE OR REPLACE FUNCTION public.can_read_contractor_document(owner_folder text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE company_key text; vehicle_key text; owner_id uuid;
BEGIN
  IF public.is_admin(auth.uid()) THEN RETURN true; END IF;
  IF split_part(owner_folder, '/', 1) = 'companies' THEN
    RETURN EXISTS (SELECT 1 FROM public.contractor_profiles cp WHERE cp.company_id::text = split_part(owner_folder, '/', 2) AND cp.user_id = auth.uid());
  ELSIF split_part(owner_folder, '/', 1) = 'vehicles' THEN
    vehicle_key := split_part(owner_folder, '/', 2);
    RETURN EXISTS (SELECT 1 FROM public.driver_vehicles v WHERE v.id = vehicle_key AND v.user_id = auth.uid());
  END IF;
  company_key := split_part(owner_folder, '/', 1);
  IF company_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN false; END IF;
  owner_id := company_key::uuid;
  IF owner_id = auth.uid() THEN RETURN true; END IF;
  RETURN EXISTS (SELECT 1 FROM public.contractor_profiles viewer JOIN public.contractor_profiles owner ON owner.company_id = viewer.company_id WHERE viewer.user_id = auth.uid() AND owner.user_id = owner_id AND viewer.company_id IS NOT NULL);
END; $$;
NOTIFY pgrst, 'reload schema';
