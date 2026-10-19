/* Dubbel Uit — service worker: de app werkt ook zonder internet. */
const CACHE = "dubbel-uit-v11";
const FILES = [
  "./",
  "./index.html",
  "./logic.js",
  "./vision.js",
  "./app.js",
  "./link.js",
  "./caller.js",
  "./vendor/peerjs.min.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Eerst het netwerk (zodat je altijd de nieuwste versie krijgt), anders de opgeslagen kopie.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    // Eigen bestanden: altijd bij de server navragen of er een nieuwere versie is.
    fetch(new URL(e.request.url).origin === self.location.origin
      ? new Request(e.request.url, { cache: "no-cache", credentials: "same-origin" })
      : e.request)
      .then((res) => {
        if (res.ok && new URL(e.request.url).origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("./index.html")))
  );
});
