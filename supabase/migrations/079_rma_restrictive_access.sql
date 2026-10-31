-- ============================================================
-- RMA-specific restrictive access policies
-- ============================================================
-- These policies do not alter or drop any existing policy.
-- They add restrictive (AND) layers on top of the existing
-- permissive policies for RMA and RMA_ACK rows only.

CREATE POLICY cor_form_submissions_rma_restrictive_select
  ON public.cor_form_submissions
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (
    form_code IS DISTINCT FROM 'RMA'
    OR is_admin(auth.uid())
    OR payload->>'status' = 'Approved'
  );

CREATE POLICY cor_form_submissions_rma_restrictive_insert
  ON public.cor_form_submissions
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (
    form_code IS DISTINCT FROM 'RMA'
    OR is_admin(auth.uid())
  );

CREATE POLICY cor_form_submissions_rma_restrictive_update
  ON public.cor_form_submissions
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING (
    form_code IS DISTINCT FROM 'RMA'
    OR is_admin(auth.uid())
  )
  WITH CHECK (
    form_code IS DISTINCT FROM 'RMA'
    OR is_admin(auth.uid())
  );

CREATE POLICY cor_form_submissions_rma_ack_restrictive_select
  ON public.cor_form_submissions
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (
    form_code IS DISTINCT FROM 'RMA_ACK'
    OR user_id = auth.uid()
    OR is_admin(auth.uid())
  );

NOTIFY pgrst, 'reload schema';