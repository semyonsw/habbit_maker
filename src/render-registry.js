"use strict";

const registry = {};

export function registerRenderer(name, fn) {
  registry[name] = fn;
}

export function callRenderer(name, ...args) {
  if (registry[name]) {
    return registry[name](...args);
  }
}
