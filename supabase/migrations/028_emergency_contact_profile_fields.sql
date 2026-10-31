ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS emergency_contact_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS emergency_contact_relationship text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS emergency_contact_phone text NOT NULL DEFAULT '';