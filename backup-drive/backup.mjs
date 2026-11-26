// Backup notturno: Supabase -> Google Drive (file .json.gz). Tiene gli ultimi 30.
import { gzipSync } from "node:zlib";
const env = (k) => { const v = process.env[k]; if (!v) throw new Error("Manca il segreto " + k); return v; };
const URL_ = env("SUPABASE_URL").replace(/\/$/, ""), KEY = env("SUPABASE_SERVICE_KEY");
const TABLES = ["companies", "profiles", "clients", "jobs", "job_assignments", "job_checklists", "job_materials", "reports", "time_entries", "leave_requests", "assets", "warranties", "documents", "invoices", "quotes", "expenses", "vehicles", "vehicle_deadlines", "km_log", "stock", "library", "checklists", "posts", "comments", "chat_messages"];

async function dump(t) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${URL_}/rest/v1/${t}?select=*`, { headers: { apikey: KEY, Authorization: "Bearer " + KEY, Range: `${from}-${from + 999}`, "Range-Unit": "items" } });
    if (!r.ok) { console.log("salto", t, r.status); return null; }
    const part = await r.json(); rows.push(...part); if (part.length < 1000) break;
  }
  return rows;
}
const out = { app: "Light Project", creato: new Date().toISOString(), tabelle: {} };
for (const t of TABLES) { const d = await dump(t); if (d) out.tabelle[t] = d; }
const righe = Object.values(out.tabelle).reduce((a, x) => a + x.length, 0);
if (!righe) throw new Error("Backup vuoto: controlla SUPABASE_URL e SUPABASE_SERVICE_KEY");
const body = gzipSync(Buffer.from(JSON.stringify(out)));
console.log("Tabelle:", Object.keys(out.tabelle).length, "righe:", righe, "byte:", body.length);

const tk = await (await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ client_id: env("GOOGLE_CLIENT_ID"), client_secret: env("GOOGLE_CLIENT_SECRET"), refresh_token: env("GOOGLE_REFRESH_TOKEN"), grant_type: "refresh_token" }) })).json();
if (!tk.access_token) throw new Error("Accesso a Google non riuscito: " + JSON.stringify(tk));
const auth = { Authorization: "Bearer " + tk.access_token }, folder = env("DRIVE_FOLDER_ID");
const name = "backup-light-project-" + new Date().toISOString().slice(0, 10) + ".json.gz";
const boundary = "bk" + Date.now();
const meta = JSON.stringify({ name, parents: [folder] });
const multipart = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/gzip\r\n\r\n`), body, Buffer.from(`\r\n--${boundary}--`)]);
const up = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", { method: "POST", headers: { ...auth, "Content-Type": "multipart/related; boundary=" + boundary }, body: multipart });
if (!up.ok) throw new Error("Caricamento su Drive non riuscito: " + (await up.text()));
console.log("Caricato su Drive:", name);

const q = encodeURIComponent(`'${folder}' in parents and name contains 'backup-light-project-' and trashed=false`);
const list = await (await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=name desc&pageSize=200&fields=files(id,name)`, { headers: auth })).json();
for (const f of (list.files || []).slice(30)) { await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}`, { method: "DELETE", headers: auth }); console.log("Cancellato vecchio:", f.name); }
