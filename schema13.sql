-- Tutti i membri dell'azienda possono creare/modificare lavori e clienti (solo la parte fiscale resta al titolare)

drop policy if exists "jobs_member_update" on public.jobs;
create policy "jobs_member_update" on public.jobs for update
  using (company_id = public.my_company()) with check (company_id = public.my_company());

drop policy if exists "clients_member_insert" on public.clients;
create policy "clients_member_insert" on public.clients for insert with check (company_id = public.my_company());
drop policy if exists "clients_member_update" on public.clients;
create policy "clients_member_update" on public.clients for update
  using (company_id = public.my_company()) with check (company_id = public.my_company());

drop policy if exists "assign_member_insert" on public.job_assignments;
create policy "assign_member_insert" on public.job_assignments for insert with check (public.job_company(job_id) = public.my_company());
drop policy if exists "assign_member_delete" on public.job_assignments;
create policy "assign_member_delete" on public.job_assignments for delete using (public.job_company(job_id) = public.my_company());

grant select, insert, update on public.clients to authenticated;
grant select, insert, update on public.jobs to authenticated;
grant select, insert, delete on public.job_assignments to authenticated;
