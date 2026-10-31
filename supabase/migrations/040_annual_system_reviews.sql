CREATE TABLE IF NOT EXISTS public.annual_system_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_year integer NOT NULL CHECK (review_year BETWEEN 2000 AND 2200),
  company_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  requirements jsonb NOT NULL DEFAULT '[]'::jsonb,
  follow_up jsonb NOT NULL DEFAULT '[]'::jsonb,
  acknowledgement jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  submitted_at timestamptz,
  retention_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (status = 'draft' AND submitted_at IS NULL AND retention_expires_at IS NULL)
    OR
    (status = 'submitted' AND submitted_at IS NOT NULL
      AND retention_expires_at >= submitted_at + interval '3 years')
  )
);

CREATE INDEX IF NOT EXISTS annual_system_reviews_recent_idx
  ON public.annual_system_reviews (review_year DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS annual_system_reviews_retention_idx
  ON public.annual_system_reviews (retention_expires_at)
  WHERE status = 'submitted';

ALTER TABLE public.annual_system_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.annual_system_reviews FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.annual_system_reviews TO service_role;

CREATE OR REPLACE FUNCTION public.prevent_early_annual_review_deletion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'submitted' AND OLD.retention_expires_at > now() THEN
    RAISE EXCEPTION 'Submitted annual system reviews must be retained until %.', OLD.retention_expires_at;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS annual_review_retention_guard ON public.annual_system_reviews;
CREATE TRIGGER annual_review_retention_guard
  BEFORE DELETE ON public.annual_system_reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_early_annual_review_deletion();

NOTIFY pgrst, 'reload schema';