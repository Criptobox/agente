// sw.js — Service Worker de agent-brain.
// Estrategia pensada para 3G lento (igual que en TiendaMax):
//  - Shell de la app (html/manifest/iconos): cache-first, carga instantánea offline.
//  - Datos de GitHub (JSON/API): network-first con caída al último cacheado.
const VERSION = "brain-v2";
const SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("message", (e) => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  const isFont = url.hostname.includes("fonts.googleapis.com") || url.hostname.includes("fonts.gstatic.com");
  const isData = url.hostname.includes("githubusercontent.com") || url.hostname.includes("api.github.com");

  if (isFont) {
    // Fuentes: cache-first (no cambian). Tras la 1ª carga, instantáneo y offline.
    e.respondWith(
      caches.match(e.request).then((hit) =>
        hit || fetch(e.request).then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
          return res;
        }).catch(() => hit)
      )
    );
    return;
  }

  if (isData) {
    // Datos del centinela (/vigilancia/): SIEMPRE red, nunca se cachean —
    // una alerta de hace 10 minutos no sirve. Si no hay señal, lo último visto.
    if (url.pathname.includes("/vigilancia/")) {
      e.respondWith(
        fetch(e.request).catch(() => caches.match(e.request, { ignoreSearch: true }))
      );
      return;
    }
    // network-first: datos frescos si hay señal; si no, lo último que vimos.
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // shell: cache-first.
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
