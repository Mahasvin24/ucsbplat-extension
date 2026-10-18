import { UCSBPLAT_ORIGIN } from "./config.js";

const els = Object.fromEntries([
  "intro", "websiteAction", "websiteActionTitle", "websiteActionDetail", "status", "stateLabel",
  "run", "cancelWebsiteAction", "confirm", "confirmMessage", "confirmYes", "confirmNo", "website",
].map((id) => [id, document.getElementById(id)]));
let preparedAction = null;
let viewRequestId = null;
let revision = 0;
let submitting = false;

const labels = {
  idle: "GOLD sync", prepared: "Ready to sync", starting: "Starting update…",
  running: "Sync in progress", confirm: "Review major change", success: "Update saved",
  partial: "Some data was saved", error: "Update needs attention", signin: "Sign in required",
  cancelled: "Update cancelled", expired: "Confirmation expired",
};

function showStatus(status, message = "") {
  document.body.dataset.state = status;
  els.intro.hidden = status !== "idle";
  els.website.hidden = status !== "idle";
  els.websiteAction.hidden = !["prepared", "starting"].includes(status);
  if (status === "error") {
    preparedAction = null;
    els.run.hidden = true;
    els.cancelWebsiteAction.hidden = true;
    els.confirm.hidden = true;
  }
  els.stateLabel.textContent = labels[status] ?? labels.error;
  els.status.textContent = message;
  els.status.hidden = !message;
}

els.website.addEventListener("click", () => chrome.tabs.create({ url: `${UCSBPLAT_ORIGIN}/profile/` }));
async function send(type, extra = {}) {
  try {
    return await chrome.runtime.sendMessage({ type, ...extra });
  } catch {
    showStatus("error", "Couldn't reach the extension. Reload it, then try again from your UCSBPlat profile.");
    return null;
  }
}
els.run.addEventListener("click", async () => {
  if (!preparedAction || submitting) return;
  submitting = true;
  els.run.disabled = true;
  els.cancelWebsiteAction.disabled = true;
  showStatus("starting");
  const response = await send("START_SYNC", { requestId: preparedAction.requestId });
  submitting = false;
  els.cancelWebsiteAction.disabled = false;
  if (response && !response.started) {
    await render();
    showStatus("error", response.message || "Could not start this update. Try again from your profile.");
  } else if (response) await render();
  if (!response) els.run.disabled = false;
});
els.cancelWebsiteAction.addEventListener("click", async () => {
  els.cancelWebsiteAction.disabled = true;
  const response = await send("CANCEL_WEBSITE_ACTION");
  if (response) await render();
  els.cancelWebsiteAction.disabled = false;
});
els.confirmYes.addEventListener("click", async () => {
  els.confirmYes.disabled = true;
  els.confirmNo.disabled = true;
  const response = await send("CONFIRM_MAJOR_CHANGE");
  if (response) await render();
  els.confirmYes.disabled = false;
  els.confirmNo.disabled = false;
  if (response && !response.started) showStatus("error", "This confirmation is no longer available. Start a new update from your profile.");
});
els.confirmNo.addEventListener("click", async () => { await send("CANCEL_MAJOR_CHANGE"); render(); });
chrome.storage.onChanged.addListener((changes, area) => {
  if ((area === "local" && ("lastRun" in changes || "pendingChange" in changes))
      || (area === "session" && "pendingWebsiteAction" in changes)) render();
});
chrome.action.setBadgeText({ text: "" });
render();

async function render() {
  const currentRevision = ++revision;
  const state = await send("GET_POPUP_STATE");
  if (!state || currentRevision !== revision) return;
  if (state.error) { showStatus("error", state.error); return; }
  const { lastRun = {}, pendingChange } = state;
  preparedAction = state.pendingWebsiteAction ?? null;
  // A raw toolbar opening has no history screen. Reopening during an active website
  // request resumes that request; finished results belong on the website.
  if (state.expiredRequestId) viewRequestId = state.expiredRequestId;
  else if (preparedAction) viewRequestId = preparedAction.requestId;
  else if (["running", "confirm"].includes(lastRun.status)) viewRequestId = lastRun.requestId;
  const relevantRun = viewRequestId && lastRun.requestId === viewRequestId ? lastRun : {};
  const popup = preparedAction?.popup ?? relevantRun.popup;
  const confirming = relevantRun.status === "confirm" && pendingChange?.requestId === viewRequestId;
  els.websiteActionTitle.textContent = popup?.title ?? "";
  els.websiteActionDetail.textContent = popup?.detail ?? "";
  els.run.hidden = !preparedAction;
  els.run.disabled = !preparedAction || submitting;
  els.run.textContent = popup?.confirm_label ?? "Continue";
  els.cancelWebsiteAction.hidden = !preparedAction;
  els.cancelWebsiteAction.disabled = submitting;
  els.confirm.hidden = !confirming;
  els.confirmYes.disabled = false;
  els.confirmNo.disabled = false;
  els.confirmMessage.textContent = confirming ? pendingChange.message : "";
  const status = submitting ? "starting" : preparedAction ? "prepared"
    : confirming ? "confirm" : relevantRun.status || "idle";
  showStatus(status, status === "running" ? popup?.running_message ?? "Working…"
    : status === "prepared" || confirming ? "" : relevantRun.message ?? "");
}
