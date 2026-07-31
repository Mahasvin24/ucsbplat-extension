const STALE_RUN_MS = 3 * 60 * 1000;

const runButton = document.getElementById("run");
const lastUpdateEl = document.getElementById("lastUpdate");
const statusEl = document.getElementById("status");
const downloads = {
  scheduleHtml: document.getElementById("downloadSchedule"),
  progressHtml: document.getElementById("downloadProgress"),
};

runButton.addEventListener("click", async () => {
  runButton.disabled = true;
  const response = await chrome.runtime.sendMessage({ type: "START_SCRAPE" });
  if (!response?.started) statusEl.textContent = "An update is already running.";
});

downloads.scheduleHtml.addEventListener("click", () => download("scheduleHtml", "gold-schedule.txt"));
downloads.progressHtml.addEventListener("click", () => download("progressHtml", "gold-progress-check.txt"));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && ("lastRun" in changes || "lastGood" in changes)) render();
});

render();

async function render() {
  const { lastRun = {}, lastGood } = await chrome.storage.local.get(["lastRun", "lastGood"]);
  const isRunning = lastRun.status === "running" && Date.now() - (lastRun.startedAt ?? 0) < STALE_RUN_MS;

  lastUpdateEl.textContent = lastGood
    ? `Last updated ${relativeTime(lastGood.capturedAt)} · ${formatTime(lastGood.capturedAt)}`
    : "Never updated";

  statusEl.classList.toggle("error", lastRun.status === "error");
  if (isRunning) statusEl.textContent = lastRun.step ?? "Working…";
  else if (lastRun.status === "running") statusEl.textContent = "The last update was interrupted.";
  else if (lastRun.status === "error") statusEl.textContent = lastRun.message ?? "Something went wrong.";
  else if (lastRun.status === "success") statusEl.textContent = "Up to date.";
  else statusEl.textContent = "";

  runButton.disabled = isRunning;
  downloads.scheduleHtml.disabled = !lastGood;
  downloads.progressHtml.disabled = !lastGood;
}

async function download(key, filename) {
  const stored = await chrome.storage.local.get(key);
  const html = stored[key];
  if (!html) return;
  const url = URL.createObjectURL(new Blob([html], { type: "text/plain" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
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
