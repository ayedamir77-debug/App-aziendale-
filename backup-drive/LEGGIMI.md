# Backup notturno su Google Drive

Ogni notte (03:30) GitHub Actions salva su Drive, nella cartella scelta:
- `backup-light-project-AAAA-MM-GG.json.gz`: tutti i dati (ultimi 30)
- `db-public-AAAA-MM-GG.sql.gz`: database completo: tabelle, regole (RLS), funzioni, dati (ultimi 30)
- `db-sistema-utenti-AAAA-MM-GG.sql.gz`: utenti (auth) e archivio (storage), se riesce (ultimi 30)
- cartella `Clienti/<Cliente>/<Lavoro>/` con dentro `Rapportini/` (un file di testo per rapportino, con ore, materiale e commenti) e `Foto e documenti/` (foto, bolle, fatture, con data e titolo nel nome)
- `Documenti generali/` (documenti non legati a un lavoro), `Libreria tecnica/`, `Altri file/`
- le foto e i documenti si copiano una volta sola e non si cancellano mai; i rapportini si aggiornano se li modifichi

Il codice dell'app e delle funzioni è già in questo repository GitHub.
Non salvabili (si rifanno a mano): i segreti di Supabase (GEMINI_API_KEY, GEMINI_MODEL).

## Segreti GitHub necessari (Settings → Secrets and variables → Actions)
SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_DB_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, DRIVE_FOLDER_ID

## Ripristino
Un nuovo progetto Supabase: importare `db-public-*.sql.gz` (gunzip, poi psql), rimettere i file di `files/` nel bucket `docs` (il nome usa `__` al posto di `/`).

## Secondo e terzo account Google (facoltativi)
Aggiungere i segreti `GOOGLE_REFRESH_TOKEN_2` e `DRIVE_FOLDER_ID_2` (e per il terzo `_3`). Se presenti, il backup viene caricato anche lì.
Client ID/secret possono essere gli stessi; per usarne di diversi aggiungere `GOOGLE_CLIENT_ID_2` e `GOOGLE_CLIENT_SECRET_2`.
Il workflow li legge: vedi `.github/workflows/backup.yml`.
