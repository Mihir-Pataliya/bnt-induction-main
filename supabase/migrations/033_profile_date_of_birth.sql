-- Store the driver's date of birth on the existing profile record.
-- Nullable for existing profiles; Step 1 requires it before completion.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS date_of_birth date;
