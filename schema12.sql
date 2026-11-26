-- Stato "Non più necessario" per i lavori
do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.jobs'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%status%' loop
    execute format('alter table public.jobs drop constraint %I', c.conname);
  end loop;
end $$;

create or replace function public.update_job_progress(p_job uuid, p_status text, p_notes text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_status not in ('todo','doing','done','void') then raise exception 'Stato non valido'; end if;
  if public.job_company(p_job) is distinct from public.my_company() then raise exception 'Operazione non consentita'; end if;
  update public.jobs set status = p_status, field_notes = p_notes where id = p_job;
end $$;
