"use strict";

import { PDF_DB_NAME, PDF_DB_VERSION, PDF_STORE_NAME } from "./constants.js";
import { idbPromise, setIdbPromise } from "./state.js";
import { nowIso } from "./utils.js";
import { appendLogEntry } from "./logging.js";

export function openPdfDatabase() {
  if (idbPromise) return idbPromise;

  const p = new Promise((resolve, reject) => {
    const request = indexedDB.open(PDF_DB_NAME, PDF_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PDF_STORE_NAME)) {
        db.createObjectStore(PDF_STORE_NAME, { keyPath: "fileId" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      const error = request.error || new Error("IndexedDB open failed");
      appendLogEntry({
        level: "error",
        component: "idb",
        operation: "openPdfDatabase",
        message: "IndexedDB open failed.",
        error,
      });
      reject(error);
    };
  });

  setIdbPromise(p);
  return p;
}

export async function idbSavePdfBlob(fileId, blob) {
  const db = await openPdfDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PDF_STORE_NAME, "readwrite");
    tx.objectStore(PDF_STORE_NAME).put({ fileId, blob, updatedAt: nowIso() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => {
      const error = tx.error || new Error("PDF save failed");
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
      reject(error);
    };
  });
}

export async function idbGetPdfBlob(fileId) {
  const db = await openPdfDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PDF_STORE_NAME, "readonly");
    const req = tx.objectStore(PDF_STORE_NAME).get(fileId);
    req.onsuccess = () => resolve(req.result ? req.result.blob : null);
    req.onerror = () => {
      const error = req.error || new Error("PDF read failed");
      appendLogEntry({
        level: "error",
        component: "idb",
        operation: "idbGetPdfBlob",
        message: "Reading PDF blob failed.",
        error,
        context: { fileId },
      });
      reject(error);
    };
  });
}

export async function idbDeletePdfBlob(fileId) {
  const db = await openPdfDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(PDF_STORE_NAME, "readwrite");
    tx.objectStore(PDF_STORE_NAME).delete(fileId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => {
      const error = tx.error || new Error("PDF delete failed");
      appendLogEntry({
        level: "error",
        component: "idb",
        operation: "idbDeletePdfBlob",
        message: "Deleting PDF blob failed.",
        error,
        context: { fileId },
      });
      reject(error);
    };
  });
}
