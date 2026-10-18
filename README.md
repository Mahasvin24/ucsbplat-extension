UCSBPlat-Extension is a Chrome extension pairing with the UCSBPlat website. It captures two pages
from UCSB's GOLD platform and posts their HTML to UCSBPlat, which parses them to keep a live record
of the courses a student has taken and is currently taking.

## What a sync does

Every run starts with an action on the UCSBPlat website and confirmation in the extension.
Opening the toolbar popup directly links to your profile; it cannot start a standalone sync.

1. Resolves the website request and checks sign-in (`GET /api/extension/session`). A 401 stops
   the run before GOLD opens. The request identifies every major to refresh and both of its
   GOLD dropdown selections. An initial add supplies the two labels entered on the website.
2. Opens `StudentSchedule.aspx` in a background tab and captures it, noting the selected quarter.
3. Goes to `AcademicProgress.aspx` for each requested major. It selects Major Area first,
   waits for GOLD to repopulate the dependent dropdown, then selects the audit. It verifies and records both selected
   values and labels, ticks "use in-progress courses", clicks **Run This Progress Check**, waits for
   fresh audit to render, clicks **Expand All**, and captures the page. Old results do not count
   as completion; full navigation and AJAX grid replacement/content updates are supported.
4. Posts the schedule once and the requested audit captures to `/api/extension/gold-sync`, then
   closes the tab. `sync_all` sends `{schedule_page, major_progress_checks: [{audit_id,
   major_progress_check, audit_selection}], action, request_id}`. Add/refresh sends one audit.

Either page alone is still worth sending, so a failure on one is reported as a warning and the other
is sent anyway. The captured HTML is the student's full transcript: it is never written to extension
storage, never logged, and is dropped as soon as the request finishes.

The website prepares `add_major`, `sync_all`, or `refresh_major` using a short-lived,
account-scoped server request ID. The extension resolves that request from the website,
shows a confirmation popup, and starts only after the student confirms. Add-major requires
both dropdown labels from the website and resolves them to exact GOLD option values; it
never assumes GOLD's default choice. Refresh-major uses the requested saved pair. Full
updates capture the schedule once and refresh every saved major in primary-first order.
Failed captures keep that major's previous requirements and produce a server-owned partial
result. Wrong audit identities roll back the entire batch. Re-entering a legacy major with
missing selections repairs the existing row rather than adding a duplicate.

The website decides the saved result. A successful response includes `status: success`
or `partial`, the database timestamp, stored summary/counts, and warnings. The website displays the detailed result. The popup shows only the website's action text,
live progress (current courses, selecting a major, including in-progress courses, running
the named major's check, and saving), and the final server message. It has no sync history, counts,
warnings list, or reminder settings. The extension reports running/failure/cancellation to the
same account-scoped request; it cannot declare a save successful itself. Prepared actions
can be cancelled in the popup. No captured HTML is written to extension storage.

Protocol v5 requires extension v1.4 and the corresponding website changes. No new database
migration is needed; the existing selector columns and per-major audit tables are reused. A website message
cannot start GOLD automation or read extension storage. Status receipts contain no captured
HTML, expire on the server after 15 minutes, and are erased with course-data deletion.

## Pointing at a server

`config.js` holds the origin every request and the sign-in link use. It points at
`https://ucsbplat.com`; set `UCSBPLAT_ORIGIN` to `LOCAL_ORIGIN` to test against a local server.
Also add `"http://localhost:12345/*"` to both `manifest.json`'s `host_permissions` and
`externally_connectable.matches`. These settings are not left in a release, because a published
extension asking for plain-http localhost access is a permission it can never use and one more
thing for a Web Store reviewer to query. Undo all three before packaging; `package.sh` refuses to
build while any remains.

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
`SameSite=None; Secure`. Every 401 is reported the same way — sign in and run it again — because
telling a withheld cookie apart from a missing session needed a count of the cookies on the host,
and the `cookies` permission that costs is not worth the better message at a Web Store review. If
signing in does not clear it, suspect `SameSite` on the session cookie: that is a server-side change
(or a pairing token), not something to work around here.

**Major changes are confirmed, never assumed.** A what-if progress check for another major looks
identical to a real one, so the server answers 409 `program_code_mismatch` and writes nothing. The
popup shows the website's explanation and asks. Only if the student confirms is the same payload resent
with `confirm_major_change: true`.

**The quarter is whatever GOLD had selected.** The run opens a fresh schedule page, so this is
GOLD's default quarter. The website shows which one was stored.

**Pages are trimmed, never rewritten.** Only `style`, `script`, `noscript` and `svg` elements are
removed — about 1.75 MB drops to ~0.55 MB. Nothing is reformatted, because the degree audit encodes
meaning in exact column spacing using non-breaking spaces.

## Installing

`chrome://extensions` → enable Developer mode → **Load unpacked** → pick this folder.

To point it at a local UCSBPlat, swap `UCSBPLAT_ORIGIN` to `LOCAL_ORIGIN` in `config.js` and add
`"http://localhost:12345/*"` to both `host_permissions` and `externally_connectable.matches` in
`manifest.json`. Undo all three before packaging.

## Using it

During onboarding, choose both dropdowns in GOLD and copy their labels into the two fields
on UCSBPlat. Choose **Add this major** and confirm in the popup; the extension runs the check
with in-progress courses included. For later updates, choose **Update my
Course Data** or **Refresh this major** on the website and confirm the requested action.
Keep the automation tab open until the update finishes. Use your profile for saved details.

Closing the GOLD tab during capture stops the run, reports an error to the website, and releases
the worker so a new website request can start. It must never turn a user-closed tab into a
schedule-only save. Closing the tab after submission does not undo a committed server save.
The tab-removal event also interrupts an outstanding injection even if Chrome never resolves
its promise. Website calls have timeouts so a network stall cannot hold the run lock forever.

If the service worker restarts during a run or major-change confirmation, reopening the popup
or preparing another website action reconciles the stored request with the server. A committed
success is preserved; otherwise the interrupted request fails and can be retried from the website.
Captured pages cannot survive a worker restart and are never restored from storage.

Chrome may refuse to open the popup automatically. The website then asks the student to click
the toolbar icon; the already-prepared action appears there. No profile-visit reminders open it.

## Files

| File | Role |
| --- | --- |
| `background.js` | Service worker: validates website requests, runs automation, reports status |
| `injected.js` | Self-contained functions injected into GOLD pages |
| `popup.*` | Website link, server-supplied confirmation/status, major-change confirmation |

## Debugging

Service worker logs are behind the "service worker" link on `chrome://extensions`.

`sample-data/` holds saved copies of both GOLD pages used to pin down the element IDs. It is
gitignored because it contains real academic records.

## Verification

### Popup state coverage

All three website actions (`add_major`, `sync_all`, `refresh_major`) use the same
presentation states and keep the website's title, description, button, and running copy.

| State | Popup behavior |
| --- | --- |
| Toolbar / idle | Open ucsbplat.com button to the profile; no past results or standalone sync |
| Prepared | Website action with confirm and cancel controls |
| Starting | Immediate feedback; confirm and cancel disabled while dispatching |
| Running | Live worker step with the current major's name; no duplicate start control |
| Major replacement | Website explanation with explicit replace/cancel controls |
| Success | Saved message |
| Partial save | Distinct warning state with the website's explanation |
| Error / sign-in required | Actionable message |
| Cancelled | Cancellation feedback for the current popup |
| Expired confirmation | Explanation to begin a fresh request on the website |
| Worker unavailable | Recovery message |

Only the idle view shows website navigation. Loaded requests show their own heading,
website-supplied explanation, and any confirmation/cancellation controls in a flat layout.

Finished results appear only for the request this popup is following. Reopening the
toolbar after completion returns to the profile entry point. Website API errors
(expired request, invalid major, parse/save failures, unavailable status, and rejected
origin) use the error presentation and preserve the returned explanation. Warnings and
counts stay on the website. Local expiry is reported to the website as cancellation.

`node check.cjs` drives the real service worker with synthetic Chrome and HTTP stubs. It
checks website-only initiation, server-supplied popup copy, selected-major restoration,
partial/failure results, closure during each capture phase, stuck-injection interruption,
worker restart, network timeouts, retry, confirmation races, and that captured HTML never
reaches storage. `node --check background.js && node --check popup.js` checks syntax.

`node check-browser.cjs` uses Playwright (via `NODE_PATH` if needed) against synthetic GOLD
controls in isolated Chrome. `CHROME_PATH` can point at an installed Chrome binary. It checks
the actual injected functions: dependent lists, label/value matching, ambiguity rejection,
checkbox idempotence, and stale versus fresh audit output. It makes no network requests.

### Manual GOLD checks still needed

1. Add a major using the actual labels from both GOLD dropdowns. Verify the popup names it,
   the first selection repopulates the second, and the checkbox is checked before the run.
2. Save a second major, then choose **Sync with GOLD**. Confirm current courses are checked
   once, each major's name appears as it runs, and both progress pages update afterward.
3. Use **Refresh this major** on the secondary major. Confirm the primary stays primary.
4. Close GOLD during the second audit: the request should fail without submitting earlier
   captures. Retry from the website. Also verify signed-out GOLD and missing-option errors.
5. Reopen the popup mid-run and verify live steps resume. Inspect server-reported partial
   results when an ordinary audit capture fails, and check real cookies/long MV3 runs.

For release verification, use a temporary release copy, restore hosted configuration,
remove localhost from both manifest lists, and run `./package.sh`. Keep the development
checkout pointed at localhost. Real GOLD/Chrome behavior still needs an unpacked-browser sync.
