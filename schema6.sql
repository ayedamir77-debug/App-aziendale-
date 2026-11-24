-- ===== APP AZIENDA: fase 6 (rapportini, magazzino, biblioteca, schede impianto, bacheca, ferie, km, garanzie, checklist, IA) =====
-- Incolla tutto in Supabase > SQL Editor > Run. Si puo' rilanciare senza problemi.

-- ---------- colonne nuove su tabelle esistenti ----------
alter table public.documents add column if not exists items jsonb;
alter table public.documents add column if not exists phase text;             -- 'prima' / 'dopo' per le foto
alter table public.documents drop constraint if exists documents_kind_check;
alter table public.documents add constraint documents_kind_check
  check (kind in ('foto','bolla','fattura','preventivo','scontrino','conformita','contratto','firma','rapporto','altro'));

alter table public.invoices add column if not exists job_id uuid references public.jobs(id) on delete set null;

alter table public.companies add column if not exists hourly_cost numeric;
alter table public.companies add column if not exists ai_enabled boolean not null default false;
alter table public.companies add column if not exists ai_provider text not null default 'claude';
alter table public.companies add column if not exists track_pos boolean not null default false;

alter table public.time_entries add column if not exists in_lat double precision;
alter table public.time_entries add column if not exists in_lng double precision;
alter table public.time_entries add column if not exists out_lat double precision;
alter table public.time_entries add column if not exists out_lng double precision;

-- ---------- tabelle nuove ----------
create table if not exists public.reports (          -- rapportini di fine giornata
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  job_id uuid references public.jobs(id) on delete set null,
  day date not null default current_date,
  summary text,
  with_ids uuid[] not null default '{}',
  materials jsonb not null default '[]',
  minutes integer,
  created_at timestamptz not null default now()
);
create table if not exists public.comments (         -- commenti su rapportini e bacheca
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  ref_type text not null check (ref_type in ('report','post')),
  ref_id uuid not null,
  body text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.posts (            -- bacheca avvisi
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.stock (            -- magazzino
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  code text,
  description text not null,
  quantity numeric not null default 0,
  unit text,
  location text,
  note text,
  updated_at timestamptz not null default now()
);
create table if not exists public.library (          -- biblioteca tecnica
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  category text not null default 'Altro',
  brand text,
  model text,
  title text not null,
  note text,
  url text,
  file_path text,
  file_name text,
  ocr_text text,
  fav boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.assets (           -- schede impianto per cliente
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  title text not null,
  address_url text,
  username text,
  secret text,
  notes text,
  created_at timestamptz not null default now()
);
create table if not exists public.warranties (       -- garanzie e manutenzioni
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  kind text not null default 'manutenzione' check (kind in ('garanzia','manutenzione')),
  title text not null,
  due_date date not null,
  notes text,
  done boolean not null default false,
  created_at timestamptz not null default now()
);
create table if not exists public.checklists (       -- modelli di checklist
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  items jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create table if not exists public.job_checklists (   -- checklist su un lavoro
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  job_id uuid not null references public.jobs(id) on delete cascade,
  name text not null,
  items jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create table if not exists public.leave_requests (   -- ferie e permessi
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null default 'ferie',
  from_date date not null,
  to_date date not null,
  note text,
  status text not null default 'richiesta' check (status in ('richiesta','ok','no')),
  created_at timestamptz not null default now()
);
create table if not exists public.km_log (           -- chilometri veicoli
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null default current_date,
  vehicle text,
  km_start numeric,
  km_end numeric,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists reports_company_day on public.reports(company_id, day desc);
create index if not exists comments_ref on public.comments(ref_type, ref_id);
create index if not exists library_company on public.library(company_id);
create index if not exists stock_company on public.stock(company_id);

do $$
declare t text;
begin
  foreach t in array array['reports','comments','posts','stock','library','assets','warranties','checklists','job_checklists','leave_requests','km_log'] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---------- regole: tutti i membri attivi vedono e usano le tabelle condivise ----------
do $$
declare t text;
begin
  foreach t in array array['stock','library','assets','warranties','checklists','job_checklists'] loop
    execute format('drop policy if exists "%1$s_member" on public.%1$I', t);
    execute format('create policy "%1$s_member" on public.%1$I for all using (company_id = public.my_company()) with check (company_id = public.my_company())', t);
  end loop;
end $$;

-- ---------- regole: tabelle con autore (vedono tutti, modifica l'autore o il titolare) ----------
do $$
declare t text;
begin
  foreach t in array array['reports','comments','posts'] loop
    execute format('drop policy if exists "%1$s_sel" on public.%1$I', t);
    execute format('create policy "%1$s_sel" on public.%1$I for select using (company_id = public.my_company())', t);
    execute format('drop policy if exists "%1$s_ins" on public.%1$I', t);
    execute format('create policy "%1$s_ins" on public.%1$I for insert with check (company_id = public.my_company() and user_id = auth.uid())', t);
    execute format('drop policy if exists "%1$s_upd" on public.%1$I', t);
    execute format('create policy "%1$s_upd" on public.%1$I for update using (company_id = public.my_company() and (user_id = auth.uid() or company_id = public.my_owned_company())) with check (company_id = public.my_company())', t);
    execute format('drop policy if exists "%1$s_del" on public.%1$I', t);
    execute format('create policy "%1$s_del" on public.%1$I for delete using (company_id = public.my_company() and (user_id = auth.uid() or company_id = public.my_owned_company()))', t);
  end loop;
end $$;

-- ferie: tutti vedono, ognuno chiede le sue, il titolare decide
drop policy if exists "leave_sel" on public.leave_requests;
create policy "leave_sel" on public.leave_requests for select using (company_id = public.my_company());
drop policy if exists "leave_ins" on public.leave_requests;
create policy "leave_ins" on public.leave_requests for insert with check (company_id = public.my_company() and user_id = auth.uid() and status = 'richiesta');
drop policy if exists "leave_upd" on public.leave_requests;
create policy "leave_upd" on public.leave_requests for update using (company_id = public.my_owned_company()) with check (company_id = public.my_owned_company());
drop policy if exists "leave_del" on public.leave_requests;
create policy "leave_del" on public.leave_requests for delete using (company_id = public.my_company() and (company_id = public.my_owned_company() or (user_id = auth.uid() and status = 'richiesta')));

-- km: ognuno i suoi, il titolare tutti
drop policy if exists "km_sel" on public.km_log;
create policy "km_sel" on public.km_log for select using (company_id = public.my_owned_company() or (company_id = public.my_company() and user_id = auth.uid()));
drop policy if exists "km_ins" on public.km_log;
create policy "km_ins" on public.km_log for insert with check (company_id = public.my_company() and user_id = auth.uid());
drop policy if exists "km_del" on public.km_log;
create policy "km_del" on public.km_log for delete using (company_id = public.my_owned_company() or (company_id = public.my_company() and user_id = auth.uid()));

-- ---------- file della biblioteca (cartella <azienda>/lib/...) ----------
drop policy if exists "lib_select" on storage.objects;
create policy "lib_select" on storage.objects for select to authenticated using (
  bucket_id = 'docs' and (storage.foldername(name))[1] = public.my_company()::text and (storage.foldername(name))[2] = 'lib');
drop policy if exists "lib_delete" on storage.objects;
create policy "lib_delete" on storage.objects for delete to authenticated using (
  bucket_id = 'docs' and (storage.foldername(name))[1] = public.my_company()::text and (storage.foldername(name))[2] = 'lib');

-- ---------- impostazioni extra del titolare (costo orario, IA, posizione) ----------
create or replace function public.set_company_extra(p_hourly numeric, p_ai boolean, p_provider text, p_pos boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_co uuid := public.my_owned_company();
begin
  if v_co is null then raise exception 'Operazione non consentita'; end if;
  if p_provider not in ('claude','gemini') then raise exception 'Motore non valido'; end if;
  update public.companies set hourly_cost = p_hourly, ai_enabled = coalesce(p_ai, false), ai_provider = p_provider, track_pos = coalesce(p_pos, false) where id = v_co;
end $$;
revoke all on function public.set_company_extra(numeric, boolean, text, boolean) from public, anon;
grant execute on function public.set_company_extra(numeric, boolean, text, boolean) to authenticated;

-- ---------- timbratura con posizione (facoltativa) ----------
create or replace function public.clock_in_pos(p_job uuid, p_lat double precision, p_lng double precision)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.clock_in(p_job);
  update public.time_entries set in_lat = p_lat, in_lng = p_lng
   where user_id = auth.uid() and ended_at is null;
end $$;
create or replace function public.clock_out_pos(p_lat double precision, p_lng double precision)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.time_entries set out_lat = p_lat, out_lng = p_lng
   where user_id = auth.uid() and ended_at is null;
  perform public.clock_out();
end $$;
revoke all on function public.clock_in_pos(uuid, double precision, double precision) from public, anon;
revoke all on function public.clock_out_pos(double precision, double precision) from public, anon;
grant execute on function public.clock_in_pos(uuid, double precision, double precision) to authenticated;
grant execute on function public.clock_out_pos(double precision, double precision) to authenticated;

-- ---------- i colleghi vedono i nomi dei colleghi della stessa azienda ----------
drop policy if exists "colleghi vedono colleghi" on public.profiles;
create policy "colleghi vedono colleghi" on public.profiles for select
  using (company_id = public.my_company() and status = 'active');
