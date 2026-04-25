"use strict";

// Thin compatibility shim. Existing callers continue to import
// `idbSavePdfBlob` / `idbGetPdfBlob` / `idbDeletePdfBlob` from this module;
// the implementations now flow through the local Python backend, which
// stores PDFs as plain files under `books/<fileId>.pdf`.

import { appendLogEntry } from "./logging.js";
import * as db from "./db.js";

export async function idbSavePdfBlob(fileId, blob) {
  try {
    await db.uploadPdf(fileId, blob);
  } catch (error) {
    appendLogEntry({
      level: "error",
      component: "idb",
      operation: "idbSavePdfBlob",
      message: "Saving PDF blob failed.",
      error,
      context: {
        fileId,
        sizeBytes: Number.isFinite(Number(blob && blob.size))
          ? Number(blob.size)
          : 0,
      },
    });
    throw error;
  }
}

export async function idbGetPdfBlob(fileId) {
  try {
    return await db.getPdfBlob(fileId);
  } catch (error) {
    appendLogEntry({
      level: "error",
      component: "idb",
      operation: "idbGetPdfBlob",
      message: "Reading PDF blob failed.",
      error,
      context: { fileId },
    });
    throw error;
  }
}

export async function idbDeletePdfBlob(fileId) {
  try {
    await db.deletePdf(fileId);
  } catch (error) {
    appendLogEntry({
      level: "error",
      component: "idb",
      operation: "idbDeletePdfBlob",
      message: "Deleting PDF blob failed.",
      error,
      context: { fileId },
    });
    throw error;
  }
}
