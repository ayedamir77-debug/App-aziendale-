// Funzione "backup-now": il titolare preme il tasto nell'app e parte subito il backup su Google Drive.
// Serve il segreto GITHUB_TOKEN (token con permesso "Actions: lettura e scrittura" sul repository).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const REPO = "ayedamir77-debug/App-aziendale-";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: u } = await sb.auth.getUser();
    if (!u?.user) return json({ error: "Accesso non valido" }, 401);
    const { data: p } = await sb.from("profiles").select("role, status").eq("id", u.user.id).maybeSingle();
    if (!p || p.status !== "active" || p.role !== "owner") return json({ error: "Solo il titolare può avviare il backup" }, 403);
    const token = Deno.env.get("GITHUB_TOKEN");
    if (!token) return json({ error: "Manca il segreto GITHUB_TOKEN su Supabase" }, 500);
    const gh = { Authorization: "Bearer " + token, Accept: "application/vnd.github+json", "User-Agent": "light-project" };
    const body = await req.json().catch(() => ({}));
    const base = `https://api.github.com/repos/${REPO}/actions/workflows/backup.yml`;
    if (body.task === "status") {
      const r = await fetch(base + "/runs?per_page=1", { headers: gh });
      if (!r.ok) return json({ error: "GitHub non risponde (" + r.status + ")" }, 502);
      const run = (await r.json()).workflow_runs?.[0];
      return json(run ? { status: run.status, conclusion: run.conclusion, started: run.run_started_at ?? run.created_at, updated: run.updated_at } : { status: "none" });
    }
    const r = await fetch(base + "/dispatches", { method: "POST", headers: { ...gh, "Content-Type": "application/json" }, body: JSON.stringify({ ref: "main" }) });
    if (r.status !== 204) return json({ error: "GitHub ha rifiutato (" + r.status + "): controlla il token" }, 502);
    return json({ ok: true });
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
