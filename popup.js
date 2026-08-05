import { UCSBPLAT_ORIGIN } from "./config.js";

const STALE_RUN_MS = 3 * 60 * 1000;

const els = {
  lastUpdate: document.getElementById("lastUpdate"),
  summary: document.getElementById("summary"),
  status: document.getElementById("status"),
  warnings: document.getElementById("warnings"),
  confirm: document.getElementById("confirm"),
  confirmMessage: document.getElementById("confirmMessage"),
  confirmYes: document.getElementById("confirmYes"),
  confirmNo: document.getElementById("confirmNo"),
  run: document.getElementById("run"),
  signin: document.getElementById("signin"),
  remindToUpdate: document.getElementById("remindToUpdate"),
};

els.run.addEventListener("click", async () => {
  els.run.disabled = true;
  const response = await chrome.runtime.sendMessage({ type: "START_SYNC" });
  if (!response?.started) els.status.textContent = "An update is already running.";
});

els.signin.addEventListener("click", () => chrome.tabs.create({ url: UCSBPLAT_ORIGIN }));
els.confirmYes.addEventListener("click", () => chrome.runtime.sendMessage({ type: "CONFIRM_MAJOR_CHANGE" }));
els.confirmNo.addEventListener("click", () => chrome.runtime.sendMessage({ type: "CANCEL_MAJOR_CHANGE" }));
els.remindToUpdate.addEventListener("change", () => {
  // Clearing the cooldown on the way back on means re-ticking the box takes effect
  // on the next visit, rather than being swallowed by a reminder shown before it
  // was switched off.
  const enabled = els.remindToUpdate.checked;
  chrome.storage.local.set(enabled
    ? { remindToUpdate: true, lastReminderAt: 0 }
    : { remindToUpdate: false });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && ("lastRun" in changes || "lastSync" in changes || "pendingChange" in changes)) render();
});

// Opening the popup answers whatever the badge was asking for.
chrome.action.setBadgeText({ text: "" });
render();

async function render() {
  const { lastRun = {}, lastSync, pendingChange, remindToUpdate } = await chrome.storage.local.get([
    "lastRun",
    "lastSync",
    "pendingChange",
    "remindToUpdate",
  ]);
  const isRunning = lastRun.status === "running" && Date.now() - (lastRun.startedAt ?? 0) < STALE_RUN_MS;

  els.lastUpdate.textContent = lastSync
    ? `Last synced ${relativeTime(lastSync.syncedAt)} · ${formatTime(lastSync.syncedAt)}`
    : "Never synced";
  setText(els.summary, lastSync ? describe(lastSync) : "");

  els.status.classList.toggle("error", lastRun.status === "error" || lastRun.status === "signin");
  if (isRunning) els.status.textContent = lastRun.step ?? "Working…";
  else if (lastRun.status === "running") els.status.textContent = "The last update was interrupted.";
  else if (lastRun.status === "error" || lastRun.status === "signin" || lastRun.status === "cancelled")
    els.status.textContent = lastRun.message ?? "Something went wrong.";
  else if (lastRun.status === "confirm") els.status.textContent = "";
  else if (lastRun.status === "success") els.status.textContent = "Up to date.";
  else els.status.textContent = "";

  const warnings = lastRun.status === "success" ? lastSync?.warnings ?? [] : [];
  els.warnings.replaceChildren(...warnings.map((text) => Object.assign(document.createElement("li"), { textContent: text })));
  els.warnings.hidden = warnings.length === 0;

  els.confirm.hidden = !pendingChange;
  if (pendingChange) {
    const codes = [pendingChange.storedCode, pendingChange.incomingCode].filter(Boolean);
    els.confirmMessage.textContent = codes.length === 2
      ? `${pendingChange.message} (stored ${codes[0]}, this check ${codes[1]})`
      : pendingChange.message;
  }

  els.signin.hidden = lastRun.status !== "signin";
  els.run.disabled = isRunning;
  // On by default: only an explicit opt-out turns the reminder off, matching what
  // background.js checks for.
  els.remindToUpdate.checked = remindToUpdate !== false;
}

function describe(sync) {
  const student = sync.student ?? {};
  const headline = [student.major_title, student.current_quarter ?? sync.quarter].filter(Boolean).join(" · ");
  const counts = Object.entries(sync.counts ?? {}).map(([key, value]) => `${value} ${key.replace(/_/g, " ")}`);
  return [headline, counts.join(", ")].filter(Boolean).join(" — ");
}

function setText(element, text) {
  element.textContent = text;
  element.hidden = !text;
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function relativeTime(timestamp) {
  const units = [
    ["day", 86_400_000],
    ["hour", 3_600_000],
    ["minute", 60_000],
    ["second", 1000],
  ];
  const elapsed = timestamp - Date.now();
  const formatter = new Intl.RelativeTimeFormat([], { numeric: "auto" });
  for (const [unit, ms] of units) {
    if (Math.abs(elapsed) >= ms || unit === "second") {
      return formatter.format(Math.round(elapsed / ms), unit);
    }
  }
}
