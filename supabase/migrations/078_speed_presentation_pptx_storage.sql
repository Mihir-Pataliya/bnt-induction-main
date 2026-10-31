-- Allow PPTX files in the induction-assets bucket for Speed Awareness presentations.
update storage.buckets
set allowed_mime_types = array[
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/pdf',
  'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/webm', 'audio/ogg',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
]
where id = 'induction-assets';

-- Ensure RLS policy permits admins to upload PPTX assets (folder = admin uid).
drop policy if exists "induction_assets_admin_insert" on storage.objects;
create policy "induction_assets_admin_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'induction-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_admin(auth.uid())
  );

drop policy if exists "induction_assets_admin_update" on storage.objects;
create policy "induction_assets_admin_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'induction-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_admin(auth.uid())
  )
  with check (
    bucket_id = 'induction-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_admin(auth.uid())
  );

drop policy if exists "induction_assets_admin_delete" on storage.objects;
create policy "induction_assets_admin_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'induction-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_admin(auth.uid())
  );

NOTIFY pgrst, 'reload schema';