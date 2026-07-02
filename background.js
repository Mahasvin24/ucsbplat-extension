const GOLD_URL_PATTERN = "https://my.sa.ucsb.edu/gold/*";
const GOLD_SCHEDULE_URL = "https://my.sa.ucsb.edu/gold/StudentSchedule.aspx";
const PENDING_SCRAPE_KEY = "pendingGoldScrape";

async function findGoldTab() {
  const tabs = await chrome.tabs.query({
    url: GOLD_URL_PATTERN
  });

  return tabs[0] ?? null;
}

async function focusTab(tab) {
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
}

async function getGoldLoginStatus(tab) {
  try {
    return await chrome.tabs.sendMessage(tab.id, {
      type: "CHECK_GOLD_LOGIN_STATUS"
    });
  } catch (error) {
    return {
      isLoggedIn: false,
      error: error.message
    };
  }
}

async function savePendingScrape(major) {
  await chrome.storage.local.set({
    [PENDING_SCRAPE_KEY]: {
      major,
      targetUrl: GOLD_SCHEDULE_URL
    }
  });
}

async function clearPendingScrape() {
  await chrome.storage.local.remove(PENDING_SCRAPE_KEY);
}

async function getPendingScrape() {
  const result = await chrome.storage.local.get(PENDING_SCRAPE_KEY);
  return result[PENDING_SCRAPE_KEY] ?? null;
}

async function runGoldScrape(tab, major) {
  await chrome.tabs.sendMessage(tab.id, {
    type: "RUN_GOLD_SCRAPE",
    major
  });

  await clearPendingScrape();

  return {
    isLoggedIn: true,
    needsLogin: false,
    scrapeStarted: true
  };
}

function isScheduleTab(tab) {
  return tab.url?.toLowerCase().startsWith(GOLD_SCHEDULE_URL.toLowerCase());
}

async function navigateToSchedule(tab, major) {
  await savePendingScrape(major);

  await chrome.tabs.update(tab.id, {
    url: GOLD_SCHEDULE_URL
  });

  return {
    isLoggedIn: true,
    needsLogin: false,
    scrapeStarted: false,
    navigationStarted: true
  };
}

async function startGoldScrape(major) {
  const existingGoldTab = await findGoldTab();

  if (!existingGoldTab) {
    await savePendingScrape(major);

    const newGoldTab = await chrome.tabs.create({
      url: GOLD_SCHEDULE_URL
    });

    return {
      tab: newGoldTab,
      major,
      isLoggedIn: false,
      needsLogin: true,
      scrapeStarted: false
    };
  }

  const loginStatus = await getGoldLoginStatus(existingGoldTab);

  if (!loginStatus.isLoggedIn) {
    await savePendingScrape(major);
    await focusTab(existingGoldTab);

    return {
      tab: existingGoldTab,
      major,
      isLoggedIn: false,
      needsLogin: true,
      scrapeStarted: false,
      error: loginStatus.error
    };
  }

  if (!isScheduleTab(existingGoldTab)) {
    return navigateToSchedule(existingGoldTab, major);
  }

  return runGoldScrape(existingGoldTab, major);
}

async function resumePendingGoldScrape(tab) {
  const pendingScrape = await getPendingScrape();

  if (!pendingScrape) {
    return {
      scrapeStarted: false
    };
  }

  if (!isScheduleTab(tab)) {
    return navigateToSchedule(tab, pendingScrape.major);
  }

  return runGoldScrape(tab, pendingScrape.major);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "START_GOLD_SCRAPE") {
    startGoldScrape(message.major).then(sendResponse);
    return true;
  }

  if (message?.type === "GOLD_LOGIN_READY" && sender.tab?.id) {
    resumePendingGoldScrape(sender.tab).then(sendResponse);
    return true;
  }

  return false;
});