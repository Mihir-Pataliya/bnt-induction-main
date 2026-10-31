-- Admin-managed company identity fields. Existing shared company, driver-link,
-- insurance, policy, and private storage tables remain the source of truth.
ALTER TABLE public.contractor_companies
  ADD COLUMN IF NOT EXISTS acn text NOT NULL DEFAULT '';

CREATE OR REPLACE FUNCTION public.can_read_contractor_document(owner_folder text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE owner_id uuid;
BEGIN
  IF public.is_admin(auth.uid()) THEN RETURN true; END IF;
  IF split_part(owner_folder, '/', 1) = 'companies' THEN
    RETURN EXISTS (SELECT 1 FROM public.contractor_profiles cp
      WHERE cp.company_id::text = split_part(owner_folder, '/', 2) AND cp.user_id = auth.uid());
  END IF;
  owner_folder := split_part(owner_folder, '/', 1);
  IF owner_folder !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN false; END IF;
  owner_id := owner_folder::uuid;
  IF owner_id = auth.uid() THEN RETURN true; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.contractor_profiles viewer
    JOIN public.contractor_profiles owner ON owner.company_id = viewer.company_id
    WHERE viewer.user_id = auth.uid() AND owner.user_id = owner_id AND viewer.company_id IS NOT NULL
  );
END;
$$;
DROP POLICY IF EXISTS contractor_documents_select ON storage.objects;
CREATE POLICY contractor_documents_select ON storage.objects FOR SELECT
  USING (bucket_id = 'contractor-documents' AND public.can_read_contractor_document(name));
