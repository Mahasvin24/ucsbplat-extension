import { HOSTED_ORIGIN, LOCAL_ORIGIN, UCSBPLAT_ORIGIN } from "./config.js";
import {
  auditSelectionState,
  auditReadyState,
  capturePage,
  chooseAuditOption,
  clickExpandAll,
  clickRunAudit,
  dismissWelcomeLetter,
  documentState,
  domSize,
  ensureInProgressChecked,
  markDocument,
  scheduleState,
} from "./injected.js";

const GOLD_ORIGIN = "https://my.sa.ucsb.edu/gold/";
const GOLD_SCHEDULE_URL = `${GOLD_ORIGIN}StudentSchedule.aspx`;
const GOLD_AUDIT_URL = `${GOLD_ORIGIN}AcademicProgress.aspx`;
const GOLD_SIGNED_OUT = "Couldn't reach GOLD. Sign in at my.sa.ucsb.edu/gold and try again.";

const UCSBPLAT_HOST = new URL(UCSBPLAT_ORIGIN).hostname;
const SYNC_ENDPOINT = `${UCSBPLAT_ORIGIN}/api/extension/gold-sync`;
const PROGRESS_ENDPOINT = `${UCSBPLAT_ORIGIN}/api/extension/session`;
const UNREACHABLE = `Couldn't reach ${UCSBPLAT_HOST}. Check your connection and try again.`;
const WEBSITE_ORIGINS = new Set([HOSTED_ORIGIN, LOCAL_ORIGIN]);
const EXTERNAL_PROTOCOL_VERSION = 4;
const ACTION_SYNC_ALL = "sync_all";
const ACTION_ADD_MAJOR = "add_major";
const ACTION_REFRESH_MAJOR = "refresh_major";
const WEBSITE_ACTIONS = new Set([ACTION_ADD_MAJOR, ACTION_SYNC_ALL, ACTION_REFRESH_MAJOR]);
let activeRequestId = null;
const WEBSITE_ACTION_KEY = "pendingWebsiteAction";

const CONFIRM_TTL_MS = 10 * 60 * 1000;

let running = false;
let preparing = false;
let automationTabId = null;
let automationTabClosed = false;
let automationController = null;
let recovery = null;

// Captured pages exist only in memory while the website asks for confirmation.
let awaitingConfirmation = null;

class AuthError extends Error {}
class AutomationTabClosedError extends Error {
  constructor() {
    super("The GOLD tab was closed. Start a new update from your UCSBPlat profile.");
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.remove([
    "scheduleHtml", "progressHtml", "lastGood", "debugSave", "lastSync",
    "remindToUpdate", "lastReminderAt", "lastSyncCheckAt",
  ]);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === automationTabId) {
    automationTabClosed = true;
    automationController?.abort();
  }
});

function throwIfTabClosed() {
  if (automationTabClosed) throw new AutomationTabClosedError();
}

async function whileTabOpen(work) {
  const signal = automationController.signal;
  let onClosed;
  try {
    return await Promise.race([work, new Promise((_resolve, reject) => {
      onClosed = () => reject(new AutomationTabClosedError());
      if (signal.aborted) { onClosed(); return; }
      signal.addEventListener("abort", onClosed, { once: true });
    })]);
  } finally {
    signal.removeEventListener("abort", onClosed);
  }
}

function ensureRecovered() {
  recovery ??= recoverInterruptedRun();
  return recovery;
}

async function recoverInterruptedRun() {
  const { lastRun, pendingChange } = await chrome.storage.local.get(["lastRun", "pendingChange"]);
  if (lastRun?.status !== "running" && !pendingChange) return;
  const requestId = pendingChange?.requestId ?? lastRun?.requestId;
  let job;
  try { if (requestId) job = await getWebsiteRequest(requestId); } catch { /* Report interruption below. */ }
  const message = "The extension was interrupted. Start a new update from your UCSBPlat profile.";
  if (requestId && !["success", "partial"].includes(job?.status)) {
    job = await reportWebsiteStatus(requestId, "error", message);
  }
  await chrome.storage.local.remove("pendingChange");
  await setRun({ status: job?.status || "error", requestId,
    message: job?.message || message, step: "", finishedAt: Date.now() });
  const stored = await chrome.storage.session.get("automationTabId");
  await chrome.storage.session.remove("automationTabId");
  if (stored.automationTabId != null) await chrome.tabs.remove(stored.automationTabId).catch(() => {});
}

async function offerSync() {
  try {
    await chrome.action.openPopup();
    return true;
  } catch {
    // Chrome refuses this unless its window is focused, so fall back to a badge
    // rather than losing the prompt entirely.
    try {
      await chrome.action.setBadgeText({ text: "•" });
      await chrome.action.setBadgeBackgroundColor({ color: "#003660" });
    } catch {
      // The website receives opened: false below, so failure to set the secondary
      // indicator must not turn this into an unanswered external message.
    }
    return false;
  }
}

function isAllowedWebsiteSender(sender) {
  try {
    return WEBSITE_ORIGINS.has(new URL(sender.url).origin);
  } catch {
    return false;
  }
}

// Public only to the exact website origins declared in manifest.json. The website may
// prepare one known action and ask Chrome to show the confirmation popup, but it cannot
// bypass that confirmation, start arbitrary work, or read extension storage.
chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  if (!isAllowedWebsiteSender(sender)) return;

  if (message?.type === "UCSBPLAT_EXTENSION_PING") {
    sendResponse({
      ok: true,
      protocolVersion: EXTERNAL_PROTOCOL_VERSION,
      extensionVersion: chrome.runtime.getManifest().version,
    });
    return;
  }

  if (message?.type === "UCSBPLAT_OPEN_POPUP") {
    offerSync().then((opened) => sendResponse({ ok: true, opened }));
    return true;
  }

  if (message?.type === "UCSBPLAT_PREPARE_ACTION") {
    if (!WEBSITE_ACTIONS.has(message.action) || !/^[0-9a-f-]{36}$/.test(message.requestId ?? "")) {
      sendResponse({ ok: false, error: "unsupported_action" });
      return;
    }
    prepareWebsiteAction(message.action, message.requestId)
      .then((opened) => sendResponse({ ok: true, opened }))
      .catch((error) => sendResponse({ ok: false, error: "could_not_prepare", message: reason(error) }));
    return true;
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "GET_POPUP_STATE") {
    (async () => {
      await ensureRecovered();
      const local = await chrome.storage.local.get(["lastRun", "pendingChange"]);
      const stored = await chrome.storage.session.get(WEBSITE_ACTION_KEY);
      let pending = stored[WEBSITE_ACTION_KEY];
      if (pending && Date.now() - pending.requestedAt >= CONFIRM_TTL_MS) {
        await reportWebsiteStatus(pending.requestId, "cancelled", "This confirmation expired. Start a new update from your profile.");
        await chrome.storage.session.remove(WEBSITE_ACTION_KEY);
        pending = null;
      }
      sendResponse({ ...local, pendingWebsiteAction: pending });
    })().catch(() => sendResponse({ error: "Could not check this update. Open your UCSBPlat profile to try again." }));
    return true;
  }
  if (message?.type === "START_SYNC") {
    beginPreparedSync(message.requestId)
      .then(sendResponse)
      .catch(() => sendResponse({ started: false, message: "Could not start this update. Try again from your UCSBPlat profile." }));
    return true;
  }
  if (message?.type === "CANCEL_WEBSITE_ACTION") {
    (async () => {
      const stored = await chrome.storage.session.get(WEBSITE_ACTION_KEY);
      const pending = stored[WEBSITE_ACTION_KEY];
      if (pending?.requestId) await reportWebsiteStatus(pending.requestId, "cancelled", "Update cancelled. Nothing was changed.");
      await chrome.storage.session.remove(WEBSITE_ACTION_KEY);
      sendResponse({ cancelled: true });
    })();
    return true;
  }
  if (message?.type === "CONFIRM_MAJOR_CHANGE") {
    const canConfirm = !running && Boolean(awaitingConfirmation);
    if (canConfirm) start(resendConfirmed());
    sendResponse({ started: canConfirm });
    return;
  }
  if (message?.type === "CANCEL_MAJOR_CHANGE") {
    (async () => {
      const stored = await chrome.storage.local.get("pendingChange");
      const requestId = awaitingConfirmation?.context.requestId ?? stored.pendingChange?.requestId;
      if (requestId) await reportWebsiteStatus(requestId, "cancelled", "Update cancelled. Nothing was changed.");
      awaitingConfirmation = null;
      await chrome.storage.local.remove("pendingChange");
      await setRun({ status: "cancelled", step: "", message: "Nothing was changed.", finishedAt: Date.now() });
      sendResponse({ started: true });
    })();
    return true;
  }
});

function start(work) {
  running = true;
  work.catch(() => {}).finally(() => {
    running = false;
  });
}

async function prepareWebsiteAction(action, requestId) {
  await ensureRecovered();
  if (running || preparing || awaitingConfirmation) throw new Error("An update is already running.");
  preparing = true;
  try {
    const job = await getWebsiteRequest(requestId);
    if (job.action !== action || job.status !== "pending" || !validPopup(job.popup)) {
      throw new Error("This request is no longer available. Reload your UCSBPlat profile.");
    }
    if (running || awaitingConfirmation) throw new Error("An update is already running.");
    const stored = await chrome.storage.session.get(WEBSITE_ACTION_KEY);
    const pending = stored[WEBSITE_ACTION_KEY];
    if (pending && pending.requestId !== requestId && Date.now() - pending.requestedAt < CONFIRM_TTL_MS) {
      throw new Error("Confirm or cancel the update already open in the extension.");
    }
    await chrome.storage.session.set({
      [WEBSITE_ACTION_KEY]: { type: job.action, requestId, requestedAt: Date.now(), popup: job.popup },
    });
    return offerSync();
  } finally {
    preparing = false;
  }
}

function validPopup(popup) {
  return ["title", "detail", "confirm_label", "running_message"].every((key) =>
    typeof popup?.[key] === "string" && popup[key].length > 0 && popup[key].length <= 1000);
}

async function beginPreparedSync(requestId) {
  await ensureRecovered();
  if (running || preparing || awaitingConfirmation) return { started: false, message: "An update is already running." };
  // Reserve the worker before the storage await so two popup clicks cannot start jobs.
  running = true;
  try {
    const stored = await chrome.storage.session.get(WEBSITE_ACTION_KEY);
    const prepared = stored[WEBSITE_ACTION_KEY];
    if (!prepared || prepared.requestId !== requestId || Date.now() - prepared.requestedAt >= CONFIRM_TTL_MS) {
      running = false;
      return { started: false, message: "Choose an action on your UCSBPlat profile first." };
    }
    await chrome.storage.session.remove(WEBSITE_ACTION_KEY);
    start(runSync(prepared.type, prepared.requestId));
    return { started: true };
  } catch (error) {
    running = false;
    throw error;
  }
}

async function runSync(action, requestId) {
  let tabId = null;
  activeRequestId = requestId;
  automationTabClosed = false;
  automationController = new AbortController();
  try {
    if (!requestId || !WEBSITE_ACTIONS.has(action)) throw new Error("Choose an action on your UCSBPlat profile first.");
    await chrome.storage.local.remove("pendingChange");
    awaitingConfirmation = null;
    await setRun({
      status: "running",
      requestId,
      popup: null,
      action,
      step: "Checking your UCSBPlat sign-in…",
      message: "",
      startedAt: Date.now(),
      finishedAt: null,
    });
    const job = await getWebsiteRequest(requestId);
    if (job.action !== action || !["pending", "running"].includes(job.status) || !validPopup(job.popup)) {
      throw new Error("This request is no longer available. Start a new update from your profile.");
    }
    await setRun({ popup: job.popup });
    const profile = await requireSignedIn();
    // Adding a major uses the student's current GOLD choice. Restoring the saved
    // primary selection here would silently re-add the wrong audit.
    const savedSelection = action === ACTION_ADD_MAJOR
      ? null : job?.audit_selection ?? profile?.student?.audit_selection ?? null;

    await setRun({ step: "Opening GOLD…" });
    const firstUrl = action === ACTION_ADD_MAJOR ? GOLD_AUDIT_URL : GOLD_SCHEDULE_URL;
    const tab = await chrome.tabs.create({ url: firstUrl, active: false });
    tabId = tab.id;
    automationTabId = tabId;
    await chrome.storage.session.set({ automationTabId: tabId });
    await waitForDocument(tabId, "", "GOLD didn't load in time.");
    await assertOnGold(tabId);

    const warnings = [];
    const scheduleFirst = action !== ACTION_ADD_MAJOR;
    let schedule = { html: null, quarter: null };
    if (scheduleFirst) schedule = await captureSchedule(tabId, warnings);
    const audit = await captureAudit(
      tabId,
      warnings,
      savedSelection,
      scheduleFirst,
    );
    // Onboarding starts on the audit so GOLD keeps the student's chosen major.
    // After trying it, visit My Schedule as well: the audit has course names
    // but not the units, instructors, rooms, times, or sections shown on Home.
    if (!scheduleFirst) schedule = await captureSchedule(tabId, warnings, true);
    if (action !== ACTION_SYNC_ALL && !audit.html) {
      throw new Error("Couldn't capture that major's progress check. Your saved majors were not changed.");
    }
    if (!schedule.html && !audit.html) {
      throw new Error("Couldn't capture either GOLD page. Try again in a minute.");
    }
    if (schedule.html && !audit.html) {
      warnings.push("Sent your schedule only — UCSBPlat kept the major and requirements it already had.");
    }

    throwIfTabClosed();
    await setRun({ step: "Sending to UCSBPlat…" });
    throwIfTabClosed();
    await submit(
      {
        schedule_page: schedule.html ?? "",
        major_progress_check: audit.html ?? "",
        ...(audit.selection ? { audit_selection: audit.selection } : {}),
        action,
        ...(requestId ? { request_id: requestId } : {}),
      },
      { quarter: schedule.quarter, warnings, action, requestId },
    );
  } catch (error) {
    await reportFailure(error);
  } finally {
    automationTabId = null;
    automationController = null;
    if (tabId !== null) await chrome.tabs.remove(tabId).catch(() => {});
    await chrome.storage.session.remove("automationTabId");
    activeRequestId = null;
  }
}

async function captureSchedule(tabId, warnings, navigateToSchedule = false) {
  try {
    if (navigateToSchedule) {
      await setRun({ step: "Opening your schedule…" });
      await navigate(tabId, GOLD_SCHEDULE_URL);
    }
    await setRun({ step: "Capturing your schedule…" });
    // The Dean's Letter may still be covering the schedule on a first visit.
    // Dismissing it is harmless when the audit already cleared it.
    await dismissGate(tabId);
    const state = await inject(tabId, scheduleState);
    if (!state.found) throw new Error("the page didn't look like GOLD's schedule");
    return { html: await inject(tabId, capturePage), quarter: state.quarter };
  } catch (error) {
    if (error instanceof AutomationTabClosedError) throw error;
    throwIfTabClosed();
    warnings.push(`Couldn't capture your schedule (${reason(error)}). Schedule details weren't updated.`);
    return { html: null, quarter: null };
  }
}

async function captureAudit(tabId, warnings, savedSelection, navigateToAudit = true) {
  try {
    if (navigateToAudit) {
      await setRun({ step: "Opening the major progress check…" });
      await navigate(tabId, GOLD_AUDIT_URL);
    }

    await setRun({ step: "Preparing the progress check…" });
    await dismissGate(tabId);
    if (savedSelection) await restoreAuditSelection(tabId, savedSelection);
    const selection = await readAuditSelection(tabId);
    const checkbox = await inject(tabId, ensureInProgressChecked);
    if (!checkbox.found) {
      throw new Error("the in-progress courses checkbox is missing");
    }

    await setRun({ step: "Running the progress check…" });
    const token = newToken();
    await inject(tabId, markDocument, [token]);
    const runButton = await inject(tabId, clickRunAudit);
    if (!runButton.found) {
      throw new Error("the “Run This Progress Check” button is missing");
    }
    await waitForDocument(tabId, token, "the progress check didn't finish in time", 90_000);

    await setRun({ step: "Waiting for results…" });
    await waitForResults(tabId);

    await setRun({ step: "Expanding all requirements…" });
    await inject(tabId, clickExpandAll);
    await waitForDomSettle(tabId);

    await setRun({ step: "Capturing the progress check…" });
    return { html: await inject(tabId, capturePage), selection };
  } catch (error) {
    if (error instanceof AutomationTabClosedError) throw error;
    throwIfTabClosed();
    warnings.push(`Couldn't run your major progress check (${reason(error)}).`);
    return { html: null, selection: null };
  }
}

async function restoreAuditSelection(tabId, selection) {
  await setRun({ step: "Selecting your saved major area…" });
  await chooseAuditSelection(tabId, "major_area", selection.major_area);
  await setRun({ step: "Selecting your saved major…" });
  await chooseAuditSelection(tabId, "audit", selection.audit);
}

async function chooseAuditSelection(tabId, kind, option) {
  if (!option?.value && !option?.label) {
    throw new Error("UCSBPlat's saved major selection is incomplete");
  }
  const token = newToken();
  await inject(tabId, markDocument, [token]);
  const result = await inject(tabId, chooseAuditOption, [kind, option]);
  if (!result.found) throw new Error("GOLD's major selection list is missing");
  if (!result.matched) throw new Error("your saved major is no longer available in GOLD");
  if (result.changed) {
    await waitForDocument(tabId, token, "GOLD didn't finish changing the major selection.");
    await dismissGate(tabId);
  }
}

async function readAuditSelection(tabId) {
  const selection = await inject(tabId, auditSelectionState);
  if (!selection.found || !selection.majorArea.value || !selection.majorArea.label
      || !selection.audit.value || !selection.audit.label) {
    throw new Error("choose both your major area and major in GOLD first");
  }
  return {
    major_area: { value: selection.majorArea.value, label: selection.majorArea.label },
    audit: { value: selection.audit.value, label: selection.audit.label },
  };
}

// The service worker — not the content script — makes this call so the browser
// sends the extension's own origin, which is what the server allows.
async function submit(payload, context, confirmMajorChange = false) {
  let response;
  try {
    response = await postSync(payload, confirmMajorChange);
    // A 5xx means the pages parsed but the write failed, so one retry is fair.
    if (response.status >= 500) {
      await sleep(2000);
      response = await postSync(payload, confirmMajorChange);
    }
  } catch {
    throw new Error(UNREACHABLE);
  }
  const data = await readJson(response);

  if (response.ok) {
    if (!["success", "partial"].includes(data.status) || !data.synced_at) {
      throw new Error("UCSBPlat did not return a saved result. Check your profile before retrying.");
    }
    awaitingConfirmation = null;
    await setRun({ status: data.status === "partial" ? "partial" : "success", step: "", message: data.message ?? "Update saved.", finishedAt: Date.now() });
    return;
  }

  if (response.status === 401) throw missingSessionError();

  if (response.status === 403) {
    throw new Error(
      `UCSBPlat rejected this extension (id ${chrome.runtime.id}). That id has to be listed in EXTENSION_ID on the server.`,
    );
  }

  // A what-if check for another major looks identical to a real one, so the
  // server refuses to overwrite until the student says that is what they meant.
  if (response.status === 409 && data.error === "program_code_mismatch") {
    awaitingConfirmation = { payload, context, expiresAt: Date.now() + CONFIRM_TTL_MS };
    await chrome.storage.local.set({
      pendingChange: {
        requestId: context.requestId ?? null,
        message: data.message ?? "This progress check is for a different major than the one UCSBPlat has stored.",
      },
    });
    await setRun({ status: "confirm", step: "", message: "", finishedAt: Date.now() });
    return;
  }

  if (response.status === 400) {
    throw new Error(data.message ?? "UCSBPlat couldn't read those GOLD pages. Try running the update again.");
  }
  throw new Error(data.message ?? `UCSBPlat returned ${response.status}.`);
}

function postSync(payload, confirmMajorChange) {
  return websiteFetch(SYNC_ENDPOINT, {
    method: "POST",
    // Without this the session cookie is never attached and every call is a 401.
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(confirmMajorChange ? { ...payload, confirm_major_change: true } : payload),
  });
}

async function resendConfirmed() {
  const pending = awaitingConfirmation;
  awaitingConfirmation = null;
  const stored = await chrome.storage.local.get("pendingChange");
  await chrome.storage.local.remove("pendingChange");
  if (!pending || pending.expiresAt < Date.now()) {
    const requestId = pending?.context.requestId ?? stored.pendingChange?.requestId;
    if (requestId) await reportWebsiteStatus(requestId, "error", "That confirmation expired. Run the update again.");
    await setRun({
      status: "error",
      message: "That confirmation expired. Run the update again.",
      finishedAt: Date.now(),
    });
    return;
  }
  try {
    activeRequestId = pending.context.requestId;
    await setRun({ status: "running", step: "Sending to UCSBPlat…", message: "", startedAt: Date.now(), finishedAt: null });
    await submit(
      pending.payload,
      { ...pending.context, warnings: [...pending.context.warnings, "Your stored major was replaced with this progress check's."] },
      true,
    );
  } catch (error) {
    await reportFailure(error);
  } finally {
    activeRequestId = null;
  }
}

async function requireSignedIn() {
  let response;
  try {
    response = await websiteFetch(PROGRESS_ENDPOINT, { credentials: "include" });
  } catch {
    throw new Error(UNREACHABLE);
  }
  // Only a genuine not-synced response is safe to continue without saved selectors.
  if (response.status === 401) throw missingSessionError();
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`UCSBPlat could not check your saved profile (${response.status}). Try again.`);
  return readJson(response);
}

// One message for every 401. Separating "never signed in" from "signed in, but Chrome
// withheld the cookie" needed a count of the cookies on this host, and reading a
// student's cookies is not worth the permission it costs. Offering the sign-in page
// fixes the first case and does no harm in the second.
function missingSessionError() {
  const error = new AuthError(`Sign in to ${UCSBPLAT_HOST} with Google, then run the update again.`);
  error.openSignIn = true;
  return error;
}

async function reportFailure(error) {
  if (error instanceof AuthError) {
    await setRun({ status: "signin", step: "", message: error.message, finishedAt: Date.now() });
    if (error.openSignIn) await chrome.tabs.create({ url: UCSBPLAT_ORIGIN });
    return;
  }
  await setRun({ status: "error", step: "", message: reason(error), finishedAt: Date.now() });
}

async function readJson(response) {
  try {
    return (await response.json()) ?? {};
  } catch {
    return {};
  }
}

async function navigate(tabId, url) {
  const token = newToken();
  await inject(tabId, markDocument, [token]);
  await whileTabOpen(chrome.tabs.update(tabId, { url }));
  await waitForDocument(tabId, token, `${url} didn't load in time.`);
}

async function dismissGate(tabId) {
  const token = newToken();
  await inject(tabId, markDocument, [token]);
  const gate = await inject(tabId, dismissWelcomeLetter);
  if (!gate.clicked) return;
  await waitForDocument(tabId, token, "GOLD's welcome letter didn't dismiss in time.");
}

// A GOLD postback replaces the document, which drops the marker set before the
// click — so an unmarked, fully loaded document means the new page has arrived.
async function waitForDocument(tabId, token, timeoutMessage, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let erroringSince = null;
  while (Date.now() < deadline) {
    try {
      const state = await inject(tabId, documentState, [token]);
      erroringSince = null;
      if (state.ready && !state.marked) return;
    } catch (error) {
      if (error instanceof AutomationTabClosedError) throw error;
      erroringSince ??= Date.now();
      if (Date.now() - erroringSince > 8_000) await assertOnGold(tabId);
    }
    await sleep(300);
  }
  throw new Error(timeoutMessage);
}

async function waitForResults(tabId) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const state = await inject(tabId, auditReadyState);
    if (state.gated) {
      await dismissGate(tabId);
      continue;
    }
    if (state.hasResults && !state.running) return;
    await sleep(500);
  }
  throw new Error("the results never appeared");
}

async function waitForDomSettle(tabId) {
  const deadline = Date.now() + 5_000;
  let previous = -1;
  while (Date.now() < deadline) {
    const size = await inject(tabId, domSize);
    if (size === previous) return;
    previous = size;
    await sleep(400);
  }
}

async function assertOnGold(tabId) {
  throwIfTabClosed();
  let tab;
  try { tab = await chrome.tabs.get(tabId); } catch { throw new AutomationTabClosedError(); }
  if (!tab.url?.startsWith(GOLD_ORIGIN)) throw new Error(GOLD_SIGNED_OUT);
}

async function inject(tabId, func, args = []) {
  throwIfTabClosed();
  try {
    const [frame] = await whileTabOpen(chrome.scripting.executeScript({ target: { tabId }, func, args }));
    throwIfTabClosed();
    return frame?.result;
  } catch (error) {
    throwIfTabClosed();
    try { await chrome.tabs.get(tabId); } catch { throw new AutomationTabClosedError(); }
    throw error;
  }
}

async function setRun(patch) {
  if (activeRequestId && ["running", "error", "signin", "cancelled"].includes(patch.status)) {
    const job = await reportWebsiteStatus(activeRequestId, patch.status === "signin" ? "error" : patch.status,
      patch.message || patch.step || "Working in GOLD…");
    if (["success", "partial"].includes(job?.status)) {
      patch = { ...patch, status: job.status, message: job.message, step: "", finishedAt: Date.now() };
    }
  }
  const { lastRun = {} } = await chrome.storage.local.get("lastRun");
  await chrome.storage.local.set({ lastRun: { ...lastRun, ...patch } });
}

function reason(error) {
  return error?.message ?? String(error);
}

function newToken() {
  return crypto.randomUUID();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


async function getWebsiteRequest(requestId) {
  const response = await websiteFetch(`${UCSBPLAT_ORIGIN}/api/extension/sync-requests/${requestId}`, { credentials: "include" });
  const job = await readJson(response);
  if (!response.ok) throw new Error(job.message ?? "Could not prepare this website update. Try again.");
  return job;
}

async function reportWebsiteStatus(requestId, status, message) {
  try {
    const response = await websiteFetch(`${UCSBPLAT_ORIGIN}/api/extension/sync-requests/${requestId}`, {
      method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, message }),
    }, 5000);
    return response.ok ? readJson(response) : null;
  } catch {
    // Popup still reports the local failure; website requests also expire after 15 minutes.
  }
}

// Bound website calls so a disconnected request cannot hold the worker's run lock forever.
async function websiteFetch(url, options = {}, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    // Consume the response within the timeout as well; a stalled body is still a stall.
    const data = await readJson(response);
    return { ok: response.ok, status: response.status, json: async () => data };
  } finally {
    clearTimeout(timeout);
  }
}
