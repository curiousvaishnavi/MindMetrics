"use strict";

/* ---------- Configuration ---------- */
// Existing FastAPI endpoint (POST). Do not change field names below:
// they must match the Pydantic StudentData model exactly.
const API_URL = "https://mindmetrics-mjm5.onrender.com/predict";

const RING_CIRCUMFERENCE = 2 * Math.PI * 52; // matches r="52" in index.html
const RING_SCALE_MAX = 100; // display-only scale; not a verified model range

/* Validation rules mirror the backend schema. */
const FIELDS = {
  age:                     { type: "int",   min: 10, max: 100, label: "Age" },
  gender:                  { type: "enum",  options: ["Male", "Female"], label: "Gender" },
  country:                 { type: "text",  label: "Country" },
  academic_level:          { type: "enum",  options: ["Undergraduate", "Graduate", "High School"], label: "Academic level" },
  most_used_platform:      { type: "enum",  options: ["Facebook", "LinkedIn", "Instagram", "Snapchat", "Twitter", "YouTube", "TikTok", "LINE", "KakaoTalk", "VKontakte", "WhatsApp", "WeChat"], label: "Most-used platform" },
  purpose_of_use:          { type: "enum",  options: ["Networking", "Education", "Entertainment", "News"], label: "Purpose of use" },
  avg_daily_usage_hours:   { type: "float", min: 0, max: 24, label: "Daily usage" },
  daily_unlocks:           { type: "int",   min: 0, label: "Daily unlocks" },
  study_hours:             { type: "float", min: 0, max: 24, label: "Study hours" },
  physical_activity_hours: { type: "float", min: 0, max: 2,  label: "Physical activity" },
  sleep_hours_per_night:   { type: "float", min: 0, max: 24, label: "Sleep hours" },
  stress_level:            { type: "enum",  options: ["Low", "Medium", "High", "Very High"], label: "Stress level" },
};

/* ---------- Elements ---------- */
const $ = (id) => document.getElementById(id);
const form = $("form");
const submitBtn = $("submitBtn");
const submitLabel = $("submitLabel");
const alertBox = $("alert");
const alertMsg = $("alertMsg");
const retryBtn = $("retryBtn");
const resultSection = $("result");
const ringFg = $("ringFg");

let lastPayload = null;

/* ---------- Navigation ---------- */
const navToggle = $("navToggle");
const navLinks = $("navLinks");
navToggle.addEventListener("click", () => {
  const open = navLinks.classList.toggle("open");
  navToggle.setAttribute("aria-expanded", String(open));
});
navLinks.addEventListener("click", (e) => {
  if (e.target.tagName === "A") {
    navLinks.classList.remove("open");
    navToggle.setAttribute("aria-expanded", "false");
  }
});

/* ---------- Validation ---------- */
function setFieldError(name, message) {
  const el = $(name);
  const err = $(`${name}-err`);
  err.textContent = message || "";
  el.closest(".field").classList.toggle("invalid", Boolean(message));
  if (message) el.setAttribute("aria-describedby", `${name}-hint ${name}-err`);
  el.setAttribute("aria-invalid", message ? "true" : "false");
}

// Returns { values, errors } where values holds correctly typed data.
function validate() {
  const values = {};
  const errors = {};

  for (const [name, rule] of Object.entries(FIELDS)) {
    const raw = form.elements[name].value.trim();

    if (raw === "") { errors[name] = `${rule.label} is required.`; continue; }

    if (rule.type === "text") {
      values[name] = raw;
    } else if (rule.type === "enum") {
      if (!rule.options.includes(raw)) errors[name] = `Choose one of the listed options.`;
      else values[name] = raw;
    } else {
      const num = Number(raw);
      if (!Number.isFinite(num)) errors[name] = "Enter a valid number.";
      else if (rule.type === "int" && !Number.isInteger(num)) errors[name] = "Enter a whole number.";
      else if (rule.min !== undefined && num < rule.min) errors[name] = `Must be at least ${rule.min}.`;
      else if (rule.max !== undefined && num > rule.max) errors[name] = `Must be at most ${rule.max}.`;
      else values[name] = num;
    }
  }

  Object.keys(FIELDS).forEach((name) => setFieldError(name, errors[name]));
  return { values, errors };
}

// Clear a field's error as soon as the user edits it.
form.addEventListener("input", (e) => {
  if (e.target.name in FIELDS) setFieldError(e.target.name, "");
});

/* ---------- UI helpers ---------- */
function setLoading(isLoading) {
  submitBtn.disabled = isLoading;
  retryBtn.disabled = isLoading;
  submitBtn.classList.toggle("loading", isLoading);
  submitLabel.textContent = isLoading ? "Calculating…" : "Get my estimate";
}

function showError(message, canRetry) {
  alertMsg.textContent = message;
  retryBtn.hidden = !canRetry;
  alertBox.hidden = false;
  alertBox.scrollIntoView({ behavior: "smooth", block: "center" });
}

function hideError() { alertBox.hidden = true; }

function hideResult() {
  resultSection.hidden = true;
  ringFg.style.strokeDashoffset = RING_CIRCUMFERENCE;
}

// Show the real score returned by the API; never clamp or alter the number.
function showResult(score) {
  $("scoreValue").textContent = String(score);
  $("scoreText").textContent = String(score);
  $("rangeNote").hidden = score >= 0 && score <= RING_SCALE_MAX;

  resultSection.hidden = false;
  ringFg.style.strokeDashoffset = RING_CIRCUMFERENCE;
  resultSection.scrollIntoView({ behavior: "smooth", block: "start" });

  // Ring fill is clamped for drawing only; the displayed number is untouched.
  const fraction = Math.min(Math.max(score / RING_SCALE_MAX, 0), 1);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    ringFg.style.strokeDashoffset = RING_CIRCUMFERENCE * (1 - fraction);
  }));
}

// Turn FastAPI 422 detail arrays into readable text and field errors.
function handleValidationResponse(body) {
  const detail = Array.isArray(body && body.detail) ? body.detail : [];
  const lines = [];
  detail.forEach((d) => {
    const field = Array.isArray(d.loc) ? d.loc[d.loc.length - 1] : "";
    lines.push(`${field}: ${d.msg}`);
    if (field in FIELDS) setFieldError(field, d.msg);
  });
  return lines.length
    ? `The server rejected some values. ${lines.join("; ")}`
    : "The server rejected the submitted values (HTTP 422).";
}

/* ---------- API integration ---------- */
async function requestPrediction(payload) {
  hideError();
  hideResult();
  setLoading(true);

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    let body = null;
    try { body = await response.json(); } catch { /* non-JSON body handled below */ }

    if (response.status === 422) {
      showError(handleValidationResponse(body), false);
      return;
    }
    if (!response.ok) {
      showError(`The server returned an error (HTTP ${response.status}). Check the uvicorn terminal for details.`, true);
      return;
    }

    const score = body && body.predicted_mental_health_score;
    if (typeof score !== "number" || !Number.isFinite(score)) {
      showError("The server responded, but the result was not in the expected format. No score is shown.", true);
      return;
    }

    showResult(score);
  } catch (err) {
    // fetch() rejects on network failure, server down, or a CORS block.
    showError(
      `Could not reach the prediction server at ${API_URL}. Make sure FastAPI is running on port 8000. If it is running, open DevTools (F12) > Console to check for a CORS error.`,
      true
    );
    console.error("Prediction request failed:", err);
  } finally {
    setLoading(false);
  }
}

/* ---------- Events ---------- */
form.addEventListener("submit", (e) => {
  e.preventDefault();
  const { values, errors } = validate();
  const firstInvalid = Object.keys(errors)[0];
  if (firstInvalid) {
    $(firstInvalid).focus();
    return;
  }
  // Keys are the exact lowercase backend field names.
  lastPayload = values;
  requestPrediction(lastPayload);
});

retryBtn.addEventListener("click", () => { if (lastPayload) requestPrediction(lastPayload); });

function resetAssessment() {
  form.reset();
  Object.keys(FIELDS).forEach((name) => setFieldError(name, ""));
  hideError();
  hideResult();
  lastPayload = null;
}

$("resetBtn").addEventListener("click", resetAssessment);
$("againBtn").addEventListener("click", () => {
  resetAssessment();
  $("assessment").scrollIntoView({ behavior: "smooth" });
  $("age").focus({ preventScroll: true });
});
