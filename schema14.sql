-- Tipo di cliente (privato, azienda, comune/ente, condominio, altro)
alter table public.clients add column if not exists category text;
