-- ============================================================
-- Employee/Contractor Induction Records
-- Admin page for selecting existing workers and tracking CoR induction completion
-- ============================================================

-- 1. Main induction records table
create table if not exists public.employee_induction_records (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid references public.profiles(id) on delete cascade,
  employment_type text not null default 'employee' check (employment_type in ('employee', 'contractor')),
  staff_role text not null default 'driver' check (staff_role in ('driver', 'warehouse', 'office')),
  contractor_company_id uuid references public.contractor_profiles(user_id) on delete set null,
  role text,
  
  -- Checklist tracking (JSON array of {id, label, answered, notes, status})
  checklist jsonb default '[]'::jsonb,
  
  -- Document tracking (JSON array of doc status)
  documents jsonb default '[]'::jsonb,
  
  -- Acknowledgements (JSON array of {content, acknowledged, date})
  acknowledgements jsonb default '[]'::jsonb,
  
  -- Signatures (JSON array of {signer, role, signature, signed_at})
  signatures jsonb default '[]'::jsonb,
  
  status text not null default 'draft' check (status in ('draft', 'completed')),
  
  induction_start_date timestamptz,
  induction_completed_date timestamptz,
  
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Indexes for fast lookups
create index if not exists employee_induction_records_worker_idx
  on public.employee_induction_records (worker_id);

create index if not exists employee_induction_records_status_idx
  on public.employee_induction_records (status);

-- 2. RLS Policies

alter table public.employee_induction_records enable row level security;

drop policy if exists "employee_induction_records_select" on public.employee_induction_records;
create policy "employee_induction_records_select"
  on public.employee_induction_records for select
  using (auth.role() = 'authenticated');

drop policy if exists "employee_induction_records_admin_manage" on public.employee_induction_records;
create policy "employee_induction_records_admin_manage"
  on public.employee_induction_records for all
  using (public.is_admin(auth.uid()))
  with check (public.is_admin(auth.uid()));

-- Notify schema reload
NOTIFY pgrst, 'reload schema';

-- ============================================================
-- END OF EMPLOYEE INDUCTION RECORDS MIGRATION
-- ============================================================