# Chrome Web Store submission — copy for the dashboard

Paste-ready text for the listing and the **Privacy practices** tab.

Chrome treats a mismatch between these answers, the privacy policy, and what the code
actually does as a policy violation, not a mistake — so every claim below is written from
the code, and if you change the extension, change this too. The three that must agree are
this file, `manifest.json`, and <https://ucsbplat.com/privacy>.

---

## Store listing

**Name:** UCSBPlat (matches `manifest.json`)

**Short description** (132 char limit, current: 61)

> Syncs your GOLD schedule and major progress check to UCSBPlat

**Category:** Productivity

**Detailed description**

> UCSBPlat keeps your course record in step with GOLD.
>
> UCSBPlat can show your degree progress and suggest courses to take next, but it has no
> way to read GOLD on its own. This extension is that link. When you ask UCSBPlat to add
> or refresh a selected major, or click "Update my Course Data" on your profile, the extension shows the action
> for confirmation, opens the relevant GOLD pages, reads them using the GOLD session you
> are already signed in to, and sends the result to your UCSBPlat account.
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

All syncs begin on the UCSBPlat website. Opening the toolbar opens the standard Chrome popup with an idle link to the
website. The window displays the website's requested action and simple status;
saved course details and warnings appear on the website. No reminders open the popup.

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
> student's own signed-in session. The injected functions select the student's saved Major
> Area and audit in order, tick "use in-progress courses", run the progress check, expand all
> requirements, and return the resulting HTML. They add no content to the page and change
> nothing else on it. The only mark they leave is a single data attribute, set to tell one
> page load apart from the next and removed again before the page is read.

**`storage`**

> Holds the website-requested action and its confirmation text, current run status, and
> a pending major-change confirmation. This lets the popup resume an active action and
> reconcile an interrupted worker with the website. The captured GOLD pages and detailed
> sync history are never stored here.

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

Tick:

- **Website content** — the contents of the two GOLD pages (courses, grades, degree
  requirements, class times).
- **Personally identifiable information** — captured page contents can contain a student's
  name and other identifiers. They are transmitted to UCSBPlat even though the parser
  does not extract or retain the GOLD name as a structured field.

Do **not** tick: authentication information, health, financial and payment, personal
communications, location, web history, or user activity. The extension does not collect
these separately. Class meeting rooms are included in website content, not device location.

Transient transmission is still collection; do not omit the personal-information disclosure
just because the server discards the HTML. The extension neither reads nor stores session
cookies or GOLD passwords; the browser attaches the UCSBPlat session cookie to API requests.
See Google's [privacy-field instructions](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy).

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

All three required images are in `store/` and `icons/`. Icons also ship in the extension;
the promotional tile and screenshot are uploaded only through the dashboard.

| Dashboard field | File | Notes |
| --- | --- | --- |
| Store icon (128x128) | `icons/icon128.png` | 96x96 of artwork inside 16px padding, per Chrome's spec |
| Small promo tile (440x280) | `store/promo-440x280.png` | |
| Screenshot (1280x800) | `store/screenshot-1280x800.png` | |

The screenshot is a real render of the popup: the extension's own `popup.css` and markup,
captured in a browser, not a drawing of it. The record shown in it is invented. A listing
image is public, and a real transcript is the one thing that must never be in one.
Regenerate it with `node render-store.cjs` (Playwright on `NODE_PATH`, optional `CHROME_PATH`).
The script intercepts all network requests and supplies synthetic confirmation data.

## Before uploading

1. `./package.sh --release` — must print `clean`. It builds a hosted release from an
   explicit file list without changing the development checkout. Both harnesses, docs,
   store images, and `sample-data/` are excluded.
2. Inspect the **archived** `manifest.json` and `config.js`: no localhost permissions or
   externally connectable matches; active origin must be `HOSTED_ORIGIN`.
3. **Deploy the website first**, then read <https://ucsbplat.com/privacy> against this
   file. Every disclosure here must be true *of the live site* — a reviewer reads the
   deployed policy, not the repository. Disclose personal information in the dashboard
   because full GOLD page contents can include it, even though raw HTML is discarded.
4. The existing published ID `cffmlcefmeeeiidkdffgjimpjojiibap` and current development ID
   are already configured in the website bridge and API allowlist. No manual ID setup
   is needed for an update to this store item. A different unpacked checkout may need
   its localhost mapping and server allowlist updated — see the README.
5. Verify both September migrations are applied before the website rollout:
   `2026_09_gold_audit_selection.sql`, then `2026_09_student_audits.sql`. Pause GOLD writes
   during the initial migration until all workers run the multi-major website code.
   Protocol v5 requires the matching website and Redis. This release needs no additional migration.
6. Load the extracted release package unpacked and complete the real-GOLD checks in
   `README.md`: add, full update with two majors, secondary refresh, close/retry, and
   reopen the popup mid-run. Verify the published extension ID and production cookies too.
7. Upload to the **existing** Web Store item `cffmlcefmeeeiidkdffgjimpjojiibap` so its ID
   stays stable. Confirm version `1.6` is higher than every previously uploaded package;
   if it has already been uploaded, increment the manifest version and rebuild.
8. Replace the old screenshot with the current one, apply both data disclosures above,
   verify publisher contact email and two-step verification, and provide reviewer test
   instructions for the signed-in UCSBPlat/GOLD flow. Never share a real student's login
   or transcript; use an authorized test account or ask review support for the accepted
   alternative when GOLD access cannot be provided.

## Website actions (v1.6 / protocol v5)

Website-initiated add-major, full-update, and selected-major-refresh actions use an
account-scoped server request and require confirmation in the extension popup. The server
supplies popup confirmation and fallback copy and returns the saved result. Live steps name
the major being checked. A full update visits every saved major using both stored GOLD
selectors; adding a major explicitly collects both dropdown labels. The website
shows detailed results, failure, and cancellation. The toolbar popup cannot start a sync
without a valid website request, and closing the GOLD tab ends capture with a retryable error. These
actions collect the same two GOLD pages and academic fields described above, add no
permissions, and never store captured HTML. Deploy the updated privacy policy before
submitting this release. Both development harnesses (`check.cjs`, `check-browser.cjs`) are excluded by `package.sh`.

Release v1.6 restores the standard dark toolbar popup with bullet-listed majors.
Live steps and numbered progress appear only on the website. Closing the popup leaves
sync active. No permissions or collected fields are added.
