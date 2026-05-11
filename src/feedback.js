"use strict";

import {
  APP_VERSION,
  FEEDBACK_GITHUB_REPO,
  FEEDBACK_EMAIL,
  FEEDBACK_URL_LENGTH_WARNING_THRESHOLD,
  EMAILJS_API_URL,
  EMAILJS_PUBLIC_KEY_STORAGE,
  EMAILJS_SERVICE_ID_STORAGE,
  EMAILJS_TEMPLATE_ID_STORAGE,
  GEMINI_POLISH_MODEL,
} from "./constants.js";
import { closeModal, openModal } from "./modals.js";
import { callGeminiGenerateText } from "./ai-summary.js";
import { getApiKeyForSummary } from "./encryption.js";
import { appendLogEntry } from "./logging.js";

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

function buildIssueUrl({ type, title, description, includeDiagnostics }) {
  const labels = FEEDBACK_TYPE_GH_LABELS[type] || "feedback";
  const params = new URLSearchParams({
    title: (title || "").trim(),
    body: formatBody({ description, includeDiagnostics }),
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
  refreshFormState();
}

function getEmailJsConfig() {
  return {
    publicKey: (localStorage.getItem(EMAILJS_PUBLIC_KEY_STORAGE) || "").trim(),
    serviceId: (localStorage.getItem(EMAILJS_SERVICE_ID_STORAGE) || "").trim(),
    templateId: (
      localStorage.getItem(EMAILJS_TEMPLATE_ID_STORAGE) || ""
    ).trim(),
  };
}

function hasEmailJsConfig() {
  const c = getEmailJsConfig();
  return !!(c.publicKey && c.serviceId && c.templateId);
}

function setEmailJsConfig({ publicKey, serviceId, templateId }) {
  localStorage.setItem(EMAILJS_PUBLIC_KEY_STORAGE, (publicKey || "").trim());
  localStorage.setItem(EMAILJS_SERVICE_ID_STORAGE, (serviceId || "").trim());
  localStorage.setItem(EMAILJS_TEMPLATE_ID_STORAGE, (templateId || "").trim());
}

function loadEmailJsConfigIntoInputs() {
  const { publicKey, serviceId, templateId } = getEmailJsConfig();
  const pk = document.getElementById("emailjsPublicKey");
  const sv = document.getElementById("emailjsServiceId");
  const tp = document.getElementById("emailjsTemplateId");
  if (pk) pk.value = publicKey;
  if (sv) sv.value = serviceId;
  if (tp) tp.value = templateId;
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
  setEmailJsConfig({ publicKey, serviceId, templateId });

  appendLogEntry({
    level: "info",
    component: FEEDBACK_LOG_COMPONENT,
    operation: "emailjs-config-save",
    message: "EmailJS credentials saved to localStorage.",
    context: {
      hasPublicKey: !!publicKey,
      hasServiceId: !!serviceId,
      hasTemplateId: !!templateId,
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

async function sendViaEmailJS({ subject, body }) {
  const { publicKey, serviceId, templateId } = getEmailJsConfig();
  const resp = await fetch(EMAILJS_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      service_id: serviceId,
      template_id: templateId,
      user_id: publicKey,
      template_params: {
        subject,
        message: body,
        to_email: FEEDBACK_EMAIL,
      },
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
  appendLogEntry({
    level: "info",
    component: FEEDBACK_LOG_COMPONENT,
    operation: "mailto-fallback",
    message: "Mailto anchor fired (no EmailJS config).",
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
  refreshFormState();
}

export function submitFeedbackToGithub() {
  const form = readForm();
  if (!isFormValid(form)) return;
  const url = buildIssueUrl(form);
  appendLogEntry({
    level: "info",
    component: FEEDBACK_LOG_COMPONENT,
    operation: "github-submit",
    message: "Opening GitHub issue URL in new tab.",
    context: { urlLength: url.length, type: form.type },
  });
  window.open(url, "_blank", "noopener,noreferrer");
  closeModal("settingsModal");
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
    appendLogEntry({
      level: "info",
      component: FEEDBACK_LOG_COMPONENT,
      operation: "emailjs-send",
      message: "Submitting feedback via EmailJS.",
      context: { subject },
    });
    try {
      await sendViaEmailJS({ subject, body });
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
