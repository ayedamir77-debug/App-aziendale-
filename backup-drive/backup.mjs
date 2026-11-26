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

/* ---- 3. archivio leggibile: Clienti / Lavoro / Foto e documenti + Rapportini ---- */
const T = out.tabelle, byId = (a) => Object.fromEntries((a || []).map((x) => [x.id, x]));
const clientsM = byId(T.clients), jobsM = byId(T.jobs), profM = byId(T.profiles), docsAll = T.documents || [], libAll = T.library || [];
const safe = (x, fb = "Senza nome") => (String(x || "").replace(/[\\/:*?"<>|\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80)) || fb;
const fcache = new Map();
async function path(parent, ...names) {
  let cur = parent;
  for (const n of names) { const k = cur + "/" + n; if (!fcache.has(k)) fcache.set(k, await gFolder(n, cur)); cur = fcache.get(k); }
  return cur;
}
const fmtDay = (d) => (d || "").slice(0, 10);
const jobPath = (jobId) => {
  const j = jobsM[jobId]; if (!j) return ["Senza lavoro"];
  const c = clientsM[j.client_id];
  return [c ? safe(c.name) : "Senza cliente", safe(j.title)];
};
async function listTagged(kind) {
  const q = `appProperties has { key='kind' and value='${kind}' } and trashed=false`, res = new Map(); let page = "";
  do {
    const r = await (await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&pageSize=1000&fields=nextPageToken,files(id,appProperties)${page ? "&pageToken=" + page : ""}`, { headers: G })).json();
    for (const f of r.files || []) res.set(f.appProperties.id, { id: f.id, v: f.appProperties.v || "" }); page = r.nextPageToken || "";
  } while (page);
  return res;
}
async function gUploadTagged(name, buf, parent, mime, props) {
  const s2 = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable", { method: "POST", headers: { ...G, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": mime }, body: JSON.stringify({ name, parents: [parent], appProperties: props }) });
  if (!s2.ok) throw new Error("Drive (avvio) " + (await s2.text()));
  const up = await fetch(s2.headers.get("location"), { method: "PUT", headers: { "Content-Type": mime }, body: buf });
  if (!up.ok) throw new Error("Drive (invio) " + (await up.text()));
}
const hrs = (m) => (m == null ? "—" : Math.floor(m / 60) + "h " + String(m % 60).padStart(2, "0") + "m");

// 3a. rapportini leggibili (si aggiornano se cambiano)
const haveRep = await listTagged("rep"), comm = T.comments || [];
let repNew = 0, repUp = 0;
for (const r of T.reports || []) {
  const j = jobsM[r.job_id], c = j && clientsM[j.client_id], who = [...new Set([r.user_id, ...(r.with_ids || [])])].map((u) => (profM[u] || {}).full_name || "?").join(", ");
  const cm = comm.filter((x) => x.ref_type === "report" && x.ref_id === r.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const txt = [`RAPPORTINO del ${fmtDay(r.day)}`, `Cliente: ${c ? c.name : "—"}`, `Lavoro: ${j ? j.title : "—"}`, `Fatto da: ${who}`, `Ore: ${hrs(r.minutes)}`, "", "Lavoro svolto:", r.summary || "—", "",
    "Materiale usato:", ...((r.materials || []).length ? r.materials.map((m) => `- ${m.desc}${m.qty != null ? ": " + m.qty + (m.unit ? " " + m.unit : "") : ""}`) : ["—"]),
    ...(cm.length ? ["", "Commenti:", ...cm.map((x) => `- ${(profM[x.user_id] || {}).full_name || "?"} (${fmtDay(x.created_at)}): ${x.body}`)] : [])].join("\n");
  const v = String(txt.length) + ":" + [...txt].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7), old = haveRep.get(r.id);
  if (old && old.v === v) continue;
  const folder = await path(ROOT, "Clienti", ...jobPath(r.job_id), "Rapportini");
  if (old) { await fetch(`https://www.googleapis.com/drive/v3/files/${old.id}`, { method: "DELETE", headers: G }); repUp++; } else repNew++;
  await gUploadTagged(`${fmtDay(r.day)}_${safe((profM[r.user_id] || {}).full_name, "rapportino")}_${r.id.slice(0, 6)}.txt`, Buffer.from(txt, "utf8"), folder, "text/plain", { kind: "rep", id: r.id, v });
}
console.log(`Rapportini: ${(T.reports || []).length} totali, ${repNew} nuovi, ${repUp} aggiornati`);

// 3b. foto e documenti (solo i nuovi, mai cancellati)
const haveDoc = await listTagged("doc"), used = new Set();
let nuovi = 0, errori = 0;
async function copyFile(storagePath, name, folderId, props) {
  const r = await fetch(`${URL_}/storage/v1/object/${BUCKET}/${storagePath.split("/").map(encodeURIComponent).join("/")}`, { headers: SB });
  if (!r.ok) throw new Error("download " + r.status);
  await gUploadTagged(name, Buffer.from(await r.arrayBuffer()), folderId, r.headers.get("content-type") || "application/octet-stream", props);
}
for (const d of docsAll) {
  if (!d.file_path) continue; used.add(d.file_path);
  if (haveDoc.has(d.id)) continue;
  try {
    const kindName = { foto: "Foto", bolla: "Bolle", fattura: "Fatture", altro: "Documenti" }[d.kind] || "Documenti";
    const folder = d.job_id ? await path(ROOT, "Clienti", ...jobPath(d.job_id), "Foto e documenti") : await path(ROOT, "Documenti generali", kindName);
    const ext = ((d.file_name || d.file_path).match(/\.[A-Za-z0-9]{2,5}$/) || [""])[0];
    await copyFile(d.file_path, `${fmtDay(d.doc_date || d.created_at)}_${kindName}_${safe(d.title || d.file_name, "file")}_${d.id.slice(0, 6)}${ext}`, folder, { kind: "doc", id: d.id });
    nuovi++;
  } catch (e) { errori++; console.log("File non copiato:", d.file_path, e.message); }
}
// 3c. file dell'archivio che non sono documenti (libreria tecnica, altro): copia piatta
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
const otherFolder = await path(ROOT, "Altri file"), haveOther = new Set((await gList(`'${otherFolder}' in parents and trashed=false`)).map((f) => f.name));
const objs = await listObjects(); let altri = 0;
for (const p of objs) {
  if (used.has(p)) continue; const name = p.replaceAll("/", "__"); if (haveOther.has(name)) continue;
  const lib = libAll.find((l) => l.file_path === p);
  try { await copyFile(p, lib ? "Libreria_" + safe(lib.title) + "_" + name.slice(-12) : name, lib ? await path(ROOT, "Libreria tecnica") : otherFolder, { kind: "other", id: p }); altri++; } catch (e) { errori++; console.log("File non copiato:", p, e.message); }
}
console.log(`File: ${docsAll.length} documenti (${nuovi} nuovi), ${altri} altri file nuovi, ${errori} errori`);
if (errori) process.exitCode = 1;
