-- ============================================================
-- Training Calendar Feature
-- Allows admins to schedule training events for employees/subcontractors
-- with calendar and list views, Scheduled/Completed/Overdue statuses,
-- and refresher due dates.
-- ============================================================

-- 1. training_calendar_events table
create table if not exists public.training_calendar_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  topic text not null,
  trainer text not null,
  employee_id uuid references public.profiles(id) on delete cascade,
  target_group text,
  role text,
  scheduled_date timestamptz not null,
  start_time text,
  end_time text,
  refresher_due_date timestamptz,
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'overdue')),
  notes text default '',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists training_calendar_events_employee_idx
  on public.training_calendar_events (employee_id);

create index if not exists training_calendar_events_status_idx
  on public.training_calendar_events (status);

create index if not exists training_calendar_events_scheduled_idx
  on public.training_calendar_events (scheduled_date);

-- 2. RLS Policies

alter table public.training_calendar_events enable row level security;

drop policy if exists "training_calendar_events_select" on public.training_calendar_events;
create policy "training_calendar_events_select"
  on public.training_calendar_events for select
  using (auth.role() = 'authenticated');

drop policy if exists "training_calendar_events_admin_manage" on public.training_calendar_events;
create policy "training_calendar_events_admin_manage"
  on public.training_calendar_events for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- Notify schema reload
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- END OF TRAINING CALENDAR MIGRATION
-- ============================================================