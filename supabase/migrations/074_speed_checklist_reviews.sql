CREATE TABLE IF NOT EXISTS public.speed_checklist_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES public.cor_form_submissions(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reviewer_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  review_status text NOT NULL DEFAULT 'Pending Review' CHECK (review_status IN ('Pending Review', 'In Progress', 'Reviewed')),
  feedback text,
  corrective_action_required boolean NOT NULL DEFAULT false,
  internal_notes text,
  corrective_action_title text,
  corrective_action_description text,
  corrective_action_description text,
  assigned_to text,
  priority text,
  due_date date,
  corrective_action_status text CHECK (corrective_action_status IS NULL OR corrective_action_status IN ('Open', 'In Progress', 'Resolved')),
  resolution_notes text,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS speed_checklist_reviews_submission_idx ON public.speed_checklist_reviews (submission_id, reviewed_at DESC);
CREATE INDEX IF NOT EXISTS speed_checklist_reviews_driver_idx ON public.speed_checklist_reviews (driver_id, reviewed_at DESC);

ALTER TABLE public.speed_checklist_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.speed_checklist_reviews FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.speed_checklist_reviews TO service_role;

NOTIFY pgrst, 'reload schema';