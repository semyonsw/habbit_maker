(function () {
  "use strict";

  H.loadSecureSettings = function () {
    try {
      var raw = localStorage.getItem(H.SECURE_SETTINGS_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (!H.isPlainObject(parsed)) return;
      H.secureSettings = {
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
      };
    } catch (error) {
      H.appendLogEntry({
        level: "warn",
        component: "secure-settings",
        operation: "loadSecureSettings",
        message: "Failed to load secure settings; using empty defaults.",
        error: error,
      });
    }
  };

  H.persistSecureSettings = function () {
    localStorage.setItem(H.SECURE_SETTINGS_KEY, JSON.stringify(H.secureSettings));
  };

  H.hasStoredEncryptedApiKey = function () {
    return !!(
      H.secureSettings &&
      H.secureSettings.keyCiphertext &&
      H.secureSettings.saltBase64 &&
      H.secureSettings.ivBase64
    );
  };

  H.clearRuntimeApiKey = function () {
    H.runtimeSecrets.apiKey = "";
    H.runtimeSecrets.unlockedAt = null;
  };

  H.isApiKeyDeviceCacheEnabled = function () {
    if (!H.state || !H.state.books || !H.state.books.ai) return false;
    return H.state.books.ai.rememberOnDevice === true;
  };

  H.persistRuntimeApiKeyCache = function (apiKey) {
    var value = String(apiKey || "").trim();
    if (!value || !H.isApiKeyDeviceCacheEnabled()) {
      localStorage.removeItem(H.API_KEY_CACHE_KEY);
      return;
    }
    localStorage.setItem(H.API_KEY_CACHE_KEY, value);
  };

  H.loadRuntimeApiKeyCache = function () {
    var cached = String(localStorage.getItem(H.API_KEY_CACHE_KEY) || "").trim();
    if (!cached) return false;
    H.runtimeSecrets.apiKey = cached;
    H.runtimeSecrets.unlockedAt = H.nowIso();
    return true;
  };

  H.derivePassphraseKey = async function (passphrase, salt, iterations) {
    var keyMaterial = await window.crypto.subtle.importKey(
      "raw",
      H.bytesFromString(passphrase),
      { name: "PBKDF2" },
      false,
      ["deriveKey"],
    );
    return window.crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: salt,
        iterations: iterations,
        hash: "SHA-256",
      },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  };

  H.encryptApiKeyWithPassphrase = async function (apiKey, passphrase) {
    if (!window.crypto || !window.crypto.subtle) {
      throw new Error("Secure crypto APIs are unavailable in this browser.");
    }
    var salt = window.crypto.getRandomValues(new Uint8Array(16));
    var iv = window.crypto.getRandomValues(new Uint8Array(12));
    var iterations = 200000;
    var key = await H.derivePassphraseKey(passphrase, salt, iterations);
    var encrypted = await window.crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv },
      key,
      H.bytesFromString(apiKey),
    );

    H.secureSettings.keyCiphertext = H.toBase64(new Uint8Array(encrypted));
    H.secureSettings.saltBase64 = H.toBase64(salt);
    H.secureSettings.ivBase64 = H.toBase64(iv);
    H.secureSettings.kdfIterations = iterations;
    H.secureSettings.keyUpdatedAt = H.nowIso();
    H.persistSecureSettings();
  };

  H.decryptApiKeyWithPassphrase = async function (passphrase) {
    if (!H.hasStoredEncryptedApiKey()) {
      throw new Error("No encrypted API key is stored yet.");
    }
    var salt = H.fromBase64(H.secureSettings.saltBase64);
    var iv = H.fromBase64(H.secureSettings.ivBase64);
    var ciphertext = H.fromBase64(H.secureSettings.keyCiphertext);
    var key = await H.derivePassphraseKey(
      passphrase,
      salt,
      H.secureSettings.kdfIterations || 200000,
    );
    var decrypted = await window.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv },
      key,
      ciphertext,
    );
    return H.stringFromBytes(new Uint8Array(decrypted));
  };

  H.getApiKeyForSummary = function () {
    return String(H.runtimeSecrets.apiKey || "").trim();
  };

  H.applySummaryApiKeyUiState = function () {
    var keyInput = document.getElementById("summaryApiKeyInput");
    var savedLabel = document.getElementById("summaryApiKeySavedLabel");
    var unlockBtn = document.getElementById("summaryApiKeyUnlockBtn");
    var clearBtn = document.getElementById("summaryApiKeyClearBtn");
    var saveBtn = document.getElementById("btnSaveSummarySettings");

    if (!keyInput || !savedLabel || !unlockBtn || !clearBtn || !saveBtn) return;

    var hasEncrypted = H.hasStoredEncryptedApiKey();
    var isUnlocked = !!H.getApiKeyForSummary();
    var hasCachedRuntimeKey = !!String(
      localStorage.getItem(H.API_KEY_CACHE_KEY) || "",
    ).trim();
    var cacheEnabled = H.isApiKeyDeviceCacheEnabled();
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
  };

  H.unlockStoredApiKeyInteractive = async function () {
    if (!H.hasStoredEncryptedApiKey()) {
      alert("No encrypted API key is saved yet.");
      return false;
    }
    var passphrase = window.prompt(
      "Enter passphrase to unlock saved API key:",
      "",
    );
    if (!passphrase) return false;
    try {
      var decrypted = await H.decryptApiKeyWithPassphrase(passphrase);
      H.runtimeSecrets.apiKey = String(decrypted || "").trim();
      H.runtimeSecrets.unlockedAt = H.nowIso();
      H.persistRuntimeApiKeyCache(H.runtimeSecrets.apiKey);
      H.applySummaryApiKeyUiState();
      H.appendLogEntry({
        level: "info",
        component: "secure-settings",
        operation: "unlockStoredApiKeyInteractive",
        message: "Encrypted API key unlocked for current session.",
      });
      return true;
    } catch (error) {
      H.clearRuntimeApiKey();
      H.applySummaryApiKeyUiState();
      H.appendLogEntry({
        level: "warn",
        component: "secure-settings",
        operation: "unlockStoredApiKeyInteractive",
        message: "Failed to unlock encrypted API key.",
        error: error,
      });
      alert("Passphrase is incorrect or key is corrupted.");
      return false;
    }
  };

  H.tryUnlockOnStartup = async function () {
    if (H.isApiKeyDeviceCacheEnabled() && H.loadRuntimeApiKeyCache()) {
      H.applySummaryApiKeyUiState();
      return;
    }
    if (!H.hasStoredEncryptedApiKey()) {
      H.applySummaryApiKeyUiState();
      return;
    }
    var passphrase = window.prompt(
      "Enter passphrase to unlock your saved Gemini API key for this session:",
      "",
    );
    if (!passphrase) {
      H.clearRuntimeApiKey();
      H.applySummaryApiKeyUiState();
      return;
    }
    try {
      var decrypted = await H.decryptApiKeyWithPassphrase(passphrase);
      H.runtimeSecrets.apiKey = String(decrypted || "").trim();
      H.runtimeSecrets.unlockedAt = H.nowIso();
      H.persistRuntimeApiKeyCache(H.runtimeSecrets.apiKey);
      H.appendLogEntry({
        level: "info",
        component: "secure-settings",
        operation: "tryUnlockOnStartup",
        message: "Encrypted API key unlocked on app startup.",
      });
    } catch (error) {
      H.clearRuntimeApiKey();
      H.appendLogEntry({
        level: "warn",
        component: "secure-settings",
        operation: "tryUnlockOnStartup",
        message: "Startup unlock failed.",
        error: error,
      });
      alert(
        "Could not unlock saved API key. You can retry from Summary AI settings.",
      );
    } finally {
      H.applySummaryApiKeyUiState();
    }
  };

  H.maybeMigrateLegacyApiKey = async function () {
    var legacyKey = String(H.legacyPlaintextApiKeyForMigration || "").trim();
    if (!legacyKey) return;

    H.legacyPlaintextApiKeyForMigration = "";
    var passphrase = window.prompt(
      "A legacy plaintext API key was detected. Create a passphrase to encrypt and migrate it now:",
      "",
    );

    if (!passphrase) {
      H.appendLogEntry({
        level: "warn",
        component: "secure-settings",
        operation: "maybeMigrateLegacyApiKey",
        message: "Legacy API key migration skipped by user.",
      });
      return;
    }

    var confirmPassphrase = window.prompt(
      "Confirm migration passphrase:",
      "",
    );
    if (passphrase !== confirmPassphrase) {
      H.appendLogEntry({
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
      await H.encryptApiKeyWithPassphrase(legacyKey, passphrase);
      H.runtimeSecrets.apiKey = legacyKey;
      H.runtimeSecrets.unlockedAt = H.nowIso();
      H.persistRuntimeApiKeyCache(H.runtimeSecrets.apiKey);
      var settings = H.getBookAiSettings();
      settings.apiKeySaved = true;
      settings.apiKeyLastUpdated = H.secureSettings.keyUpdatedAt || H.nowIso();
      H.saveState();
      H.applySummaryApiKeyUiState();
      H.appendLogEntry({
        level: "info",
        component: "secure-settings",
        operation: "maybeMigrateLegacyApiKey",
        message: "Legacy API key migrated to encrypted storage.",
      });
      alert(
        "Legacy API key migrated successfully and unlocked for this session.",
      );
    } catch (error) {
      H.appendLogEntry({
        level: "error",
        component: "secure-settings",
        operation: "maybeMigrateLegacyApiKey",
        message: "Failed to migrate legacy API key.",
        error: error,
      });
      alert("Failed to migrate legacy API key.");
    }
  };

  H.wipeStoredApiKey = function () {
    H.secureSettings.keyCiphertext = null;
    H.secureSettings.saltBase64 = null;
    H.secureSettings.ivBase64 = null;
    H.secureSettings.keyUpdatedAt = null;
    H.persistSecureSettings();
    H.clearRuntimeApiKey();
    H.persistRuntimeApiKeyCache("");
    var settings = H.getBookAiSettings();
    settings.apiKeySaved = false;
    settings.apiKeyLastUpdated = "";
    H.saveState();
    H.applySummaryApiKeyUiState();
    H.appendLogEntry({
      level: "info",
      component: "secure-settings",
      operation: "wipeStoredApiKey",
      message: "Encrypted API key removed.",
    });
  };

  H.ensureModelAllowed = function (value) {
    var candidate = String(value || "").trim();
    if (!candidate) return "gemini-2.5-flash";
    if (H.GEMINI_MODELS.includes(candidate)) return candidate;
    return "gemini-2.5-flash";
  };

  H.closeSummaryModelDropdown = function () {
    var picker = document.getElementById("summaryModelPicker");
    var input = document.getElementById("summaryModelInput");
    if (!picker || !input) return;
    H.summaryModelPickerState.isOpen = false;
    picker.classList.remove("open");
    input.setAttribute("aria-expanded", "false");
  };

  H.setSummaryModelValue = function (modelName, closeAfterSelect) {
    if (closeAfterSelect === undefined) closeAfterSelect = true;
    var input = document.getElementById("summaryModelInput");
    if (!input) return;
    input.value = H.ensureModelAllowed(modelName);
    if (closeAfterSelect) {
      H.closeSummaryModelDropdown();
    }
  };

  H.renderSummaryModelOptions = function () {
    var dropdown = document.getElementById("summaryModelDropdown");
    if (!dropdown) return;

    if (!H.summaryModelPickerState.filtered.length) {
      dropdown.innerHTML =
        '<div class="model-picker-empty">No matching model. Keep typing...</div>';
      return;
    }

    dropdown.innerHTML = H.summaryModelPickerState.filtered
      .map(function (modelName, idx) {
        var activeClass =
          idx === H.summaryModelPickerState.activeIndex ? " active" : "";
        return '<button class="model-picker-option' + activeClass + '" type="button" role="option" data-model="' + H.sanitize(modelName) + '" aria-selected="' + (idx === H.summaryModelPickerState.activeIndex) + '">' + H.sanitize(modelName) + '</button>';
      })
      .join("");

    dropdown.querySelectorAll(".model-picker-option").forEach(function (btn) {
      btn.addEventListener("click", function () {
        H.setSummaryModelValue(btn.dataset.model || "gemini-2.5-flash", true);
      });
    });
  };

  H.updateSummaryModelFilter = function (query) {
    var needle = String(query || "")
      .trim()
      .toLowerCase();
    var sorted = [].concat(H.GEMINI_MODELS).sort(function (a, b) { return a.localeCompare(b); });
    if (!needle) {
      H.summaryModelPickerState.filtered = sorted;
    } else {
      H.summaryModelPickerState.filtered = sorted.filter(function (name) {
        return name.toLowerCase().includes(needle);
      });
    }
    H.summaryModelPickerState.activeIndex = H.summaryModelPickerState.filtered
      .length
      ? 0
      : -1;
    H.renderSummaryModelOptions();
  };

  H.openSummaryModelDropdown = function () {
    var picker = document.getElementById("summaryModelPicker");
    var input = document.getElementById("summaryModelInput");
    if (!picker || !input) return;

    H.summaryModelPickerState.isOpen = true;
    picker.classList.add("open");
    input.setAttribute("aria-expanded", "true");
    H.updateSummaryModelFilter(input.value);
  };

  H.moveSummaryModelActive = function (delta) {
    if (!H.summaryModelPickerState.filtered.length) return;
    var next = H.summaryModelPickerState.activeIndex + delta;
    if (next < 0) {
      H.summaryModelPickerState.activeIndex =
        H.summaryModelPickerState.filtered.length - 1;
    } else if (next >= H.summaryModelPickerState.filtered.length) {
      H.summaryModelPickerState.activeIndex = 0;
    } else {
      H.summaryModelPickerState.activeIndex = next;
    }
    H.renderSummaryModelOptions();

    var dropdown = document.getElementById("summaryModelDropdown");
    if (!dropdown) return;
    var activeOption = dropdown.querySelector(".model-picker-option.active");
    if (activeOption) {
      activeOption.scrollIntoView({ block: "nearest" });
    }
  };

  H.confirmSummaryModelSelection = function () {
    if (!H.summaryModelPickerState.filtered.length) {
      H.setSummaryModelValue("gemini-2.5-flash", true);
      return;
    }

    var selected =
      H.summaryModelPickerState.filtered[H.summaryModelPickerState.activeIndex] ||
      H.summaryModelPickerState.filtered[0] ||
      "gemini-2.5-flash";
    H.setSummaryModelValue(selected, true);
  };

  H.bindSummaryModelPicker = function () {
    var input = document.getElementById("summaryModelInput");
    var toggle = document.getElementById("summaryModelToggle");
    var picker = document.getElementById("summaryModelPicker");
    if (!input || !toggle || !picker) return;

    H.updateSummaryModelFilter(input.value);

    input.addEventListener("focus", function () {
      H.openSummaryModelDropdown();
    });

    input.addEventListener("input", function () {
      if (!H.summaryModelPickerState.isOpen) {
        H.openSummaryModelDropdown();
      }
      H.updateSummaryModelFilter(input.value);
    });

    input.addEventListener("keydown", function (event) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (!H.summaryModelPickerState.isOpen) {
          H.openSummaryModelDropdown();
        } else {
          H.moveSummaryModelActive(1);
        }
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        if (!H.summaryModelPickerState.isOpen) {
          H.openSummaryModelDropdown();
        } else {
          H.moveSummaryModelActive(-1);
        }
      } else if (event.key === "Enter") {
        if (!H.summaryModelPickerState.isOpen) return;
        event.preventDefault();
        H.confirmSummaryModelSelection();
      } else if (event.key === "Escape") {
        H.closeSummaryModelDropdown();
      }
    });

    input.addEventListener("blur", function () {
      setTimeout(function () {
        var activeEl = document.activeElement;
        if (picker.contains(activeEl)) return;
        H.closeSummaryModelDropdown();
      }, 100);
    });

    toggle.addEventListener("click", function () {
      if (H.summaryModelPickerState.isOpen) {
        H.closeSummaryModelDropdown();
        return;
      }
      H.openSummaryModelDropdown();
      input.focus();
    });

    document.addEventListener("click", function (event) {
      if (!picker.contains(event.target)) {
        H.closeSummaryModelDropdown();
      }
    });
  };
})();
