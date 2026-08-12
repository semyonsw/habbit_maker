/* Habit Tracker service worker — offline app shell.
 * Bump CACHE_VERSION on every release to invalidate the old cache.
 * All paths are RELATIVE so they resolve under a GitHub Pages subpath.
 */
"use strict";

const CACHE_VERSION = "v8";
const CACHE_NAME = `habit-shell-${CACHE_VERSION}`;

const PRECACHE = [
  "./",
  "index.html",
  "styles.css",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-192.png",
  "icons/icon-maskable-512.png",
  "src/app.js",
  "src/constants.js",
  "src/data-io.js",
  "src/db.js",
  "src/db-idb.js",
  "src/db-rest.js",
  "src/habits.js",
  "src/idb.js",
  "src/logging.js",
  "src/persistence.js",
  "src/reminders.js",
  "src/render-analytics.js",
  "src/render-detail.js",
  "src/render-registry.js",
  "src/render-settings.js",
  "src/render-today.js",
  "src/router.js",
  "src/sheet.js",
  "src/state.js",
  "src/utils.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.all(PRECACHE.map((url) => cache.add(url).catch(() => {}))),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (/\/api\//.test(url.pathname)) return; // never cache the SQLite REST backend

  event.respondWith(
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
          if (req.mode === "navigate") return caches.match("index.html");
          return Response.error();
        });
    }),
  );
});

// Tapping a habit reminder focuses the app rather than opening a second window.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow ? self.clients.openWindow("./") : undefined;
    }),
  );
});
