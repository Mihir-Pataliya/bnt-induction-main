-- ============================================================
-- Third party engagement applications
-- ============================================================

CREATE TABLE IF NOT EXISTS public.third_party_engagement_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  register_id uuid NOT NULL REFERENCES public.third_party_register(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'Draft'
    CHECK (status IN ('Draft', 'Submitted', 'Under Review', 'Accepted', 'Rejected', 'More Information Required')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  review_comments text,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS third_party_engagement_applications_register_idx
  ON public.third_party_engagement_applications (register_id, updated_at DESC);

ALTER TABLE public.third_party_engagement_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "third_party_engagement_applications_admin_all" ON public.third_party_engagement_applications;
CREATE POLICY "third_party_engagement_applications_admin_all"
  ON public.third_party_engagement_applications FOR ALL
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

GRANT ALL ON public.third_party_engagement_applications TO service_role;
NOTIFY pgrst, 'reload schema';
