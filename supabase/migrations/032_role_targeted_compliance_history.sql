-- Make existing learning sections targetable and version their completion
-- evidence. Keep the existing catalogue and completion tables.
ALTER TABLE public.learning_sections
  ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS target_role text NOT NULL DEFAULT 'driver',
  ADD COLUMN IF NOT EXISTS is_mandatory boolean NOT NULL DEFAULT true;

-- Preserve completion evidence against the content version it belongs to.
-- Legacy completion rows remain valid for the existing 1.0 content.
ALTER TABLE public.learning_section_completions
  ADD COLUMN IF NOT EXISTS section_version text NOT NULL DEFAULT '1.0';

ALTER TABLE public.learning_sections DROP CONSTRAINT IF EXISTS learning_sections_audience_check;
ALTER TABLE public.learning_sections ADD CONSTRAINT learning_sections_audience_check
  CHECK (audience IN ('all', 'employee', 'contractor'));
ALTER TABLE public.learning_sections DROP CONSTRAINT IF EXISTS learning_sections_target_role_check;
ALTER TABLE public.learning_sections ADD CONSTRAINT learning_sections_target_role_check
  CHECK (target_role IN ('all', 'driver', 'warehouse', 'office'));

-- Existing safety curriculum is retained as mandatory driver training.
UPDATE public.learning_sections
SET audience = coalesce(nullif(audience, ''), 'all'),
    target_role = coalesce(nullif(target_role, ''), 'driver'),
    is_mandatory = coalesce(is_mandatory, true),
    version = coalesce(nullif(version, ''), '1.0');

-- Workplace-wide modules apply to all staff roles and engagement types.
UPDATE public.learning_sections
SET target_role = 'all', audience = 'all'
WHERE lower(title) IN (
  'privacy and confidentiality', 'code of conduct',
  'workplace behaviour, bullying and harassment',
  'incident, injury and hazard reporting', 'emergency and evacuation',
  'it and acceptable use'
) OR lower(title) LIKE 'incident, injury and hazard reporting%';

-- The contractor services agreement is a company obligation for all contractor
-- staff roles, not only contractor drivers.
UPDATE public.policies
SET target_role = 'all'
WHERE lower(coalesce(nullif(name, ''), title)) = lower('Contractor Services Agreement and Compliance Undertaking')
  AND audience = 'contractor';

-- Apply the same engagement and role filter to direct authenticated reads.
-- Admin users retain access to the full learning catalogue for management.
DROP POLICY IF EXISTS learning_sections_select ON public.learning_sections;
CREATE POLICY learning_sections_select ON public.learning_sections FOR SELECT TO authenticated
  USING (
    public.is_admin(auth.uid()) OR
    ((audience = 'all' OR
      (audience = 'contractor' AND (coalesce((SELECT p.employment_type FROM public.profiles p WHERE p.id = auth.uid()), 'employee') = 'contractor' OR EXISTS (SELECT 1 FROM public.contractor_profiles cp WHERE cp.user_id = auth.uid()))) OR
      (audience = 'employee' AND NOT EXISTS (SELECT 1 FROM public.contractor_profiles cp WHERE cp.user_id = auth.uid()) AND coalesce((SELECT p.employment_type FROM public.profiles p WHERE p.id = auth.uid()), 'employee') = 'employee')) AND
     (target_role = 'all' OR target_role = coalesce((SELECT p.staff_role FROM public.profiles p WHERE p.id = auth.uid()), 'driver')))
  );

NOTIFY pgrst, 'reload schema';
