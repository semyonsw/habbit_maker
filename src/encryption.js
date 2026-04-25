"use strict";

import { GEMINI_MODELS, API_KEY_CACHE_KEY } from "./constants.js";
import { state, secureSettings, runtimeSecrets, globals } from "./state.js";
import {
  isPlainObject,
  nowIso,
  toBase64,
  fromBase64,
  bytesFromString,
  stringFromBytes,
} from "./utils.js?v=2";
import { appendLogEntry } from "./logging.js";
import * as db from "./db.js";

const RUNTIME_KEY_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RUNTIME_KEY_CACHE_VERSION = 1;

export async function loadSecureSettings() {
  try {
    const parsed = await db.getSecureSettings();
    if (!isPlainObject(parsed)) return;
    Object.assign(secureSettings, {
      keyCiphertext:
        typeof parsed.keyCiphertext === "string" ? parsed.keyCiphertext : null,
      saltBase64:
        typeof parsed.saltBase64 === "string" ? parsed.saltBase64 : null,
      ivBase64: typeof parsed.ivBase64 === "string" ? parsed.ivBase64 : null,
      kdfIterations: Number.isFinite(Number(parsed.kdfIterations))
        ? Math.max(200000, Number(parsed.kdfIterations))
        : 600000,
      keyUpdatedAt:
        typeof parsed.keyUpdatedAt === "string" ? parsed.keyUpdatedAt : null,
    });
  } catch (error) {
    appendLogEntry({
      level: "warn",
      component: "secure-settings",
      operation: "loadSecureSettings",
      message: "Failed to load secure settings; using empty defaults.",
      error,
    });
  }
}

export function persistSecureSettings() {
  db.putSecureSettings({
    keyCiphertext: secureSettings.keyCiphertext,
    saltBase64: secureSettings.saltBase64,
    ivBase64: secureSettings.ivBase64,
    kdfIterations: secureSettings.kdfIterations,
    keyUpdatedAt: secureSettings.keyUpdatedAt,
  }).catch((error) => {
    appendLogEntry({
      level: "error",
      component: "secure-settings",
      operation: "persistSecureSettings",
      message: "Failed to persist secure settings to backend.",
      error,
    });
  });
}

export function hasStoredEncryptedApiKey() {
  return !!(
    secureSettings &&
    secureSettings.keyCiphertext &&
    secureSettings.saltBase64 &&
    secureSettings.ivBase64
  );
}

export function clearRuntimeApiKey() {
  runtimeSecrets.apiKey = "";
  runtimeSecrets.unlockedAt = null;
}

export function isApiKeyDeviceCacheEnabled() {
  return true;
}

function readSessionRuntimeApiKeyCacheRaw() {
  try {
    return String(sessionStorage.getItem(API_KEY_CACHE_KEY) || "");
  } catch (_) {
    return "";
  }
}

function writeSessionRuntimeApiKeyCache(payload) {
  try {
    sessionStorage.setItem(API_KEY_CACHE_KEY, JSON.stringify(payload));
  } catch (_) {
    /* session storage can be unavailable in restricted contexts */
  }
}

function clearSessionRuntimeApiKeyCache() {
  try {
    sessionStorage.removeItem(API_KEY_CACHE_KEY);
  } catch (_) {
    /* session storage can be unavailable in restricted contexts */
  }
}

function parseRuntimeApiKeyCachePayload(rawPayload) {
  if (!rawPayload) return null;

  if (typeof rawPayload === "string") {
    const legacyValue = rawPayload.trim();
    if (!legacyValue) return null;
    const now = Date.now();
    return {
      version: RUNTIME_KEY_CACHE_VERSION,
      apiKey: legacyValue,
      cachedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + RUNTIME_KEY_CACHE_TTL_MS).toISOString(),
      _normalized: true,
    };
  }

  if (!isPlainObject(rawPayload)) return null;

  const apiKey = String(rawPayload.apiKey || "").trim();
  const parsedExpiresAt = Date.parse(String(rawPayload.expiresAt || ""));
  if (!apiKey || !Number.isFinite(parsedExpiresAt)) {
    return null;
  }

  const cachedAtCandidate = Date.parse(String(rawPayload.cachedAt || ""));
  const cachedAt = Number.isFinite(cachedAtCandidate)
    ? new Date(cachedAtCandidate).toISOString()
    : nowIso();
  const normalizedVersion =
    Number(rawPayload.version) === RUNTIME_KEY_CACHE_VERSION
      ? RUNTIME_KEY_CACHE_VERSION
      : RUNTIME_KEY_CACHE_VERSION;

  const parsed = {
    version: normalizedVersion,
    apiKey,
    cachedAt,
    expiresAt: new Date(parsedExpiresAt).toISOString(),
  };

  if (
    Number(rawPayload.version) !== RUNTIME_KEY_CACHE_VERSION ||
    !String(rawPayload.cachedAt || "").trim()
  ) {
    parsed._normalized = true;
  }

  return parsed;
}

function buildRuntimeApiKeyCachePayload(apiKey) {
  const value = String(apiKey || "").trim();
  if (!value) return null;
  const now = Date.now();
  return {
    version: RUNTIME_KEY_CACHE_VERSION,
    apiKey: value,
    cachedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + RUNTIME_KEY_CACHE_TTL_MS).toISOString(),
  };
}

function isRuntimeApiKeyCacheValid(payload) {
  const expiresAtMs = Date.parse(String(payload && payload.expiresAt));
  return Number.isFinite(expiresAtMs) && expiresAtMs > Date.now();
}

function hydrateRuntimeApiKeyFromCache(payload) {
  runtimeSecrets.apiKey = String(payload.apiKey || "").trim();
  runtimeSecrets.unlockedAt = nowIso();
}

function persistRuntimeApiKeyCache(apiKey) {
  const payload = buildRuntimeApiKeyCachePayload(apiKey);

  if (!payload) {
    clearSessionRuntimeApiKeyCache();
    return db.patchPrefs({ [API_KEY_CACHE_KEY]: null }).catch((error) => {
      appendLogEntry({
        level: "warn",
        component: "secure-settings",
        operation: "persistRuntimeApiKeyCache.clear",
        message: "Failed to clear persisted API key cache.",
        error,
      });
    });
  }

  writeSessionRuntimeApiKeyCache(payload);
  return db.patchPrefs({ [API_KEY_CACHE_KEY]: payload }).catch((error) => {
    appendLogEntry({
      level: "warn",
      component: "secure-settings",
      operation: "persistRuntimeApiKeyCache.persist",
      message: "Failed to persist API key cache.",
      error,
    });
  });
}

async function loadRuntimeApiKeyCache() {
  const sessionRaw = readSessionRuntimeApiKeyCacheRaw();
  if (sessionRaw) {
    let parsedSession = null;
    try {
      parsedSession = JSON.parse(sessionRaw);
    } catch (_) {
      parsedSession = sessionRaw;
    }
    const payload = parseRuntimeApiKeyCachePayload(parsedSession);
    if (payload && isRuntimeApiKeyCacheValid(payload)) {
      hydrateRuntimeApiKeyFromCache(payload);
      if (payload._normalized) {
        writeSessionRuntimeApiKeyCache(payload);
      }
      return true;
    }
    clearSessionRuntimeApiKeyCache();
  }

  let prefs = null;
  try {
    prefs = await db.getPrefs();
  } catch (error) {
    appendLogEntry({
      level: "warn",
      component: "secure-settings",
      operation: "loadRuntimeApiKeyCache.getPrefs",
      message: "Failed to read persisted API key cache.",
      error,
    });
    return false;
  }

  const persistedRaw = isPlainObject(prefs) ? prefs[API_KEY_CACHE_KEY] : null;
  const payload = parseRuntimeApiKeyCachePayload(persistedRaw);
  if (payload && isRuntimeApiKeyCacheValid(payload)) {
    hydrateRuntimeApiKeyFromCache(payload);
    writeSessionRuntimeApiKeyCache(payload);
    if (payload._normalized) {
      db.patchPrefs({ [API_KEY_CACHE_KEY]: payload }).catch((error) => {
        appendLogEntry({
          level: "warn",
          component: "secure-settings",
          operation: "loadRuntimeApiKeyCache.normalize",
          message: "Failed to normalize persisted API key cache.",
          error,
        });
      });
    }
    return true;
  }

  if (persistedRaw !== null && persistedRaw !== undefined) {
    db.patchPrefs({ [API_KEY_CACHE_KEY]: null }).catch((error) => {
      appendLogEntry({
        level: "warn",
        component: "secure-settings",
        operation: "loadRuntimeApiKeyCache.clearExpired",
        message: "Failed to clear expired API key cache.",
        error,
      });
    });
  }

  return false;
}

async function derivePassphraseKey(passphrase, salt, iterations) {
  const keyMaterial = await window.crypto.subtle.importKey(
    "raw",
    bytesFromString(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return window.crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptApiKeyWithPassphrase(apiKey, passphrase) {
  if (!window.crypto || !window.crypto.subtle) {
    throw new Error("Secure crypto APIs are unavailable in this browser.");
  }
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const iterations = 600000;
  const key = await derivePassphraseKey(passphrase, salt, iterations);
  const encrypted = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    bytesFromString(apiKey),
  );

  secureSettings.keyCiphertext = toBase64(new Uint8Array(encrypted));
  secureSettings.saltBase64 = toBase64(salt);
  secureSettings.ivBase64 = toBase64(iv);
  secureSettings.kdfIterations = iterations;
  secureSettings.keyUpdatedAt = nowIso();
  persistSecureSettings();
}

export async function decryptApiKeyWithPassphrase(passphrase) {
  if (!hasStoredEncryptedApiKey()) {
    throw new Error("No encrypted API key is stored yet.");
  }
  const salt = fromBase64(secureSettings.saltBase64);
  const iv = fromBase64(secureSettings.ivBase64);
  const ciphertext = fromBase64(secureSettings.keyCiphertext);
  const key = await derivePassphraseKey(
    passphrase,
    salt,
    secureSettings.kdfIterations || 200000,
  );
  const decrypted = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext,
  );
  return stringFromBytes(new Uint8Array(decrypted));
}

export function getApiKeyForSummary() {
  return String(runtimeSecrets.apiKey || "").trim();
}

export function applySummaryApiKeyUiState() {
  const keyInput = document.getElementById("summaryApiKeyInput");
  const savedLabel = document.getElementById("summaryApiKeySavedLabel");
  const unlockBtn = document.getElementById("summaryApiKeyUnlockBtn");
  const clearBtn = document.getElementById("summaryApiKeyClearBtn");
  const saveBtn = document.getElementById("btnSaveSummarySettings");

  if (!keyInput || !savedLabel || !unlockBtn || !clearBtn || !saveBtn) return;

  const hasEncrypted = hasStoredEncryptedApiKey();
  const isUnlocked = !!getApiKeyForSummary();
  if (hasEncrypted && isUnlocked) {
    savedLabel.textContent =
      "API key is saved (encrypted) and unlocked. Device cache stays valid for 7 days.";
  } else if (hasEncrypted) {
    savedLabel.textContent =
      "API key is saved (encrypted). You will only re-enter passphrase when cache expires.";
  } else if (isUnlocked) {
    savedLabel.textContent = "API key is loaded for this session.";
  } else {
    savedLabel.textContent = "No API key saved yet.";
  }

  keyInput.placeholder = hasEncrypted
    ? "Leave empty to keep saved key, or paste a new key to rotate"
    : "Paste your Gemini API key";
  unlockBtn.disabled = !hasEncrypted;
  clearBtn.disabled = !hasEncrypted;
  saveBtn.textContent = hasEncrypted
    ? "Save Summary Settings"
    : "Save Summary Settings + Encrypted API Key";
}

export async function unlockStoredApiKeyInteractive() {
  if (!hasStoredEncryptedApiKey()) {
    alert("No encrypted API key is saved yet.");
    return false;
  }
  const passphrase = window.prompt(
    "Enter passphrase to unlock saved API key:",
    "",
  );
  if (!passphrase) return false;
  try {
    const decrypted = await decryptApiKeyWithPassphrase(passphrase);
    runtimeSecrets.apiKey = String(decrypted || "").trim();
    runtimeSecrets.unlockedAt = nowIso();
    await persistRuntimeApiKeyCache(runtimeSecrets.apiKey);
    applySummaryApiKeyUiState();
    appendLogEntry({
      level: "info",
      component: "secure-settings",
      operation: "unlockStoredApiKeyInteractive",
      message: "Encrypted API key unlocked for current session.",
    });
    return true;
  } catch (error) {
    clearRuntimeApiKey();
    await persistRuntimeApiKeyCache("");
    applySummaryApiKeyUiState();
    appendLogEntry({
      level: "warn",
      component: "secure-settings",
      operation: "unlockStoredApiKeyInteractive",
      message: "Failed to unlock encrypted API key.",
      error,
    });
    alert("Passphrase is incorrect or key is corrupted.");
    return false;
  }
}

export async function tryUnlockOnStartup() {
  if (await loadRuntimeApiKeyCache()) {
    applySummaryApiKeyUiState();
    return;
  }
  clearRuntimeApiKey();
  applySummaryApiKeyUiState();
}

export async function maybeMigrateLegacyApiKey() {
  const legacyKey = String(
    globals.legacyPlaintextApiKeyForMigration || "",
  ).trim();
  if (!legacyKey) return;

  globals.legacyPlaintextApiKeyForMigration = "";
  const passphrase = window.prompt(
    "A legacy plaintext API key was detected. Create a passphrase to encrypt and migrate it now:",
    "",
  );

  if (!passphrase) {
    appendLogEntry({
      level: "warn",
      component: "secure-settings",
      operation: "maybeMigrateLegacyApiKey",
      message: "Legacy API key migration skipped by user.",
    });
    return;
  }

  const confirmPassphrase = window.prompt("Confirm migration passphrase:", "");
  if (passphrase !== confirmPassphrase) {
    appendLogEntry({
      level: "warn",
      component: "secure-settings",
      operation: "maybeMigrateLegacyApiKey",
      message: "Legacy API key migration passphrase mismatch.",
    });
    alert(
      "Passphrase confirmation did not match. Legacy key was not migrated.",
    );
    return;
  }

  try {
    await encryptApiKeyWithPassphrase(legacyKey, passphrase);
    runtimeSecrets.apiKey = legacyKey;
    runtimeSecrets.unlockedAt = nowIso();
    await persistRuntimeApiKeyCache(runtimeSecrets.apiKey);
    const settings = getBookAiSettings();
    settings.apiKeySaved = true;
    settings.apiKeyLastUpdated = secureSettings.keyUpdatedAt || nowIso();
    saveStateImported();
    applySummaryApiKeyUiState();
    appendLogEntry({
      level: "info",
      component: "secure-settings",
      operation: "maybeMigrateLegacyApiKey",
      message: "Legacy API key migrated to encrypted storage.",
    });
    alert(
      "Legacy API key migrated successfully and unlocked for this session.",
    );
  } catch (error) {
    appendLogEntry({
      level: "error",
      component: "secure-settings",
      operation: "maybeMigrateLegacyApiKey",
      message: "Failed to migrate legacy API key.",
      error,
    });
    alert("Failed to migrate legacy API key.");
  }
}

export function wipeStoredApiKey() {
  secureSettings.keyCiphertext = null;
  secureSettings.saltBase64 = null;
  secureSettings.ivBase64 = null;
  secureSettings.keyUpdatedAt = null;
  persistSecureSettings();
  clearRuntimeApiKey();
  persistRuntimeApiKeyCache("");
  const settings = getBookAiSettings();
  settings.apiKeySaved = false;
  settings.apiKeyLastUpdated = "";
  saveStateImported();
  applySummaryApiKeyUiState();
  appendLogEntry({
    level: "info",
    component: "secure-settings",
    operation: "wipeStoredApiKey",
    message: "Encrypted API key removed.",
  });
}

export function ensureModelAllowed(value) {
  const candidate = String(value || "").trim();
  if (!candidate) return "gemini-2.5-flash";
  if (GEMINI_MODELS.includes(candidate)) return candidate;
  return "gemini-2.5-flash";
}

export function ensureSummaryLanguageAllowed(value) {
  const candidate = String(value || "").trim();
  if (candidate === "Armenian") return "Armenian";
  if (candidate === "Russian") return "Russian";
  return "English";
}

export function getBookAiSettings() {
  if (!isPlainObject(state.books.ai)) {
    state.books.ai = {
      apiKey: "",
      apiKeyMode: "encrypted",
      apiKeySaved: false,
      apiKeyLastUpdated: "",
      rememberOnDevice: true,
      model: "gemini-2.5-flash",
      summaryLanguage: "English",
      consolidateMode: true,
    };
  }
  state.books.ai.apiKey = "";
  state.books.ai.apiKeyMode = "encrypted";
  state.books.ai.apiKeySaved = hasStoredEncryptedApiKey();
  state.books.ai.rememberOnDevice = true;
  state.books.ai.model = ensureModelAllowed(state.books.ai.model);
  state.books.ai.summaryLanguage = ensureSummaryLanguageAllowed(
    state.books.ai.summaryLanguage,
  );
  delete state.books.ai.chunkChars;
  delete state.books.ai.maxPagesPerRun;
  return state.books.ai;
}

// Import saveState lazily to avoid circular dependency.
// Persistence is bound by persistence.js after both modules load; until then
// callers must not run state mutations through saveStateImported.
let saveStateImported = () => {
  appendLogEntry({
    level: "warn",
    component: "secure-settings",
    operation: "saveStateImported",
    message: "saveState callback invoked before binding; ignoring.",
  });
};
export function _bindSaveState(fn) {
  saveStateImported = fn;
}

export function applyBookSummarySettingsToInputs() {
  const settings = getBookAiSettings();
  const keyInput = document.getElementById("summaryApiKeyInput");
  const modelInput = document.getElementById("summaryModelInput");
  const languageInput = document.getElementById("summaryLanguageInput");
  const rememberToggle = document.getElementById("summaryRememberApiKeyToggle");
  const consolidateToggle = document.getElementById("summaryConsolidateToggle");

  if (keyInput) keyInput.value = "";
  if (modelInput) {
    modelInput.value = ensureModelAllowed(settings.model);
  }
  if (languageInput) {
    languageInput.value = ensureSummaryLanguageAllowed(
      settings.summaryLanguage,
    );
  }
  if (rememberToggle) {
    rememberToggle.checked = true;
    rememberToggle.disabled = true;
  }
  if (consolidateToggle) {
    consolidateToggle.checked = settings.consolidateMode !== false;
  }
  applySummaryApiKeyUiState();
}

export async function saveBookSummarySettingsFromInputs() {
  const settings = getBookAiSettings();
  const keyInput = document.getElementById("summaryApiKeyInput");
  const modelInput = document.getElementById("summaryModelInput");
  const languageInput = document.getElementById("summaryLanguageInput");
  const consolidateToggle = document.getElementById("summaryConsolidateToggle");

  const enteredKey = keyInput ? String(keyInput.value || "").trim() : "";
  settings.model = ensureModelAllowed(
    modelInput ? String(modelInput.value || "") : "",
  );
  settings.summaryLanguage = ensureSummaryLanguageAllowed(
    languageInput ? String(languageInput.value || "") : "",
  );

  settings.rememberOnDevice = true;

  settings.consolidateMode = consolidateToggle
    ? consolidateToggle.checked
    : true;

  try {
    if (enteredKey) {
      const passphrase = window.prompt(
        "Create a passphrase to encrypt your Gemini API key on this device:",
        "",
      );
      if (!passphrase) {
        alert("Passphrase is required to save the API key securely.");
        return;
      }
      const confirmPassphrase = window.prompt("Confirm the passphrase:", "");
      if (passphrase !== confirmPassphrase) {
        alert("Passphrase confirmation did not match.");
        return;
      }
      await encryptApiKeyWithPassphrase(enteredKey, passphrase);
      runtimeSecrets.apiKey = enteredKey;
      runtimeSecrets.unlockedAt = nowIso();
      await persistRuntimeApiKeyCache(runtimeSecrets.apiKey);
      settings.apiKeySaved = true;
      settings.apiKeyLastUpdated = secureSettings.keyUpdatedAt || nowIso();
    } else {
      settings.apiKeySaved = hasStoredEncryptedApiKey();
    }
  } catch (error) {
    appendLogEntry({
      level: "error",
      component: "secure-settings",
      operation: "saveBookSummarySettingsFromInputs",
      message: "Failed to encrypt API key.",
      error,
    });
    alert("Failed to save encrypted API key.");
    return;
  }

  settings.apiKey = "";
  settings.apiKeyMode = "encrypted";

  const runtimeApiKey = getApiKeyForSummary();
  if (runtimeApiKey) {
    await persistRuntimeApiKeyCache(runtimeApiKey);
  }

  saveStateImported();
  applyBookSummarySettingsToInputs();
  if (enteredKey) {
    alert("Summary AI settings saved. API key is encrypted and stored safely.");
  } else {
    alert("Summary AI settings saved.");
  }
}
