-- Tutti i membri attivi vedono tutti i lavori dell'azienda; i dipendenti possono creare interventi urgenti
drop policy if exists "jobs_select" on public.jobs;
create policy "jobs_select" on public.jobs for select using (company_id = public.my_company());

drop policy if exists "jobs_member_insert" on public.jobs;
create policy "jobs_member_insert" on public.jobs for insert with check (company_id = public.my_company() and created_by = auth.uid());

drop policy if exists "jobs_member_update_urgent" on public.jobs;
create policy "jobs_member_update_urgent" on public.jobs for update
  using (company_id = public.my_company() and title like '🚨%')
  with check (company_id = public.my_company() and title like '🚨%');

drop policy if exists "mat_select" on public.job_materials;
create policy "mat_select" on public.job_materials for select using (public.job_company(job_id) = public.my_company());
drop policy if exists "mat_insert" on public.job_materials;
create policy "mat_insert" on public.job_materials for insert with check (
  added_by = auth.uid() and company_id = public.job_company(job_id) and company_id = public.my_company());

drop policy if exists "doc_select" on public.documents;
create policy "doc_select" on public.documents for select using (
  company_id = public.my_owned_company()
  or (company_id = public.my_company() and (uploaded_by = auth.uid() or job_id is not null)));
drop policy if exists "doc_insert" on public.documents;
create policy "doc_insert" on public.documents for insert with check (
  uploaded_by = auth.uid() and company_id = public.my_company()
  and (job_id is null or public.job_company(job_id) = company_id));

create or replace function public.update_job_progress(p_job uuid, p_status text, p_notes text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('todo','doing','done') then raise exception 'Stato non valido'; end if;
  if public.job_company(p_job) is distinct from public.my_company() then raise exception 'Operazione non consentita'; end if;
  update public.jobs set status = p_status, field_notes = p_notes where id = p_job;
end $$;
