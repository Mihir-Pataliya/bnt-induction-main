-- Allow authenticated users to use the third-party tables through Supabase RLS.
-- Without these privileges, PostgREST rejects queries before the RLS policies run.
GRANT SELECT, INSERT, UPDATE, DELETE
ON public.third_party_register,
   public.third_party_engagement_applications
TO authenticated;

GRANT ALL ON public.third_party_register,
              public.third_party_engagement_applications
TO service_role;

DROP POLICY IF EXISTS "third_party_register_user_all" ON public.third_party_register;
CREATE POLICY "third_party_register_user_all"
  ON public.third_party_register FOR ALL
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS "third_party_engagement_applications_user_all" ON public.third_party_engagement_applications;
CREATE POLICY "third_party_engagement_applications_user_all"
  ON public.third_party_engagement_applications FOR ALL
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

NOTIFY pgrst, 'reload schema';
