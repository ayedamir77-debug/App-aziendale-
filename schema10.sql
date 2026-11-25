-- Notifiche sul telefono (push)
create table if not exists public.push_subs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subs enable row level security;
drop policy if exists "push proprie" on public.push_subs;
create policy "push proprie" on public.push_subs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and company_id = public.my_company());
grant select, insert, update, delete on public.push_subs to authenticated;

create table if not exists public.push_config (
  id int primary key,
  public_key text not null,
  private_key text not null
);
alter table public.push_config enable row level security;   -- nessuna policy: lo legge solo la funzione
revoke all on public.push_config from anon, authenticated;
