"use strict";

import { state } from "./state.js";
import {
  sanitize,
  formatByteSize,
  formatIsoForDisplay,
} from "./utils.js?v=2";
import { getHabitEmoji } from "./persistence.js";
import { getFileBlob } from "./db.js";
import { appendLogEntry } from "./logging.js";
import { registerRenderer } from "./render-registry.js";

function getSortedReports() {
  const reports = Array.isArray(state.reports) ? state.reports : [];
  // Newest first, by creation time.
  return [...reports].sort((a, b) =>
    String(a.createdAt) < String(b.createdAt) ? 1 : -1,
  );
}

function getLinkedHabitLabel(habitId) {
  if (!habitId) return "";
  const habit = state.habits.daily.find((h) => h.id === habitId);
  if (!habit) return "";
  return `${getHabitEmoji(habit)} ${habit.name}`;
}

function renderAttachmentChips(report) {
  const attachments = Array.isArray(report.attachments)
    ? report.attachments
    : [];
  if (!attachments.length) return "";
  const chips = attachments
    .map(
      (att) =>
        `<button type="button" class="report-attach-chip" onclick="HabitApp.openReportAttachment('${report.id}', '${att.fileId}')" title="Open ${sanitize(att.fileName)}">📎 ${sanitize(att.fileName)} <span class="report-attach-size">${formatByteSize(att.fileSize)}</span></button>`,
    )
    .join("");
  return `<div class="report-card-attachments">${chips}</div>`;
}

export function renderReportView() {
  const list = document.getElementById("reportsList");
  if (!list) return;

  const reports = getSortedReports();
  if (!reports.length) {
    list.innerHTML =
      "<div class='empty-state'><p>No reports yet. Create one with “New Report”.</p></div>";
    return;
  }

  list.innerHTML = reports
    .map((report) => {
      const habitLabel = getLinkedHabitLabel(report.habitId);
      const noteHtml = report.note
        ? `<div class="report-card-note">${sanitize(report.note)}</div>`
        : "";
      const habitHtml = habitLabel
        ? `<span class="report-card-habit">🔗 ${sanitize(habitLabel)}</span>`
        : "";
      const title = report.title || "Untitled report";
      return `<div class="card report-card">
        <div class="report-card-header">
          <div class="report-card-title">${sanitize(title)}</div>
          <div class="report-card-actions">
            <button class="manage-btn" onclick="HabitApp.editReport('${report.id}')">Edit</button>
            <button class="manage-btn delete" onclick="HabitApp.deleteReport('${report.id}')">Delete</button>
          </div>
        </div>
        <div class="report-card-meta">
          <span>${sanitize(formatIsoForDisplay(report.createdAt))}</span>
          ${habitHtml}
        </div>
        ${noteHtml}
        ${renderAttachmentChips(report)}
      </div>`;
    })
    .join("");
}

export async function openReportAttachment(reportId, fileId) {
  const report = (state.reports || []).find((r) => r.id === reportId);
  if (!report) return;
  const att = (report.attachments || []).find((a) => a.fileId === fileId);
  if (!att) return;

  let objectUrl = "";
  // Claim the tab NOW, synchronously inside the click. Calling window.open()
  // after `await getFileBlob(...)` is outside the user-gesture window, and iOS
  // Safari blocks it silently -- the attachment simply never opened on a phone.
  const tab = window.open("", "_blank");
  try {
    const blob = await getFileBlob(fileId);
    if (!blob) {
      if (tab) tab.close();
      alert("This attachment could not be found in storage.");
      return;
    }
    // Re-apply the tracked MIME type (the REST backend returns raw bytes).
    const typed = att.mimeType
      ? new Blob([blob], { type: att.mimeType })
      : blob;
    objectUrl = URL.createObjectURL(typed);
    if (tab) {
      tab.location = objectUrl;
    } else {
      // Popup blocked entirely: fall back to a same-tab navigation.
      window.location.assign(objectUrl);
    }
  } catch (error) {
    if (tab) tab.close();
    appendLogEntry({
      level: "error",
      component: "report",
      operation: "openReportAttachment",
      message: "Opening report attachment failed.",
      error,
      context: { reportId, fileId },
    });
    alert("Could not open the attachment.");
  } finally {
    if (objectUrl) {
      // Give the new tab time to load before releasing the URL.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
    }
  }
}

registerRenderer("renderReportView", renderReportView);
