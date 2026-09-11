/* Service Worker — Parcelles Le Sougey
   Met en cache l'appli elle-même, les librairies (CDN) et les tuiles de carte IGN
   déjà consultées, pour un usage sans réseau au champ. */

const CACHE_NAME = "parcelles-sougey-v1";
const APP_SHELL = [
  "./",
  "./index.html"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  let url;
  try { url = new URL(event.request.url); } catch (e) { return; }

  const isTile = url.hostname === "data.geopf.fr";
  const isCdn = url.hostname === "cdnjs.cloudflare.com";
  const isGeocode = url.hostname === "geo.api.gouv.fr" || url.hostname === "api.open-meteo.com";

  // Géocodage / météo : jamais de cache (données changeantes), on laisse passer normalement.
  if (isGeocode) return;

  // Tuiles IGN et librairies CDN : cache d'abord, puis on rafraîchit en arrière-plan.
  if (isTile || isCdn) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) =>
        cache.match(event.request).then((cached) => {
          const network = fetch(event.request).then((res) => {
            if (res && res.status === 200) cache.put(event.request, res.clone());
            return res;
          }).catch(() => cached);
          return cached || network;
        })
      )
    );
    return;
  }

  // Page principale (navigation) : réseau d'abord, secours sur le cache hors-ligne.
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, res.clone()));
          return res;
        })
        .catch(() => caches.match("./index.html"))
    );
  }
});
