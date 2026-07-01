function isGoldUserLoggedIn() {
  const hasLoginForm = Boolean(
    document.querySelector('input[type="password"], input[name*="password" i]')
  );
  const hasLogoutLink = Boolean(
    document.querySelector('a[href*="logout" i], a[id*="logout" i]')
  );

  return hasLogoutLink && !hasLoginForm;
}

async function runGoldScrape(major) {
  const schedule =
    typeof scrapeSchedule === "function" ? await scrapeSchedule() : null;
  const majorCheck =
    typeof scrapeMajorCheck === "function" ? await scrapeMajorCheck(major) : null;

  return {
    major,
    schedule,
    majorCheck
  };
}

function notifyBackgroundIfLoggedIn() {
  if (!isGoldUserLoggedIn()) {
    return;
  }

  chrome.runtime.sendMessage({
    type: "GOLD_LOGIN_READY"
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "CHECK_GOLD_LOGIN_STATUS") {
    sendResponse({
      isLoggedIn: isGoldUserLoggedIn(),
      url: window.location.href
    });

    return false;
  }

  if (message?.type === "RUN_GOLD_SCRAPE") {
    runGoldScrape(message.major).then(sendResponse);
    return true;
  }

  return false;
});

notifyBackgroundIfLoggedIn();
