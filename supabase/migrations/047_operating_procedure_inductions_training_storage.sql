-- Allow authorised admins to upload/replace the single Operating Procedure PDF
-- used by Step 9 of the COR admin view. The induction-assets bucket is public so
-- drivers and admins can view/download the approved procedure by stable URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'induction-assets',
  'induction-assets',
  true,
  104857600,
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif',
    'application/pdf',
    'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/webm', 'audio/ogg',
    'video/mp4', 'video/webm', 'video/ogg'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "operating_procedure_admin_insert" on storage.objects;
create policy "operating_procedure_admin_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'induction-assets'
    and name = 'cor/operating-procedure-inductions-and-training.pdf'
    and public.is_admin(auth.uid())
  );

drop policy if exists "operating_procedure_admin_update" on storage.objects;
create policy "operating_procedure_admin_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'induction-assets'
    and name = 'cor/operating-procedure-inductions-and-training.pdf'
    and public.is_admin(auth.uid())
  )
  with check (
    bucket_id = 'induction-assets'
    and name = 'cor/operating-procedure-inductions-and-training.pdf'
    and public.is_admin(auth.uid())
  );

drop policy if exists "operating_procedure_admin_delete" on storage.objects;
create policy "operating_procedure_admin_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'induction-assets'
    and name = 'cor/operating-procedure-inductions-and-training.pdf'
    and public.is_admin(auth.uid())
  );