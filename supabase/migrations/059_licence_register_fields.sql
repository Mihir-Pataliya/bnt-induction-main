-- Store licence register fields on the existing profile record.
-- Date of birth already exists via 033_profile_date_of_birth.sql.
-- licence_history_provided is separate from the driving history document upload.
-- left_business records departure without deleting or archiving the worker record.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS licence_history_provided boolean NOT NULL DEFAULT false;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS left_business boolean NOT NULL DEFAULT false;
