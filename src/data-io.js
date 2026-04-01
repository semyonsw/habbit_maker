"use strict";

import { state, setState } from "./state.js";
import { isPlainObject, toBase64, fromBase64, nowIso, monthKey, formatByteSize } from "./utils.js";
import { appendLogEntry, maybeAutoDownloadLogs } from "./logging.js";
import { idbGetPdfBlob, idbSavePdfBlob } from "./idb.js";
import { migrateState, ensureMonthData, saveState } from "./persistence.js";
import { callRenderer } from "./render-registry.js";

export function setBackupStatus(text, tone) {
  const statusEl = document.getElementById("backupStatus");
  if (!statusEl) return;
  statusEl.textContent = String(text || "");
  statusEl.classList.remove("pending", "success", "warn", "error");
  if (["pending", "success", "warn", "error"].includes(String(tone))) {
    statusEl.classList.add(String(tone));
  }
}

export function shouldExportIncludePdfs() {
  const checkbox = document.getElementById("exportIncludePdfs");
  return !!(checkbox && checkbox.checked);
}

export async function collectEmbeddedPdfPayload() {
  const pdfBlobs = {};
  const books =
    isPlainObject(state.books) && Array.isArray(state.books.items)
      ? state.books.items
      : [];
  let embeddedCount = 0;
  let missingCount = 0;
  let failedCount = 0;
  let totalBytes = 0;

  for (const book of books) {
    if (!isPlainObject(book) || typeof book.fileId !== "string") continue;
    const fileId = book.fileId.trim();
    if (!fileId) continue;

    try {
      const blob = await idbGetPdfBlob(fileId);
      if (!blob) {
        missingCount += 1;
        continue;
      }

      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      pdfBlobs[fileId] = toBase64(bytes);
      embeddedCount += 1;
      totalBytes += Number.isFinite(Number(blob.size))
        ? Number(blob.size)
        : bytes.length;
    } catch (error) {
      failedCount += 1;
      appendLogEntry({
        level: "warn",
        component: "backup",
        operation: "collectEmbeddedPdfPayload",
        message: "Skipping PDF while building export payload.",
        error,
        context: { fileId },
      });
    }
  }

  return { pdfBlobs, embeddedCount, missingCount, failedCount, totalBytes };
}

export async function restoreEmbeddedPdfPayload(pdfBlobs) {
  if (!isPlainObject(pdfBlobs)) {
    return { restoredCount: 0, failedCount: 0 };
  }

  let restoredCount = 0;
  let failedCount = 0;

  for (const [fileIdRaw, encoded] of Object.entries(pdfBlobs)) {
    const fileId = String(fileIdRaw || "").trim();
    if (!fileId || typeof encoded !== "string" || !encoded.trim()) {
      failedCount += 1;
      continue;
    }

    try {
      const bytes = fromBase64(encoded);
      const blob = new Blob([bytes], { type: "application/pdf" });
      await idbSavePdfBlob(fileId, blob);
      restoredCount += 1;
    } catch (error) {
      failedCount += 1;
      appendLogEntry({
        level: "warn",
        component: "backup",
        operation: "restoreEmbeddedPdfPayload",
        message: "Restoring embedded PDF failed.",
        error,
        context: { fileId },
      });
    }
  }

  return { restoredCount, failedCount };
}

export async function exportData() {
  const includePdfs = shouldExportIncludePdfs();
  setBackupStatus(
    includePdfs
      ? "Preparing backup with embedded PDFs..."
      : "Preparing metadata backup...",
    "pending",
  );

  try {
    const exportedState = JSON.parse(JSON.stringify(state));
    let payloadStats = {
      pdfBlobs: {},
      embeddedCount: 0,
      missingCount: 0,
      failedCount: 0,
      totalBytes: 0,
    };

    if (includePdfs) {
      payloadStats = await collectEmbeddedPdfPayload();
      if (Object.keys(payloadStats.pdfBlobs).length > 0) {
        exportedState.pdfBlobs = payloadStats.pdfBlobs;
      }
    }

    const blob = new Blob([JSON.stringify(exportedState, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `habit-tracker-backup-${monthKey(state.currentYear, state.currentMonth)}.json`;
    a.click();
    URL.revokeObjectURL(url);

    if (!includePdfs) {
      setBackupStatus(
        "Metadata backup exported. Enable Include PDFs for full backup.",
        "success",
      );
      return;
    }

    const estimatedJsonBytes = Math.round(payloadStats.totalBytes * 1.34);
    const info = `Embedded ${payloadStats.embeddedCount} PDF${payloadStats.embeddedCount === 1 ? "" : "s"} (~${formatByteSize(estimatedJsonBytes)}).`;
    if (
      estimatedJsonBytes >= EMBEDDED_EXPORT_SIZE_WARN_BYTES ||
      payloadStats.failedCount > 0 ||
      payloadStats.missingCount > 0
    ) {
      setBackupStatus(
        `${info} ${payloadStats.missingCount ? `${payloadStats.missingCount} missing in IndexedDB.` : ""} ${payloadStats.failedCount ? `${payloadStats.failedCount} failed to embed.` : ""}`.trim(),
        "warn",
      );
    } else {
      setBackupStatus(`Full backup exported. ${info}`, "success");
    }
  } catch (error) {
    appendLogEntry({
      level: "error",
      component: "backup",
      operation: "exportData",
      message: "Export failed.",
      error,
    });
    setBackupStatus("Export failed. See logs for details.", "error");
    alert("Export failed. See logs for details.");
  }
}

export function validateImportedState(imported) {
  const errors = [];

  if (!isPlainObject(imported)) {
    return { ok: false, errors: ["Root value must be an object."] };
  }

  if (!Array.isArray(imported.categories)) {
    errors.push("categories must be an array.");
  }

  if (
    !isPlainObject(imported.habits) ||
    !Array.isArray(imported.habits.daily)
  ) {
    errors.push("habits.daily must be an array.");
  }

  if (!isPlainObject(imported.months)) {
    errors.push("months must be an object.");
  }

  if (imported.books !== undefined) {
    if (!isPlainObject(imported.books)) {
      errors.push("books must be an object when provided.");
    } else {
      if (!Array.isArray(imported.books.items)) {
        errors.push("books.items must be an array.");
      } else {
        imported.books.items.forEach((book, i) => {
          if (!isPlainObject(book)) {
            errors.push(`books.items[${i}] must be an object.`);
            return;
          }
          if (typeof book.bookId !== "string" || !book.bookId.trim()) {
            errors.push(
              `books.items[${i}].bookId must be a non-empty string.`,
            );
          }
          if (
            book.bookmarks !== undefined &&
            !Array.isArray(book.bookmarks)
          ) {
            errors.push(`books.items[${i}].bookmarks must be an array.`);
          }
          if (Array.isArray(book.bookmarks)) {
            book.bookmarks.forEach((bm, j) => {
              if (!isPlainObject(bm)) {
                errors.push(
                  `books.items[${i}].bookmarks[${j}] must be an object.`,
                );
                return;
              }
              if (
                typeof bm.bookmarkId !== "string" ||
                !bm.bookmarkId.trim()
              ) {
                errors.push(
                  `books.items[${i}].bookmarks[${j}].bookmarkId must be a non-empty string.`,
                );
              }
              if (!Number.isFinite(Number(bm.pdfPage))) {
                errors.push(
                  `books.items[${i}].bookmarks[${j}].pdfPage must be numeric.`,
                );
              }
              const hasRealPageValue =
                bm.realPage !== undefined &&
                bm.realPage !== null &&
                String(bm.realPage).trim() !== "";
              if (hasRealPageValue && !Number.isFinite(Number(bm.realPage))) {
                errors.push(
                  `books.items[${i}].bookmarks[${j}].realPage must be numeric when provided.`,
                );
              }
              if (bm.history !== undefined && !Array.isArray(bm.history)) {
                errors.push(
                  `books.items[${i}].bookmarks[${j}].history must be an array.`,
                );
              }
            });
          }
        });
      }
    }
  }

  if (imported.pdfBlobs !== undefined) {
    if (!isPlainObject(imported.pdfBlobs)) {
      errors.push("pdfBlobs must be an object when provided.");
    } else {
      Object.entries(imported.pdfBlobs).forEach(([fileId, encoded], i) => {
        if (typeof fileId !== "string" || !fileId.trim()) {
          errors.push(`pdfBlobs entry ${i + 1} has an invalid fileId key.`);
        }
        if (typeof encoded !== "string" || !encoded.trim()) {
          errors.push(
            `pdfBlobs[${fileId || i}] must be a non-empty base64 string.`,
          );
        }
      });
    }
  }

  return { ok: errors.length === 0, errors };
}

export function importData(file) {
  const reader = new FileReader();
  reader.onload = async function (e) {
    try {
      const imported = JSON.parse(e.target.result);
      const validation = validateImportedState(imported);
      if (!validation.ok) {
        alert(
          `Import failed:\n- ${validation.errors.slice(0, 8).join("\n- ")}`,
        );
        return;
      }

      const embeddedPdfPayload =
        imported.pdfBlobs !== undefined ? imported.pdfBlobs : null;
      if (imported.pdfBlobs !== undefined) {
        delete imported.pdfBlobs;
      }

      setState(imported);
      migrateState();
      ensureMonthData();
      saveState();
      callRenderer("renderAll");

      const restoreStats =
        await restoreEmbeddedPdfPayload(embeddedPdfPayload);
      await callRenderer("refreshBookBlobStatus");
      await callRenderer("renderBooksView");

      if (restoreStats.restoredCount > 0) {
        const tone = restoreStats.failedCount > 0 ? "warn" : "success";
        setBackupStatus(
          `Import completed. Restored ${restoreStats.restoredCount} embedded PDF${restoreStats.restoredCount === 1 ? "" : "s"}${restoreStats.failedCount ? `, ${restoreStats.failedCount} failed.` : "."}`,
          tone,
        );
      } else {
        setBackupStatus(
          "Import completed. No embedded PDFs found; re-upload PDFs if needed.",
          embeddedPdfPayload ? "warn" : "success",
        );
      }
    } catch (err) {
      console.error("Import error:", err);
      alert("Failed to import backup file.\n" + (err && err.message ? err.message : String(err)));
    }
  };
  reader.readAsText(file);
}

