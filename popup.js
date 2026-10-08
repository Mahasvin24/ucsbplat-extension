import { UCSBPLAT_ORIGIN } from "./config.js";

const els = Object.fromEntries([
  "intro", "websiteAction", "websiteActionTitle", "websiteActionDetail", "status",
  "run", "cancelWebsiteAction", "confirm", "confirmMessage", "confirmYes", "confirmNo", "website",
].map((id) => [id, document.getElementById(id)]));
let preparedAction = null;
let viewRequestId = null;
let revision = 0;

els.website.addEventListener("click", () => chrome.tabs.create({ url: `${UCSBPLAT_ORIGIN}/profile/` }));
async function send(type, extra = {}) {
  try {
    return await chrome.runtime.sendMessage({ type, ...extra });
  } catch {
    els.status.textContent = "Couldn't reach the extension. Reload it, then try again from your UCSBPlat profile.";
    return null;
  }
}
els.run.addEventListener("click", async () => {
  if (!preparedAction) return;
  els.run.disabled = true;
  const response = await send("START_SYNC", { requestId: preparedAction.requestId });
  if (response && !response.started) {
    els.status.textContent = response.message;
    els.run.disabled = false;
  }
  if (!response) els.run.disabled = false;
});
els.cancelWebsiteAction.addEventListener("click", async () => { await send("CANCEL_WEBSITE_ACTION"); render(); });
els.confirmYes.addEventListener("click", async () => {
  els.confirmYes.disabled = true;
  await send("CONFIRM_MAJOR_CHANGE");
  render();
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
  if (state.error) { els.status.textContent = state.error; return; }
  const { lastRun = {}, pendingChange } = state;
  preparedAction = state.pendingWebsiteAction ?? null;
  // A raw toolbar opening has no history screen. Reopening during an active website
  // request resumes that request; finished results belong on the website.
  if (preparedAction) viewRequestId = preparedAction.requestId;
  else if (["running", "confirm"].includes(lastRun.status)) viewRequestId = lastRun.requestId;
  const relevantRun = viewRequestId && lastRun.requestId === viewRequestId ? lastRun : {};
  const popup = preparedAction?.popup ?? relevantRun.popup;
  const confirming = relevantRun.status === "confirm" && pendingChange?.requestId === viewRequestId;
  els.intro.hidden = Boolean(popup);
  els.websiteAction.hidden = !popup;
  els.websiteActionTitle.textContent = popup?.title ?? "";
  els.websiteActionDetail.textContent = popup?.detail ?? "";
  els.run.hidden = !preparedAction;
  els.run.disabled = !preparedAction;
  els.run.textContent = popup?.confirm_label ?? "Continue";
  els.cancelWebsiteAction.hidden = !preparedAction;
  els.confirm.hidden = !confirming;
  els.confirmYes.disabled = false;
  els.confirmMessage.textContent = confirming ? pendingChange.message : "";
  els.status.classList.toggle("error", ["error", "signin"].includes(relevantRun.status));
  els.status.textContent = relevantRun.status === "running" ? popup?.running_message ?? "Working…"
    : confirming ? "" : relevantRun.message ?? "";
}
