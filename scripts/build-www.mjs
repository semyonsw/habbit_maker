// Assemble the Capacitor web payload into www/.
//
// The web app has no build step -- the repo root IS the served site. But the
// root also holds node_modules/, .git/, server/, data.db and the
// android/ project itself, and Capacitor copies `webDir` wholesale into the
// APK's assets. So we stage an explicit allow-list instead of pointing webDir
// at ".".
//
// sw.js is deliberately EXCLUDED: inside the APK all assets are already local,
// so a service worker would only add a second, stale cache layer in front of
// them. The GitHub Pages PWA still uses it from the repo root, which this
// script never touches.
//
// manifest.webmanifest IS shipped even though nothing installs the app from a
// browser here, purely because index.html links it and the WebView logs a 404
// on every launch otherwise.

import { cp, rm, mkdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WWW = join(ROOT, "www");

// Everything the app shell actually loads at runtime, and nothing else.
const SHIP = [
  "index.html",
  "styles.css",
  "manifest.webmanifest",
  "icons",
  "src",
  "vendor",
];

async function main() {
  await rm(WWW, { recursive: true, force: true });
  await mkdir(WWW, { recursive: true });

  for (const entry of SHIP) {
    const from = join(ROOT, entry);
    try {
      await stat(from);
    } catch {
      throw new Error(`build-www: missing required asset "${entry}"`);
    }
    await cp(from, join(WWW, entry), { recursive: true });
  }

  console.log(`build-www: staged ${SHIP.length} entries into www/`);
}

await main();
