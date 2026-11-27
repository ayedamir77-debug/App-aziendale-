// Funzione "ai-assist": tiene nascosta la chiave dell'IA e risponde solo ai membri attivi dell'azienda
// se il titolare ha acceso l'assistente. Segreti da impostare su Supabase:
//   ANTHROPIC_API_KEY (se usi Claude)   GEMINI_API_KEY (se usi Gemini)
//   facoltativi: CLAUDE_MODEL, GEMINI_MODEL
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });

const DOC_PROMPT = (own: string) => `Leggi questo documento italiano (bolla, fattura, preventivo, scontrino, conformità, contratto o altro).
La nostra azienda si chiama "${own}": la controparte è l'ALTRA azienda o persona, non noi.
Rispondi SOLO con un oggetto JSON, senza testo prima o dopo, con queste chiavi:
{"kind":"bolla|fattura|preventivo|scontrino|conformita|contratto|altro","party":"nome della controparte o null","number":"numero documento o null","date":"AAAA-MM-GG o null","amount":numero del totale documento in euro o null,"items":[{"desc":"descrizione articolo","qty":numero o null,"unit":"unità o null"}]}
In "items" metti le righe di materiale (solo per bolle, fatture, scontrini, preventivi); non inventare nulla che non sia scritto.`;

async function askClaude(content: unknown[], system: string, maxTokens: number) {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("Chiave Claude non configurata su Supabase");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: Deno.env.get("CLAUDE_MODEL") || "claude-sonnet-5-5", max_tokens: maxTokens, system, messages: [{ role: "user", content }] }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || "Errore Claude");
  return (j.content || []).map((c: { text?: string }) => c.text || "").join("");
}
async function askGemini(parts: unknown[], system: string, asJson: boolean) {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("Chiave Gemini non configurata su Supabase");
  const model = Deno.env.get("GEMINI_MODEL") || "gemini-3.8-flash";
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts }],
      generationConfig: asJson ? { responseMimeType: "application/json" } : {},
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j?.error?.message || "Errore Gemini");
  return (j.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || "").join("");
}
const parseJson = (t: string) => {
  const m = t.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("Risposta non leggibile");
  return JSON.parse(m[0]);
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: u } = await sb.auth.getUser();
    if (!u?.user) return json({ error: "Accesso non valido" }, 401);
    const { data: p } = await sb.from("profiles").select("status, companies(ai_enabled, ai_provider)").eq("id", u.user.id).maybeSingle();
    const c = Array.isArray(p?.companies) ? p?.companies[0] : p?.companies;
    if (!p || p.status !== "active" || !c?.ai_enabled) return json({ error: "L'assistente IA non è attivo" }, 403);

    const body = await req.json();
    const provider = c.ai_provider === "gemini" ? "gemini" : "claude";
    const own = String(body.ownName || "").slice(0, 120);

    if (body.task === "doc") {
      const mime = String(body.mime || "");
      const b64 = String(body.b64 || "");
      if (!b64 || b64.length > 14_000_000) return json({ error: "File troppo grande" }, 400);
      if (!["image/jpeg", "image/png", "application/pdf"].includes(mime)) return json({ error: "Formato non supportato" }, 400);
      const system = "Sei un assistente che estrae dati da documenti commerciali italiani. Rispondi solo in JSON.";
      let text: string;
      if (provider === "gemini") {
        text = await askGemini([{ inlineData: { mimeType: mime, data: b64 } }, { text: DOC_PROMPT(own) }], system, true);
      } else {
        const block = mime === "application/pdf"
          ? { type: "document", source: { type: "base64", media_type: mime, data: b64 } }
          : { type: "image", source: { type: "base64", media_type: mime, data: b64 } };
        text = await askClaude([block, { type: "text", text: DOC_PROMPT(own) }], system, 2000);
      }
      return json(parseJson(text));
    }

    if (body.task === "ask") {
      const q = String(body.question || "").slice(0, 1000);
      const ctx = String(body.context || "").slice(0, 12000);
      if (!q) return json({ error: "Scrivi una domanda" }, 400);
      const system = "Sei l'assistente di un'azienda di impianti. Rispondi in italiano, breve e chiaro, usando solo i dati forniti. Se non bastano, dillo. Non dare consulenza fiscale o legale.";
      const prompt = `Dati dell'azienda:\n${ctx}\n\nDomanda: ${q}`;
      const text = provider === "gemini"
        ? await askGemini([{ text: prompt }], system, false)
        : await askClaude([{ type: "text", text: prompt }], system, 800);
      return json({ text });
    }
    if (body.task === "materials") {
      const txt = String(body.text || "").slice(0, 6000);
      const imgs = (Array.isArray(body.images) ? body.images : []).slice(0, 4).filter((x: { mime?: string; b64?: string }) => x && ["image/jpeg", "image/png"].includes(String(x.mime)) && String(x.b64 || "").length < 8_000_000);
      if (!txt.trim() && !imgs.length) return json({ error: "Niente da leggere" }, 400);
      const system = "Sei l'assistente di un'azienda di impianti elettrici e domotici. Rispondi solo in JSON.";
      const prompt = `Fai l'elenco del materiale elettrico/domotico.${txt.trim() ? "\nTesto dettato o scritto:\n" + txt : ""}${imgs.length ? "\nLe foto possono mostrare una bolla, uno scontrino, una lista scritta a mano o il materiale stesso: elenca ogni articolo riconoscibile." : ""}\nRispondi SOLO con JSON: {"items":[{"desc":"descrizione breve","qty":numero o null,"unit":"m|pz|kg|... o null"}]}. Non inventare quantità non scritte né visibili: se non sei sicuro metti null. Unisci i doppioni.`;
      const text = provider === "gemini"
        ? await askGemini([...imgs.map((x: { mime: string; b64: string }) => ({ inlineData: { mimeType: x.mime, data: x.b64 } })), { text: prompt }], system, true)
        : await askClaude([...imgs.map((x: { mime: string; b64: string }) => ({ type: "image", source: { type: "base64", media_type: x.mime, data: x.b64 } })), { type: "text", text: prompt }], system, 1500);
      return json(parseJson(text));
    }
    if (body.task === "report") {
      const t = String(body.text || "").slice(0, 6000);
      const names = String(body.team || "").slice(0, 600);
      if (!t.trim()) return json({ error: "Niente da riordinare" }, 400);
      const system = "Sei l'assistente di un'azienda di impianti elettrici. Rispondi solo in JSON.";
      const prompt = `Un installatore ha dettato a voce il rapportino di fine giornata. Rimetti in ordine senza inventare nulla.\nRispondi SOLO con JSON: {"summary": string, "materials": [{"desc": string, "qty": number|null, "unit": string|null, "src": "nostro"|"comprato"}], "with": [string]}.\n- summary: elenco puntato breve in italiano (una riga per attività, ogni riga inizia con "• "), togli intercalari e ripetizioni, includi problemi e cose rimaste da fare.\n- materials: materiale citato; src "comprato" solo se dice che è stato comprato, altrimenti "nostro".\n- with: nomi dei colleghi citati, scelti tra: ${names || "nessuno"}.\n\nTesto dettato:\n${t}`;
      const text = provider === "gemini"
        ? await askGemini([{ text: prompt }], system, true)
        : await askClaude([{ type: "text", text: prompt }], system, 1200);
      return json(parseJson(text));
    }
    return json({ error: "Richiesta non valida" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});
