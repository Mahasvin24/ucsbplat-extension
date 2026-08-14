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

**`cookies`**

> Checks whether a UCSBPlat session cookie exists when a sync is rejected as
> unauthenticated. "You are not signed in" and "you are signed in but your browser did not
> attach the cookie" need different fixes, and without this the extension cannot tell the
> student which one they are looking at.

**Host permission — `https://my.sa.ucsb.edu/gold/*`**

> The two GOLD pages being synced live here: the student's schedule and their Major
> Progress Check.

**Host permission — `https://ucsbplat.com/*`**

> Where the result is sent, and where the student's account lives. The extension posts the
> synced pages to the UCSBPlat API and checks the student is signed in before it starts.

### Remote code

> **No, I am not using remote code.**

Verified in the source: no `eval`, no `new Function`, no `importScripts`, no externally
hosted scripts. Everything executed ships in the package. The functions passed to
`chrome.scripting.executeScript` are defined in `injected.js` and bundled.

### Data types collected

Tick, and nothing else:

- **Website content** — the contents of the two GOLD pages (courses, grades, degree
  requirements, class times).
- **Authentication information** — the UCSBPlat session cookie is checked to confirm the
  student is signed in.

Do **not** tick: personally identifiable information, health, financial and payment,
personal communications, location, web history, or user activity. None are collected.

> Note on the first two: the GOLD pages do contain the student's name, and the sync is
> attached to their account. It is disclosed under "website content" because that is the
> category the page contents fall into, and the privacy policy spells out exactly what is
> read and kept. If a reviewer queries it, the honest answer is that the name arrives as
> part of the page content and is stored so the profile can address them by it.

### Certifications

All three, consistent with the privacy policy:

- I do not sell or transfer user data to third parties, apart from the approved use cases
- I do not use or transfer user data for purposes unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

---

## Before uploading

1. `./package.sh` — must print `clean` and roughly 36K. It refuses to build if
   `sample-data/` (real academic records) is in the archive.
2. Confirm `manifest.json` has no `http://localhost` host permission and that
   `config.js` points at `HOSTED_ORIGIN`.
3. Read <https://ucsbplat.com/privacy> against this file. Every disclosure here must be
   true there.
4. The published extension gets a permanent ID different from the unpacked one. Add it to
   `EXTENSION_ID` on the server, or the API will answer 403 — see the README.
