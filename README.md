UCSBPlat-Extension is a Chrome extension pairing with the UCSBPlat website. It captures two pages
from UCSB's GOLD platform and posts their HTML to UCSBPlat, which parses them to keep a live record
of the courses a student has taken and is currently taking.

## What a sync does

1. Checks the student is signed in to ucsbplat.com (`GET /api/extension/progress`). A 401 stops the
   run before GOLD is ever opened.
2. Opens `StudentSchedule.aspx` in a background tab and captures it, noting the selected quarter.
3. Goes to `AcademicProgress.aspx`, ticks "use in-progress courses", clicks **Run This Progress
   Check**, waits for the audit to render, clicks **Expand All**, and captures the page.
4. `POST`s both pages to `https://ucsbplat.com/api/extension/gold-sync` as
   `{ schedule_page, major_progress_check }`, then closes the tab.

Either page alone is still worth sending, so a failure on one is reported as a warning and the other
is sent anyway. The captured HTML is the student's full transcript: it is never written to extension
storage, never logged, and is dropped as soon as the request finishes.

## Pointing at a server

`config.js` holds the origin every request and the sign-in link use. It points at
`https://ucsbplat.com`; set `UCSBPLAT_ORIGIN` to `LOCAL_ORIGIN` to test against a local server
instead. Both origins stay in `manifest.json`'s host permissions, so no other change is needed.

Local testing does not fully stand in for production on the cookie question: Chrome treats
`http://localhost` as a trustworthy origin, so a `Secure` cookie works there over plain HTTP. The
request is still cross-site, so a `SameSite=Lax` cookie will still be withheld — a local pass proves
`SameSite`, not TLS.

## Details that matter

**Authentication is the session cookie, nothing else.** The `fetch` lives in the service worker so
the browser sends `chrome-extension://<id>` as the Origin, which is what the server allows — a
content script would send `my.sa.ucsb.edu` and be rejected with 403. The call sets
`credentials: "include"`; without it every request is a 401.

**The extension id must be listed in `EXTENSION_ID` on the server.** It is on `chrome://extensions`,
and a 403 names it in the error message. An unpacked id is derived from the folder path, so it
varies per checkout; a published id is permanent. The server takes a comma-separated list so both
can be allowed at once — or paste the published item's public key into `manifest.json` as `"key"` to
make the unpacked build use the published id.

**Cross-site cookies.** Chrome only attaches a cookie to the extension's request if it is
`SameSite=None; Secure`. If the sync reports being signed in but the cookie never arrives, the
extension says so explicitly rather than hiding it — that is a server-side session-cookie change (or
a pairing token), not something to work around here.

**Major changes are confirmed, never assumed.** A what-if progress check for another major looks
identical to a real one, so the server answers 409 `program_code_mismatch` and writes nothing. The
popup shows both program codes and asks. Only if the student confirms is the same payload resent
with `confirm_major_change: true`.

**The quarter is whatever GOLD had selected.** The run opens a fresh schedule page, so this is
GOLD's default quarter, and the popup shows which one was stored.

**Pages are trimmed, never rewritten.** Only `style`, `script`, `noscript` and `svg` elements are
removed — about 1.75 MB drops to ~0.55 MB. Nothing is reformatted, because the degree audit encodes
meaning in exact column spacing using non-breaking spaces.

## Installing

`chrome://extensions` → enable Developer mode → **Load unpacked** → pick this folder.

## Using it

The popup opens on its own every time a `StudentSchedule.aspx` load completes in the tab the student
is looking at — including the postbacks the quarter dropdown triggers. Chrome only allows an
extension to open its own popup while its window is focused; when it refuses, the toolbar icon gets
a badge instead.

Sign in to ucsbplat.com and to GOLD, click the extension icon, then **Update my Course Data**. The
popup shows progress while it runs, then the stored major, quarter and counts, plus any warnings the
server returned. Warnings are how the server says things like "that page contained no audit".

## Files

| File | Role |
| --- | --- |
| `background.js` | Service worker: runs the sync, calls the API, handles every response |
| `injected.js` | The functions injected into GOLD pages (click, poll, capture) |
| `popup.*` | Status card, update button, major-change confirmation, debug row |

## Debugging

**Save copies to Downloads** in the popup writes `gold-schedule.txt` and `gold-progress-check.txt`
— exactly the bytes that were sent — on the next run. It is off by default and nothing is retained
between runs. Service worker logs are behind the "service worker" link on `chrome://extensions`.

`sample-data/` holds saved copies of both GOLD pages used to pin down the element IDs. It is
gitignored because it contains real academic records.
