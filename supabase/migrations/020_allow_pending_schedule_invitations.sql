-- The schedule processor creates in-app invitations with status = 'pending'.
-- Migration 013's status check did not include that value, so processing failed
-- before the invitation could be shown in the driver's portal.
ALTER TABLE public.induction_schedule_invitations
  DROP CONSTRAINT IF EXISTS induction_schedule_invitations_status_check;

ALTER TABLE public.induction_schedule_invitations
  ADD CONSTRAINT induction_schedule_invitations_status_check
  CHECK (status IN ('pending', 'sent', 'delivered', 'opened', 'clicked', 'failed', 'bounced'));
