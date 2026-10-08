// Scripted Chrome harness: node check.cjs. No browser, credentials, or GOLD data.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8')
  .replace(/^import .*?;\n/gms, '');
const requestId = '11111111-1111-4111-8111-111111111111';

function setup({age = null, remind = true, cooldown = 0, getStatus = 200,
  action = 'add_major', postStatus = 200, resultStatus = 'success', auditFails = false} = {}) {
  const storage = {local: {remindToUpdate: remind, lastReminderAt: cooldown}, session: {}};
  if (age !== null) storage.local.lastSync = {syncedAt: Date.now() - age};
  const listeners = {};
  const calls = {popup: 0, tabs: 0, posts: [], selections: [], reports: []};
  const job = {request_id: requestId, action, status: 'pending', audit_selection: {
    major_area: {value: 'ENGR', label: 'Engineering'}, audit: {value: 'CMPSC-BS', label: 'CS'},
  }};
  const makeStorage = (area) => ({
    get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, storage[area][key]])),
    set: async (patch) => Object.assign(storage[area], patch),
    remove: async (keys) => (Array.isArray(keys) ? keys : [keys]).forEach((key) => delete storage[area][key]),
  });
  const chrome = {
    runtime: {
      id: 'synthetic', getManifest: () => ({version: '1.2'}),
      onInstalled: {addListener() {}},
      onMessageExternal: {addListener: (fn) => { listeners.external = fn; }},
      onMessage: {addListener: (fn) => { listeners.internal = fn; }},
    },
    storage: {local: makeStorage('local'), session: makeStorage('session')},
    tabs: {
      onUpdated: {addListener() {}},
      create: async () => { calls.tabs++; return {id: 1}; }, update: async () => {},
      get: async () => ({url: 'https://my.sa.ucsb.edu/gold/AcademicProgress.aspx'}), remove: async () => {},
    },
    action: {
      openPopup: async () => { calls.popup++; }, setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {},
    },
    scripting: {executeScript: async ({func, args}) => {
      let result;
      switch (func.name) {
        case 'documentState': result = {ready: true, marked: false}; break;
        case 'scheduleState': result = {found: true, quarter: 'FALL 2026'}; break;
        case 'auditSelectionState': result = {found: true, majorArea: {value: 'ENGR', label: 'Engineering'}, audit: {value: 'CMPSC-BS', label: 'CS'}}; break;
        case 'ensureInProgressChecked': result = {found: !auditFails}; break;
        case 'clickRunAudit': result = {found: true}; break;
        case 'auditReadyState': result = {hasResults: true, running: false}; break;
        case 'dismissWelcomeLetter': result = {clicked: false}; break;
        case 'domSize': result = 1; break;
        case 'capturePage': result = '<html>synthetic</html>'; break;
        case 'chooseAuditOption': calls.selections.push(args); result = {found: true, matched: true, changed: false}; break;
      }
      return [{result}];
    }},
  };
  const response = (status, body) => ({ok: status >= 200 && status < 300, status, json: async () => body});
  const context = vm.createContext({
    chrome, URL, Date, Set, Promise, Error, crypto: {randomUUID: () => 'test'},
    setTimeout: (fn) => setTimeout(fn, 0),
    fetch: async (url, opts = {}) => {
      if (url.includes('/sync-requests/')) {
        if (opts.method === 'POST') {
          const report = JSON.parse(opts.body); calls.reports.push(report);
          if (!['success', 'partial', 'error', 'cancelled'].includes(job.status)) Object.assign(job, report);
        }
        return response(200, {...job});
      }
      if (opts.method === 'POST') {
        calls.posts.push(JSON.parse(opts.body));
        if (postStatus !== 200) return response(postStatus, {message: 'The update could not be saved.'});
        job.status = resultStatus;
        return response(200, {status: resultStatus, message: 'Website saved result.', synced_at: new Date().toISOString(), warnings: ['Server warning']});
      }
      return response(getStatus, {student: {audit_selection: {
        major_area: {value: 'LS', label: 'LS'}, audit: {value: 'MATH-BS', label: 'Math'},
      }}, synced_seconds_ago: 172800});
    },
    HOSTED_ORIGIN: 'https://ucsbplat.com', LOCAL_ORIGIN: 'http://localhost:12345', UCSBPLAT_ORIGIN: 'http://localhost:12345',
  });
  for (const name of ['auditSelectionState', 'auditReadyState', 'capturePage', 'chooseAuditOption',
    'clickExpandAll', 'clickRunAudit', 'dismissWelcomeLetter', 'documentState', 'domSize',
    'ensureInProgressChecked', 'markDocument', 'scheduleState']) {
    context[name] = ({[name]: function () {}})[name];
  }
  vm.runInContext(source, context);
  return {context, storage, listeners, calls};
}
let passed = 0;
function check(condition, label) { assert.ok(condition, label); passed++; }
(async () => {
  let s = setup(); let reply;
  s.listeners.external({type: 'UCSBPLAT_PREPARE_ACTION', action: 'add_major', requestId}, {url: 'https://evil.example'}, (r) => { reply = r; });
  check(reply === undefined && !s.storage.session.pendingWebsiteAction, 'untrusted origin rejected');
  s.listeners.external({type: 'UCSBPLAT_PREPARE_ACTION', action: 'arbitrary', requestId}, {url: 'https://ucsbplat.com'}, (r) => { reply = r; });
  check(reply.error === 'unsupported_action', 'unknown action rejected');
  s.listeners.external({type: 'UCSBPLAT_EXTENSION_PING'}, {url: 'https://ucsbplat.com'}, (r) => { reply = r; });
  check(reply.protocolVersion === 3, 'protocol version identifies request-aware extension');
  await vm.runInContext(`prepareWebsiteAction('add_major', '${requestId}')`, s.context);
  check(s.storage.session.pendingWebsiteAction.requestId === requestId && s.calls.tabs === 0, 'preparation does not start GOLD');
  await vm.runInContext(`runSync('add_major', '${requestId}')`, s.context);
  check(s.calls.posts[0].action === 'add_major' && s.calls.posts[0].request_id === requestId, 'website request carried through submission');
  check(s.calls.selections.length === 0 && s.calls.posts[0].schedule_page, 'add-major captures schedule using current GOLD choice');
  check(s.storage.local.lastRun.message === 'Website saved result.', 'popup uses website result');
  check(!JSON.stringify(s.storage).includes('<html>'), 'captured HTML never stored');
  s = setup(); await vm.runInContext('runSync()', s.context);
  check(s.calls.selections.length === 2 && s.calls.selections[1][1].value === 'MATH-BS', 'normal sync restores primary selectors');
  s = setup({action: 'refresh_major'}); await vm.runInContext(`runSync('refresh_major', '${requestId}')`, s.context);
  check(s.calls.selections[1][1].value === 'CMPSC-BS', 'selected major refresh uses server-owned selectors');
  s = setup({resultStatus: 'partial'}); await vm.runInContext('runSync()', s.context);
  check(s.storage.local.lastRun.status === 'partial', 'partial save never presented as complete');
  s = setup({postStatus: 400}); await vm.runInContext(`runSync('add_major', '${requestId}')`, s.context);
  check(s.storage.local.lastRun.status === 'error' && s.calls.reports.some((r) => r.status === 'error'), 'failure reaches popup and website');
  s = setup({auditFails: true}); await vm.runInContext(`runSync('add_major', '${requestId}')`, s.context);
  check(s.calls.posts.length === 0 && s.storage.local.lastRun.status === 'error', 'failed add-major capture does not submit schedule-only success');
  s = setup({getStatus: 403}); await vm.runInContext('runSync()', s.context);
  check(s.calls.tabs === 0 && s.storage.local.lastRun.status === 'error', 'rejected preflight stops before GOLD');
  s = setup(); await vm.runInContext(`prepareWebsiteAction('add_major', '${requestId}')`, s.context);
  await new Promise((resolve) => s.listeners.internal({type: 'CANCEL_WEBSITE_ACTION'}, {}, resolve));
  check(!s.storage.session.pendingWebsiteAction && s.calls.reports[0].status === 'cancelled', 'prepared cancellation reaches website');
  for (const [options, expected] of [
    [{age: 1000}, 0], [{age: 172800000}, 1], [{age: 172800000, remind: false}, 0],
    [{age: 172800000, cooldown: Date.now()}, 0], [{}, 1],
  ]) {
    s = setup(options); await vm.runInContext('maybeRemindToUpdate()', s.context);
    check(s.calls.popup === expected, 'reminder freshness, opt-out, cooldown, or server fallback');
  }
  console.log(`${passed} extension checks passed`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
