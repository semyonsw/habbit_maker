// A DOM for the render tests.
//
// linkedom rather than jsdom: the render modules only ever set innerHTML,
// toggle classes and read dataset/closest, so a full browser emulation is not
// needed and would cost several seconds per CI run.
//
// This must be imported BEFORE any src/ module, because several of them touch
// window/document/localStorage while they are still evaluating.

import { parseHTML } from "linkedom";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function installDom() {
  // The real index.html, so the tests fail if a mount point is renamed or
  // removed -- which is exactly the kind of break a render test should catch.
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  const { document, window } = parseHTML(html);

  const noop = () => {};
  const store = new Map();

  const shim = {
    document,
    addEventListener: noop,
    removeEventListener: noop,
    matchMedia: () => ({
      matches: false,
      addEventListener: noop,
      addListener: noop,
    }),
    requestAnimationFrame: (fn) => {
      // Synchronous, so the post-render measurement passes run inside the test
      // rather than after it has finished.
      fn(0);
      return 0;
    },
    cancelAnimationFrame: noop,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    location: { hostname: "example.test", hash: "", search: "", href: "/" },
    Notification: undefined,
    Capacitor: undefined,
  };

  globalThis.window = Object.assign(globalThis, shim);
  globalThis.document = document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  Object.defineProperty(globalThis, "navigator", {
    value: { storage: undefined, vibrate: noop },
    configurable: true,
  });
  globalThis.indexedDB = undefined;

  return document;
}

// A click, delivered the way the delegated handlers expect to receive one.
export function clickOn(element) {
  return { target: element, preventDefault: () => {} };
}
