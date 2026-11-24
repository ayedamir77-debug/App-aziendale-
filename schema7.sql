-- ===== APP AZIENDA: fase 7 (Mezzi: veicoli, scadenze, scontrini carburante) =====
-- Incolla tutto in Supabase > SQL Editor > Run. Si puo' rilanciare senza problemi.

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  plate text,
  kind text,
  notes text,
  created_at timestamptz not null default now()
);
create table if not exists public.vehicle_deadlines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  kind text not null default 'altro',
  due_date date not null,
  notes text,
  done boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.documents add column if not exists vehicle_id uuid references public.vehicles(id) on delete set null;

alter table public.vehicles enable row level security;
alter table public.vehicle_deadlines enable row level security;

drop policy if exists "vehicles_member" on public.vehicles;
create policy "vehicles_member" on public.vehicles for all
  using (company_id = public.my_company()) with check (company_id = public.my_company());
drop policy if exists "vdl_member" on public.vehicle_deadlines;
create policy "vdl_member" on public.vehicle_deadlines for all
  using (company_id = public.my_company()) with check (company_id = public.my_company());

grant select, insert, update, delete on public.vehicles, public.vehicle_deadlines to authenticated;
