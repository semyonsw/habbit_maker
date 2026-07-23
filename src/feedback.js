"use strict";

import {
  APP_VERSION,
  FEEDBACK_GITHUB_REPO,
  FEEDBACK_EMAIL,
  FEEDBACK_URL_LENGTH_WARNING_THRESHOLD,
  FEEDBACK_MAX_IMAGES,
  FEEDBACK_MAX_IMAGE_BYTES,
  FEEDBACK_EMAIL_ATTACH_MAX_WIDTH,
  FEEDBACK_EMAIL_ATTACH_BUDGET_BYTES,
  EMAILJS_API_URL,
  EMAILJS_PUBLIC_KEY_STORAGE,
  EMAILJS_SERVICE_ID_STORAGE,
  EMAILJS_TEMPLATE_ID_STORAGE,
  EMAILJS_ATTACH_TEMPLATE_ID_STORAGE,
  GEMINI_POLISH_MODEL,
} from "./constants.js";
import { closeModal, openModal } from "./modals.js";
import { callGeminiGenerateText } from "./ai-summary.js";
import { getApiKeyForSummary } from "./encryption.js";
import { appendLogEntry } from "./logging.js";
import { formatByteSize, uid } from "./utils.js";

const FEEDBACK_LOG_COMPONENT = "feedback";

const EMAILJS_VALIDATION_SUBJECT =
  "[Habit Maker] EmailJS credentials test — please ignore";
const EMAILJS_VALIDATION_BODY =
  "This is an automated credential validation test from Habit Maker. " +
  "If you received this, your EmailJS setup is working. " +
  "You can safely ignore this email.";

const FEEDBACK_TYPE_LABELS = {
  bug: "Bug",
  feature: "Feature",
  other: "Feedback",
};

const FEEDBACK_TYPE_GH_LABELS = {
  bug: "bug",
  feature: "enhancement",
  other: "feedback",
};

let lastFormSnapshot = null;

// In-memory screenshots for the feedback currently being composed. Each entry:
// { id, name, size, type, dataUrl }. Never persisted -- cleared on form reset.
let feedbackImages = [];

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("File read failed."));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image could not be decoded."));
    img.src = src;
  });
}

// Approximate the decoded byte size of a base64 data URL without allocating it.
function decodedByteLength(dataUrl) {
  const comma = dataUrl.indexOf(",");
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - pad);
}

function dataUrlToBlob(dataUrl) {
  const comma = dataUrl.indexOf(",");
  const header = dataUrl.slice(0, comma);
  const data = dataUrl.slice(comma + 1);
  const mime = (header.match(/data:([^;]+)/) || [])[1] || "application/octet-stream";
  const raw = /;base64/i.test(header) ? atob(data) : decodeURIComponent(data);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function extFromType(type) {
  if (/png/i.test(type)) return ".png";
  if (/jpe?g/i.test(type)) return ".jpg";
  if (/webp/i.test(type)) return ".webp";
  if (/gif/i.test(type)) return ".gif";
  return ".img";
}

// Sanitize a filename for the attachment/download. When forcedType is
// image/jpeg (we re-encoded), rewrite the extension to .jpg.
function safeAttachmentName(name, forcedType) {
  let base = String(name || "").split(/[\\/]/).pop() || "";
  base = base.replace(/[^\w.\-]+/g, "_").slice(0, 80) || "screenshot";
  if (forcedType === "image/jpeg") {
    base = base.replace(/\.[a-z0-9]{2,5}$/i, "") + ".jpg";
  } else if (!/\.[a-z0-9]{2,5}$/i.test(base)) {
    base += extFromType(forcedType);
  }
  return base;
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 8000);
}

function downloadFeedbackImages() {
  feedbackImages.forEach((item, i) => {
    try {
      triggerDownload(
        dataUrlToBlob(item.dataUrl),
        safeAttachmentName(item.name, item.type) || `screenshot-${i + 1}.png`,
      );
    } catch (_) {
      /* one failed download shouldn't abort the rest */
    }
  });
}

async function toPngDataUrl(dataUrl) {
  if (/^data:image\/png/i.test(dataUrl)) return dataUrl;
  const img = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  canvas.getContext("2d").drawImage(img, 0, 0);
  return canvas.toDataURL("image/png");
}

// Best-effort: clipboard image writes need a PNG, a secure context, and a user
// gesture. Any failure just means the user drags the downloaded file instead.
async function copyFirstImageToClipboard() {
  if (!feedbackImages.length) return false;
  if (!navigator.clipboard || typeof window.ClipboardItem === "undefined") {
    return false;
  }
  try {
    const blob = dataUrlToBlob(await toPngDataUrl(feedbackImages[0].dataUrl));
    await navigator.clipboard.write([
      new window.ClipboardItem({ [blob.type]: blob }),
    ]);
    return true;
  } catch (_) {
    return false;
  }
}

// Draw one image onto a white canvas at `scale` of its email-capped width.
function makeSingleCanvas(img, scale) {
  const nw = img.naturalWidth || img.width;
  const nh = img.naturalHeight || img.height;
  const w = Math.max(1, Math.round(Math.min(nw, FEEDBACK_EMAIL_ATTACH_MAX_WIDTH) * scale));
  const h = Math.max(1, Math.round((w / nw) * nh));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return canvas;
}

// Stack several images vertically, centered, on one white canvas.
function makeCompositeCanvas(imgs, scale) {
  const gap = 10;
  const baseW = Math.min(
    FEEDBACK_EMAIL_ATTACH_MAX_WIDTH,
    Math.max(...imgs.map((im) => im.naturalWidth || im.width)),
  );
  const targetW = Math.max(1, Math.round(baseW * scale));
  const rows = imgs.map((im) => {
    const nw = im.naturalWidth || im.width;
    const nh = im.naturalHeight || im.height;
    const w = Math.min(targetW, Math.max(1, Math.round(nw * scale)));
    return { im, w, h: Math.max(1, Math.round((w / nw) * nh)) };
  });
  const totalH = rows.reduce((sum, r) => sum + r.h + gap, gap);
  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = totalH;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, targetW, totalH);
  let y = gap;
  for (const r of rows) {
    ctx.drawImage(r.im, Math.round((targetW - r.w) / 2), y, r.w, r.h);
    y += r.h + gap;
  }
  return canvas;
}

// Re-encode a canvas as JPEG, walking down scale then quality until it fits the
// byte budget (EmailJS caps attachments at 500KB). Returns the smallest attempt
// with overBudget=true if nothing fit.
function encodeToBudget(makeCanvas, budget) {
  const scales = [1, 0.8, 0.65, 0.5, 0.38, 0.28];
  const qualities = [0.85, 0.72, 0.6, 0.48];
  let smallest = null;
  for (const scale of scales) {
    const canvas = makeCanvas(scale);
    for (const quality of qualities) {
      const url = canvas.toDataURL("image/jpeg", quality);
      if (!smallest || url.length < smallest.length) smallest = url;
      if (decodedByteLength(url) <= budget) return { dataUrl: url, overBudget: false };
    }
  }
  return { dataUrl: smallest, overBudget: true };
}

// Produce the single attachment sent via EmailJS. One image is kept pristine
// when it already fits; otherwise it's re-encoded. Several are combined into
// one stacked JPEG so exactly one template slot is used (no empty-slot 422s).
async function buildEmailAttachment() {
  if (!feedbackImages.length) return null;
  const budget = FEEDBACK_EMAIL_ATTACH_BUDGET_BYTES;
  const imgs = [];
  for (const item of feedbackImages) imgs.push(await loadImage(item.dataUrl));

  if (feedbackImages.length === 1) {
    const only = feedbackImages[0];
    if (decodedByteLength(only.dataUrl) <= budget) {
      return {
        dataUrl: only.dataUrl,
        filename: safeAttachmentName(only.name, only.type),
        count: 1,
        compressed: false,
        overBudget: false,
      };
    }
    const { dataUrl, overBudget } = encodeToBudget(
      (s) => makeSingleCanvas(imgs[0], s),
      budget,
    );
    return {
      dataUrl,
      filename: safeAttachmentName(only.name, "image/jpeg"),
      count: 1,
      compressed: true,
      overBudget,
    };
  }

  const { dataUrl, overBudget } = encodeToBudget(
    (s) => makeCompositeCanvas(imgs, s),
    budget,
  );
  return {
    dataUrl,
    filename: "habit-maker-screenshots.jpg",
    count: feedbackImages.length,
    compressed: true,
    overBudget,
  };
}

function renderFeedbackImages() {
  const container = document.getElementById("feedbackImageList");
  if (!container) return;
  container.innerHTML = "";
  if (!feedbackImages.length) {
    container.hidden = true;
    return;
  }
  container.hidden = false;
  feedbackImages.forEach((item) => {
    const cell = document.createElement("div");
    cell.className = "feedback-image-thumb";

    const img = document.createElement("img");
    img.src = item.dataUrl;
    img.alt = item.name;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "feedback-image-remove";
    remove.title = `Remove ${item.name}`;
    remove.setAttribute("aria-label", `Remove ${item.name}`);
    remove.textContent = "×";
    remove.addEventListener("click", () => removeFeedbackImage(item.id));

    const cap = document.createElement("span");
    cap.className = "feedback-image-cap";
    cap.textContent = formatByteSize(item.size);

    cell.appendChild(img);
    cell.appendChild(remove);
    cell.appendChild(cap);
    container.appendChild(cell);
  });
}

function removeFeedbackImage(id) {
  feedbackImages = feedbackImages.filter((i) => i.id !== id);
  renderFeedbackImages();
  if (!feedbackImages.length) hideImageNote();
}

function clearFeedbackImages() {
  feedbackImages = [];
  renderFeedbackImages();
  hideImageNote();
  hideGithubImageHint();
  hideMailtoImageHint();
}

function setImageNote(message, tone) {
  const el = document.getElementById("feedbackImageNote");
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("is-warn", tone === "warn");
  el.hidden = false;
}

function hideImageNote() {
  const el = document.getElementById("feedbackImageNote");
  if (!el) return;
  el.hidden = true;
  el.classList.remove("is-warn");
}

export async function handleFeedbackImageInputChange() {
  const input = document.getElementById("feedbackImageInput");
  if (!input || !input.files || !input.files.length) return;
  const files = Array.from(input.files);
  input.value = "";
  const rejected = [];
  for (const file of files) {
    if (feedbackImages.length >= FEEDBACK_MAX_IMAGES) {
      rejected.push(`${file.name} (max ${FEEDBACK_MAX_IMAGES})`);
      continue;
    }
    if (!/^image\//i.test(file.type)) {
      rejected.push(`${file.name} (not an image)`);
      continue;
    }
    if (file.size > FEEDBACK_MAX_IMAGE_BYTES) {
      rejected.push(
        `${file.name} (over ${formatByteSize(FEEDBACK_MAX_IMAGE_BYTES)})`,
      );
      continue;
    }
    try {
      feedbackImages.push({
        id: uid("fbimg"),
        name: file.name,
        size: file.size,
        type: file.type,
        dataUrl: await readFileAsDataUrl(file),
      });
    } catch (_) {
      rejected.push(`${file.name} (could not be read)`);
    }
  }
  renderFeedbackImages();
  if (rejected.length) {
    setImageNote(`Skipped: ${rejected.join(", ")}.`, "warn");
  } else {
    hideImageNote();
  }
}

function showGithubImageHint(copied, count) {
  const el = document.getElementById("feedbackGithubImageHint");
  if (!el) return;
  const many = count > 1;
  el.innerHTML =
    "GitHub issue opened in a new tab. " +
    (copied
      ? "Your first screenshot was copied — press <strong>Ctrl/Cmd + V</strong> in the issue description to paste it. "
      : "") +
    `We downloaded ${count} screenshot${many ? "s" : ""} to your device — ` +
    `<strong>drag ${many ? "them" : "it"}</strong> into the issue description to attach.`;
  el.hidden = false;
}

function hideGithubImageHint() {
  const el = document.getElementById("feedbackGithubImageHint");
  if (el) el.hidden = true;
}

function showMailtoImageHint(count) {
  const el = document.getElementById("feedbackMailtoImageHint");
  if (!el) return;
  const many = count > 1;
  el.innerHTML =
    `We downloaded ${count} screenshot${many ? "s" : ""} to your device. ` +
    "Mail links can't carry attachments — please " +
    `<strong>attach ${many ? "them" : "it"}</strong> in your mail client before sending.`;
  el.hidden = false;
}

function hideMailtoImageHint() {
  const el = document.getElementById("feedbackMailtoImageHint");
  if (el) el.hidden = true;
}

function setPreviewImageNote(text, tone) {
  const el = document.getElementById("feedbackPreviewImageNote");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("is-warn", tone === "warn");
  el.hidden = false;
}

function hidePreviewImageNote() {
  const el = document.getElementById("feedbackPreviewImageNote");
  if (!el) return;
  el.hidden = true;
  el.classList.remove("is-warn");
}

function refreshPreviewImageNote() {
  const n = feedbackImages.length;
  if (!n) {
    hidePreviewImageNote();
    return;
  }
  const cfg = getEmailJsConfig();
  const canAttach = !!(cfg.publicKey && cfg.serviceId && cfg.attachTemplateId);
  const many = n > 1;
  if (canAttach) {
    setPreviewImageNote(
      `📎 ${n} screenshot${many ? "s" : ""} will be attached to this email` +
        (many ? " (combined into one image)" : "") +
        ". Large images are auto-compressed to fit EmailJS's 500 KB limit.",
      "info",
    );
  } else {
    setPreviewImageNote(
      `⚠ ${n} screenshot${many ? "s" : ""} won't be emailed — that needs a paid ` +
        'EmailJS attachments template (see settings). Send text-only, or go back and use "Open GitHub Issue" to attach them.',
      "warn",
    );
  }
}

function gatherDiagnostics() {
  return {
    appVersion: APP_VERSION,
    platform: (navigator && navigator.platform) || "unknown",
    userAgent: (navigator && navigator.userAgent) || "unknown",
  };
}

function formatBody({ description, includeDiagnostics }) {
  let body = (description || "").trim();
  if (includeDiagnostics) {
    const { appVersion, platform, userAgent } = gatherDiagnostics();
    body +=
      `\n\n---\n**Environment**\n` +
      `- App version: ${appVersion}\n` +
      `- Platform: ${platform}\n` +
      `- User-agent: ${userAgent}\n`;
  }
  return body;
}

function defaultSubject({ type, title }) {
  const typeLabel = FEEDBACK_TYPE_LABELS[type] || "Feedback";
  return `[Habit Maker] ${typeLabel}: ${(title || "").trim()}`;
}

function buildIssueUrl({
  type,
  title,
  description,
  includeDiagnostics,
  imageCount,
}) {
  const labels = FEEDBACK_TYPE_GH_LABELS[type] || "feedback";
  let body = formatBody({ description, includeDiagnostics });
  if (imageCount) {
    body +=
      `\n\n---\n📎 **Screenshots (${imageCount}):** ` +
      "paste the copied image here with Ctrl/Cmd+V, and drag any downloaded screenshots into this box.";
  }
  const params = new URLSearchParams({
    title: (title || "").trim(),
    body,
    labels,
  });
  return `https://github.com/${FEEDBACK_GITHUB_REPO}/issues/new?${params.toString()}`;
}

function buildMailtoUrl({ subject, body }) {
  return (
    `mailto:${FEEDBACK_EMAIL}` +
    `?subject=${encodeURIComponent(subject)}` +
    `&body=${encodeURIComponent(body)}`
  );
}

function readForm() {
  const type = document.getElementById("feedbackType").value || "other";
  const title = document.getElementById("feedbackTitle").value || "";
  const description = document.getElementById("feedbackBody").value || "";
  const includeDiagnostics = !!document.getElementById(
    "feedbackIncludeDiagnostics",
  ).checked;
  return { type, title, description, includeDiagnostics };
}

function isFormValid({ title, description }) {
  return title.trim().length > 0 && description.trim().length > 0;
}

function refreshFormState() {
  const form = readForm();
  const valid = isFormValid(form);

  const githubBtn = document.getElementById("feedbackSubmitGithub");
  const mailtoBtn = document.getElementById("feedbackSubmitMailto");
  if (githubBtn) githubBtn.disabled = !valid;
  if (mailtoBtn) mailtoBtn.disabled = !valid;

  const warning = document.getElementById("feedbackLengthWarning");
  if (warning) {
    const url = buildIssueUrl(form);
    warning.hidden = url.length <= FEEDBACK_URL_LENGTH_WARNING_THRESHOLD;
  }
}

function resetForm() {
  const type = document.getElementById("feedbackType");
  const title = document.getElementById("feedbackTitle");
  const body = document.getElementById("feedbackBody");
  const diag = document.getElementById("feedbackIncludeDiagnostics");
  if (type) type.value = "bug";
  if (title) title.value = "";
  if (body) body.value = "";
  if (diag) diag.checked = true;
  hideMailtoHint();
  clearFeedbackImages();
  hidePreviewImageNote();
  refreshFormState();
}

function getEmailJsConfig() {
  return {
    publicKey: (localStorage.getItem(EMAILJS_PUBLIC_KEY_STORAGE) || "").trim(),
    serviceId: (localStorage.getItem(EMAILJS_SERVICE_ID_STORAGE) || "").trim(),
    templateId: (
      localStorage.getItem(EMAILJS_TEMPLATE_ID_STORAGE) || ""
    ).trim(),
    attachTemplateId: (
      localStorage.getItem(EMAILJS_ATTACH_TEMPLATE_ID_STORAGE) || ""
    ).trim(),
  };
}

function hasEmailJsConfig() {
  const c = getEmailJsConfig();
  return !!(c.publicKey && c.serviceId && c.templateId);
}

function setEmailJsConfig({ publicKey, serviceId, templateId, attachTemplateId }) {
  localStorage.setItem(EMAILJS_PUBLIC_KEY_STORAGE, (publicKey || "").trim());
  localStorage.setItem(EMAILJS_SERVICE_ID_STORAGE, (serviceId || "").trim());
  localStorage.setItem(EMAILJS_TEMPLATE_ID_STORAGE, (templateId || "").trim());
  localStorage.setItem(
    EMAILJS_ATTACH_TEMPLATE_ID_STORAGE,
    (attachTemplateId || "").trim(),
  );
}

function loadEmailJsConfigIntoInputs() {
  const { publicKey, serviceId, templateId, attachTemplateId } =
    getEmailJsConfig();
  const pk = document.getElementById("emailjsPublicKey");
  const sv = document.getElementById("emailjsServiceId");
  const tp = document.getElementById("emailjsTemplateId");
  const at = document.getElementById("emailjsAttachTemplateId");
  if (pk) pk.value = publicKey;
  if (sv) sv.value = serviceId;
  if (tp) tp.value = templateId;
  if (at) at.value = attachTemplateId;
  if (publicKey && serviceId && templateId) {
    setEmailJsStatus("✓ Credentials saved on this browser.", "success");
  } else {
    hideEmailJsStatus();
  }
}

export async function saveEmailJsConfigFromInputs() {
  const publicKey =
    document.getElementById("emailjsPublicKey")?.value.trim() || "";
  const serviceId =
    document.getElementById("emailjsServiceId")?.value.trim() || "";
  const templateId =
    document.getElementById("emailjsTemplateId")?.value.trim() || "";
  const attachTemplateId =
    document.getElementById("emailjsAttachTemplateId")?.value.trim() || "";
  setEmailJsConfig({ publicKey, serviceId, templateId, attachTemplateId });

  appendLogEntry({
    level: "info",
    component: FEEDBACK_LOG_COMPONENT,
    operation: "emailjs-config-save",
    message: "EmailJS credentials saved to localStorage.",
    context: {
      hasPublicKey: !!publicKey,
      hasServiceId: !!serviceId,
      hasTemplateId: !!templateId,
      hasAttachTemplateId: !!attachTemplateId,
    },
  });

  if (!publicKey || !serviceId || !templateId) {
    setEmailJsStatus(
      "Cleared — emails will use mailto fallback.",
      "neutral",
    );
    return;
  }

  setEmailJsStatus("Validating credentials…", "neutral");
  setSaveButtonDisabled(true);
  appendLogEntry({
    level: "info",
    component: FEEDBACK_LOG_COMPONENT,
    operation: "emailjs-validate",
    message: "Sending EmailJS validation test email.",
    context: { serviceId, templateId },
  });
  try {
    await validateEmailJsCredentials();
    setEmailJsStatus(
      "✓ Saved and validated — a test email was sent.",
      "success",
    );
    appendLogEntry({
      level: "info",
      component: FEEDBACK_LOG_COMPONENT,
      operation: "emailjs-validate-ok",
      message: "EmailJS credentials validated successfully.",
    });
  } catch (err) {
    setEmailJsStatus("✗ Validation failed.", "error");
    appendLogEntry({
      level: "warn",
      component: FEEDBACK_LOG_COMPONENT,
      operation: "emailjs-validate-fail",
      message: "EmailJS credentials validation failed.",
      error: err,
      context: {
        status: err && err.status ? err.status : null,
        body: err && err.body ? err.body : null,
      },
    });
  } finally {
    setSaveButtonDisabled(false);
  }
}

async function validateEmailJsCredentials() {
  await sendViaEmailJS({
    subject: EMAILJS_VALIDATION_SUBJECT,
    body: EMAILJS_VALIDATION_BODY,
  });
}

function setEmailJsStatus(message, level) {
  const el = document.getElementById("emailjsSaveStatus");
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  el.classList.remove("is-success", "is-error");
  if (level === "success") el.classList.add("is-success");
  else if (level === "error") el.classList.add("is-error");
}

function hideEmailJsStatus() {
  const el = document.getElementById("emailjsSaveStatus");
  if (!el) return;
  el.hidden = true;
  el.classList.remove("is-success", "is-error");
}

function setSaveButtonDisabled(disabled) {
  const btn = document.getElementById("emailjsSave");
  if (btn) btn.disabled = !!disabled;
}

async function sendViaEmailJS({ subject, body, attachment }) {
  const { publicKey, serviceId, templateId, attachTemplateId } =
    getEmailJsConfig();
  // Attachments only ride the dedicated attachments template (one Variable
  // Attachment: content=`content`, filename=`{{filename}}`). Text-only feedback
  // keeps using the plain template so it never hits an empty-attachment 422.
  const useAttachment = !!(attachment && attachment.dataUrl && attachTemplateId);
  const templateParams = {
    subject,
    message: body,
    to_email: FEEDBACK_EMAIL,
  };
  if (useAttachment) {
    templateParams.content = attachment.dataUrl;
    templateParams.filename = attachment.filename;
  }
  const resp = await fetch(EMAILJS_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      service_id: serviceId,
      template_id: useAttachment ? attachTemplateId : templateId,
      user_id: publicKey,
      template_params: templateParams,
    }),
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    const err = new Error(
      `EmailJS ${resp.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
    );
    err.status = resp.status;
    err.body = detail.slice(0, 500);
    throw err;
  }
}

function fallbackToMailto({ subject, body }) {
  const url = buildMailtoUrl({ subject, body });
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.rel = "noopener noreferrer";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  showMailtoHint();
  if (feedbackImages.length) {
    // mailto can't carry attachments, so hand the user the files and, since the
    // form view is hidden behind the preview, say so where they can see it.
    downloadFeedbackImages();
    showMailtoImageHint(feedbackImages.length);
    setPreviewImageNote(
      `Opened your mail client and downloaded ${feedbackImages.length} screenshot` +
        `${feedbackImages.length > 1 ? "s" : ""} — attach ` +
        `${feedbackImages.length > 1 ? "them" : "it"} in your mail client before sending.`,
      "warn",
    );
  }
  appendLogEntry({
    level: "info",
    component: FEEDBACK_LOG_COMPONENT,
    operation: "mailto-fallback",
    message: "Mailto anchor fired (no EmailJS config).",
    context: { imageCount: feedbackImages.length },
  });
}

async function polishWithGemini({ type, title, description }) {
  const apiKey = getApiKeyForSummary();
  if (!apiKey) return null;
  appendLogEntry({
    level: "info",
    component: FEEDBACK_LOG_COMPONENT,
    operation: "gemini-polish",
    message: "Requesting Gemini polish for feedback.",
    context: { model: GEMINI_POLISH_MODEL },
  });
  const typeLabel = FEEDBACK_TYPE_LABELS[type] || "Feedback";
  const prompt = [
    "You polish raw user feedback for a habit-tracker app into a clean, professional email to the maintainer.",
    'Return STRICT JSON only — no prose, no markdown fences, no preamble. Exactly this schema:',
    '{"subject": "<concise subject line, max 90 chars>", "body": "<polished plain-text email body, 2-5 short paragraphs, no markdown>"}',
    "Keep the user's intent and any technical details. Do not invent facts. Do not include code fences.",
    "",
    `Feedback type: ${typeLabel}`,
    `User title: ${(title || "").trim()}`,
    `User description: ${(description || "").trim()}`,
  ].join("\n");

  const raw = await callGeminiGenerateText({
    apiKey,
    model: GEMINI_POLISH_MODEL,
    prompt,
  });
  const cleaned = String(raw || "")
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  if (!cleaned) {
    throw new Error("Gemini returned an empty response.");
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (_) {
    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first === -1 || last <= first) {
      throw new Error("Gemini did not return valid JSON.");
    }
    parsed = JSON.parse(cleaned.slice(first, last + 1));
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Gemini did not return a JSON object.");
  }
  const subject = String(parsed.subject || "").trim();
  const body = String(parsed.body || "").trim();
  if (!subject || !body) {
    throw new Error("Gemini returned an empty subject or body.");
  }
  appendLogEntry({
    level: "info",
    component: FEEDBACK_LOG_COMPONENT,
    operation: "gemini-polish-ok",
    message: "Gemini polish succeeded.",
  });
  return { subject, body };
}

function setView(view) {
  const formView = document.getElementById("feedbackFormView");
  const previewView = document.getElementById("feedbackPreviewView");
  const loadingView = document.getElementById("feedbackLoadingView");
  const errorView = document.getElementById("feedbackErrorView");
  const formFooter = document.getElementById("feedbackFormFooter");
  const previewFooter = document.getElementById("feedbackPreviewFooter");
  const errorFooter = document.getElementById("feedbackErrorFooter");

  if (formView) formView.hidden = view !== "form";
  if (previewView) previewView.hidden = view !== "preview";
  if (loadingView) loadingView.hidden = view !== "loading";
  if (errorView) errorView.hidden = view !== "error";

  if (formFooter) formFooter.hidden = view !== "form";
  if (previewFooter) previewFooter.hidden = view !== "preview";
  if (errorFooter) errorFooter.hidden = view !== "error";

  const overlay = document.getElementById("settingsModal");
  if (overlay) {
    overlay.classList.toggle("is-feedback-expanded", view !== "form");
  }
}

function enterFormState() {
  setView("form");
  hidePreviewSendError();
  hidePreviewSuccess();
  hideGithubImageHint();
  hideMailtoImageHint();
  loadEmailJsConfigIntoInputs();
}

function enterLoadingState() {
  setView("loading");
}

function enterPreviewState({ subject, body, aiPolished }) {
  const subjectEl = document.getElementById("feedbackPreviewSubject");
  const bodyEl = document.getElementById("feedbackPreviewBody");
  const aiNote = document.getElementById("feedbackPreviewAiNote");
  if (subjectEl) subjectEl.value = subject || "";
  if (bodyEl) bodyEl.value = body || "";
  if (aiNote) aiNote.hidden = !aiPolished;
  hidePreviewSendError();
  hidePreviewSuccess();
  refreshPreviewImageNote();
  setView("preview");
}

function enterErrorState(message) {
  const messageEl = document.getElementById("feedbackErrorMessage");
  if (messageEl) messageEl.textContent = message || "Unknown error";
  setView("error");
}

function showPreviewSendError(message) {
  const el = document.getElementById("feedbackPreviewSendError");
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
}

function hidePreviewSendError() {
  const el = document.getElementById("feedbackPreviewSendError");
  if (el) el.hidden = true;
}

function showPreviewSuccess() {
  const el = document.getElementById("feedbackPreviewSuccess");
  if (el) el.hidden = false;
}

function hidePreviewSuccess() {
  const el = document.getElementById("feedbackPreviewSuccess");
  if (el) el.hidden = true;
}

export function openFeedbackPanel() {
  resetForm();
  enterFormState();
  openModal("settingsModal");
}

export function bindFeedbackForm() {
  const inputs = [
    "feedbackType",
    "feedbackTitle",
    "feedbackBody",
    "feedbackIncludeDiagnostics",
  ];
  for (const id of inputs) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener("input", refreshFormState);
    el.addEventListener("change", refreshFormState);
  }
  loadEmailJsConfigIntoInputs();
  renderFeedbackImages();
  refreshFormState();
}

export async function submitFeedbackToGithub() {
  const form = readForm();
  if (!isFormValid(form)) return;
  const imageCount = feedbackImages.length;
  const url = buildIssueUrl({ ...form, imageCount });
  appendLogEntry({
    level: "info",
    component: FEEDBACK_LOG_COMPONENT,
    operation: "github-submit",
    message: "Opening GitHub issue URL in new tab.",
    context: { urlLength: url.length, type: form.type, imageCount },
  });
  // Open synchronously inside the click gesture so popup blockers don't fire.
  window.open(url, "_blank", "noopener,noreferrer");
  if (imageCount) {
    const copied = await copyFirstImageToClipboard();
    downloadFeedbackImages();
    showGithubImageHint(copied, imageCount);
    // Keep the modal open so the hint is visible when the user returns.
  } else {
    closeModal("settingsModal");
  }
}

export async function submitFeedbackToMail() {
  const form = readForm();
  if (!isFormValid(form)) return;
  lastFormSnapshot = form;

  const hasGemini = !!getApiKeyForSummary();
  if (!hasGemini) {
    enterPreviewState({
      subject: defaultSubject(form),
      body: formatBody(form),
      aiPolished: false,
    });
    return;
  }

  enterLoadingState();
  try {
    const polished = await polishWithGemini(form);
    enterPreviewState({
      subject: polished.subject,
      body: polished.body,
      aiPolished: true,
    });
  } catch (err) {
    appendLogEntry({
      level: "warn",
      component: FEEDBACK_LOG_COMPONENT,
      operation: "gemini-polish-fail",
      message: "Gemini polish failed.",
      error: err,
    });
    enterErrorState(err && err.message ? err.message : String(err));
  }
}

export async function sendFromPreview() {
  const subject = (
    document.getElementById("feedbackPreviewSubject")?.value || ""
  ).trim();
  const body = (
    document.getElementById("feedbackPreviewBody")?.value || ""
  ).trim();
  if (!subject || !body) {
    showPreviewSendError("Subject and body cannot be empty.");
    return;
  }
  hidePreviewSendError();

  if (hasEmailJsConfig()) {
    const btn = document.getElementById("feedbackPreviewSend");
    if (btn) btn.disabled = true;
    try {
      let attachment = null;
      const { attachTemplateId } = getEmailJsConfig();
      if (feedbackImages.length && attachTemplateId) {
        attachment = await buildEmailAttachment();
        if (attachment && attachment.overBudget) {
          appendLogEntry({
            level: "warn",
            component: FEEDBACK_LOG_COMPONENT,
            operation: "emailjs-attach-oversize",
            message:
              "Screenshot attachment stayed above the size budget after compression; sending anyway.",
            context: { bytes: decodedByteLength(attachment.dataUrl) },
          });
        }
      }
      appendLogEntry({
        level: "info",
        component: FEEDBACK_LOG_COMPONENT,
        operation: "emailjs-send",
        message: "Submitting feedback via EmailJS.",
        context: {
          subject,
          hasAttachment: !!attachment,
          imageCount: feedbackImages.length,
        },
      });
      await sendViaEmailJS({ subject, body, attachment });
      showPreviewSuccess();
      appendLogEntry({
        level: "info",
        component: FEEDBACK_LOG_COMPONENT,
        operation: "emailjs-send-ok",
        message: "Feedback delivered via EmailJS.",
      });
      setTimeout(() => closeModal("settingsModal"), 1200);
    } catch (err) {
      showPreviewSendError(
        err && err.message
          ? `Send failed: ${err.message}`
          : "Send failed: unknown error",
      );
      appendLogEntry({
        level: "error",
        component: FEEDBACK_LOG_COMPONENT,
        operation: "emailjs-send-fail",
        message: "EmailJS send failed at preview step.",
        error: err,
        context: {
          status: err && err.status ? err.status : null,
          body: err && err.body ? err.body : null,
        },
      });
    } finally {
      if (btn) btn.disabled = false;
    }
  } else {
    fallbackToMailto({ subject, body });
  }
}

export function previewBackToForm() {
  enterFormState();
}

export async function retryAiPolish() {
  if (!lastFormSnapshot) {
    enterFormState();
    return;
  }
  enterLoadingState();
  try {
    const polished = await polishWithGemini(lastFormSnapshot);
    enterPreviewState({
      subject: polished.subject,
      body: polished.body,
      aiPolished: true,
    });
  } catch (err) {
    appendLogEntry({
      level: "warn",
      component: FEEDBACK_LOG_COMPONENT,
      operation: "gemini-polish-fail",
      message: "Gemini polish retry failed.",
      error: err,
    });
    enterErrorState(err && err.message ? err.message : String(err));
  }
}

export function sendRawWithoutAi() {
  const form = lastFormSnapshot || readForm();
  enterPreviewState({
    subject: defaultSubject(form),
    body: formatBody(form),
    aiPolished: false,
  });
}

export function errorBackToForm() {
  enterFormState();
}

function showMailtoHint() {
  const hint = document.getElementById("feedbackMailtoHint");
  if (!hint) return;
  hint.hidden = false;
}

function hideMailtoHint() {
  const hint = document.getElementById("feedbackMailtoHint");
  if (!hint) return;
  hint.hidden = true;
}
