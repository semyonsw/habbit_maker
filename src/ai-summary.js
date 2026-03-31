"use strict";

import { PDFJS_WORKER_URL, GEMINI_API_BASE_URL } from "./constants.js";
import { state, summaryModalState } from "./state.js";
import { sanitize, isPlainObject, uid, formatIsoForDisplay } from "./utils.js";
import { appendLogEntry, maybeAutoDownloadLogs } from "./logging.js";
import { idbGetPdfBlob } from "./idb.js";
import { ensurePdfJsLibLoaded } from "./pdf-reader.js";
import { getApiKeyForSummary, getBookAiSettings } from "./encryption.js";
import { saveState } from "./persistence.js";
import {
  getBookById,
  getActiveBook,
  getBookmarkById,
  getReadySummariesFromBookmark,
  getBookmarkLastSummarizedPage,
  getReadySummariesFromBook,
  getLatestSummaryUpToPageFromBook,
  getBookLastSummarizedPage,
  resolveIncrementalRange,
  getSummaryById,
  getLatestBookmarkSummary,
  appendBookmarkSummaryRecord,
} from "./books.js";
import { openModal, closeModal } from "./modals.js";
import { registerRenderer, callRenderer } from "./render-registry.js";

export function chunkTextForSummary(text, maxChars) {
  const clean = String(text || "")
    .replace(/\r/g, "")
    .trim();
  if (!clean) return [];
  const targetSize = Math.max(4000, parseInt(maxChars, 10) || 12000);
  const paragraphs = clean
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (!paragraphs.length) return [clean];

  const chunks = [];
  let current = "";

  paragraphs.forEach((paragraph) => {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= targetSize) {
      current = candidate;
      return;
    }

    if (current) {
      chunks.push(current);
    }

    if (paragraph.length <= targetSize) {
      current = paragraph;
      return;
    }

    let offset = 0;
    while (offset < paragraph.length) {
      chunks.push(paragraph.slice(offset, offset + targetSize));
      offset += targetSize;
    }
    current = "";
  });

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

export async function extractTextRangeFromBookPdf(
  book,
  startPage,
  endPage,
  onProgress,
) {
  if (!book || !book.fileId) {
    throw new Error("Book PDF reference is missing.");
  }

  const blob = await idbGetPdfBlob(book.fileId);
  if (!blob) {
    throw new Error("PDF file is missing in this browser storage.");
  }

  const pdfjsLib = await ensurePdfJsLibLoaded();
  if (!pdfjsLib) {
    throw new Error("PDF.js failed to load.");
  }
  pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;

  const pdfData = await blob.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: pdfData });
  let pdfDoc = null;

  try {
    pdfDoc = await loadingTask.promise;
    const totalPages = Math.max(1, parseInt(pdfDoc.numPages, 10) || 1);
    const safeStart = Math.max(
      1,
      Math.min(parseInt(startPage, 10) || 1, totalPages),
    );
    const safeEnd = Math.max(
      safeStart,
      Math.min(parseInt(endPage, 10) || safeStart, totalPages),
    );

    const extracted = [];
    const rangeTotal = safeEnd - safeStart + 1;

    for (let pageNum = safeStart; pageNum <= safeEnd; pageNum += 1) {
      const page = await pdfDoc.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = (
        Array.isArray(textContent.items) ? textContent.items : []
      )
        .map((item) => (typeof item.str === "string" ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      extracted.push(`[Page ${pageNum}]\n${pageText}`);

      if (typeof onProgress === "function") {
        onProgress({
          current: pageNum - safeStart + 1,
          total: rangeTotal,
          absolutePage: pageNum,
        });
      }
    }

    const text = extracted.join("\n\n").trim();
    if (!text.replace(/\[Page \d+\]/g, "").trim()) {
      throw new Error(
        "No extractable text found in this page range. The PDF may be image-based.",
      );
    }

    return {
      text,
      startPage: safeStart,
      endPage: safeEnd,
      totalPages,
    };
  } catch (error) {
    appendLogEntry({
      level: "error",
      component: "pdf-extract",
      operation: "extractTextRangeFromBookPdf",
      message: "PDF text extraction failed.",
      error,
      context: {
        bookId: book.bookId,
        fileId: book.fileId,
        startPage,
        endPage,
      },
    });
    maybeAutoDownloadLogs("pdf-extract-failed");
    throw error;
  } finally {
    try {
      if (pdfDoc && typeof pdfDoc.destroy === "function") {
        await pdfDoc.destroy();
      }
    } catch (_) {}
  }
}

export function buildIncrementalChunkPrompt({
  text,
  startPage,
  endPage,
  chunkIndex,
  totalChunks,
}) {
  return [
    "You are a concise reading assistant.",
    `Summarize only pages ${startPage}-${endPage} from the provided text chunk ${chunkIndex}/${totalChunks}.`,
    "Keep it factual and avoid speculation.",
    "Return markdown with these sections:",
    "## Key Concepts",
    "## Important Events or Arguments",
    "## Notable Insights or Takeaways",
    "Use short bullet points.",
    "Text to summarize:",
    text,
  ].join("\n\n");
}

export function buildChunkMergePrompt({ chunkSummaries, startPage, endPage }) {
  return [
    "You are consolidating partial summaries of one continuous reading segment.",
    `Create one clean summary for pages ${startPage}-${endPage}.`,
    "Remove overlap and duplication while preserving key details.",
    "Return markdown with these exact sections:",
    "## Key Concepts",
    "## Important Events or Arguments",
    "## Notable Insights or Takeaways",
    "Partial summaries:",
    chunkSummaries
      .map((chunk, idx) => `Chunk ${idx + 1}:\n${chunk}`)
      .join("\n\n"),
  ].join("\n\n");
}

export function buildFinalMergePrompt({
  previousSummary,
  incrementalSummary,
  currentBookmarkPage,
}) {
  return [
    "You are updating a running book summary.",
    `The unified summary should represent reading progress up to page ${currentBookmarkPage}.`,
    "Merge previous and new summaries without redundancy and keep chronology clear.",
    "Return markdown with these exact sections:",
    "## Key Concepts",
    "## Important Events or Arguments",
    "## Notable Insights or Takeaways",
    "Previous summary context:",
    previousSummary,
    "New incremental summary:",
    incrementalSummary,
  ].join("\n\n");
}

export function parseGeminiResponseText(payload) {
  if (!isPlainObject(payload) || !Array.isArray(payload.candidates)) {
    return "";
  }
  return payload.candidates
    .map((candidate) => {
      const parts =
        candidate &&
        isPlainObject(candidate.content) &&
        Array.isArray(candidate.content.parts)
          ? candidate.content.parts
          : [];
      return parts
        .map((part) => (typeof part.text === "string" ? part.text : ""))
        .join("");
    })
    .join("\n")
    .trim();
}

export async function callGeminiGenerateText({ apiKey, model, prompt }) {
  if (!apiKey) {
    throw new Error("Gemini API key is missing.");
  }
  if (!model) {
    throw new Error("Gemini model is missing.");
  }

  const endpoint = `${GEMINI_API_BASE_URL}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const retries = 1;
  const startedAt = performance.now();

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), 90000);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
          },
        }),
        signal: controller.signal,
      });

      const body = await response.json().catch(() => ({}));

      if (!response.ok) {
        const maybeMessage =
          body &&
          isPlainObject(body.error) &&
          typeof body.error.message === "string"
            ? body.error.message
            : `Gemini request failed (${response.status}).`;
        const retriable = response.status === 429 || response.status >= 500;
        if (retriable && attempt < retries) {
          continue;
        }
        throw new Error(maybeMessage);
      }

      const text = parseGeminiResponseText(body);
      if (!text) {
        throw new Error("Gemini returned an empty response.");
      }

      return text;
    } catch (error) {
      const isAbort = error && error.name === "AbortError";
      appendLogEntry({
        level: "warn",
        component: "ai-summary",
        operation: "callGeminiGenerateText",
        message: "Gemini call attempt failed.",
        error,
        context: {
          model,
          attempt,
          retries,
          promptLength: String(prompt || "").length,
          elapsedMs: Math.round(performance.now() - startedAt),
        },
      });
      if ((isAbort || /network/i.test(String(error))) && attempt < retries) {
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  throw new Error("Gemini request failed after retry.");
}

export async function summarizeSegmentWithChunking({
  text,
  startPage,
  endPage,
  apiKey,
  model,
  chunkChars,
  onChunkProgress,
}) {
  const chunks = chunkTextForSummary(text, chunkChars);
  const totalChunks = chunks.length || 1;
  const chunkSummaries = [];

  for (let idx = 0; idx < chunks.length; idx += 1) {
    if (typeof onChunkProgress === "function") {
      onChunkProgress({ current: idx + 1, total: totalChunks });
    }

    const prompt = buildIncrementalChunkPrompt({
      text: chunks[idx],
      startPage,
      endPage,
      chunkIndex: idx + 1,
      totalChunks,
    });

    const chunkSummary = await callGeminiGenerateText({
      apiKey,
      model,
      prompt,
    });
    chunkSummaries.push(chunkSummary);
  }

  if (chunkSummaries.length <= 1) {
    return {
      summary: chunkSummaries[0] || "",
      chunkCount: totalChunks,
    };
  }

  const mergedPrompt = buildChunkMergePrompt({
    chunkSummaries,
    startPage,
    endPage,
  });
  const merged = await callGeminiGenerateText({
    apiKey,
    model,
    prompt: mergedPrompt,
  });
  return {
    summary: merged,
    chunkCount: totalChunks,
  };
}

export async function mergeWithPreviousSummary({
  previousSummary,
  incrementalSummary,
  currentBookmarkPage,
  apiKey,
  model,
  consolidateMode,
}) {
  const prev = String(previousSummary || "").trim();
  const inc = String(incrementalSummary || "").trim();

  if (!prev) return inc;
  if (!consolidateMode) {
    return `${prev}\n\n---\n\n${inc}`;
  }

  const prompt = buildFinalMergePrompt({
    previousSummary: prev.slice(0, 14000),
    incrementalSummary: inc,
    currentBookmarkPage,
  });

  return callGeminiGenerateText({ apiKey, model, prompt });
}

export function formatDuration(durationMs) {
  const ms = Number(durationMs);
  if (!Number.isFinite(ms) || ms <= 0) return "-";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function formatSummaryInlineMarkdown(input) {
  const escaped = sanitize(String(input || "")).replace(/\r/g, "");
  const withCode = escaped.replace(/`([^`]+)`/g, "<code>$1</code>");
  const withBold = withCode.replace(
    /\*\*([^*]+)\*\*/g,
    "<strong>$1</strong>",
  );
  return withBold
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1<em>$2</em>");
}

export function renderSummaryContentHtmlFallback(content) {
  const source = String(content || "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!source) return "";

  const lines = source.split("\n");
  const html = [];
  let listDepth = 0;
  let inParagraph = false;

  function closeParagraph() {
    if (!inParagraph) return;
    html.push("</p>");
    inParagraph = false;
  }

  function closeLists(targetDepth = 0) {
    while (listDepth > targetDepth) {
      html.push("</ul>");
      listDepth -= 1;
    }
  }

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      closeParagraph();
      closeLists(0);
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      closeParagraph();
      closeLists(0);
      const level = Math.min(4, headingMatch[1].length + 1);
      html.push(
        `<h${level}>${formatSummaryInlineMarkdown(headingMatch[2])}</h${level}>`,
      );
      continue;
    }

    const bulletMatch = line.match(/^(\s*)[-*+]\s+(.+)$/);
    if (bulletMatch) {
      closeParagraph();
      const indent = (bulletMatch[1] || "").replace(/\t/g, "  ").length;
      const depth = Math.floor(indent / 2) + 1;
      if (depth > listDepth) {
        while (listDepth < depth) {
          html.push("<ul>");
          listDepth += 1;
        }
      } else if (depth < listDepth) {
        closeLists(depth);
      }
      html.push(`<li>${formatSummaryInlineMarkdown(bulletMatch[2])}</li>`);
      continue;
    }

    closeLists(0);
    if (!inParagraph) {
      html.push("<p>");
      inParagraph = true;
    } else {
      html.push("<br>");
    }
    html.push(formatSummaryInlineMarkdown(trimmed));
  }

  closeParagraph();
  closeLists(0);
  return html.join("");
}

export function normalizeSummaryMarkdown(content) {
  let source = String(content || "").trim();
  if (!source) return "";

  const fencedBlock = source.match(
    /^```(?:markdown|md)?\s*([\s\S]*?)\s*```$/i,
  );
  if (fencedBlock) {
    source = String(fencedBlock[1] || "").trim();
  }

  source = source
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "  ")
    .replace(/\\([*_`#>[\]\-])/g, "$1")
    .replace(/\r\n?/g, "\n")
    .trim();

  return source;
}

export function renderSummaryContentHtml(content) {
  const source = normalizeSummaryMarkdown(content);
  if (!source) return "";

  if (window.marked && typeof window.marked.parse === "function") {
    const safeMarkdown = sanitize(source);
    return window.marked.parse(safeMarkdown, {
      gfm: true,
      breaks: true,
    });
  }

  return renderSummaryContentHtmlFallback(source);
}

export function renderSummaryModal() {
  const titleEl = document.getElementById("summaryModalTitle");
  const detectionEl = document.getElementById("summaryDetectionText");
  const statusEl = document.getElementById("summaryRunStatus");
  const bodyEl = document.getElementById("summaryBody");
  const historyEl = document.getElementById("summaryHistoryList");
  const regenBtn = document.getElementById("summaryRegenerateBtn");
  const rebuildBtn = document.getElementById("summaryRebuildBtn");
  const copyBtn = document.getElementById("summaryCopyBtn");

  if (
    !titleEl ||
    !detectionEl ||
    !statusEl ||
    !bodyEl ||
    !historyEl ||
    !regenBtn ||
    !rebuildBtn ||
    !copyBtn
  ) {
    return;
  }

  const book = getBookById(summaryModalState.bookId);
  const bookmark = book
    ? getBookmarkById(book, summaryModalState.bookmarkId)
    : null;

  if (!book || !bookmark) {
    titleEl.textContent = "Summary";
    detectionEl.textContent = "No bookmark selected.";
    statusEl.textContent = "";
    bodyEl.textContent = "";
    historyEl.innerHTML = "";
    regenBtn.disabled = true;
    rebuildBtn.disabled = true;
    copyBtn.disabled = true;
    return;
  }

  titleEl.textContent = `Summary: ${bookmark.label}`;
  detectionEl.textContent =
    summaryModalState.detectionText || `Bookmark page ${bookmark.pdfPage}.`;
  statusEl.textContent = summaryModalState.statusText || "Ready.";

  const selectedSummary =
    getSummaryById(bookmark, summaryModalState.selectedSummaryId) ||
    summaryModalState.externalSummary ||
    getLatestBookmarkSummary(bookmark) ||
    getLatestSummaryUpToPageFromBook(book, bookmark.pdfPage);

  if (selectedSummary && selectedSummary.content) {
    bodyEl.innerHTML = renderSummaryContentHtml(selectedSummary.content);
    copyBtn.disabled = false;
  } else {
    bodyEl.innerHTML =
      "<p>No summary yet. Use Summarize up to Bookmark to generate one.</p>";
    copyBtn.disabled = true;
  }

  const entries = Array.isArray(bookmark.summaries) ? bookmark.summaries : [];
  historyEl.innerHTML = entries.length
    ? entries
        .map((entry) => {
          const stateLabel =
            entry.status === "failed"
              ? "Failed"
              : entry.isIncremental
                ? "Incremental"
                : "Full";
          const activeClass =
            entry.summaryId === summaryModalState.selectedSummaryId
              ? " active"
              : "";
          return `<li class='summary-history-item${activeClass}'><button class='summary-history-btn' type='button' onclick="HabitApp.selectSummary('${book.bookId}', '${bookmark.bookmarkId}', '${entry.summaryId}')">${sanitize(stateLabel)} · p${entry.startPage}-${entry.endPage} · ${sanitize(formatIsoForDisplay(entry.createdAt))}</button></li>`;
        })
        .join("")
    : "<li class='summary-history-item'>No saved summaries for this bookmark.</li>";

  const hasAnySummary = !!getLatestBookmarkSummary(bookmark);
  regenBtn.disabled = summaryModalState.isRunning || !hasAnySummary;
  rebuildBtn.disabled = summaryModalState.isRunning;
}

export function openSummaryModal(bookId, bookmarkId) {
  summaryModalState.bookId = bookId;
  summaryModalState.bookmarkId = bookmarkId;
  summaryModalState.selectedSummaryId = null;
  summaryModalState.statusText = "Ready.";
  summaryModalState.detectionText = "";
  summaryModalState.externalSummary = null;
  summaryModalState.isRunning = false;
  renderSummaryModal();
  openModal("summaryModal");
}

export function closeSummaryModal() {
  Object.assign(summaryModalState, {
    bookId: null,
    bookmarkId: null,
    selectedSummaryId: null,
    statusText: "",
    detectionText: "",
    externalSummary: null,
    isRunning: false,
  });
  closeModal("summaryModal");
}

export function selectSummaryForModal(bookId, bookmarkId, summaryId) {
  if (
    summaryModalState.bookId !== bookId ||
    summaryModalState.bookmarkId !== bookmarkId
  ) {
    summaryModalState.bookId = bookId;
    summaryModalState.bookmarkId = bookmarkId;
  }
  summaryModalState.selectedSummaryId = summaryId;
  summaryModalState.externalSummary = null;
  renderSummaryModal();
}

export async function copySelectedSummaryToClipboard() {
  const book = getBookById(summaryModalState.bookId);
  const bookmark = book
    ? getBookmarkById(book, summaryModalState.bookmarkId)
    : null;
  if (!book || !bookmark) return;

  const summary =
    getSummaryById(bookmark, summaryModalState.selectedSummaryId) ||
    summaryModalState.externalSummary ||
    getLatestBookmarkSummary(bookmark);
  if (!summary || !summary.content) {
    alert("No summary available to copy.");
    return;
  }

  try {
    await navigator.clipboard.writeText(summary.content);
    summaryModalState.statusText = "Summary copied to clipboard.";
    renderSummaryModal();
  } catch (_) {
    appendLogEntry({
      level: "warn",
      component: "clipboard",
      operation: "copySelectedSummaryToClipboard",
      message: "Clipboard write failed.",
    });
    alert("Clipboard write failed. Please copy manually.");
  }
}

export async function runBookmarkSummary(bookId, bookmarkId, runMode) {
  const book = getBookById(bookId);
  const bookmark = book ? getBookmarkById(book, bookmarkId) : null;
  if (!book || !bookmark) {
    alert("Bookmark not found.");
    return;
  }

  const settings = getBookAiSettings();
  const runtimeApiKey = getApiKeyForSummary();
  if (!runtimeApiKey) {
    alert(
      "Unlock your saved Gemini API key in Books > Summary AI Settings first.",
    );
    return;
  }
  if (!String(settings.model || "").trim()) {
    alert("Select a Gemini model in Summary AI Settings.");
    return;
  }

  openSummaryModal(bookId, bookmarkId);
  summaryModalState.isRunning = true;

  const currentBookmarkPage = Math.max(
    1,
    parseInt(bookmark.pdfPage, 10) || 1,
  );
  const startedAt = performance.now();
  const runId = uid("sumrun");

  let startPage = 1;
  let endPage = currentBookmarkPage;
  let isIncremental = false;
  let basedOnSummaryId = null;
  let previousSummaryContent = "";
  let attemptDescriptor = "full";

  const latestBookmarkSummary = getLatestBookmarkSummary(bookmark);

  if (runMode === "regenerate-latest") {
    if (!latestBookmarkSummary) {
      summaryModalState.isRunning = false;
      summaryModalState.statusText =
        "No summary available to regenerate yet.";
      renderSummaryModal();
      return;
    }
    startPage = Math.max(
      1,
      parseInt(latestBookmarkSummary.startPage, 10) || 1,
    );
    endPage = Math.max(
      startPage,
      parseInt(latestBookmarkSummary.endPage, 10) || startPage,
    );
    isIncremental = latestBookmarkSummary.isIncremental === true;
    basedOnSummaryId = latestBookmarkSummary.basedOnSummaryId;
    attemptDescriptor = "regenerate-latest-segment";
    summaryModalState.detectionText = `Regenerating pages ${startPage}-${endPage}.`;
  } else if (runMode === "rebuild-full") {
    startPage = 1;
    endPage = currentBookmarkPage;
    isIncremental = false;
    basedOnSummaryId = null;
    attemptDescriptor = "rebuild-full";
    summaryModalState.detectionText = `Full rebuild for pages 1-${endPage}.`;
  } else {
    const detection = resolveIncrementalRange(book, currentBookmarkPage);
    if (detection.mode === "reuse") {
      summaryModalState.isRunning = false;
      summaryModalState.externalSummary = detection.relevantSummary;
      summaryModalState.detectionText = `Already summarized through page ${detection.lastSummarizedPage}. No new pages to process.`;
      summaryModalState.statusText = detection.relevantSummary
        ? "Showing the most relevant existing summary."
        : "No relevant prior summary found for this exact page.";
      if (
        detection.relevantSummary &&
        detection.relevantSummary.bookmarkId === bookmark.bookmarkId
      ) {
        summaryModalState.selectedSummaryId =
          detection.relevantSummary.summaryId;
      }
      renderSummaryModal();
      return;
    }

    startPage = detection.startPage;
    endPage = detection.endPage;
    basedOnSummaryId = detection.relevantSummary
      ? detection.relevantSummary.summaryId
      : null;
    previousSummaryContent = detection.relevantSummary
      ? String(detection.relevantSummary.content || "")
      : "";
    isIncremental = detection.mode === "incremental";
    attemptDescriptor = detection.mode;
    summaryModalState.detectionText =
      detection.mode === "incremental"
        ? `Incremental run: pages ${startPage}-${endPage} (previously summarized through ${detection.lastSummarizedPage}).`
        : `No previous summary found. Running full summary pages 1-${endPage}.`;
  }

  const plannedPages = endPage - startPage + 1;
  if (plannedPages > settings.maxPagesPerRun) {
    const proceed = window.confirm(
      `This run will process ${plannedPages} pages (limit is ${settings.maxPagesPerRun}). Continue?`,
    );
    if (!proceed) {
      summaryModalState.isRunning = false;
      summaryModalState.statusText = "Summary run canceled.";
      renderSummaryModal();
      return;
    }
  }

  renderSummaryModal();
  appendLogEntry({
    level: "info",
    component: "ai-summary",
    operation: "runBookmarkSummary",
    message: "Summary run started.",
    runId,
    context: {
      runMode,
      attemptDescriptor,
      bookId,
      bookmarkId,
      startPage,
      endPage,
      model: settings.model,
    },
  });

  try {
    summaryModalState.statusText = `Extracting pages ${startPage}-${endPage}...`;
    renderSummaryModal();

    const extracted = await extractTextRangeFromBookPdf(
      book,
      startPage,
      endPage,
      ({ current, total, absolutePage }) => {
        summaryModalState.statusText = `Extracting page ${absolutePage} (${current}/${total})...`;
        renderSummaryModal();
      },
    );

    startPage = extracted.startPage;
    endPage = extracted.endPage;

    summaryModalState.statusText = "Generating incremental summary...";
    renderSummaryModal();

    const segmentSummary = await summarizeSegmentWithChunking({
      text: extracted.text,
      startPage,
      endPage,
      apiKey: runtimeApiKey,
      model: settings.model,
      chunkChars: settings.chunkChars,
      onChunkProgress: ({ current, total }) => {
        summaryModalState.statusText = `Summarizing chunk ${current}/${total}...`;
        renderSummaryModal();
      },
    });

    summaryModalState.statusText = previousSummaryContent
      ? "Merging with previous summary context..."
      : "Finalizing summary...";
    renderSummaryModal();

    const mergedSummary = await mergeWithPreviousSummary({
      previousSummary: previousSummaryContent,
      incrementalSummary: segmentSummary.summary,
      currentBookmarkPage: endPage,
      apiKey: runtimeApiKey,
      model: settings.model,
      consolidateMode: settings.consolidateMode,
    });

    const durationMs = performance.now() - startedAt;
    const saved = appendBookmarkSummaryRecord(book, bookmark, {
      model: settings.model,
      startPage,
      endPage,
      isIncremental,
      basedOnSummaryId,
      status: "ready",
      content: mergedSummary,
      chunkMeta: {
        chunkCount: segmentSummary.chunkCount,
        mode: attemptDescriptor,
        incrementalOnlySummary: segmentSummary.summary,
      },
      durationMs,
    });

    summaryModalState.selectedSummaryId = saved.summaryId;
    summaryModalState.externalSummary = null;
    summaryModalState.statusText = `Summary saved for pages ${startPage}-${endPage} in ${formatDuration(durationMs)}.`;
    callRenderer("renderBooksView");
    renderSummaryModal();
    appendLogEntry({
      level: "info",
      component: "ai-summary",
      operation: "runBookmarkSummary",
      message: "Summary run completed successfully.",
      runId,
      context: {
        bookId,
        bookmarkId,
        startPage,
        endPage,
        durationMs: Math.round(durationMs),
        chunkCount: segmentSummary.chunkCount,
        model: settings.model,
      },
    });
  } catch (error) {
    const failedDurationMs = performance.now() - startedAt;
    appendBookmarkSummaryRecord(book, bookmark, {
      model: settings.model,
      startPage,
      endPage,
      isIncremental,
      basedOnSummaryId,
      status: "failed",
      content: "",
      chunkMeta: {
        mode: attemptDescriptor,
      },
      durationMs: failedDurationMs,
      error: String(error && error.message ? error.message : error),
    });

    summaryModalState.statusText = `Summary failed: ${String(error && error.message ? error.message : error)}`;
    callRenderer("renderBooksView");
    renderSummaryModal();
    appendLogEntry({
      level: "error",
      component: "ai-summary",
      operation: "runBookmarkSummary",
      message: "Summary run failed.",
      error,
      runId,
      context: {
        runMode,
        attemptDescriptor,
        bookId,
        bookmarkId,
        startPage,
        endPage,
        model: settings.model,
        durationMs: Math.round(failedDurationMs),
      },
    });
    maybeAutoDownloadLogs("summary-run-failed");
  } finally {
    summaryModalState.isRunning = false;
    renderSummaryModal();
  }
}

export function summarizeBookmark(bookId, bookmarkId) {
  runBookmarkSummary(bookId, bookmarkId, "auto");
}

export function viewBookmarkSummary(bookId, bookmarkId) {
  openSummaryModal(bookId, bookmarkId);
}

export function regenerateLatestSummarySegment() {
  if (!summaryModalState.bookId || !summaryModalState.bookmarkId) return;
  runBookmarkSummary(
    summaryModalState.bookId,
    summaryModalState.bookmarkId,
    "regenerate-latest",
  );
}

export function rebuildFullSummary() {
  if (!summaryModalState.bookId || !summaryModalState.bookmarkId) return;
  runBookmarkSummary(
    summaryModalState.bookId,
    summaryModalState.bookmarkId,
    "rebuild-full",
  );
}

registerRenderer("openSummaryModal", openSummaryModal);
registerRenderer("closeSummaryModal", closeSummaryModal);
