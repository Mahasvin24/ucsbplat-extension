// Functions in this file are serialized and injected into GOLD pages by
// chrome.scripting.executeScript, so each one must be fully self-contained.

export function markDocument(token) {
  document.documentElement.dataset.ucsbplatRun = token;
}

export function documentState(token) {
  return {
    ready: document.readyState === "complete",
    marked: document.documentElement.dataset.ucsbplatRun === token,
  };
}

export function scheduleState() {
  const dropdown = document.querySelector("#ctl00_pageContent_quarterDropDown");
  return {
    found: !!dropdown,
    quarter: dropdown?.selectedOptions[0]?.textContent.trim() || null,
  };
}

export function dismissWelcomeLetter() {
  const button = document.querySelector("#pageContent_btnDeanLetterConfirm");
  if (!button || button.offsetParent === null) return { clicked: false };
  button.click();
  return { clicked: true };
}

export function ensureInProgressChecked() {
  const checkbox = document.querySelector("#pageContent_DegreeAuditWipCheckBox");
  if (!checkbox) return { found: false };
  if (!checkbox.checked) checkbox.click();
  return { found: true, checked: checkbox.checked };
}

export function clickRunAudit() {
  const button = document.querySelector("#pageContent_runAuditBtn");
  if (!button) return { found: false };
  button.click();
  return { found: true };
}

export function auditReadyState() {
  const spinner = document.querySelector("#pageContent_processingAuditPanel");
  const gate = document.querySelector("#pageContent_btnDeanLetterConfirm");
  return {
    hasResults: !!document.querySelector("#pageContent_pageContent_DA_GridPlaceHolderRadGrid"),
    running: !!spinner && spinner.offsetParent !== null,
    gated: !!gate && gate.offsetParent !== null,
  };
}

export function clickExpandAll() {
  const button = document.querySelector("#pageContent_DA_ExpandAll");
  if (!button) return { found: false };
  button.click();
  return { found: true };
}

export function domSize() {
  return document.getElementsByTagName("*").length;
}

// The degree audit encodes meaning in its exact column spacing, so the markup
// is never reformatted — only whole elements the parser throws away are cut,
// which drops roughly two thirds of the bytes.
export function capturePage() {
  delete document.documentElement.dataset.ucsbplatRun;
  const clone = document.documentElement.cloneNode(true);
  for (const node of clone.querySelectorAll("style, script, noscript, svg")) node.remove();
  return clone.outerHTML;
}
