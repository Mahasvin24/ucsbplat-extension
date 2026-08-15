# Chrome Web Store submission — copy for the dashboard

Paste-ready text for the listing and the **Privacy practices** tab.

Chrome treats a mismatch between these answers, the privacy policy, and what the code
actually does as a policy violation, not a mistake — so every claim below is written from
the code, and if you change the extension, change this too. The three that must agree are
this file, `manifest.json`, and <https://ucsbplat.com/privacy>.

---

## Store listing

**Name:** UCSBPlat Helper

**Short description** (132 char limit, current: 61)

> Syncs your GOLD schedule and major progress check to UCSBPlat

**Category:** Productivity

**Detailed description**

> UCSBPlat Helper keeps your UCSBPlat course record in step with GOLD.
>
> UCSBPlat can show your degree progress and suggest courses to take next, but it has no
> way to read GOLD on its own. This extension is that link. When you click "Update my
> Course Data", it opens your GOLD schedule and Major Progress Check, reads them using
> the GOLD session you are already signed in to, and sends the result to your UCSBPlat
> account.
>
> It runs only when you ask it to. It does not read GOLD in the background, does not run
> on other websites, and never sees your GOLD password. The pages it reads are used once
> to pull out your courses and requirements, and are then discarded — they are never
> stored or logged. You can delete everything it has synced at any time from your
> UCSBPlat profile page.
>
> UCSBPlat is a student project by UCSB ACM, sponsored by Associated Students. It is not
> an official UCSB service and is not affiliated with or endorsed by the University.

The last paragraph is deliberate. The name and icon use UCSB's marks, and saying plainly
that this is a sponsored student project rather than a University service answers the
question a reviewer would otherwise open a rejection to ask.

**Privacy policy URL:** `https://ucsbplat.com/privacy`

---

## Privacy practices tab

### Single purpose

> Keeps a student's UCSBPlat course record in sync with UCSB's GOLD system, by reading
> their GOLD schedule and Major Progress Check when they ask it to and sending the result
> to their own UCSBPlat account.

### Permission justifications

**`scripting`**

> Reads the two GOLD pages the student asked to sync. GOLD has no API, so the only way to
> get a student's schedule and progress check is to read the pages themselves, in the
> student's own signed-in session. The injected functions only click GOLD's own controls
> and return page contents; they do not modify the pages.

**`storage`**

> Remembers when the last sync happened, the result to show in the popup, and whether the
> student wants update reminders. The captured GOLD pages are never stored here.

**Host permissions** (one field covering both, not one per host)

> Two hosts, one for each half of the sync. `https://my.sa.ucsb.edu/gold/*` is where the
> pages being synced live: the student's schedule and their Major Progress Check, read in
> the GOLD session they are already signed in to. `https://ucsbplat.com/*` is where the
> result goes and where the student's account lives — the extension checks they are signed
> in there before it starts, then posts the two pages to the UCSBPlat API. No other host is
> requested, and the extension does not run on any other site.

### Remote code

> **No, I am not using remote code.**

Verified in the source: no `eval`, no `new Function`, no `importScripts`, no externally
hosted scripts. Everything executed ships in the package. The functions passed to
`chrome.scripting.executeScript` are defined in `injected.js` and bundled.

### Data types collected

Tick, and nothing else:

- **Website content** — the contents of the two GOLD pages (courses, grades, degree
  requirements, class times).

Do **not** tick: personally identifiable information, authentication information, health,
financial and payment, personal communications, location, web history, or user activity.
None are collected.

> Note, in case a reviewer asks: the GOLD pages are page contents and a student's name is
> rendered on them, which is what "website content" covers and what the privacy policy
> describes. Nothing pulls it out — the server parses courses and requirements and keeps
> no name — so no personally identifiable information is collected as such. Authentication
> is likewise nothing the extension handles: the request carries whatever session cookie
> the browser already attaches, and the extension neither reads nor stores a cookie.

### Certifications

All three, consistent with the privacy policy:

- I do not sell or transfer user data to third parties, apart from the approved use cases
- I do not use or transfer user data for purposes unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

---

## Settings page (not the Privacy practices tab)

Two blockers live here instead, and they are easy to miss because every other requirement
is on the Privacy tab:

- **Publisher contact email** — an address you can actually receive at. It is shown
  publicly on the listing.
- **Verify that email** — Google sends a confirmation link and publishing stays blocked
  until you click it.

**Do this first.** Everything else on this page is copy-paste and takes a minute; the
verification is a round-trip through your inbox, and there is no reason to discover that
after the rest is done.

---

## Store images

All three required images are in `store/` and `icons/`, and none of them ship inside the
extension package — they are uploaded through the dashboard.

| Dashboard field | File | Notes |
| --- | --- | --- |
| Store icon (128x128) | `icons/icon128.png` | 96x96 of artwork inside 16px padding, per Chrome's spec |
| Small promo tile (440x280) | `store/promo-440x280.png` | |
| Screenshot (1280x800) | `store/screenshot-1280x800.png` | |

The screenshot is a real render of the popup: the extension's own `popup.css` and markup,
captured in a browser, not a drawing of it. The record shown in it is invented. A listing
image is public, and a real transcript is the one thing that must never be in one.

## Before uploading

1. `./package.sh` — must print `clean` and roughly 36K. It refuses to build if
   `sample-data/` (real academic records) is in the archive.
2. Confirm `manifest.json` has no `http://localhost` host permission and that
   `config.js` points at `HOSTED_ORIGIN`.
3. Read <https://ucsbplat.com/privacy> against this file. Every disclosure here must be
   true there.
4. The published extension gets a permanent ID different from the unpacked one. Add it to
   `EXTENSION_ID` on the server, or the API will answer 403 — see the README.
