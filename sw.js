// Service worker: rende l'app installabile e la fa aprire anche senza internet.
// Pagina e file dell'app: prima la rete (così gli aggiornamenti arrivano subito), se manca la rete usa la copia salvata.
// Librerie esterne (Supabase, OCR, PDF): copia salvata, aggiornata in sottofondo.
// Le chiamate ai dati (Supabase) non vengono mai salvate.
const CACHE = 'app-azienda-v3';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  if (url.hostname.endsWith('.supabase.co') || url.hostname.endsWith('radio-browser.info') || url.hostname.includes('open-meteo.com')) return;
  const lib = url.hostname === 'esm.sh' || url.hostname === 'cdn.jsdelivr.net';
  if (url.origin === location.origin) {
    e.respondWith((async () => {
      try { const r = await fetch(req); if (r.ok) (await caches.open(CACHE)).put(req, r.clone()); return r; }
      catch { return (await caches.match(req)) || (await caches.match('./index.html')) || Response.error(); }
    })());
  } else if (lib) {
    e.respondWith((async () => {
      const c = await caches.open(CACHE), hit = await c.match(req);
      const net = fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    })());
  }
});
