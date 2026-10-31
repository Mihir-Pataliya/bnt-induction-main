-- ============================================================
-- Third party / subcontractor register
-- ============================================================

CREATE TABLE IF NOT EXISTS public.third_party_register (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  business_name text NOT NULL DEFAULT '',
  trading_name text NOT NULL DEFAULT '',
  acn text,
  postal_address text NOT NULL DEFAULT '',
  contact_person text NOT NULL DEFAULT '',
  position text NOT NULL DEFAULT '',
  mobile text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  business_activity text NOT NULL DEFAULT '',
  accreditation_type text NOT NULL DEFAULT '',
  accreditation_number text NOT NULL DEFAULT '',
  accreditation_expiry date,
  certification_details text NOT NULL DEFAULT '',
  certification_expiry date,
  engagement_application_status text NOT NULL DEFAULT 'Not Started'
    CHECK (engagement_application_status IN ('Not Started', 'Submitted', 'Under Review', 'Accepted', 'Rejected')),
  mutual_obligation_status text NOT NULL DEFAULT 'Not Issued'
    CHECK (mutual_obligation_status IN ('Not Issued', 'Pending Signatures', 'Signed by Both Parties')),
  status text NOT NULL DEFAULT 'Active'
    CHECK (status IN ('Active', 'Inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS third_party_register_user_idx
  ON public.third_party_register (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS third_party_register_status_idx
  ON public.third_party_register (status, updated_at DESC);

ALTER TABLE public.third_party_register ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "third_party_register_admin_all" ON public.third_party_register;
CREATE POLICY "third_party_register_admin_all"
  ON public.third_party_register FOR ALL
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

GRANT ALL ON public.third_party_register TO service_role;
NOTIFY pgrst, 'reload schema';
