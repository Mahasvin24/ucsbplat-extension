const majorInput = document.querySelector("#major");
const startButton = document.querySelector("#start");
const statusText = document.querySelector("#status");

function setStatus(message) {
  statusText.textContent = message;
}

startButton.addEventListener("click", async () => {
  const major = majorInput.value.trim();

  if (!major) {
    setStatus("Please enter your major.");
    return;
  }

  setStatus("Checking GOLD...");
  startButton.disabled = true;

  try {
    const result = await chrome.runtime.sendMessage({
      type: "START_GOLD_SCRAPE",
      major
    });

    if (result?.needsLogin) {
      setStatus("Please log in to GOLD. Scraping will start after login.");
      return;
    }

    setStatus("Scraping started.");
  } catch (error) {
    setStatus(`Error: ${error.message}`);
  } finally {
    startButton.disabled = false;
  }
});