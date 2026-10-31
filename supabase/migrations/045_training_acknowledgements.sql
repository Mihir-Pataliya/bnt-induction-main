-- Presentation-specific training acknowledgements.
-- Each row links an existing worker and a versioned Step 3 safety presentation.
create table if not exists public.training_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.profiles(id) on delete cascade,
  section_id text not null,
  section_version text not null,
  presentation_title text not null,
  acknowledgement_statement text not null,
  acknowledged_at timestamptz not null default now(),
  signature text not null check (length(btrim(signature)) >= 2),
  signed_at timestamptz not null default now(),
  recorded_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint training_acknowledgements_worker_presentation_version_key
    unique (worker_id, section_id, section_version)
);

create index if not exists training_acknowledgements_worker_idx
  on public.training_acknowledgements (worker_id);

create index if not exists training_acknowledgements_presentation_idx
  on public.training_acknowledgements (section_id, section_version);

alter table public.training_acknowledgements enable row level security;

drop policy if exists "training_acknowledgements_select" on public.training_acknowledgements;
create policy "training_acknowledgements_select"
  on public.training_acknowledgements for select
  using (auth.role() = 'authenticated');

drop policy if exists "training_acknowledgements_admin_manage" on public.training_acknowledgements;
create policy "training_acknowledgements_admin_manage"
  on public.training_acknowledgements for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

notify pgrst, 'reload schema';
