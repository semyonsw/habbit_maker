"use strict";

import { PDFJS_WORKER_URL, GEMINI_API_BASE_URL } from "./constants.js";
import { summaryModalState } from "./state.js";
import {
  sanitize,
  isPlainObject,
  uid,
  formatIsoForDisplay,
  nowIso,
  clampNumber,
} from "./utils.js?v=2";
import { appendLogEntry, maybeAutoDownloadLogs } from "./logging.js";
import { idbGetPdfBlob } from "./idb.js";
import { ensurePdfJsLibLoaded } from "./pdf-reader.js";
import {
  getApiKeyForSummary,
  getBookAiSettings,
  hasStoredEncryptedApiKey,
  unlockStoredApiKeyInteractive,
} from "./encryption.js";
import {
  getBookById,
  getBookmarkById,
  getLatestSummaryUpToPageFromBook,
  resolveIncrementalRange,
  getSummaryById,
  getLatestBookmarkSummary,
  appendBookmarkSummaryRecord,
} from "./books.js";
import { openModal, closeModal } from "./modals.js";
import { registerRenderer, callRenderer } from "./render-registry.js";

const SUMMARY_DYNAMIC_CHUNK_MIN = 5000;
const SUMMARY_DYNAMIC_CHUNK_MAX = 26000;
const SUMMARY_DYNAMIC_PAGES_MIN = 35;
const SUMMARY_DYNAMIC_PAGES_MAX = 320;
const MATHJAX_FALLBACK_URL =
  "https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js";
const SUMMARY_PENDING_ID = "__summary_pending__";
let mathJaxLoadPromise = null;

function resolveSummaryModelProfile(model) {
  const normalized = String(model || "").toLowerCase();
  if (normalized.includes("pro")) {
    return {
      baseChunkChars: 17000,
      baseMaxPagesPerRun: 240,
      label: "pro",
    };
  }
  if (normalized.includes("lite")) {
    return {
      baseChunkChars: 9000,
      baseMaxPagesPerRun: 100,
      label: "lite",
    };
  }
  if (normalized.includes("flash")) {
    return {
      baseChunkChars: 13000,
      baseMaxPagesPerRun: 160,
      label: "flash",
    };
  }
  return {
    baseChunkChars: 12000,
    baseMaxPagesPerRun: 140,
    label: "default",
  };
}

function computeDynamicSummaryLimits({
  model,
  plannedPages,
  totalBookPages,
  fileSizeBytes,
}) {
  const profile = resolveSummaryModelProfile(model);
  const safePlannedPages = Math.max(1, parseInt(plannedPages, 10) || 1);
  const safeTotalBookPages = Math.max(
    safePlannedPages,
    parseInt(totalBookPages, 10) || safePlannedPages,
  );
  const sizeMb = Math.max(0, Number(fileSizeBytes) / (1024 * 1024) || 0);

  let chunkMultiplier = 1;
  if (safePlannedPages > 220) chunkMultiplier -= 0.28;
  else if (safePlannedPages > 130) chunkMultiplier -= 0.18;
  else if (safePlannedPages > 80) chunkMultiplier -= 0.09;
  else if (safePlannedPages < 30) chunkMultiplier += 0.1;

  if (safeTotalBookPages > 500) chunkMultiplier -= 0.08;
  if (sizeMb > 55) chunkMultiplier -= 0.08;
  else if (sizeMb < 12) chunkMultiplier += 0.04;

  const chunkChars = clampNumber(
    Math.round(profile.baseChunkChars * chunkMultiplier),
    SUMMARY_DYNAMIC_CHUNK_MIN,
    SUMMARY_DYNAMIC_CHUNK_MAX,
  );

  let pageBudget = profile.baseMaxPagesPerRun;
  if (safePlannedPages > 240) pageBudget -= 60;
  else if (safePlannedPages > 140) pageBudget -= 35;
  else if (safePlannedPages < 45) pageBudget += 20;
  if (sizeMb > 55) pageBudget -= 18;

  const maxPagesPerRun = clampNumber(
    pageBudget,
    SUMMARY_DYNAMIC_PAGES_MIN,
    SUMMARY_DYNAMIC_PAGES_MAX,
  );

  return {
    chunkChars,
    maxPagesPerRun,
    profile: profile.label,
  };
}

function escapeSelectorValue(value) {
  const source = String(value || "");
  if (window.CSS && typeof window.CSS.escape === "function") {
    return window.CSS.escape(source);
  }
  return source.replace(/([\\"'])/g, "\\$1");
}

function getSummarizeButton(bookId, bookmarkId) {
  const safeBook = escapeSelectorValue(bookId);
  const safeBookmark = escapeSelectorValue(bookmarkId);
  return document.querySelector(
    `.bookmark-summarize-btn[data-summary-book-id="${safeBook}"][data-summary-bookmark-id="${safeBookmark}"]`,
  );
}

function setSummarizeButtonLoading(bookId, bookmarkId, isLoading) {
  const button = getSummarizeButton(bookId, bookmarkId);
  if (!button) return;

  if (!button.dataset.labelDefault) {
    button.dataset.labelDefault =
      button.textContent || "Summarize up to Bookmark";
  }

  if (isLoading) {
    button.classList.add("is-loading");
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.textContent = "Summarizing...";
    return;
  }

  button.classList.remove("is-loading");
  button.disabled = false;
  button.setAttribute("aria-busy", "false");
  button.textContent =
    button.dataset.labelDefault || "Summarize up to Bookmark";
}

function normalizeMathEscapesInDelimitedText(source) {
  const input = String(source || "");
  if (!input.includes("\\\\")) return input;

  let output = input
    .replace(/\$\$([\s\S]*?)\$\$/g, (match, content) => {
      return `$$${content.replace(/\\\\(?=[A-Za-z])/g, "\\")}$$`;
    })
    .replace(/\\\(([\s\S]*?)\\\)/g, (match, content) => {
      return `\\(${content.replace(/\\\\(?=[A-Za-z])/g, "\\")}\\)`;
    })
    .replace(/\\\[([\s\S]*?)\\\]/g, (match, content) => {
      return `\\[${content.replace(/\\\\(?=[A-Za-z])/g, "\\")}\\]`;
    });

  output = output.replace(
    /(^|[^$])\$([^$\n]+?)\$(?!\$)/g,
    (match, prefix, content) => {
      return `${prefix}$${content.replace(/\\\\(?=[A-Za-z])/g, "\\")}$`;
    },
  );

  return output;
}

function normalizeMathEscapesInElementTextNodes(rootElement) {
  if (!rootElement) return;
  const skippedTagNames = new Set([
    "CODE",
    "PRE",
    "SCRIPT",
    "STYLE",
    "TEXTAREA",
  ]);
  const walker = document.createTreeWalker(rootElement, NodeFilter.SHOW_TEXT);

  let current = walker.nextNode();
  while (current) {
    const parentElement = current.parentElement;
    const shouldSkip =
      !parentElement ||
      skippedTagNames.has(parentElement.tagName) ||
      !!parentElement.closest("code, pre, script, style, textarea");

    if (!shouldSkip) {
      const normalized = normalizeMathEscapesInDelimitedText(
        current.textContent || "",
      );
      if (normalized !== current.textContent) {
        current.textContent = normalized;
      }
    }

    current = walker.nextNode();
  }
}

function elementHasRawMathDelimiters(element) {
  if (!element) return false;
  const text = String(element.textContent || "");
  if (!text.trim()) return false;
  return (
    /\$\$[\s\S]+?\$\$/.test(text) ||
    /(^|[^$])\$[^$\n]+\$(?!\$)/.test(text) ||
    /\\\([\s\S]+?\\\)/.test(text) ||
    /\\\[[\s\S]+?\\\]/.test(text)
  );
}

function ensureMathJaxFallbackLoaded() {
  if (window.MathJax && typeof window.MathJax.typesetPromise === "function") {
    return Promise.resolve(window.MathJax);
  }

  if (mathJaxLoadPromise) {
    return mathJaxLoadPromise;
  }

  mathJaxLoadPromise = new Promise((resolve) => {
    if (!window.MathJax || typeof window.MathJax !== "object") {
      window.MathJax = {
        tex: {
          inlineMath: [
            ["$", "$"],
            ["\\(", "\\)"],
          ],
          displayMath: [
            ["$$", "$$"],
            ["\\[", "\\]"],
          ],
        },
        options: {
          skipHtmlTags: [
            "script",
            "noscript",
            "style",
            "textarea",
            "pre",
            "code",
          ],
        },
      };
    }

    const existingScript = document.querySelector(
      "script[data-summary-mathjax='1']",
    );
    if (existingScript) {
      existingScript.addEventListener(
        "load",
        () => {
          const startupPromise =
            window.MathJax &&
            window.MathJax.startup &&
            window.MathJax.startup.promise;
          if (startupPromise && typeof startupPromise.then === "function") {
            startupPromise
              .then(() => resolve(window.MathJax))
              .catch(() => resolve(null));
            return;
          }
          resolve(window.MathJax || null);
        },
        { once: true },
      );
      existingScript.addEventListener("error", () => resolve(null), {
        once: true,
      });
      return;
    }

    const script = document.createElement("script");
    script.src = MATHJAX_FALLBACK_URL;
    script.async = true;
    script.dataset.summaryMathjax = "1";
    script.addEventListener(
      "load",
      () => {
        const startupPromise =
          window.MathJax &&
          window.MathJax.startup &&
          window.MathJax.startup.promise;
        if (startupPromise && typeof startupPromise.then === "function") {
          startupPromise
            .then(() => resolve(window.MathJax))
            .catch(() => resolve(null));
          return;
        }
        resolve(window.MathJax || null);
      },
      { once: true },
    );
    script.addEventListener("error", () => resolve(null), { once: true });
    document.head.appendChild(script);
  });

  return mathJaxLoadPromise;
}

async function renderSummaryMath(element) {
  if (!element) return;
  normalizeMathEscapesInElementTextNodes(element);

  if (typeof window.renderMathInElement === "function") {
    try {
      window.renderMathInElement(element, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "\\[", right: "\\]", display: true },
          { left: "$", right: "$", display: false },
          { left: "\\(", right: "\\)", display: false },
        ],
        throwOnError: false,
        strict: "ignore",
      });
    } catch (error) {
      appendLogEntry({
        level: "warn",
        component: "ai-summary",
        operation: "renderSummaryMath.katex",
        message: "KaTeX rendering encountered an issue.",
        error,
      });
    }
  }

  if (!elementHasRawMathDelimiters(element)) {
    return;
  }

  const mathJax = await ensureMathJaxFallbackLoaded();
  if (!mathJax || typeof mathJax.typesetPromise !== "function") {
    appendLogEntry({
      level: "warn",
      component: "ai-summary",
      operation: "renderSummaryMath.mathjax-load",
      message: "MathJax fallback could not be loaded.",
    });
    return;
  }

  try {
    await mathJax.typesetPromise([element]);
  } catch (error) {
    appendLogEntry({
      level: "warn",
      component: "ai-summary",
      operation: "renderSummaryMath.mathjax-typeset",
      message: "MathJax fallback typesetting failed.",
      error,
    });
  }
}

function chunkTextForSummary(text, maxChars) {
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

function buildIncrementalChunkPrompt({
  text,
  startPage,
  endPage,
  chunkIndex,
  totalChunks,
  summaryLanguage,
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
    resolveSummaryLanguageInstruction(summaryLanguage),
    "Text to summarize:",
    text,
  ].join("\n\n");
}

function buildChunkMergePrompt({
  chunkSummaries,
  startPage,
  endPage,
  summaryLanguage,
}) {
  return [
    "You are consolidating partial summaries of one continuous reading segment.",
    `Create one clean summary for pages ${startPage}-${endPage}.`,
    "Remove overlap and duplication while preserving key details.",
    "Return markdown with these exact sections:",
    "## Key Concepts",
    "## Important Events or Arguments",
    "## Notable Insights or Takeaways",
    resolveSummaryLanguageInstruction(summaryLanguage),
    "Partial summaries:",
    chunkSummaries
      .map((chunk, idx) => `Chunk ${idx + 1}:\n${chunk}`)
      .join("\n\n"),
  ].join("\n\n");
}

function buildFinalMergePrompt({
  previousSummary,
  incrementalSummary,
  currentBookmarkPage,
  summaryLanguage,
}) {
  return [
    "You are updating a running book summary.",
    `The unified summary should represent reading progress up to page ${currentBookmarkPage}.`,
    "Merge previous and new summaries without redundancy and keep chronology clear.",
    "Return markdown with these exact sections:",
    "## Key Concepts",
    "## Important Events or Arguments",
    "## Notable Insights or Takeaways",
    resolveSummaryLanguageInstruction(summaryLanguage),
    "Previous summary context:",
    previousSummary,
    "New incremental summary:",
    incrementalSummary,
  ].join("\n\n");
}

function resolveSummaryLanguageInstruction(summaryLanguage) {
  const candidate = String(summaryLanguage || "").trim();
  if (candidate === "Armenian") {
    return "Write the entire response in Armenian.";
  }
  if (candidate === "Russian") {
    return "Write the entire response in Russian.";
  }
  return "Write the entire response in English.";
}

function parseGeminiResponseText(payload) {
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

function describeGeminiResponseIssue(payload) {
  if (!isPlainObject(payload)) return "";
  const parts = [];
  if (Array.isArray(payload.candidates) && payload.candidates.length) {
    const reasons = payload.candidates
      .map((candidate) =>
        candidate && typeof candidate.finishReason === "string"
          ? candidate.finishReason
          : "",
      )
      .filter(Boolean);
    if (reasons.length) {
      parts.push(`finishReason=${reasons.join(",")}`);
    }
  }
  if (isPlainObject(payload.promptFeedback)) {
    const block = payload.promptFeedback.blockReason;
    if (typeof block === "string" && block) {
      parts.push(`blockReason=${block}`);
    }
  }
  return parts.join("; ");
}

export async function callGeminiGenerateText({ apiKey, model, prompt }) {
  if (!apiKey) {
    throw new Error("Gemini API key is missing.");
  }
  if (!model) {
    throw new Error("Gemini model is missing.");
  }

  const endpoint = `${GEMINI_API_BASE_URL}/models/${encodeURIComponent(model)}:generateContent`;
  const retries = 2;
  const startedAt = performance.now();
  const timeoutMs = clampNumber(
    90000 + Math.round(String(prompt || "").length / 24),
    90000,
    180000,
  );

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 8192,
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
        const diagnostic = describeGeminiResponseIssue(body);
        const detail = diagnostic ? ` (${diagnostic})` : "";
        const err = new Error(`Gemini returned an empty response.${detail}`);
        err.isEmptyResponse = true;
        err.finishReason = diagnostic;
        throw err;
      }

      return text;
    } catch (error) {
      const isAbort = error && error.name === "AbortError";
      const isEmpty = Boolean(error && error.isEmptyResponse);
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
      const canRetry = attempt < retries;
      const retriableEmpty =
        isEmpty &&
        !/SAFETY|RECITATION|BLOCK/i.test(String(error && error.finishReason));
      if (
        (isAbort || retriableEmpty || /network/i.test(String(error))) &&
        canRetry
      ) {
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
  summaryLanguage,
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
      summaryLanguage,
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
    summaryLanguage,
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
  summaryLanguage,
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
    summaryLanguage,
  });

  return callGeminiGenerateText({ apiKey, model, prompt });
}

function formatDuration(durationMs) {
  const ms = Number(durationMs);
  if (!Number.isFinite(ms) || ms <= 0) return "-";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function formatSummaryInlineMarkdown(input) {
  const escaped = sanitize(String(input || "")).replace(/\r/g, "");
  const withCode = escaped.replace(/`([^`]+)`/g, "<code>$1</code>");
  const withBold = withCode.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return withBold
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/(^|[^_])_([^_\n]+)_(?!_)/g, "$1<em>$2</em>");
}

function renderSummaryContentHtmlFallback(content) {
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

function normalizeSummaryMarkdown(content) {
  let source = String(content || "").trim();
  if (!source) return "";

  const fencedBlock = source.match(/^```(?:markdown|md)?\s*([\s\S]*?)\s*```$/i);
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

  source = normalizeMathEscapesInDelimitedText(source);

  return source;
}

function renderSummaryContentHtml(content) {
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

function renderSummaryLoadingHtml(pendingRun, statusText) {
  const hasRange =
    pendingRun &&
    Number.isFinite(Number(pendingRun.startPage)) &&
    Number.isFinite(Number(pendingRun.endPage));
  const rangeText = hasRange
    ? `Pages ${pendingRun.startPage}-${pendingRun.endPage}`
    : "Preparing page range...";
  const modeLabel =
    pendingRun && pendingRun.modeLabel
      ? String(pendingRun.modeLabel)
      : "Generating";
  const details = String(statusText || "Building your summary now...");

  return `<div class='summary-loading-state' role='status' aria-live='polite' aria-busy='true'><div class='summary-loading-spinner' aria-hidden='true'></div><p class='summary-loading-title'>${sanitize(modeLabel)} summary in progress</p><p class='summary-loading-subtitle'>${sanitize(rangeText)}</p><p class='summary-loading-subtitle'>${sanitize(details)}</p></div>`;
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
  const pendingRun = summaryModalState.pendingRun;
  const isPendingSelected = summaryModalState.isRunning && pendingRun;

  if (isPendingSelected) {
    bodyEl.innerHTML = renderSummaryLoadingHtml(
      pendingRun,
      summaryModalState.statusText,
    );
    copyBtn.disabled = true;
  } else if (selectedSummary && selectedSummary.content) {
    bodyEl.innerHTML = renderSummaryContentHtml(selectedSummary.content);
    renderSummaryMath(bodyEl).catch((error) => {
      appendLogEntry({
        level: "warn",
        component: "ai-summary",
        operation: "renderSummaryModal.renderSummaryMath",
        message: "Summary math rendering promise failed.",
        error,
      });
    });
    copyBtn.disabled = false;
  } else {
    bodyEl.innerHTML =
      "<p>No summary yet. Use Summarize up to Bookmark to generate one.</p>";
    copyBtn.disabled = true;
  }

  const entries = Array.isArray(bookmark.summaries) ? bookmark.summaries : [];
  const pendingHistoryHtml = isPendingSelected
    ? (() => {
        const pendingRange =
          Number.isFinite(Number(pendingRun.startPage)) &&
          Number.isFinite(Number(pendingRun.endPage))
            ? `p${pendingRun.startPage}-${pendingRun.endPage}`
            : "preparing";
        const pendingTime = pendingRun.createdAt
          ? formatIsoForDisplay(pendingRun.createdAt)
          : "now";
        return `<li class='summary-history-item active running'><button class='summary-history-btn running' type='button' disabled aria-disabled='true'>Running · ${sanitize(pendingRange)} · ${sanitize(pendingTime)}</button></li>`;
      })()
    : "";

  const savedHistoryHtml = entries.length
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

  historyEl.innerHTML = `${pendingHistoryHtml}${savedHistoryHtml}`;

  const hasAnySummary = !!getLatestBookmarkSummary(bookmark);
  regenBtn.disabled = summaryModalState.isRunning || !hasAnySummary;
  rebuildBtn.disabled = summaryModalState.isRunning;
}

export function openSummaryModal(bookId, bookmarkId, options = {}) {
  const preserveRunning = options && options.preserveRunning === true;
  const preservePending = options && options.preservePending === true;
  summaryModalState.bookId = bookId;
  summaryModalState.bookmarkId = bookmarkId;
  summaryModalState.selectedSummaryId = null;
  summaryModalState.statusText = "Ready.";
  summaryModalState.detectionText = "";
  summaryModalState.externalSummary = null;
  summaryModalState.isRunning = preserveRunning
    ? summaryModalState.isRunning
    : false;
  summaryModalState.pendingRun = preservePending
    ? summaryModalState.pendingRun
    : null;
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
    pendingRun: null,
  });
  closeModal("summaryModal");
}

export function selectSummaryForModal(bookId, bookmarkId, summaryId) {
  if (summaryModalState.isRunning && summaryModalState.pendingRun) {
    summaryModalState.selectedSummaryId = SUMMARY_PENDING_ID;
    renderSummaryModal();
    return;
  }

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

function resolveCurrentSummaryTargets(bookId, bookmarkId) {
  const nextBook = getBookById(bookId);
  const nextBookmark = nextBook ? getBookmarkById(nextBook, bookmarkId) : null;
  return { book: nextBook, bookmark: nextBookmark };
}

export async function runBookmarkSummary(bookId, bookmarkId, runMode) {
  if (summaryModalState.isRunning) {
    summaryModalState.statusText = "Summary already in progress. Please wait.";
    renderSummaryModal();
    return;
  }

  summaryModalState.isRunning = true;
  setSummarizeButtonLoading(bookId, bookmarkId, true);

  const startedAt = performance.now();
  const runId = uid("sumrun");
  let settings = null;
  let attemptDescriptor = "full";
  let startPage = 1;
  let endPage = 1;
  let isIncremental = false;
  let basedOnSummaryId = null;
  let previousSummaryContent = "";
  let runtimeLimits = null;
  let shouldRenderModal = false;

  try {
    const currentTargets = resolveCurrentSummaryTargets(bookId, bookmarkId);
    const book = currentTargets.book;
    const bookmark = currentTargets.bookmark;
    if (!book || !bookmark) {
      alert("Bookmark not found.");
      return;
    }

    settings = getBookAiSettings();
    let runtimeApiKey = getApiKeyForSummary();
    if (!runtimeApiKey && hasStoredEncryptedApiKey()) {
      const unlocked = await unlockStoredApiKeyInteractive();
      if (!unlocked) {
        return;
      }
      runtimeApiKey = getApiKeyForSummary();
    }
    if (!runtimeApiKey) {
      alert(
        "Save and unlock a Gemini API key in Books > Summary AI Settings first.",
      );
      return;
    }
    if (!String(settings.model || "").trim()) {
      alert("Select a Gemini model in Summary AI Settings.");
      return;
    }

    openSummaryModal(bookId, bookmarkId, { preserveRunning: true });
    shouldRenderModal = true;
    summaryModalState.pendingRun = {
      summaryId: SUMMARY_PENDING_ID,
      startPage: null,
      endPage: null,
      modeLabel: "Preparing",
      createdAt: nowIso(),
    };
    summaryModalState.selectedSummaryId = SUMMARY_PENDING_ID;
    summaryModalState.externalSummary = null;
    summaryModalState.statusText = "Preparing summary run...";
    renderSummaryModal();

    const currentBookmarkPage = Math.max(
      1,
      parseInt(bookmark.pdfPage, 10) || 1,
    );

    const latestBookmarkSummary = getLatestBookmarkSummary(bookmark);

    if (runMode === "regenerate-latest") {
      if (!latestBookmarkSummary) {
        summaryModalState.pendingRun = null;
        summaryModalState.selectedSummaryId = null;
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
        summaryModalState.pendingRun = null;
        summaryModalState.selectedSummaryId = null;
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

    summaryModalState.pendingRun = {
      ...summaryModalState.pendingRun,
      summaryId: SUMMARY_PENDING_ID,
      startPage,
      endPage,
      modeLabel:
        attemptDescriptor === "rebuild-full"
          ? "Rebuild"
          : attemptDescriptor === "regenerate-latest-segment"
            ? "Regenerate"
            : attemptDescriptor === "incremental"
              ? "Incremental"
              : "Full",
      createdAt:
        summaryModalState.pendingRun && summaryModalState.pendingRun.createdAt
          ? summaryModalState.pendingRun.createdAt
          : nowIso(),
    };
    summaryModalState.selectedSummaryId = SUMMARY_PENDING_ID;
    summaryModalState.externalSummary = null;
    summaryModalState.statusText = "Preparing summary run...";
    renderSummaryModal();

    const plannedPages = endPage - startPage + 1;
    const totalBookPages = endPage;
    runtimeLimits = computeDynamicSummaryLimits({
      model: settings.model,
      plannedPages,
      totalBookPages,
      fileSizeBytes: book.fileSize,
    });

    if (plannedPages > runtimeLimits.maxPagesPerRun) {
      const proceed = window.confirm(
        `This run will process ${plannedPages} pages (recommended ${runtimeLimits.maxPagesPerRun} for ${runtimeLimits.profile} profile). Continue?`,
      );
      if (!proceed) {
        summaryModalState.pendingRun = null;
        summaryModalState.selectedSummaryId = null;
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
        summaryLanguage: settings.summaryLanguage,
        dynamicChunkChars: runtimeLimits.chunkChars,
        dynamicPageBudget: runtimeLimits.maxPagesPerRun,
        dynamicProfile: runtimeLimits.profile,
      },
    });

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

    if (
      !String(extracted.text || "")
        .replace(/\s+/g, "")
        .trim()
    ) {
      throw new Error(
        `No extractable text found in pages ${extracted.startPage}-${extracted.endPage}.`,
      );
    }

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
      summaryLanguage: settings.summaryLanguage,
      chunkChars: runtimeLimits.chunkChars,
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
      summaryLanguage: settings.summaryLanguage,
    });

    const latestTargets = resolveCurrentSummaryTargets(bookId, bookmarkId);
    if (!latestTargets.book || !latestTargets.bookmark) {
      throw new Error(
        "The target bookmark was removed while summary generation was running.",
      );
    }

    const durationMs = performance.now() - startedAt;
    const saved = appendBookmarkSummaryRecord(
      latestTargets.book,
      latestTargets.bookmark,
      {
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
          summaryLanguage: settings.summaryLanguage,
          incrementalOnlySummary: segmentSummary.summary,
          chunkChars: runtimeLimits.chunkChars,
          dynamicProfile: runtimeLimits.profile,
        },
        durationMs,
      },
    );

    summaryModalState.pendingRun = null;
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
        summaryLanguage: settings.summaryLanguage,
        dynamicChunkChars: runtimeLimits.chunkChars,
      },
    });
  } catch (error) {
    const failedDurationMs = performance.now() - startedAt;
    const latestTargets = resolveCurrentSummaryTargets(bookId, bookmarkId);

    if (latestTargets.book && latestTargets.bookmark && settings) {
      appendBookmarkSummaryRecord(latestTargets.book, latestTargets.bookmark, {
        model: settings.model,
        startPage,
        endPage,
        isIncremental,
        basedOnSummaryId,
        status: "failed",
        content: "",
        chunkMeta: {
          mode: attemptDescriptor,
          summaryLanguage: settings.summaryLanguage,
          chunkChars: runtimeLimits ? runtimeLimits.chunkChars : null,
          dynamicProfile: runtimeLimits ? runtimeLimits.profile : null,
        },
        durationMs: failedDurationMs,
        error: String(error && error.message ? error.message : error),
      });
      callRenderer("renderBooksView");
    }

    summaryModalState.pendingRun = null;
    summaryModalState.statusText = `Summary failed: ${String(error && error.message ? error.message : error)}`;
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
        model: settings ? settings.model : "",
        durationMs: Math.round(failedDurationMs),
      },
    });
    maybeAutoDownloadLogs("summary-run-failed");
  } finally {
    summaryModalState.isRunning = false;
    summaryModalState.pendingRun = null;
    setSummarizeButtonLoading(bookId, bookmarkId, false);
    if (shouldRenderModal) {
      renderSummaryModal();
    }
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
