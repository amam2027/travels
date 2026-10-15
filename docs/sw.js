// Offline shell: everything the app needs is cached at install, then served cache-first.
// Bump VERSION whenever any file below changes, so phones pick up the new version.
const VERSION = "trips-v8";
const SHELL = [
  "./", "index.html", "app.css", "manifest.webmanifest",
  "js/app.js", "js/calc.js", "js/entry.js", "js/icons.js", "js/rates.js", "js/sheets.js", "js/store.js", "js/util.js",
  "fonts/instrument-sans-latin.woff2", "fonts/instrument-sans-latin-ext.woff2",
  "icons/icon.svg", "icons/apple-touch-icon.png", "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png",
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(VERSION)
      .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;   // rates API goes straight to the network
  if (req.mode === "navigate") {
    e.respondWith(caches.match("index.html").then(r => r || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(r => r || fetch(req)));
});
