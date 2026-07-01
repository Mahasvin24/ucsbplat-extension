function isGoldUserLoggedIn() {
  const hasLoginForm = Boolean(
    document.querySelector('input[type="password"], input[name*="password" i]')
  );
  const hasLogoutLink = Boolean(
    document.querySelector('a[href*="logout" i], a[id*="logout" i]')
  );

  return hasLogoutLink && !hasLoginForm;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "CHECK_GOLD_LOGIN_STATUS") {
    return false;
  }

  sendResponse({
    isLoggedIn: isGoldUserLoggedIn(),
    url: window.location.href
  });

  return false;
});

