// A DOM for the render and interaction tests.
//
// linkedom rather than jsdom: the app only ever sets innerHTML, toggles
// classes, and reads dataset/closest, so a full browser emulation is not needed
// and would cost several seconds per CI run.
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
  const rafTimers = new Map();
  let rafId = 0;

  // --- inert -------------------------------------------------------------
  //
  // linkedom does not implement `inert`, and src/sheet.js feature-detects it
  // with `"inert" in HTMLElement.prototype`. Without this shim the detection
  // fails, the focus trap silently takes its non-inert fallback path, and the
  // tests run a code path no real browser takes -- which is exactly how the
  // "Add habit freezes the screen" bug got past a green suite.
  //
  // Backed by the attribute, so isInert() below can walk the tree the way a
  // browser's hit-testing does.
  Object.defineProperty(window.HTMLElement.prototype, "inert", {
    get() {
      return this.hasAttribute("inert");
    },
    set(value) {
      if (value) this.setAttribute("inert", "");
      else this.removeAttribute("inert");
    },
    configurable: true,
  });

  // --- window as a real event target -------------------------------------
  //
  // A noop addEventListener made the router untestable: navigateTo() sets
  // location.hash and relies on the resulting `hashchange` to call switchView,
  // so with no event plumbing the nav buttons appeared to do nothing in tests
  // while working perfectly in a browser. Model it properly instead.
  const listeners = new Map();

  const addEventListener = (type, fn) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
  };
  const removeEventListener = (type, fn) => {
    const set = listeners.get(type);
    if (set) set.delete(fn);
  };
  const dispatch = (type, detail) => {
    const set = listeners.get(type);
    if (!set) return;
    Array.from(set).forEach((fn) => fn(detail || { type }));
  };

  // --- location + history --------------------------------------------------
  //
  // Modelled rather than stubbed, because the back button is load-bearing on
  // Android: an open sheet must swallow a back press instead of letting it
  // close the app. Testing that needs a real entry stack, a back() that pops
  // it, and the popstate/hashchange pair a browser would fire.
  //
  // Simplification: back() here is synchronous, where a browser defers it a
  // tick. The ordering the app relies on (popstate, then hashchange if the hash
  // actually changed) is faithful.
  let hash = "";
  let stack = [""];
  let index = 0;

  const setHash = (value, notify) => {
    const next = String(value || "").startsWith("#")
      ? String(value)
      : value
        ? `#${value}`
        : "";
    if (next === hash) return false;
    hash = next;
    if (notify) dispatch("hashchange", { type: "hashchange" });
    return true;
  };

  const location = {
    hostname: "example.test",
    search: "",
    href: "/",
    get hash() {
      return hash;
    },
    set hash(value) {
      const before = hash;
      if (!setHash(value, true)) return;
      // A hash assignment is a navigation: it appends an entry.
      stack = stack.slice(0, index + 1);
      stack.push(hash);
      index = stack.length - 1;
      void before;
    },
  };

  const history = {
    get length() {
      return stack.length;
    },
    // Position in the stack: how many back presses from the first entry. This
    // is the meaningful measure for the tests -- `length` also shrinks when
    // pushState truncates forward entries, exactly as a browser's does.
    get index() {
      return index;
    },
    pushState: (_state, _title, url) => {
      stack = stack.slice(0, index + 1);
      stack.push(typeof url === "string" ? url : hash);
      index = stack.length - 1;
      setHash(stack[index], false);
    },
    replaceState: (_state, _title, url) => {
      stack[index] = typeof url === "string" ? url : hash;
      setHash(stack[index], false);
    },
    back: () => {
      if (index === 0) {
        // Nothing left to pop: a real browser leaves the app here and fires
        // no popstate. Tests assert on `exited` to catch exactly that.
        history.exited = true;
        return;
      }
      index -= 1;
      const changed = setHash(stack[index], false);
      dispatch("popstate", { type: "popstate", state: null });
      if (changed) dispatch("hashchange", { type: "hashchange" });
    },
    exited: false,
  };

  // --- FileReader ---------------------------------------------------------
  //
  // Node has Blob but no FileReader, and the Android export path runs
  // blob -> base64 -> bridge. Modelled on the real API rather than mocked out
  // -- asynchronous, onload/onerror, and a genuine data: URL built from the
  // blob's own bytes -- so a test can assert on the bytes that actually reached
  // the native plugin instead of trusting a stub's word for it.
  class FileReaderShim {
    constructor() {
      this.result = null;
      this.error = null;
      this.onload = null;
      this.onerror = null;
    }

    readAsDataURL(blob) {
      Promise.resolve()
        .then(() => blob.arrayBuffer())
        .then((buffer) => {
          const type = blob.type || "application/octet-stream";
          this.result = `data:${type};base64,${Buffer.from(buffer).toString(
            "base64",
          )}`;
          if (this.onload) this.onload({ target: this });
        })
        .catch((error) => {
          this.error = error;
          if (this.onerror) this.onerror({ target: this });
        });
    }
  }

  const shim = {
    document,
    addEventListener,
    removeEventListener,
    dispatchEvent: (event) => {
      dispatch(event && event.type, event);
      return true;
    },
    matchMedia: () => ({
      matches: false,
      addEventListener: noop,
      addListener: noop,
    }),
    // Deferred, like a browser's -- NOT synchronous.
    //
    // A synchronous rAF turns any self-scheduling animation loop into infinite
    // recursion: src/reorder.js runs an auto-scroll loop for the length of a
    // drag, and calling it back from inside itself blew the stack instantly.
    // A test environment that cannot express "next frame" cannot test anything
    // that animates.
    requestAnimationFrame: (fn) => {
      const id = ++rafId;
      const timer = setTimeout(() => {
        rafTimers.delete(id);
        fn(Date.now());
      }, 0);
      // Cleanup work must never hold the test runner open.
      if (timer && typeof timer.unref === "function") timer.unref();
      rafTimers.set(id, timer);
      return id;
    },
    cancelAnimationFrame: (id) => {
      const timer = rafTimers.get(id);
      if (timer === undefined) return;
      clearTimeout(timer);
      rafTimers.delete(id);
    },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    location,
    history,
    scrollTo: noop,
    scrollY: 0,
    visualViewport: null,
    Notification: undefined,
    Capacitor: undefined,
  };

  // location has accessors; assign it by descriptor so the setter survives.
  const { location: locationShim, ...plain } = shim;
  globalThis.window = Object.assign(globalThis, plain);
  Object.defineProperty(globalThis, "location", {
    value: locationShim,
    writable: true,
    configurable: true,
  });
  globalThis.document = document;
  globalThis.FileReader = FileReaderShim;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  globalThis.Event = window.Event;
  Object.defineProperty(globalThis, "navigator", {
    value: { storage: undefined, vibrate: noop },
    configurable: true,
  });
  // A request that never fires: the persistence layer's promises stay pending
  // instead of rejecting into the test output. Nothing here asserts on what
  // reached storage -- these tests are about the UI.
  globalThis.indexedDB = { open: () => ({}) };

  return document;
}

/* ====================================================================== */
/* Browser-faithful interaction helpers                                   */
/* ====================================================================== */

// True if `el` or any ancestor is inert -- the browser would route no pointer
// event to it and it would not be focusable.
export function isInert(el) {
  let node = el;
  while (node && node.hasAttribute) {
    if (node.hasAttribute("inert")) return true;
    node = node.parentElement;
  }
  return false;
}

// Why an element cannot be interacted with, or null if it can be.
export function whyNotInteractive(el) {
  if (!el) return "element does not exist";
  if (isInert(el)) {
    let node = el;
    while (node && !node.hasAttribute("inert")) node = node.parentElement;
    return `inside an inert subtree (<${node.tagName.toLowerCase()}${
      node.id ? ` id="${node.id}"` : ""
    }> is inert)`;
  }
  if (el.disabled) return "disabled";
  return null;
}

// Click the way a browser would: refuse if the element is unreachable, then
// dispatch a bubbling click so the app's delegated handlers see it.
//
// linkedom happily bubbles a click out of an inert subtree, so without the
// guard a test would pass on markup a user cannot touch.
export function click(el, label) {
  const reason = whyNotInteractive(el);
  if (reason) {
    throw new Error(
      `cannot click ${label || (el && el.outerHTML) || "element"}: ${reason}`,
    );
  }
  el.dispatchEvent(new Event("click", { bubbles: true, cancelable: true }));
}

// Set a field's value and fire the event the app listens for.
export function setValue(el, value, type = "change", label) {
  const reason = whyNotInteractive(el);
  if (reason) {
    throw new Error(`cannot type into ${label || "field"}: ${reason}`);
  }
  el.value = value;
  el.dispatchEvent(new Event(type, { bubbles: true }));
}

export function $(selector) {
  return document.querySelector(selector);
}

export function $$(selector) {
  return Array.from(document.querySelectorAll(selector));
}
