// Render the current popup with synthetic website data; no network or student records.
// NODE_PATH=<Playwright packages> CHROME_PATH=<Chrome binary> node render-store.cjs
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');

const origin = 'https://extension-preview.invalid';
const popup = {
  title: 'Update your course data?',
  detail: 'Refresh your schedule and every saved major from GOLD.',
  confirm_label: 'Update my Course Data',
  running_message: 'Updating your course data. Keep the GOLD tab open until this finishes.',
  majors: ['BS - Computer Science', 'BS - Applied Mathematics'],
};

(async () => {
  const browser = await chromium.launch({headless: true,
    ...(process.env.CHROME_PATH ? {executablePath: process.env.CHROME_PATH} : {})});
  try {
    const page = await browser.newPage({viewport: {width: 1280, height: 800}, deviceScaleFactor: 1});
    await page.addInitScript(({popup}) => {
      window.chrome = {
        runtime: {sendMessage: async () => ({pendingWebsiteAction: {
          requestId: 'synthetic-store-preview', popup,
        }})},
        storage: {onChanged: {addListener() {}}},
        action: {setBadgeText: async () => {}},
      };
    }, {popup});
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/') return route.fulfill({contentType: 'text/html', body: `<!doctype html>
<html lang="en"><meta charset="utf-8"><title>UCSBPlat store screenshot</title>
<style>
* {box-sizing:border-box} body {margin:0;background:#eff3f7;color:#003660;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main {width:1080px;height:800px;margin:auto;display:grid;grid-template-columns:580px 400px;gap:80px;align-items:center}
h1 {font-size:46px;line-height:1.14;letter-spacing:-1.5px;margin:0 0 24px}
p,li {font-size:18px;line-height:1.65;color:#465363} p {margin:0 0 28px}
ul {list-style:none;padding:0;margin:0} li {margin:18px 0;padding-left:27px;position:relative}
li::before {content:'✓';color:#17834c;position:absolute;left:0;font-weight:700}
iframe {width:400px;height:390px;border:0;border-radius:10px;box-shadow:0 16px 50px #172f4f30;background:#111820}
.caption {font-size:13px;margin:17px 0 0;color:#647184;text-align:center}
</style><main><section><h1>Your GOLD record,<br>on UCSBPlat.</h1>
<p>Add a major or update your course data from your UCSBPlat profile, then confirm in the extension.</p>
<ul><li>Refresh your schedule and saved majors.</li><li>Captured pages are discarded after parsing.</li>
<li>See progress and saved results on your profile.</li></ul></section>
<section><iframe title="UCSBPlat extension confirmation" src="/popup.html"></iframe>
<p class="caption">Current extension popup · Example majors</p></section></main></html>`});
      const file = url.pathname.slice(1);
      if (!['popup.html', 'popup.css', 'popup.js', 'config.js', 'icons/icon128.png'].includes(file)) return route.abort();
      const contentType = file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css'
        : file.endsWith('.png') ? 'image/png' : 'text/html';
      return route.fulfill({contentType, body: fs.readFileSync(path.join(__dirname, file))});
    });
    await page.goto(`${origin}/`);
    const frame = page.frameLocator('iframe');
    await frame.locator('body[data-state="prepared"]').waitFor();
    assert.equal(await frame.locator('#websiteActionTitle').textContent(), popup.title);
    assert.equal(await frame.locator('#majors li').count(), 2);
    const height = await frame.locator('body').evaluate(body => body.scrollHeight);
    await page.locator('iframe').evaluate((el, height) => { el.style.height = `${height}px`; }, height);
    assert.equal(await frame.locator('body').evaluate(body => body.scrollWidth), 400);
    await page.screenshot({path: path.join(__dirname, 'store/screenshot-1280x800.png')});
    console.log('Rendered 1280x800 store screenshot from the current popup with synthetic majors.');
  } finally {
    await browser.close();
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
