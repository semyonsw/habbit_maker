"use strict";

import { appLogs, setAppLogs } from "./state.js";
import { sanitize, formatIsoForDisplay } from "./utils.js?v=2";
import { enableLiveLogFile, disableLiveLogFile, updateLiveLogFileStatus, exportLogsAsJson, exportLogsAsCsv, clearAllLogs } from "./logging.js";
import { registerRenderer } from "./render-registry.js";

export function getFilteredLogs() {
  const levelFilter = document.getElementById("logsLevelFilter");
  const componentFilter = document.getElementById("logsComponentFilter");
  const textFilter = document.getElementById("logsTextFilter");
  const level = levelFilter ? String(levelFilter.value || "").trim() : "";
  const component = componentFilter
    ? String(componentFilter.value || "")
        .trim()
        .toLowerCase()
    : "";
  const needle = textFilter
    ? String(textFilter.value || "")
        .trim()
        .toLowerCase()
    : "";

  return appLogs
    .filter((entry) => (level ? entry.level === level : true))
    .filter((entry) =>
      component
        ? String(entry.component || "")
            .toLowerCase()
            .includes(component)
        : true,
    )
    .filter((entry) => {
      if (!needle) return true;
      const haystack = [
        entry.message,
        entry.operation,
        entry.errorMessage,
        JSON.stringify(entry.context || {}),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    })
    .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
}

// Rendering every filtered entry means building a few hundred cards of HTML in
// one synchronous pass, which is a visible freeze on a phone. Show a page at a
// time and let the user ask for more.
const LOGS_PAGE_SIZE = 120;
let logsRenderLimit = LOGS_PAGE_SIZE;

// Called by the filter controls: a new filter should start from the top again.
export function resetLogsRenderLimit() {
  logsRenderLimit = LOGS_PAGE_SIZE;
}

export function renderLogsView() {
  const table = document.getElementById("logsTable");
  if (!table) return;
  const allLogs = getFilteredLogs();
  if (!allLogs.length) {
    table.innerHTML = '<p class="logs-empty">No matching logs yet.</p>';
    return;
  }

  const logs = allLogs.slice(0, logsRenderLimit);
  table.innerHTML = logs
    .map((entry) => {
      const contextText = sanitize(
        JSON.stringify(entry.context || {}, null, 2),
      );
      const errText = entry.errorMessage
        ? `<div class=\"logs-error\">${sanitize(entry.errorName)}: ${sanitize(entry.errorMessage)}</div>`
        : "";
      return `<article class=\"logs-entry logs-${sanitize(entry.level)}\">
        <div class=\"logs-entry-top\">
          <span class=\"logs-pill\">${sanitize(entry.level.toUpperCase())}</span>
          <span class=\"logs-time\">${sanitize(formatIsoForDisplay(entry.timestamp))}</span>
          <span class=\"logs-component\">${sanitize(entry.component)}</span>
          <span class=\"logs-operation\">${sanitize(entry.operation)}</span>
        </div>
        <div class=\"logs-message\">${sanitize(entry.message)}</div>
        ${errText}
        <pre class=\"logs-context\">${contextText}</pre>
      </article>`;
    })
    .join("");

  if (allLogs.length > logs.length) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "btn-secondary logs-show-more";
    more.textContent = `Show more (${logs.length} of ${allLogs.length})`;
    more.addEventListener("click", () => {
      logsRenderLimit += LOGS_PAGE_SIZE;
      renderLogsView();
    });
    table.appendChild(more);
  }
}

export function bindLogsControls() {
  const exportJsonBtn = document.getElementById("logsExportJsonBtn");
  const exportCsvBtn = document.getElementById("logsExportCsvBtn");
  const clearBtn = document.getElementById("logsClearBtn");
  const levelFilter = document.getElementById("logsLevelFilter");
  const componentFilter = document.getElementById("logsComponentFilter");
  const textFilter = document.getElementById("logsTextFilter");
  const liveFileSelectBtn = document.getElementById("logsLiveFileSelectBtn");
  const liveFileStopBtn = document.getElementById("logsLiveFileStopBtn");

  if (exportJsonBtn) {
    exportJsonBtn.addEventListener("click", () => {
      exportLogsAsJson();
    });
  }
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener("click", () => {
      exportLogsAsCsv();
    });
  }
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      const ok = window.confirm("Clear all debug logs?");
      if (!ok) return;
      setAppLogs([]);
      clearAllLogs();
      renderLogsView();
    });
  }

  // Changing a filter produces a different result set, so paging starts over.
  const rerenderFromTop = () => {
    resetLogsRenderLimit();
    renderLogsView();
  };
  [levelFilter, componentFilter, textFilter]
    .filter(Boolean)
    .forEach((control) => {
      control.addEventListener("input", rerenderFromTop);
      control.addEventListener("change", rerenderFromTop);
    });

  if (liveFileSelectBtn) {
    liveFileSelectBtn.addEventListener("click", () => {
      enableLiveLogFile().catch(() => {});
    });
  }

  if (liveFileStopBtn) {
    liveFileStopBtn.addEventListener("click", () => {
      disableLiveLogFile().catch(() => {});
    });
  }

  updateLiveLogFileStatus();
}

registerRenderer("renderLogsView", renderLogsView);
