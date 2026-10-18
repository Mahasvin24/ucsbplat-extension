// Synthetic GOLD controls in a real browser. No network, login, or student records.
// Requires Playwright on NODE_PATH; optionally set CHROME_PATH for installed Chrome.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const injected = fs.readFileSync(path.join(__dirname, 'injected.js'), 'utf8').replace(/^export /gm, '');
let passed = 0;
function check(value, label) { assert.ok(value, label); passed++; }
const fixture = `<!doctype html><html><body>
  <select id="pageContent_availableMajorsList">
    <option value="LS" selected>Applied Mathematics</option><option value="ENGR">Engineering</option>
  </select>
  <select id="pageContent_availableAuditsList"><option value="MATH-BS">BS - Applied Mathematics</option></select>
  <input type="checkbox" id="pageContent_DegreeAuditWipCheckBox">
  <button id="pageContent_runAuditBtn">Run This Progress Check</button>
  <div class="RadAjaxLoadingPanel" style="display:none">Loading selections</div>
  <div id="pageContent_processingAuditPanel" style="display:none">Running</div>
  <div id="pageContent_pageContent_DA_GridPlaceHolderRadGrid">Old mathematics result</div>
  <p id="unrelated">Unrelated content</p>
</body></html>`;
(async () => {
  const browser = await chromium.launch({headless: true, ...(process.env.CHROME_PATH ? {executablePath: process.env.CHROME_PATH} : {})});
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.abort());
    await page.setContent(fixture);
    await page.addScriptTag({content: injected});
    await page.evaluate(() => {
      window.checkboxClicks = 0;
      window.runs = [];
      document.querySelector('#pageContent_DegreeAuditWipCheckBox').addEventListener('click', () => window.checkboxClicks++);
      document.querySelector('#pageContent_availableMajorsList').addEventListener('change', () => {
        const audit = document.querySelector('#pageContent_availableAuditsList');
        audit.disabled = true;
        document.querySelector('.RadAjaxLoadingPanel').style.display = 'block';
        setTimeout(() => {
          audit.innerHTML = '<option value="">Choose a check</option><option value="CMPSC-BS">BS - Computer Science</option><option value="CMPSC-BA">BA - Computer Science</option>';
          audit.disabled = false;
          document.querySelector('.RadAjaxLoadingPanel').style.display = 'none';
        }, 200);
      });
      document.querySelector('#pageContent_runAuditBtn').addEventListener('click', () => {
        window.runs.push({area: document.querySelector('#pageContent_availableMajorsList').value,
          audit: document.querySelector('#pageContent_availableAuditsList').value,
          checked: document.querySelector('#pageContent_DegreeAuditWipCheckBox').checked});
        document.querySelector('#pageContent_processingAuditPanel').style.display = 'block';
        setTimeout(() => {
          document.querySelector('#pageContent_pageContent_DA_GridPlaceHolderRadGrid').innerHTML = '<p>Fresh computer science result</p>';
          document.querySelector('#pageContent_processingAuditPanel').style.display = 'none';
        }, 200);
      });
    });
    const original = await page.evaluate(() => auditSelectionState());
    check(original.majorArea.value === 'LS' && original.audit.value === 'MATH-BS', 'read both independently selected fields');
    check((await page.evaluate(() => chooseAuditOption('major_area', {label: ' engineering '}))).changed, 'label selects first dropdown without guessing a value');
    check(!(await page.evaluate(() => auditSelectionState())).ready, 'asynchronous dropdown reload is not ready');
    await page.waitForFunction(() => auditSelectionState().ready);
    check((await page.evaluate(() => auditSelectionState())).signature !== original.signature, 'dependent dropdown changes its readiness signature');
    check((await page.evaluate(() => chooseAuditOption('audit', {label: 'bs  -  computer science'}))).matched, 'second dropdown matches normalized exact label');
    check(!(await page.evaluate(() => chooseAuditOption('audit', {value: 'MISSING', label: 'BS - Computer Science'}))).matched, 'missing saved value does not silently select a different option');
    check(!(await page.evaluate(() => chooseAuditOption('audit', {value: ''}))).matched, 'placeholder cannot be selected as a major');
    check(!(await page.evaluate(() => chooseAuditOption('unknown', {value: 'CMPSC-BS'}))).matched, 'unknown dropdown kind is rejected');
    await page.evaluate(() => {
      document.querySelector('#pageContent_availableAuditsList').insertAdjacentHTML('beforeend', '<option value="OTHER-CS">BS - Computer Science</option>');
    });
    check(!(await page.evaluate(() => chooseAuditOption('audit', {label: 'BS - Computer Science'}))).matched, 'ambiguous labels are rejected');
    check((await page.evaluate(() => chooseAuditOption('audit', {value: 'CMPSC-BS'}))).matched, 'saved value distinguishes duplicate labels');
    check(!(await page.evaluate(() => clickRunAudit())).found, 'unchecked in-progress courses blocks running');
    check((await page.evaluate(() => ensureInProgressChecked())).checked, 'in-progress checkbox is checked');
    await page.evaluate(() => ensureInProgressChecked());
    check(await page.evaluate(() => window.checkboxClicks === 1), 'already checked input is never toggled off');
    await page.evaluate(() => {document.querySelector('#pageContent_DegreeAuditWipCheckBox').disabled = true;});
    check(!(await page.evaluate(() => clickRunAudit())).found, 'disabled checkbox cannot silently omit in-progress courses from submission');
    await page.evaluate(() => {document.querySelector('#pageContent_DegreeAuditWipCheckBox').disabled = false;});
    await page.evaluate(() => markDocument('run-1', true));
    check(!(await page.evaluate(() => auditReadyState('run-1'))).freshResults, 'existing audit is marked stale before run');
    check((await page.evaluate(() => clickRunAudit())).found, 'audit starts after selecting both fields and checking in-progress');
    check((await page.evaluate(() => auditReadyState('run-1'))).running, 'running indicator remains visible before new result');
    await page.waitForFunction(() => auditReadyState('run-1').freshResults && !auditReadyState('run-1').running);
    const run = await page.evaluate(() => window.runs[0]);
    check(run.area === 'ENGR' && run.audit === 'CMPSC-BS' && run.checked, 'run uses the exact requested pair with in-progress included');
    check((await page.evaluate(() => capturePage())).includes('Fresh computer science result'), 'capture contains fresh audit output');
    await page.evaluate(() => markDocument('run-2', true));
    await page.evaluate(() => {document.querySelector('#unrelated').textContent = 'Changed outside the audit';});
    check(!(await page.evaluate(() => auditReadyState('run-2'))).freshResults, 'unrelated DOM mutation does not make an old audit fresh');
    await page.evaluate(() => {
      document.querySelector('#pageContent_pageContent_DA_GridPlaceHolderRadGrid').outerHTML = '<div id="pageContent_pageContent_DA_GridPlaceHolderRadGrid">Replacement grid</div>';
    });
    check((await page.evaluate(() => auditReadyState('run-2'))).freshResults, 'replacement grid is recognized as a fresh result');
    await page.evaluate(() => {document.querySelector('#pageContent_pageContent_DA_GridPlaceHolderRadGrid').remove(); markDocument('run-3', true);});
    await page.evaluate(() => {document.body.insertAdjacentHTML('beforeend', '<div id="pageContent_pageContent_DA_GridPlaceHolderRadGrid">First result</div>');});
    check((await page.evaluate(() => auditReadyState('run-3'))).freshResults, 'first result without a previous grid is accepted');
    check(!(await page.evaluate(() => capturePage())).includes('data-ucsbplat-audit-run'), 'capture omits freshness markers');
    const websiteController = path.join(__dirname, '../website/web/static/js/profile_sync.js');
    if (fs.existsSync(websiteController)) {
      await page.addScriptTag({content: fs.readFileSync(websiteController, 'utf8')
        .replace(/^import .*;\n/m, '').replace(/^export /gm, '')});
      await page.evaluate(() => {
        document.body.insertAdjacentHTML('beforeend', '<input data-gold-major-area required maxlength="200"><input data-gold-audit required maxlength="200">');
      });
      check(await page.evaluate(() => majorSelectionFrom(document.body) === null), 'website refuses empty initial major fields');
      await page.evaluate(() => {
        document.querySelector('[data-gold-major-area]').value = '  Applied Mathematics  ';
        document.querySelector('[data-gold-audit]').value = '  BS - Applied Mathematics  ';
      });
      const fields = await page.evaluate(() => majorSelectionFrom(document.body));
      check(fields.major_area.label === 'Applied Mathematics' && fields.audit.label === 'BS - Applied Mathematics',
        'website trims and collects the two initial dropdown labels independently');
    }
    await page.goto('about:blank');
    await page.setContent(fixture);
    await page.addScriptTag({content: injected});
    check(!(await page.evaluate(() => documentState('previous-document'))).marked
      && (await page.evaluate(() => auditReadyState('previous-document'))).freshResults,
      'full document navigation also recognizes the new audit as fresh');
    console.log(`${passed} real-browser GOLD control checks passed`);
  } finally {
    await browser.close();
  }
})().catch(error => {console.error(error); process.exitCode = 1;});
