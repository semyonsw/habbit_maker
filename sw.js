/* Habit Maker service worker — offline app shell.
 *
 * Bump CACHE_VERSION on every release to invalidate the old cache. All paths
 * are RELATIVE (no leading slash) so they resolve against the service worker's
 * scope, which works under a GitHub Pages project subpath (/habbit_maker/).
 *
 * App DATA lives in IndexedDB, not over HTTP — only static shell GETs reach
 * the fetch handler. Cross-origin requests are never touched.
 */
"use strict";

const CACHE_VERSION = "v12";
const CACHE_NAME = `habit-shell-${CACHE_VERSION}`;

// Core shell precached on install. The woff2 font binaries are intentionally
// NOT listed here — they are runtime-cached on first load by the fetch handler
// below, which keeps install fast and resilient.
const PRECACHE = [
  "./",
  "index.html",
  "styles.css",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-192.png",
  "icons/icon-maskable-512.png",
  // ES modules
  "src/app.js",
  "src/constants.js",
  "src/data-io.js",
  "src/db-idb.js",
  "src/db-rest.js",
  "src/db.js",
  "src/events.js",
  "src/habits.js",
  "src/loading-ui.js",
  "src/logging.js",
  "src/modals.js",
  "src/month-nav.js",
  "src/native.js",
  "src/notifications.js",
  "src/persistence.js",
  "src/render-analytics.js",
  "src/render-detail.js",
  "src/render-registry.js",
  "src/render-settings.js",
  "src/render-shell.js",
  "src/render-today.js",
  "src/router.js",
  "src/scoring.js",
  "src/sheet.js",
  "src/state.js",
  "src/toast.js",
  "src/ui-prefs.js",
  "src/utils.js",
  // Vendored libraries
  "vendor/fonts/fonts.css",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      // addAll is atomic; if a single file is missing it would fail install, so
      // add individually and tolerate the rare miss rather than block install.
      .then((cache) =>
        Promise.all(
          PRECACHE.map((url) =>
            cache.add(url).catch(() => {
              /* a missing precache entry must not break the whole install */
            }),
          ),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE_NAME)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // never touch PUT/POST/etc.

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // let cross-origin pass through
  if (/\/api\//.test(url.pathname)) return; // never cache the SQLite REST backend

  event.respondWith(
    // ignoreSearch so any future ?v= cache-busting suffix still hits the cache.
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          if (res && res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => {
          // Offline + uncached: fall back to the app shell for navigations.
          if (req.mode === "navigate") return caches.match("index.html");
          return Response.error();
        });
    }),
  );
});

// A notification shown by the service worker (rather than by the page) still
// has to know where to go when it is tapped. The web reminder path in
// src/notifications.js constructs page-scoped Notifications and handles its own
// clicks, so this is the fallback for anything shown while no page was around
// to own it.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if ("focus" in client) {
            client.navigate(`${self.registration.scope}#/today`).catch(() => {});
            return client.focus();
          }
        }
        return self.clients.openWindow(`${self.registration.scope}#/today`);
      }),
  );
});
