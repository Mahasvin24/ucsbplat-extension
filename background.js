import { UCSBPLAT_ORIGIN } from "./config.js";
import {
  auditReadyState,
  capturePage,
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
const PROGRESS_ENDPOINT = `${UCSBPLAT_ORIGIN}/api/extension/progress`;
const UNREACHABLE = `Couldn't reach ${UCSBPLAT_HOST}. Check your connection and try again.`;

const CONFIRM_TTL_MS = 10 * 60 * 1000;

const PROFILE_HOME_URL = `${UCSBPLAT_ORIGIN}/profile/home`;
// How old a sync has to be before visiting the profile is worth interrupting over.
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
// Reloading the page or clicking back and forth should not re-open the popup each
// time. A fresh visit an hour later still will.
const REMINDER_COOLDOWN_MS = 60 * 60 * 1000;

let running = false;

// The captured HTML is the student's whole transcript. It is held here only
// while a major-change confirmation is outstanding, and dropped right after.
let awaitingConfirmation = null;

class AuthError extends Error {}

chrome.runtime.onInstalled.addListener(() => {
  // An earlier build cached the captured transcript in extension storage, and a later
  // one had a debug setting that wrote copies of it to Downloads. Both are gone; the
  // leftover keys are cleared so nothing acts on them.
  chrome.storage.local.remove(["scheduleHtml", "progressHtml", "lastGood", "debugSave"]);
});

// Being on GOLD is not itself a reason to interrupt: a student is usually there to do
// something else, and the extension nagging on every visit is worse than being asked
// for. Syncing from GOLD is a deliberate act now -- the toolbar icon. The profile is
// the one place where the page is *showing* stale data, so that is where we speak up.
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  // The sync's own tab is inactive, so only a tab the student is looking at
  // reaches this.
  if (running || !tab.active) return;
  if (isProfileHomePage(tab.url)) maybeRemindToUpdate();
});

function matchesUrl(url, target) {
  if (!url) return false;
  try {
    const { origin, pathname } = new URL(url);
    return `${origin}${pathname}`.toLowerCase() === target.toLowerCase();
  } catch {
    return false;
  }
}

// Compared the same way, so the ?resume_calendar_sync=1 the calendar flow adds
// still counts as the profile page.
function isProfileHomePage(url) {
  return matchesUrl(url, PROFILE_HOME_URL);
}

// Nudge a student whose profile is showing data a day or more out of date -- the
// page cannot refresh itself, since only the extension can reach GOLD.
async function maybeRemindToUpdate() {
  const {
    lastSync,
    remindToUpdate,
    lastReminderAt = 0,
    lastSyncCheckAt = 0,
  } = await chrome.storage.local.get(["lastSync", "remindToUpdate", "lastReminderAt", "lastSyncCheckAt"]);

  const now = Date.now();
  // Undefined means the student has never touched the setting, and the reminder is
  // the point of the extension -- only an explicit `false` turns it off.
  if (remindToUpdate === false) return;

  // Checked first so a reload costs neither a request nor a prompt.
  if (now - lastReminderAt < REMINDER_COOLDOWN_MS) return;

  let ageMs = lastSync?.syncedAt ? now - lastSync.syncedAt : null;
  if (ageMs === null) {
    // Nothing stored locally. That is not the same as "never synced": extension
    // storage is wiped by a reinstall, and the extension's id -- and with it its
    // storage -- changes when an unpacked build moves. The server is the one that
    // actually knows, so ask it rather than going quiet on a profile that really is
    // months stale. Throttled so a student who has genuinely never synced does not
    // cause a request on every page load.
    if (now - lastSyncCheckAt < REMINDER_COOLDOWN_MS) return;
    await chrome.storage.local.set({ lastSyncCheckAt: now });
    ageMs = await serverSyncAge();
  }

  // Null means we could not establish an age at all -- signed out, or never synced,
  // in which case the page already says so far more clearly than a popup could.
  if (ageMs === null || ageMs < STALE_AFTER_MS) return;

  await offerSync();
  await chrome.storage.local.set({ lastReminderAt: now });
}

// How stale the *server's* copy is, in milliseconds, or null if that can't be known.
// The server sends an age rather than a timestamp precisely so no timezone has to
// survive the trip -- see _synced_seconds_ago in blueprints/extension.py.
async function serverSyncAge() {
  try {
    const response = await fetch(PROGRESS_ENDPOINT, { credentials: "include" });
    // 401 signed out, 404 never synced: neither is a stale profile worth interrupting.
    if (!response.ok) return null;
    const { synced_seconds_ago: seconds } = await response.json();
    // A server that predates this field answers 200 with it missing, which reads as
    // "cannot tell" rather than "fresh" -- so an older server goes quiet, it does not
    // guess.
    return typeof seconds === "number" ? seconds * 1000 : null;
  } catch {
    return null;
  }
}

async function offerSync() {
  try {
    await chrome.action.openPopup();
  } catch {
    // Chrome refuses this unless its window is focused, so fall back to a badge
    // rather than losing the prompt entirely.
    await chrome.action.setBadgeText({ text: "•" });
    await chrome.action.setBadgeBackgroundColor({ color: "#003660" });
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "START_SYNC") {
    if (running) {
      sendResponse({ started: false });
      return;
    }
    start(runSync());
    sendResponse({ started: true });
    return;
  }
  if (message?.type === "CONFIRM_MAJOR_CHANGE") {
    if (!running) start(resendConfirmed());
    sendResponse({ started: true });
    return;
  }
  if (message?.type === "CANCEL_MAJOR_CHANGE") {
    awaitingConfirmation = null;
    chrome.storage.local.remove("pendingChange");
    setRun({ status: "cancelled", step: "", message: "Nothing was changed.", finishedAt: Date.now() });
    sendResponse({ started: true });
  }
});

function start(work) {
  running = true;
  work.finally(() => {
    running = false;
  });
}

async function runSync() {
  let tabId = null;
  try {
    await chrome.storage.local.remove("pendingChange");
    awaitingConfirmation = null;
    await setRun({
      status: "running",
      step: "Checking your UCSBPlat sign-in…",
      message: "",
      startedAt: Date.now(),
      finishedAt: null,
    });
    await requireSignedIn();

    await setRun({ step: "Opening GOLD…" });
    const tab = await chrome.tabs.create({ url: GOLD_SCHEDULE_URL, active: false });
    tabId = tab.id;
    await waitForDocument(tabId, "", "GOLD's schedule page didn't load in time.");
    await assertOnGold(tabId);

    // Either page alone is worth sending, so neither capture aborts the run.
    const warnings = [];
    const schedule = await captureSchedule(tabId, warnings);
    const auditPage = await captureAudit(tabId, warnings);
    if (!schedule.html && !auditPage) {
      throw new Error("Couldn't capture either GOLD page. Try again in a minute.");
    }
    if (schedule.html && !auditPage) {
      warnings.push("Sent your schedule only — UCSBPlat kept the major and requirements it already had.");
    }

    await setRun({ step: "Sending to UCSBPlat…" });
    await submit(
      { schedule_page: schedule.html ?? "", major_progress_check: auditPage ?? "" },
      { quarter: schedule.quarter, warnings },
    );
  } catch (error) {
    await reportFailure(error);
  } finally {
    if (tabId !== null) await chrome.tabs.remove(tabId).catch(() => {});
  }
}

async function captureSchedule(tabId, warnings) {
  try {
    await setRun({ step: "Capturing your schedule…" });
    const state = await inject(tabId, scheduleState);
    if (!state.found) throw new Error("the page didn't look like GOLD's schedule");
    return { html: await inject(tabId, capturePage), quarter: state.quarter };
  } catch (error) {
    warnings.push(`Couldn't capture your schedule (${reason(error)}). UCSBPlat kept your stored enrollment.`);
    return { html: null, quarter: null };
  }
}

async function captureAudit(tabId, warnings) {
  try {
    await setRun({ step: "Opening the major progress check…" });
    await navigate(tabId, GOLD_AUDIT_URL);

    await setRun({ step: "Preparing the progress check…" });
    await dismissGate(tabId);
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
    return await inject(tabId, capturePage);
  } catch (error) {
    warnings.push(`Couldn't run your major progress check (${reason(error)}).`);
    return null;
  }
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
    awaitingConfirmation = null;
    await chrome.storage.local.set({
      lastSync: {
        syncedAt: Date.parse(data.synced_at) || Date.now(),
        quarter: context.quarter,
        student: data.student ?? null,
        counts: data.counts ?? null,
        warnings: [...context.warnings, ...(data.warnings ?? [])],
      },
    });
    await setRun({ status: "success", step: "", message: "", finishedAt: Date.now() });
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
        message: data.message ?? "This progress check is for a different major than the one UCSBPlat has stored.",
        storedCode: data.current_program_code ?? data.stored_program_code ?? null,
        incomingCode: data.incoming_program_code ?? data.new_program_code ?? null,
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
  return fetch(SYNC_ENDPOINT, {
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
  await chrome.storage.local.remove("pendingChange");
  if (!pending || pending.expiresAt < Date.now()) {
    await setRun({
      status: "error",
      message: "That confirmation expired. Run the update again.",
      finishedAt: Date.now(),
    });
    return;
  }
  try {
    await setRun({ status: "running", step: "Sending to UCSBPlat…", message: "", startedAt: Date.now(), finishedAt: null });
    await submit(
      pending.payload,
      { ...pending.context, warnings: [...pending.context.warnings, "Your stored major was replaced with this progress check's."] },
      true,
    );
  } catch (error) {
    await reportFailure(error);
  }
}

async function requireSignedIn() {
  let response;
  try {
    response = await fetch(PROGRESS_ENDPOINT, { credentials: "include" });
  } catch {
    throw new Error(UNREACHABLE);
  }
  // 404 means signed in but never synced, which is fine — only 401 blocks us.
  if (response.status === 401) throw missingSessionError();
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
  await chrome.tabs.update(tabId, { url });
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
    } catch {
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
  const tab = await chrome.tabs.get(tabId);
  if (!tab.url?.startsWith(GOLD_ORIGIN)) throw new Error(GOLD_SIGNED_OUT);
}

async function inject(tabId, func, args = []) {
  const [frame] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return frame?.result;
}

async function setRun(patch) {
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
