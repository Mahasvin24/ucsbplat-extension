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
- **Permissions are `scripting`, `storage`, `cookies` and two hosts.** Every one is
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
`chrome.storage.local`, which is why a reminder can go quiet on a profile that really is
months stale — see the `lastSync` note in `README.md`.

The published ID is `cffmlcefmeeeiidkdffgjimpjojiibap`.

## Pointing at a local server

Two steps, not one: set `UCSBPLAT_ORIGIN` to `LOCAL_ORIGIN` in `config.js` **and** add
`"http://localhost:12345/*"` back to `host_permissions`. It is deliberately not left in the
manifest — a published extension asking for plain-http localhost access is a permission it
can never use and one more thing for a reviewer to query. **Undo both before packaging.**

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
`chrome.*` APIs and drives the real module — the reminder logic in particular, whose
failure mode is silence. Rebuild that harness rather than reasoning about the guards by
eye; a passing read of the code is what let the "no popup on the profile page" bug survive
several rounds.

```bash
node --check background.js && node --check popup.js
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
