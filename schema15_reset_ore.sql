-- RESET ORE (da lanciare UNA volta sola, domenica sera o lunedì mattina)
-- Azzera le ore di tutti (Amir, Daniele, Simone). Rapportini, testi, materiali, clienti, lavori restano.
-- Prima di cancellare salva una copia in due tabelle di backup, così si può tornare indietro.
begin;

create table if not exists public.backup_ore_reports as select id, minutes from public.reports where minutes is not null;
create table if not exists public.backup_ore_time_entries as select * from public.time_entries;
alter table public.backup_ore_reports enable row level security;      -- nessuno le vede dall'app
alter table public.backup_ore_time_entries enable row level security;

update public.reports set minutes = null where minutes is not null;
delete from public.time_entries;

commit;

-- Per controllare dopo (devono dare 0):
--   select count(*) from public.reports where minutes is not null;
--   select count(*) from public.time_entries;
-- Per tornare indietro (solo se serve):
--   update public.reports r set minutes = b.minutes from public.backup_ore_reports b where b.id = r.id;
--   insert into public.time_entries select * from public.backup_ore_time_entries;
