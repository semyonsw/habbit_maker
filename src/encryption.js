"use strict";

import {
  SECURE_SETTINGS_KEY,
  API_KEY_CACHE_KEY,
  GEMINI_MODELS,
  SUMMARY_MAX_CHARS_PER_CHUNK_DEFAULT,
  SUMMARY_MAX_PAGES_PER_RUN_DEFAULT,
} from "./constants.js";
import { state, secureSettings, runtimeSecrets, globals } from "./state.js";
import {
  isPlainObject,
  nowIso,
  toBase64,
  fromBase64,
  bytesFromString,
  stringFromBytes,
} from "./utils.js";
import { appendLogEntry } from "./logging.js";

export function loadSecureSettings() {
  try {
    const raw = localStorage.getItem(SECURE_SETTINGS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!isPlainObject(parsed)) return;
    Object.assign(secureSettings, {
      keyCiphertext:
        typeof parsed.keyCiphertext === "string"
          ? parsed.keyCiphertext
          : null,
      saltBase64:
        typeof parsed.saltBase64 === "string" ? parsed.saltBase64 : null,
      ivBase64: typeof parsed.ivBase64 === "string" ? parsed.ivBase64 : null,
      kdfIterations: Number.isFinite(Number(parsed.kdfIterations))
        ? Math.max(120000, Number(parsed.kdfIterations))
        : 200000,
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
  localStorage.setItem(SECURE_SETTINGS_KEY, JSON.stringify(secureSettings));
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
  if (!state || !state.books || !state.books.ai) return false;
  return state.books.ai.rememberOnDevice === true;
}

function persistRuntimeApiKeyCache(apiKey) {
  const value = String(apiKey || "").trim();
  if (!value || !isApiKeyDeviceCacheEnabled()) {
    localStorage.removeItem(API_KEY_CACHE_KEY);
    return;
  }
  localStorage.setItem(API_KEY_CACHE_KEY, value);
}

function loadRuntimeApiKeyCache() {
  const cached = String(localStorage.getItem(API_KEY_CACHE_KEY) || "").trim();
  if (!cached) return false;
  runtimeSecrets.apiKey = cached;
  runtimeSecrets.unlockedAt = nowIso();
  return true;
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
  const iterations = 200000;
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
  const hasCachedRuntimeKey = !!String(
    localStorage.getItem(API_KEY_CACHE_KEY) || "",
  ).trim();
  const cacheEnabled = isApiKeyDeviceCacheEnabled();
  if (hasEncrypted && isUnlocked) {
    savedLabel.textContent =
      "API key is saved (encrypted) and unlocked for this session.";
  } else if (hasEncrypted) {
    savedLabel.textContent =
      "API key is saved (encrypted). Unlock with passphrase to run summaries.";
  } else if (cacheEnabled && hasCachedRuntimeKey && isUnlocked) {
    savedLabel.textContent =
      "API key is cached locally and ready to use on this device.";
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
    persistRuntimeApiKeyCache(runtimeSecrets.apiKey);
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
  if (isApiKeyDeviceCacheEnabled() && loadRuntimeApiKeyCache()) {
    applySummaryApiKeyUiState();
    return;
  }
  if (!hasStoredEncryptedApiKey()) {
    applySummaryApiKeyUiState();
    return;
  }
  const passphrase = window.prompt(
    "Enter passphrase to unlock your saved Gemini API key for this session:",
    "",
  );
  if (!passphrase) {
    clearRuntimeApiKey();
    applySummaryApiKeyUiState();
    return;
  }
  try {
    const decrypted = await decryptApiKeyWithPassphrase(passphrase);
    runtimeSecrets.apiKey = String(decrypted || "").trim();
    runtimeSecrets.unlockedAt = nowIso();
    persistRuntimeApiKeyCache(runtimeSecrets.apiKey);
    appendLogEntry({
      level: "info",
      component: "secure-settings",
      operation: "tryUnlockOnStartup",
      message: "Encrypted API key unlocked on app startup.",
    });
  } catch (error) {
    clearRuntimeApiKey();
    appendLogEntry({
      level: "warn",
      component: "secure-settings",
      operation: "tryUnlockOnStartup",
      message: "Startup unlock failed.",
      error,
    });
    alert(
      "Could not unlock saved API key. You can retry from Summary AI settings.",
    );
  } finally {
    applySummaryApiKeyUiState();
  }
}

export async function maybeMigrateLegacyApiKey() {
  const legacyKey = String(globals.legacyPlaintextApiKeyForMigration || "").trim();
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

  const confirmPassphrase = window.prompt(
    "Confirm migration passphrase:",
    "",
  );
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
    persistRuntimeApiKeyCache(runtimeSecrets.apiKey);
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

export function getBookAiSettings() {
  if (!isPlainObject(state.books.ai)) {
    state.books.ai = {
      apiKey: "",
      apiKeyMode: "encrypted",
      apiKeySaved: false,
      apiKeyLastUpdated: "",
      rememberOnDevice: false,
      model: "gemini-2.5-flash",
      chunkChars: SUMMARY_MAX_CHARS_PER_CHUNK_DEFAULT,
      maxPagesPerRun: SUMMARY_MAX_PAGES_PER_RUN_DEFAULT,
      consolidateMode: true,
    };
  }
  state.books.ai.apiKey = "";
  state.books.ai.apiKeyMode = "encrypted";
  state.books.ai.apiKeySaved = hasStoredEncryptedApiKey();
  state.books.ai.rememberOnDevice = state.books.ai.rememberOnDevice === true;
  state.books.ai.model = ensureModelAllowed(state.books.ai.model);
  return state.books.ai;
}

// Import saveState lazily to avoid circular dependency
let saveStateImported = () => {
  const { STORAGE_KEY: key } = { STORAGE_KEY: "habitTracker_v1" };
  localStorage.setItem(key, JSON.stringify(state));
};
export function _bindSaveState(fn) { saveStateImported = fn; }

export function applyBookSummarySettingsToInputs() {
  const settings = getBookAiSettings();
  const keyInput = document.getElementById("summaryApiKeyInput");
  const modelInput = document.getElementById("summaryModelInput");
  const chunkCharsInput = document.getElementById("summaryChunkCharsInput");
  const maxPagesInput = document.getElementById("summaryMaxPagesInput");
  const rememberToggle = document.getElementById(
    "summaryRememberApiKeyToggle",
  );
  const consolidateToggle = document.getElementById(
    "summaryConsolidateToggle",
  );

  if (keyInput) keyInput.value = "";
  if (modelInput) {
    modelInput.value = ensureModelAllowed(settings.model);
  }
  if (chunkCharsInput) {
    chunkCharsInput.value = String(
      settings.chunkChars || SUMMARY_MAX_CHARS_PER_CHUNK_DEFAULT,
    );
  }
  if (maxPagesInput) {
    maxPagesInput.value = String(
      settings.maxPagesPerRun || SUMMARY_MAX_PAGES_PER_RUN_DEFAULT,
    );
  }
  if (rememberToggle) {
    rememberToggle.checked = settings.rememberOnDevice === true;
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
  const chunkCharsInput = document.getElementById("summaryChunkCharsInput");
  const maxPagesInput = document.getElementById("summaryMaxPagesInput");
  const rememberToggle = document.getElementById(
    "summaryRememberApiKeyToggle",
  );
  const consolidateToggle = document.getElementById(
    "summaryConsolidateToggle",
  );

  const enteredKey = keyInput ? String(keyInput.value || "").trim() : "";
  settings.model = ensureModelAllowed(
    modelInput ? String(modelInput.value || "") : "",
  );

  const chunkChars = parseInt(
    chunkCharsInput ? chunkCharsInput.value : "",
    10,
  );
  settings.chunkChars = Number.isFinite(chunkChars)
    ? Math.min(30000, Math.max(4000, chunkChars))
    : SUMMARY_MAX_CHARS_PER_CHUNK_DEFAULT;

  const maxPagesPerRun = parseInt(
    maxPagesInput ? maxPagesInput.value : "",
    10,
  );
  settings.maxPagesPerRun = Number.isFinite(maxPagesPerRun)
    ? Math.min(1000, Math.max(20, maxPagesPerRun))
    : SUMMARY_MAX_PAGES_PER_RUN_DEFAULT;

  settings.rememberOnDevice = rememberToggle ? rememberToggle.checked : false;

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
      persistRuntimeApiKeyCache(runtimeSecrets.apiKey);
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

  if (settings.rememberOnDevice) {
    persistRuntimeApiKeyCache(getApiKeyForSummary());
  } else {
    persistRuntimeApiKeyCache("");
  }

  saveStateImported();
  applyBookSummarySettingsToInputs();
  if (enteredKey) {
    alert(
      "Summary AI settings saved. API key is encrypted and stored safely.",
    );
  } else {
    alert("Summary AI settings saved.");
  }
}
