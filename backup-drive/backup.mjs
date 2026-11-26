// Backup notturno COMPLETO: dati, struttura database (sistema), utenti, foto e documenti -> Google Drive.
import { gzipSync } from "node:zlib";
import { readFileSync, existsSync } from "node:fs";
const env = (k) => { const v = process.env[k]; if (!v) throw new Error("Manca il segreto " + k); return v; };
const URL_ = env("SUPABASE_URL").replace(/\/$/, ""), KEY = env("SUPABASE_SERVICE_KEY");
const SB = { apikey: KEY, Authorization: "Bearer " + KEY };
const TABLES = ["companies", "profiles", "clients", "jobs", "job_assignments", "job_checklists", "job_materials", "reports", "time_entries", "leave_requests", "assets", "warranties", "documents", "invoices", "quotes", "expenses", "vehicles", "vehicle_deadlines", "km_log", "stock", "library", "checklists", "posts", "comments", "chat_messages", "push_subs", "push_config"];
const KEEP = 30, BUCKET = "docs", day = new Date().toISOString().slice(0, 10);

/* ---- Google Drive ---- */
const tk = await (await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ client_id: env("GOOGLE_CLIENT_ID"), client_secret: env("GOOGLE_CLIENT_SECRET"), refresh_token: env("GOOGLE_REFRESH_TOKEN"), grant_type: "refresh_token" }) })).json();
if (!tk.access_token) throw new Error("Accesso a Google non riuscito: " + JSON.stringify(tk));
const G = { Authorization: "Bearer " + tk.access_token }, ROOT = env("DRIVE_FOLDER_ID");
const esc = (s) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
async function gList(q, extra = "") {
  const out = []; let page = "";
  do {
    const r = await (await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&pageSize=1000&fields=nextPageToken,files(id,name)${extra}${page ? "&pageToken=" + page : ""}`, { headers: G })).json();
    if (r.error) throw new Error("Drive: " + JSON.stringify(r.error)); out.push(...(r.files || [])); page = r.nextPageToken || "";
  } while (page);
  return out;
}
async function gFolder(name, parent) {
  const f = await gList(`'${parent}' in parents and name='${esc(name)}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  if (f.length) return f[0].id;
  const r = await (await fetch("https://www.googleapis.com/drive/v3/files?fields=id", { method: "POST", headers: { ...G, "Content-Type": "application/json" }, body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parent] }) })).json();
  if (!r.id) throw new Error("Cartella Drive non creata: " + JSON.stringify(r)); return r.id;
}
async function gUpload(name, buf, parent, mime = "application/octet-stream") {
  const s = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable", { method: "POST", headers: { ...G, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": mime }, body: JSON.stringify({ name, parents: [parent] }) });
  if (!s.ok) throw new Error("Drive (avvio) " + (await s.text()));
  const up = await fetch(s.headers.get("location"), { method: "PUT", headers: { "Content-Type": mime }, body: buf });
  if (!up.ok) throw new Error("Drive (invio) " + (await up.text()));
}
async function prune(prefix, parent) {
  const all = (await gList(`'${parent}' in parents and name contains '${prefix}' and trashed=false`)).sort((a, b) => b.name.localeCompare(a.name));
  for (const f of all.slice(KEEP)) { await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}`, { method: "DELETE", headers: G }); console.log("Cancellato vecchio:", f.name); }
}

/* ---- 1. dati (JSON) ---- */
async function dump(t) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const r = await fetch(`${URL_}/rest/v1/${t}?select=*`, { headers: { ...SB, Range: `${from}-${from + 999}`, "Range-Unit": "items" } });
    if (!r.ok) { console.log("salto tabella", t, r.status); return null; }
    const part = await r.json(); rows.push(...part); if (part.length < 1000) break;
  }
  return rows;
}
const out = { app: "Light Project", creato: new Date().toISOString(), tabelle: {} };
for (const t of TABLES) { const d = await dump(t); if (d) out.tabelle[t] = d; }
const righe = Object.values(out.tabelle).reduce((a, x) => a + x.length, 0);
if (!righe) throw new Error("Backup vuoto: controlla SUPABASE_URL e SUPABASE_SERVICE_KEY");
await gUpload(`backup-light-project-${day}.json.gz`, gzipSync(Buffer.from(JSON.stringify(out))), ROOT, "application/gzip");
console.log("Dati: tabelle", Object.keys(out.tabelle).length, "righe", righe);
await prune("backup-light-project-", ROOT);

/* ---- 2. database completo (struttura, regole, funzioni, utenti) ---- */
for (const [file, nome] of [["/tmp/db-public.sql.gz", "db-public"], ["/tmp/db-sistema.sql.gz", "db-sistema-utenti"]]) {
  if (existsSync(file)) { await gUpload(`${nome}-${day}.sql.gz`, readFileSync(file), ROOT, "application/gzip"); console.log("Caricato", nome); await prune(nome + "-", ROOT); }
  else console.log("File non presente (salto):", file);
}

/* ---- 3. foto e documenti (copia incrementale: carica solo i nuovi, non cancella mai) ---- */
async function listObjects(prefix = "") {
  const res = [];
  for (let off = 0; ; off += 1000) {
    const r = await fetch(`${URL_}/storage/v1/object/list/${BUCKET}`, { method: "POST", headers: { ...SB, "Content-Type": "application/json" }, body: JSON.stringify({ prefix, limit: 1000, offset: off }) });
    if (!r.ok) { console.log("Archivio non leggibile:", r.status); return res; }
    const items = await r.json();
    for (const it of items) { if (it.id) res.push(prefix + it.name); else res.push(...(await listObjects(prefix + it.name + "/"))); }
    if (items.length < 1000) break;
  }
  return res;
}
const filesFolder = await gFolder("files", ROOT), have = new Set((await gList(`'${filesFolder}' in parents and trashed=false`)).map((f) => f.name));
const objs = await listObjects(); let nuovi = 0, errori = 0;
for (const p of objs) {
  const name = p.replaceAll("/", "__"); if (have.has(name)) continue;
  try {
    const r = await fetch(`${URL_}/storage/v1/object/${BUCKET}/${p.split("/").map(encodeURIComponent).join("/")}`, { headers: SB });
    if (!r.ok) throw new Error("download " + r.status);
    await gUpload(name, Buffer.from(await r.arrayBuffer()), filesFolder, r.headers.get("content-type") || "application/octet-stream"); nuovi++;
  } catch (e) { errori++; console.log("File non copiato:", p, e.message); }
}
console.log(`File: ${objs.length} totali, ${nuovi} nuovi copiati, ${errori} errori`);
if (errori) process.exitCode = 1;
