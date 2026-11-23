// Service worker minimo: serve a rendere l'app installabile. Non salva file, quindi gli aggiornamenti arrivano subito.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
