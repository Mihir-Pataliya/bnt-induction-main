drop policy if exists "training_acknowledgements_select" on public.training_acknowledgements;
create policy "training_acknowledgements_select"
  on public.training_acknowledgements for select
  using (worker_id = auth.uid() or public.is_admin(auth.uid()));
