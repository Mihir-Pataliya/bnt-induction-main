-- Earlier Safe Driving Plan saves could retain the creator as user_id while
-- recording the assigned driver in payload. Normalize those existing rows so
-- the driver query and row-level policies use the same profile/auth user ID.
UPDATE public.cor_form_submissions AS submission
SET user_id = driver.id
FROM public.profiles AS driver
WHERE submission.form_code = 'SDP'
  AND driver.role = 'driver'
  AND driver.id::text = submission.payload ->> 'assignedDriverId'
  AND submission.user_id <> driver.id;

NOTIFY pgrst, 'reload schema';
