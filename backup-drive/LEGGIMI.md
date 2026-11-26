# Backup notturno su Google Drive

Ogni notte (03:30) GitHub Actions salva su Drive, nella cartella scelta:
- `backup-light-project-AAAA-MM-GG.json.gz`: tutti i dati (ultimi 30)
- `db-public-AAAA-MM-GG.sql.gz`: database completo: tabelle, regole (RLS), funzioni, dati (ultimi 30)
- `db-sistema-utenti-AAAA-MM-GG.sql.gz`: utenti (auth) e archivio (storage), se riesce (ultimi 30)
- cartella `files/`: tutte le foto e i documenti (copia incrementale, non cancella mai)

Il codice dell'app e delle funzioni è già in questo repository GitHub.
Non salvabili (si rifanno a mano): i segreti di Supabase (GEMINI_API_KEY, GEMINI_MODEL).

## Segreti GitHub necessari (Settings → Secrets and variables → Actions)
SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_DB_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, DRIVE_FOLDER_ID

## Ripristino
Un nuovo progetto Supabase: importare `db-public-*.sql.gz` (gunzip, poi psql), rimettere i file di `files/` nel bucket `docs` (il nome usa `__` al posto di `/`).
