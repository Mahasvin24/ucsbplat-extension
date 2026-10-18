# AGENTS.md — `ucsbplat-extension`

> AI coding agent instructions for the Chrome extension.
> The website it talks to is a separate repository; see its `AGENTS.md` files, in
> particular `blueprints/AGENTS.md` on the `/api/extension` routes.

## Purpose

A Manifest V3 Chrome extension that reads two GOLD pages — **My Schedule** and **Major
Progress Check** — and posts their HTML to `ucsbplat.com/api/extension/gold-sync`. That is
the whole product. The site cannot reach GOLD on its own; this is the bridge.

`README.md` documents how a sync works and why. This file is about the constraints an
agent will otherwise break.

## The one that matters most

**`sample-data/` is a real student's transcript.** It is gitignored, but it sits in the
working directory, and the Web Store takes whatever archive you hand it. Zipping this
folder publishes an academic record to a listing anyone can download.

**Always package with `./package.sh`.** It lists files explicitly rather than excluding
them, so a new file is left out by default rather than shipped by default, and it refuses
to build an archive containing `sample-data`, docs, or git metadata. A correct package is
~30 KB; if you see megabytes, stop.

## Manifest V3 constraints

- **No remote code, ever.** No `eval`, no `new Function`, no `importScripts`, no externally
  hosted scripts. Everything that executes must ship inside the package. This is declared
  on the Web Store's Privacy practices tab and is checked at review.
- **The functions in `injected.js` are serialized** by `chrome.scripting.executeScript`, so
  each must be entirely self-contained — no imports, no closure over module scope.
- **Permissions are `scripting`, `storage` and two hosts.** Every one is
  justified in `STORE_LISTING.md`. An unnecessary permission is a stated rejection reason,
  so do not add one without deciding what its justification will say.
- **`credentials: "include"` on both `fetch()` calls is load-bearing.** The browser attaches
  the session cookie; without it every request is a 401.
- **The service worker stays alive because it polls.** `runSync` waits on GOLD with repeated
  `chrome.scripting.executeScript` calls a few hundred ms apart, and each one resets the
  idle timer. A long `sleep` with no API call in it would let the worker be killed
  mid-sync.

## Identity

**An unpacked extension's ID is derived from its folder path; a published one is
permanent.** Renaming the checkout changes the ID and every sync 403s until the server's
`EXTENSION_ID` catches up. That has already happened once. It also wipes
`chrome.storage.local`. Website request receipts are account-scoped on the server;
never infer sync success from extension-local timestamps.

The published ID is `cffmlcefmeeeiidkdffgjimpjojiibap`.

## Pointing at a local server

Three settings move together: set `UCSBPLAT_ORIGIN` to `LOCAL_ORIGIN` in `config.js`, add
`"http://localhost:12345/*"` to `host_permissions`, and add it to
`externally_connectable.matches`. The localhost entries are deliberately not left in a release
manifest — a published extension asking for plain-http localhost access is a permission it can
never use and one more thing for a reviewer to query. **Undo all three before packaging.**
`package.sh` refuses to build while any local-development setting remains. Use
`./package.sh --release` to prepare hosted configuration in a temporary allowlisted copy
without changing the development checkout.

## Web Store submission

`STORE_LISTING.md` holds paste-ready copy for every dashboard field: single purpose,
per-permission justifications, remote-code answer, data-type disclosures, certifications,
and which image goes in which slot.

**Three things must agree, or it is a policy violation rather than a mistake:** this
repository's behaviour, the dashboard answers, and the privacy policy at
`https://ucsbplat.com/privacy`. If you change what the extension collects, change all
three. The policy is served from the website repository
(`templates/misc/privacy.html`) and must be **deployed** before submitting — a reviewer
opens that URL.

Required images live in `store/` and `icons/` and are uploaded through the dashboard, not
packaged: a 128×128 store icon (96×96 of artwork inside 16px padding), a 440×280 promo
tile, and at least one 1280×800 screenshot. Screenshots must not contain a real student
record.

## How to verify

There is no test runner. `background.js` is exercised by a scripted harness that stubs the
`chrome.*` APIs and drives the real module, including tab closure, website-only initiation,
restart recovery, and popup rendering. Extend that harness for lifecycle changes;
reading the guards alone does not establish that Chrome events release the run lock.

```bash
node --check background.js && node --check popup.js
node check.cjs
./package.sh          # must print "clean" and list no sample-data
```

Then load the folder unpacked at `chrome://extensions` and run a real sync. Service worker
logs are behind the "service worker" link there.

## What NOT to do

- Do not log or store the captured HTML anywhere. It is a full transcript.
- Do not commit. The maintainer commits.
- Do not add a permission without also writing its justification.
- Do not leave `console.log` in a shipped build; the diagnostics from one debugging round
  were committed by accident and had to be stripped before submission.

## Website request protocol (v5)

A prepared action carries a server-issued request ID. Resolve its action/selectors from the
website and require popup confirmation. There is no standalone sync fallback. The server
supplies the popup title, detail, confirm label, and fallback running message; the popup
points to the website for live worker steps. Detailed results live
on the website. A raw toolbar opening links to the profile. Profile visits do not trigger
reminders. Closing the automation tab must abort even a pending injection, fail the website
request, and release the worker without submitting a partial capture. The website alone declares saved success/partial
and supplies freshness; do not turn every HTTP 200 into "Up to date". Report local failures
and cancellation to that request without storing captured HTML. Refresh-major restores the
requested audit's selectors. Add-major requires both labels entered on the website, resolves
them to actual GOLD options, and saves both values and labels. Full sync captures current
courses once and visits every server-requested saved audit. Always select the first dropdown,
wait for the dependent list, select the second, verify the pair, check in-progress, and wait
for fresh results (not an old grid). Pre-run value mismatches and ambiguous labels must fail.
GOLD can reset both dropdowns after Run: do not validate the controls again after results
arrive. Keep the verified pre-run selector pair and let the server check the generated
audit's parsed PROGRAM CODE against the requested saved major.
Release v1.6 requires the matching protocol-v5 website; it reuses existing DB columns/tables.
Keep both `check.cjs` and `check-browser.cjs` out of release archives. The browser harness uses
synthetic controls only; see README for verification and remaining real-GOLD checks.

The toolbar uses `action.default_popup`, never a separate `chrome.windows` popup.
Closing the popup must not cancel the worker. Numbered progress belongs only on the
website; the popup handles confirmation and briefly points there while running.
Website progress uses 4 + 3 × requested majors, completed only by server success/partial.
Schedule capture must wait for content and preserve live select values in captured HTML.
