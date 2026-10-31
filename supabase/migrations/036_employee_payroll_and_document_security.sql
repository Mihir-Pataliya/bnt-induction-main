-- Employee payroll records are encrypted by the API and are never selectable
-- through the public/authenticated PostgREST roles.
CREATE TABLE IF NOT EXISTS public.employee_payroll_details (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  tfn_ciphertext text,
  bank_account_name_ciphertext text,
  bank_bsb_ciphertext text,
  bank_account_number_ciphertext text,
  super_fund_choice text NOT NULL DEFAULT 'default' CHECK (super_fund_choice IN ('default', 'existing', 'self_managed')),
  super_fund_name_ciphertext text,
  super_member_number_ciphertext text,
  tax_declaration_confirmed_at timestamptz,
  payroll_updated_at timestamptz NOT NULL DEFAULT now(),
  retention_expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 years')
);
ALTER TABLE public.employee_payroll_details ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.employee_payroll_details FROM anon, authenticated;
GRANT ALL ON public.employee_payroll_details TO service_role;

CREATE TABLE IF NOT EXISTS public.employee_payroll_access (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  granted_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.employee_payroll_access ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS employee_payroll_access_admin_manage ON public.employee_payroll_access;
CREATE POLICY employee_payroll_access_admin_manage ON public.employee_payroll_access
  FOR ALL TO authenticated USING (public.is_admin(auth.uid())) WITH CHECK (public.is_admin(auth.uid()));
REVOKE ALL ON public.employee_payroll_access FROM anon, authenticated;
GRANT ALL ON public.employee_payroll_access TO service_role;

-- Record explicit employer verification separate from the uploaded evidence.
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS work_rights_check_status text NOT NULL DEFAULT 'not_checked' CHECK (work_rights_check_status IN ('not_checked','verified','not_verified')),
  ADD COLUMN IF NOT EXISTS work_rights_check_method text,
  ADD COLUMN IF NOT EXISTS work_rights_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS work_rights_checked_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS retention_expires_at timestamptz;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS employment_start_date date,
  ADD COLUMN IF NOT EXISTS employment_basis text;
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_employment_basis_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_employment_basis_check
  CHECK (employment_basis IS NULL OR employment_basis IN ('full_time','part_time','casual'));

-- Employee contract PDFs use the same private worker-document bucket and review
-- metadata as other onboarding evidence.
DO $$ BEGIN
  ALTER TYPE public.document_type ADD VALUE IF NOT EXISTS 'employment_contract';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('driver-documents', 'driver-documents', false, 10485760, ARRAY['application/pdf','image/jpeg','image/png'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 10485760,
  allowed_mime_types = ARRAY['application/pdf','image/jpeg','image/png'];

DROP POLICY IF EXISTS driver_documents_select ON storage.objects;
CREATE POLICY driver_documents_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'driver-documents' AND
    (public.is_admin(auth.uid()) OR (storage.foldername(name))[1] = auth.uid()::text));
DROP POLICY IF EXISTS driver_documents_insert ON storage.objects;
CREATE POLICY driver_documents_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'driver-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS driver_documents_update ON storage.objects;
CREATE POLICY driver_documents_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'driver-documents' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'driver-documents' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS driver_documents_delete ON storage.objects;
CREATE POLICY driver_documents_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'driver-documents' AND
    (public.is_admin(auth.uid()) OR (storage.foldername(name))[1] = auth.uid()::text));

-- Callable retention job. Schedule public.purge_expired_employee_payroll() with
-- the deployment's database scheduler; it removes only expired encrypted rows.
CREATE OR REPLACE FUNCTION public.purge_expired_employee_payroll()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE removed integer;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service role required';
  END IF;
  DELETE FROM public.employee_payroll_details WHERE retention_expires_at <= now();
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END;
$$;
REVOKE ALL ON FUNCTION public.purge_expired_employee_payroll() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_employee_payroll() TO service_role;

NOTIFY pgrst, 'reload schema';
