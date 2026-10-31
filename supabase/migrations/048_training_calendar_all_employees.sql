-- Training calendar events may be assigned to one employee or all employees.
-- Migration 043 defines employee_id as nullable; restore that behavior on
-- databases where the column was made NOT NULL outside the migration.
ALTER TABLE public.training_calendar_events
  ALTER COLUMN employee_id DROP NOT NULL;
