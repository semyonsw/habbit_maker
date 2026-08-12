"use strict";

// Tiny indirection so modules can trigger a re-render without importing the
// router (which imports them).
const renderers = new Map();

export function registerRenderer(name, fn) {
  renderers.set(name, fn);
}

export function callRenderer(name, ...args) {
  const fn = renderers.get(name);
  return fn ? fn(...args) : undefined;
}
