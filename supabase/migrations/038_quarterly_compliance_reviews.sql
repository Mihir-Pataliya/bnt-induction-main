CREATE TABLE IF NOT EXISTS public.quarterly_compliance_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_quarter text NOT NULL CHECK (review_quarter IN ('Q1', 'Q2', 'Q3', 'Q4')),
  review_year integer NOT NULL CHECK (review_year BETWEEN 2000 AND 2200),
  company_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  section_data jsonb NOT NULL DEFAULT '[]'::jsonb,
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

CREATE INDEX IF NOT EXISTS quarterly_compliance_reviews_recent_idx
  ON public.quarterly_compliance_reviews (review_year DESC, review_quarter, updated_at DESC);
CREATE INDEX IF NOT EXISTS quarterly_compliance_reviews_retention_idx
  ON public.quarterly_compliance_reviews (retention_expires_at)
  WHERE status = 'submitted';

ALTER TABLE public.quarterly_compliance_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.quarterly_compliance_reviews FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.quarterly_compliance_reviews TO service_role;

CREATE OR REPLACE FUNCTION public.prevent_early_quarterly_review_deletion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'submitted' AND OLD.retention_expires_at > now() THEN
    RAISE EXCEPTION 'Submitted quarterly reviews must be retained until %.', OLD.retention_expires_at;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS quarterly_review_retention_guard ON public.quarterly_compliance_reviews;
CREATE TRIGGER quarterly_review_retention_guard
  BEFORE DELETE ON public.quarterly_compliance_reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_early_quarterly_review_deletion();

NOTIFY pgrst, 'reload schema';
