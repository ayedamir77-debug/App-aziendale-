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
  const model = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash";
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
    if (body.task === "sketch") {
      const txt = String(body.text || "").slice(0, 4000);
      const imgs = (Array.isArray(body.images) ? body.images : []).slice(0, 3).filter((x: { mime?: string; b64?: string }) => x && ["image/jpeg", "image/png"].includes(String(x.mime)) && String(x.b64 || "").length < 8_000_000);
      if (!imgs.length) return json({ error: "Manca la foto" }, 400);
      const system = "Sei l'assistente di un'azienda di impianti elettrici e fotovoltaici. Leggi appunti scritti a mano e schizzi di impianti. Rispondi solo in JSON.";
      const prompt = `Leggi gli appunti nella foto (scritti a mano, in italiano, ambito impianti elettrici/fotovoltaici/colonnine).${txt.trim() ? "\nCorrezioni o note dell'installatore (hanno la precedenza su quello che leggi):\n" + txt : ""}
Rispondi SOLO con JSON:
{"title": string|null, "items":[{"desc":string,"qty":number|null,"unit":string|null}], "notes":[string], "unclear":[string], "diagram": null | {"nodes":[{"id":string,"label":string,"type":"rete|contatore|quadro|interruttore|fv|inverter|batteria|wallbox|scaricatore|terra|carico|altro"}],"links":[{"from":string,"to":string,"label":string|null}]}}
- "items": solo materiale da fornire/comprare (con quantità e unità solo se scritte; i numeri barrati non contano).
- "notes": altre indicazioni scritte (tipo di posa, armadio, intestazione cliente/luogo).
- "diagram": solo se c'è uno schizzo. Un nodo per ogni elemento disegnato, con il nome scritto accanto; i collegamenti vanno dall'alto (alimentazione, rete o contatore) verso i carichi. Non inventare elementi non disegnati.
- "unclear": cosa non hai potuto leggere con sicurezza (scrivi il punto, non scusarti).`;
      const text = provider === "gemini"
        ? await askGemini([...imgs.map((x: { mime: string; b64: string }) => ({ inlineData: { mimeType: x.mime, data: x.b64 } })), { text: prompt }], system, true)
        : await askClaude([...imgs.map((x: { mime: string; b64: string }) => ({ type: "image", source: { type: "base64", media_type: x.mime, data: x.b64 } })), { type: "text", text: prompt }], system, 2500);
      return json(parseJson(text));
    }
    if (body.task === "config") {
      const txt = String(body.text || "").slice(0, 6000);
      const imgs = (Array.isArray(body.images) ? body.images : []).slice(0, 4).filter((x: { mime?: string; b64?: string }) => x && ["image/jpeg", "image/png"].includes(String(x.mime)) && String(x.b64 || "").length < 8_000_000);
      if (!imgs.length && !txt.trim()) return json({ error: "Manca la foto o il testo" }, 400);
      const system = "Sei l'assistente di un installatore. Trascrivi configurazioni di centraline, orologi, timer, termostati e simili in modo ordinato, in italiano, senza inventare nulla. Rispondi solo in JSON.";
      const prompt = `${imgs.length ? "Nelle foto ci sono schermate, display o appunti con la configurazione di un dispositivo (orari, programmi, parametri)." : "Questo testo è una configurazione dettata o scritta in fretta."} Trascrivila in modo ordinato e completo, pronta da ritrovare se il dispositivo perde la memoria.${txt.trim() ? "\nTesto già scritto dall'installatore (conservalo e integralo):\n" + txt : ""}
Rispondi SOLO con JSON: {"text": string, "unclear": [string]}
- "text": righe brevi, una voce per riga, nell'ordine in cui compaiono (es. "Programma 1: lun-ven 07:00–20:00", "Corsa: 3"). Titoli di sezione se servono. Solo testo semplice, senza markdown.
- Non inventare valori. Se più foto, mantieni l'ordine delle foto.
- "unclear": valori che non hai letto con sicurezza.`;
      const text = provider === "gemini"
        ? await askGemini([...imgs.map((x: { mime: string; b64: string }) => ({ inlineData: { mimeType: x.mime, data: x.b64 } })), { text: prompt }], system, true)
        : await askClaude([...imgs.map((x: { mime: string; b64: string }) => ({ type: "image", source: { type: "base64", media_type: x.mime, data: x.b64 } })), { type: "text", text: prompt }], system, 2500);
      return json(parseJson(text));
    }
    if (body.task === "manual") {
      const imgs = (Array.isArray(body.images) ? body.images : []).slice(0, 4).filter((x: { mime?: string; b64?: string }) => x && ["image/jpeg", "image/png"].includes(String(x.mime)) && String(x.b64 || "").length < 8_000_000);
      if (!imgs.length) return json({ error: "Manca la foto" }, 400);
      const known = String(body.known || "").slice(0, 600);
      const system = "Sei l'assistente di un installatore. Trascrivi manuali di istruzioni in italiano, completi e ordinati, senza inventare nulla. Rispondi solo in JSON.";
      const prompt = `Nelle foto ci sono pagine di un manuale di istruzioni (centralina, automazione, orologio, termostato o simili), anche in altra lingua: traduci in italiano. Trascrivi TUTTO il contenuto utile in modo ordinato e chiaro, così che l'installatore non debba più guardare le foto.
Rispondi SOLO con JSON: {"title": string|null, "sections":[{"title":string,"lines":[string]}], "unclear":[string]}
- Dividi in sezioni con titoli brevi. Usa questi titoli quando il contenuto c'entra: Collegamenti, Programmazione, Funzioni, Dati tecnici, Messaggi di errore, Installazione, Altro.${known ? " Sezioni già presenti (riusa lo stesso titolo se il contenuto è dello stesso tipo): " + known : ""}
- "lines": una riga per voce, brevi. Collegamenti: "Morsetti 1-2: alimentazione 230 V". Programmazione: passi numerati "1. Premi P1 per 3 secondi", parametri "F1 = chiusura automatica (0 = no, 1 = sì)". Tabelle: una riga per voce "nome: valore".
- Mantieni esatti sigle, numeri, valori e unità. Non inventare e non saltare parti.
- "title": nome del prodotto se si legge.
- "unclear": cosa non si legge con sicurezza (scrivi il punto, non scusarti).`;
      const text = provider === "gemini"
        ? await askGemini([...imgs.map((x: { mime: string; b64: string }) => ({ inlineData: { mimeType: x.mime, data: x.b64 } })), { text: prompt }], system, true)
        : await askClaude([...imgs.map((x: { mime: string; b64: string }) => ({ type: "image", source: { type: "base64", media_type: x.mime, data: x.b64 } })), { type: "text", text: prompt }], system, 6000);
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
