"use strict";

const GLOBAL_LOADING_OVERLAY_ID = "globalLoadingOverlay";
const GLOBAL_LOADING_MESSAGE_ID = "globalLoadingMessage";

function getGlobalLoadingElements() {
  const overlay = document.getElementById(GLOBAL_LOADING_OVERLAY_ID);
  const message = document.getElementById(GLOBAL_LOADING_MESSAGE_ID);
  return { overlay, message };
}

export function setGlobalLoaderMessage(message) {
  const { message: messageEl } = getGlobalLoadingElements();
  if (!messageEl) return;
  const safeMessage = String(message || "Loading...").trim();
  messageEl.textContent = safeMessage || "Loading...";
}

export function showGlobalLoader(message) {
  const { overlay } = getGlobalLoadingElements();
  if (!overlay) return;
  setGlobalLoaderMessage(message);
  overlay.classList.add("open");
  overlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("is-global-loading");
}

export function hideGlobalLoader() {
  const { overlay } = getGlobalLoadingElements();
  if (!overlay) return;
  overlay.classList.remove("open");
  overlay.setAttribute("aria-hidden", "true");
  document.body.classList.remove("is-global-loading");
}

export function waitForNextPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(resolve);
    });
  });
}

export async function runWithGlobalLoader(message, work) {
  showGlobalLoader(message);
  await waitForNextPaint();
  try {
    return await work();
  } finally {
    hideGlobalLoader();
  }
}
