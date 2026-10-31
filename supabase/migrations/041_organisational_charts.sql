-- One shared chart for this single-organisation application. Employee IDs refer
-- to existing profiles; no employee records are inserted by this feature.
CREATE TABLE IF NOT EXISTS public.organisational_charts (
  id text PRIMARY KEY DEFAULT 'default' CHECK (id = 'default'),
  company_name text NOT NULL CHECK (length(trim(company_name)) BETWEEN 1 AND 200),
  date_completed date NOT NULL,
  roles jsonb NOT NULL CHECK (jsonb_typeof(roles) = 'array'),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.organisational_charts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.organisational_charts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.organisational_charts TO service_role;
NOTIFY pgrst, 'reload schema';