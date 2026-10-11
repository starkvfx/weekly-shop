/* Weekly Shop service worker: makes the app open instantly and installable.
   The app shell is cached; the page itself is fetched fresh when online so updates show up.
   Shopping data always comes live from the database, never from this cache. */
const VERSION = "ws-v1";
const SHELL = ["./", "index.html", "app.css", "standalone.css", "app.js", "auth.js", "store.js", "config.js",
  "vendor/supabase-2.117.1.js", "manifest.webmanifest", "icons/icon-192.png", "icons/apple-touch-icon.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return; // database and fonts go straight to the network
  const isPage = e.request.mode === "navigate" || /\.(html|js|css)$/.test(url.pathname) || url.pathname.endsWith("/");
  if (isPage) {
    // network first, so a new version is picked up; cache as fallback when offline
    e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("index.html"))));
  } else {
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
  }
});
