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

export function capturePage() {
  delete document.documentElement.dataset.ucsbplatRun;
  return document.documentElement.outerHTML;
}
