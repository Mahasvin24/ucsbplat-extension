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
} from "./injected.js";

const GOLD_ORIGIN = "https://my.sa.ucsb.edu/gold/";
const SCHEDULE_URL = `${GOLD_ORIGIN}StudentSchedule.aspx`;
const PROGRESS_URL = `${GOLD_ORIGIN}AcademicProgress.aspx`;
const SIGNED_OUT_MESSAGE = "Couldn't reach GOLD. Sign in at my.sa.ucsb.edu/gold and try again.";

let running = false;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "START_SCRAPE") return;
  if (running) {
    sendResponse({ started: false });
    return;
  }
  running = true;
  runScrape().finally(() => {
    running = false;
  });
  sendResponse({ started: true });
});

async function runScrape() {
  let tabId = null;
  try {
    await setRun({
      status: "running",
      step: "Opening GOLD…",
      message: "",
      startedAt: Date.now(),
      finishedAt: null,
    });

    const tab = await chrome.tabs.create({ url: SCHEDULE_URL, active: false });
    tabId = tab.id;
    await waitForDocument(tabId, "", "GOLD's schedule page didn't load in time.");

    await setRun({ step: "Capturing your schedule…" });
    const scheduleHtml = await inject(tabId, capturePage);

    await setRun({ step: "Opening the major progress check…" });
    await navigate(tabId, PROGRESS_URL);

    await setRun({ step: "Preparing the progress check…" });
    await dismissGate(tabId);
    const checkbox = await inject(tabId, ensureInProgressChecked);
    if (!checkbox.found) {
      throw new Error("Couldn't find the in-progress courses checkbox. GOLD's page may have changed.");
    }

    await setRun({ step: "Running the progress check…" });
    const token = newToken();
    await inject(tabId, markDocument, [token]);
    const runButton = await inject(tabId, clickRunAudit);
    if (!runButton.found) {
      throw new Error("Couldn't find the “Run This Progress Check” button. GOLD's page may have changed.");
    }
    await waitForDocument(tabId, token, "The progress check didn't finish in time.", 90_000);

    await setRun({ step: "Waiting for results…" });
    await waitForResults(tabId);

    await setRun({ step: "Expanding all requirements…" });
    await inject(tabId, clickExpandAll);
    await waitForDomSettle(tabId);

    await setRun({ step: "Capturing the progress check…" });
    const progressHtml = await inject(tabId, capturePage);

    const capturedAt = Date.now();
    await chrome.storage.local.set({
      scheduleHtml,
      progressHtml,
      lastGood: {
        capturedAt,
        scheduleChars: scheduleHtml.length,
        progressChars: progressHtml.length,
      },
    });
    await postToUcsbplat({ scheduleHtml, progressHtml, capturedAt });
    await setRun({ status: "success", step: "", message: "", finishedAt: capturedAt });
  } catch (error) {
    await setRun({
      status: "error",
      message: error?.message ?? String(error),
      finishedAt: Date.now(),
    });
  } finally {
    if (tabId !== null) await chrome.tabs.remove(tabId).catch(() => {});
  }
}

// The UCSBPlat ingest endpoint doesn't exist yet, so the captured HTML only
// gets stored locally for now.
async function postToUcsbplat(payload) {
  console.debug("UCSBPlat payload ready (not sent)", {
    capturedAt: payload.capturedAt,
    scheduleChars: payload.scheduleHtml.length,
    progressChars: payload.progressHtml.length,
  });
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
  throw new Error("The progress check results never appeared.");
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
  if (!tab.url?.startsWith(GOLD_ORIGIN)) throw new Error(SIGNED_OUT_MESSAGE);
}

async function inject(tabId, func, args = []) {
  const [frame] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return frame?.result;
}

async function setRun(patch) {
  const { lastRun = {} } = await chrome.storage.local.get("lastRun");
  await chrome.storage.local.set({ lastRun: { ...lastRun, ...patch } });
}

function newToken() {
  return crypto.randomUUID();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
