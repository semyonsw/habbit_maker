"use strict";

import { GEMINI_MODELS } from "./constants.js";
import { summaryModelPickerState } from "./state.js";
import { sanitize } from "./utils.js";
import { ensureModelAllowed } from "./encryption.js";

export function closeSummaryModelDropdown() {
  const picker = document.getElementById("summaryModelPicker");
  const input = document.getElementById("summaryModelInput");
  if (!picker || !input) return;
  summaryModelPickerState.isOpen = false;
  picker.classList.remove("open");
  input.setAttribute("aria-expanded", "false");
}

export function setSummaryModelValue(modelName, closeAfterSelect = true) {
  const input = document.getElementById("summaryModelInput");
  if (!input) return;
  input.value = ensureModelAllowed(modelName);
  if (closeAfterSelect) {
    closeSummaryModelDropdown();
  }
}

function renderSummaryModelOptions() {
  const dropdown = document.getElementById("summaryModelDropdown");
  if (!dropdown) return;

  if (!summaryModelPickerState.filtered.length) {
    dropdown.innerHTML =
      '<div class="model-picker-empty">No matching model. Keep typing...</div>';
    return;
  }

  dropdown.innerHTML = summaryModelPickerState.filtered
    .map((modelName, idx) => {
      const activeClass =
        idx === summaryModelPickerState.activeIndex ? " active" : "";
      return `<button class="model-picker-option${activeClass}" type="button" role="option" data-model="${sanitize(modelName)}" aria-selected="${idx === summaryModelPickerState.activeIndex}">${sanitize(modelName)}</button>`;
    })
    .join("");

  dropdown.querySelectorAll(".model-picker-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      setSummaryModelValue(btn.dataset.model || "gemini-2.5-flash", true);
    });
  });
}

export function updateSummaryModelFilter(query) {
  const needle = String(query || "")
    .trim()
    .toLowerCase();
  const sorted = [...GEMINI_MODELS].sort((a, b) => a.localeCompare(b));
  if (!needle) {
    summaryModelPickerState.filtered = sorted;
  } else {
    summaryModelPickerState.filtered = sorted.filter((name) =>
      name.toLowerCase().includes(needle),
    );
  }
  summaryModelPickerState.activeIndex = summaryModelPickerState.filtered
    .length
    ? 0
    : -1;
  renderSummaryModelOptions();
}

function openSummaryModelDropdown() {
  const picker = document.getElementById("summaryModelPicker");
  const input = document.getElementById("summaryModelInput");
  if (!picker || !input) return;

  summaryModelPickerState.isOpen = true;
  picker.classList.add("open");
  input.setAttribute("aria-expanded", "true");
  updateSummaryModelFilter(input.value);
}

function moveSummaryModelActive(delta) {
  if (!summaryModelPickerState.filtered.length) return;
  const next = summaryModelPickerState.activeIndex + delta;
  if (next < 0) {
    summaryModelPickerState.activeIndex =
      summaryModelPickerState.filtered.length - 1;
  } else if (next >= summaryModelPickerState.filtered.length) {
    summaryModelPickerState.activeIndex = 0;
  } else {
    summaryModelPickerState.activeIndex = next;
  }
  renderSummaryModelOptions();

  const dropdown = document.getElementById("summaryModelDropdown");
  if (!dropdown) return;
  const activeOption = dropdown.querySelector(".model-picker-option.active");
  if (activeOption) {
    activeOption.scrollIntoView({ block: "nearest" });
  }
}

function confirmSummaryModelSelection() {
  if (!summaryModelPickerState.filtered.length) {
    setSummaryModelValue("gemini-2.5-flash", true);
    return;
  }

  const selected =
    summaryModelPickerState.filtered[summaryModelPickerState.activeIndex] ||
    summaryModelPickerState.filtered[0] ||
    "gemini-2.5-flash";
  setSummaryModelValue(selected, true);
}

export function bindSummaryModelPicker() {
  const input = document.getElementById("summaryModelInput");
  const toggle = document.getElementById("summaryModelToggle");
  const picker = document.getElementById("summaryModelPicker");
  if (!input || !toggle || !picker) return;

  updateSummaryModelFilter(input.value);

  input.addEventListener("focus", () => {
    openSummaryModelDropdown();
  });

  input.addEventListener("input", () => {
    if (!summaryModelPickerState.isOpen) {
      openSummaryModelDropdown();
    }
    updateSummaryModelFilter(input.value);
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!summaryModelPickerState.isOpen) {
        openSummaryModelDropdown();
      } else {
        moveSummaryModelActive(1);
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!summaryModelPickerState.isOpen) {
        openSummaryModelDropdown();
      } else {
        moveSummaryModelActive(-1);
      }
    } else if (event.key === "Enter") {
      if (!summaryModelPickerState.isOpen) return;
      event.preventDefault();
      confirmSummaryModelSelection();
    } else if (event.key === "Escape") {
      closeSummaryModelDropdown();
    }
  });

  input.addEventListener("blur", () => {
    setTimeout(() => {
      const activeEl = document.activeElement;
      if (picker.contains(activeEl)) return;
      closeSummaryModelDropdown();
    }, 100);
  });

  toggle.addEventListener("click", () => {
    if (summaryModelPickerState.isOpen) {
      closeSummaryModelDropdown();
      return;
    }
    openSummaryModelDropdown();
    input.focus();
  });

  document.addEventListener("click", (event) => {
    if (!picker.contains(event.target)) {
      closeSummaryModelDropdown();
    }
  });
}
