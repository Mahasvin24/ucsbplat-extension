UCSBPlat-Extension is a Chrome extension pairing with the UCSBPlat website. The purpose of this extension is scrape data from two pages when the user is on UCSB's GOLD platform, then send that data to an API endpointpoint on the main platform, so that it can be parsed and used to maintain a live update of the courses a student has taken and is currently taking.

The platform does the following whenever a student is on https://my.sa.ucsb.edu/gold/.

1) It scrapes the webpage https://my.sa.ucsb.edu/gold/StudentSchedule.aspx, getting all the HTML on the page.

2) It scrapes the webpage https://my.sa.ucsb.edu/gold/AcademicProgress.aspx by performing the following steps:
 - Navigates to the page
 - Checks off "Use in-progress courses on my major progress check..."
 - Clicks "Run This Progress Check" and waits for it to complete
 - Clicks the "Expand All" button (if needed to collect full page data)
 - Scrapes the entire HTML page

 3) Saves the data locally. Calls an API endpoint hosted by the main website with all the HTML for the home page, and all the HTML for the major progress check.

 Current Status:
 There is no API endpoint yet to process this data, so instead, it will do everything except for the API call, and store the html pages locally in .txt files.

## Installing

`chrome://extensions` → enable Developer mode → **Load unpacked** → pick this folder.

## Using it

Sign into GOLD, click the extension icon, then **Update my data**. The extension opens its own
background tab, drives both pages there, and closes it — the tab you are on is never touched.
The popup shows the last successful capture and the current step while it runs.

## Files

| File | Role |
| --- | --- |
| `background.js` | Service worker: runs the whole scrape, stores results, holds the API stub |
| `injected.js` | The functions injected into GOLD pages (click, poll, capture) |
| `popup.*` | Status card, update button, debug downloads |

## Debugging

Captured HTML lives in `chrome.storage.local` under `scheduleHtml` and `progressHtml`; the popup's
debug links save each one as a `.txt`. Service worker logs are behind the "service worker" link on
`chrome://extensions`.

`postToUcsbplat()` in `background.js` is where the API call goes once the endpoint exists.

`sample-data/` holds saved copies of both GOLD pages used to pin down the element IDs. It is
gitignored because it contains real academic records.