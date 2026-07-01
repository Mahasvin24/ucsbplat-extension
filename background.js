const GOLD_URL_PATTERN = "https://my.sa.ucsb.edu/gold/*";
const GOLD_LOGIN_URL = "https://my.sa.ucsb.edu/gold/";

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

async function findOrOpenGoldLogin(major) {
  const existingGoldTab = await findGoldTab();

  if (!existingGoldTab) {
    const newGoldTab = await chrome.tabs.create({
      url: GOLD_LOGIN_URL
    });

    return {
      tab: newGoldTab,
      major,
      isLoggedIn: false,
      needsLogin: true
    };
  }

  const loginStatus = await getGoldLoginStatus(existingGoldTab);

  if (!loginStatus.isLoggedIn) {
    await focusTab(existingGoldTab);
  }

  return {
    tab: existingGoldTab,
    major,
    isLoggedIn: loginStatus.isLoggedIn,
    needsLogin: !loginStatus.isLoggedIn,
    error: loginStatus.error
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "START_GOLD_SCRAPE") {
    return false;
  }

  findOrOpenGoldLogin(message.major).then(sendResponse);
  return true;
});