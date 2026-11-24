-- ===== APP AZIENDA: fase 8 (chat interna) =====
-- Incolla tutto in Supabase > SQL Editor > Run. Si puo' rilanciare senza problemi.
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index if not exists chat_company_time on public.chat_messages(company_id, created_at desc);
alter table public.chat_messages enable row level security;
drop policy if exists "chat_sel" on public.chat_messages;
create policy "chat_sel" on public.chat_messages for select using (company_id = public.my_company());
drop policy if exists "chat_ins" on public.chat_messages;
create policy "chat_ins" on public.chat_messages for insert with check (company_id = public.my_company() and user_id = auth.uid());
drop policy if exists "chat_del" on public.chat_messages;
create policy "chat_del" on public.chat_messages for delete using (company_id = public.my_company() and (user_id = auth.uid() or company_id = public.my_owned_company()));
grant select, insert, delete on public.chat_messages to authenticated;
