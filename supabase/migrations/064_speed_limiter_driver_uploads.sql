DROP POLICY IF EXISTS "speed_limiter_driver_insert" ON storage.objects;
CREATE POLICY "speed_limiter_driver_insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'induction-assets'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND (storage.foldername(name))[2] = 'speed-limiter'
  );
