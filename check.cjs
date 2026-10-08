// Scripted Chrome harness: node check.cjs. No browser, credentials, or GOLD data.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync(path.join(__dirname, 'background.js'), 'utf8')
  .replace(/^import .*?;\n/gms, '');
const requestId = '11111111-1111-4111-8111-111111111111';

function setup({getStatus = 200, action = 'add_major', postStatus = 200, resultStatus = 'success',
  auditFails = false, closeAt = null, missingTab = false, hangAt = null, hangChromeAt = null,
  closeDuringPost = false, committedThenLost = false, initialLocal = {}} = {}) {
  const storage = {local: {...initialLocal}, session: {}};
  let tabExists = !missingTab;
  let shouldClose = closeAt;
  let shouldHang = hangAt;
  const listeners = {};
  const calls = {popup: 0, tabs: 0, posts: [], selections: [], reports: []};
  const job = {request_id: requestId, action, status: 'pending', popup: {
    title: 'Website action title', detail: 'Website explanation', confirm_label: 'Website confirm label',
    running_message: 'Website running message',
  }, audit_selection: {
    major_area: {value: 'ENGR', label: 'Engineering'}, audit: {value: 'CMPSC-BS', label: 'CS'},
  }};
  const makeStorage = (area) => ({
    get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, storage[area][key]])),
    set: async (patch) => Object.assign(storage[area], patch),
    remove: async (keys) => (Array.isArray(keys) ? keys : [keys]).forEach((key) => delete storage[area][key]),
  });
  const chrome = {
    runtime: {
      id: 'synthetic', getManifest: () => ({version: '1.3'}),
      onInstalled: {addListener() {}},
      onMessageExternal: {addListener: (fn) => { listeners.external = fn; }},
      onMessage: {addListener: (fn) => { listeners.internal = fn; }},
    },
    storage: {local: makeStorage('local'), session: makeStorage('session')},
    tabs: {
      onRemoved: {addListener: (fn) => { listeners.removed = fn; }},
      create: async () => { calls.tabs++; tabExists = true; return {id: 1}; }, update: async () => {},
      get: async () => {
        if (!tabExists) throw new Error('No tab with id: 1');
        return {url: 'https://my.sa.ucsb.edu/gold/AcademicProgress.aspx'};
      }, remove: async (id) => { tabExists = false; listeners.removed(id); },
    },
    action: {
      openPopup: async () => { calls.popup++; }, setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {},
    },
    scripting: {executeScript: async ({func, args}) => {
      if (func.name === hangChromeAt) {
        setImmediate(() => { tabExists = false; listeners.removed(1); });
        return new Promise(() => {});
      }
      if (func.name === shouldClose) {
        shouldClose = null;
        tabExists = false;
        if (!missingTab) listeners.removed(1);
      }
      if (!tabExists) throw new Error('No tab with id: 1');
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
    chrome, URL, Date, Set, Promise, Error, AbortController, clearTimeout, crypto: {randomUUID: () => 'test'},
    setTimeout: (fn, ms) => setTimeout(fn, ms >= 5000 && !hangAt ? ms : 0),
    fetch: async (url, opts = {}) => {
      if (shouldHang && url.includes(shouldHang)) {
        shouldHang = null;
        return new Promise((_resolve, reject) => opts.signal.addEventListener('abort', () => reject(new Error('Timeout')), {once: true}));
      }
      if (url.includes('/sync-requests/')) {
        if (opts.method === 'POST') {
          const report = JSON.parse(opts.body); calls.reports.push(report);
          if (!['success', 'partial', 'error', 'cancelled'].includes(job.status)) Object.assign(job, report);
        }
        return response(200, {...job});
      }
      if (opts.method === 'POST') {
        calls.posts.push(JSON.parse(opts.body));
        if (postStatus !== 200 && !(postStatus === 409 && JSON.parse(opts.body).confirm_major_change)) return response(postStatus, {message: 'The update could not be saved.',
          ...(postStatus === 409 ? {error: 'program_code_mismatch'} : {})});
        job.status = resultStatus;
        job.message = 'Website saved result.';
        if (closeDuringPost) listeners.removed(1);
        if (committedThenLost) throw new Error('Connection lost after commit');
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
  return {context, storage, listeners, calls, job};
}
let passed = 0;
function check(condition, label) { assert.ok(condition, label); passed++; }
async function popupScenario(initialState) {
  let state = initialState;
  const elements = {};
  const messages = [];
  const tabs = [];
  const storageListeners = [];
  const context = vm.createContext({
    document: {getElementById(id) {
      return elements[id] ??= {hidden: true, disabled: false, textContent: "", events: {},
        classList: {toggle() {}}, addEventListener(type, callback) { this.events[type] = callback; }};
    }},
    chrome: {
      runtime: {sendMessage: async (message) => {
        messages.push(message);
        return message.type === 'GET_POPUP_STATE' ? state : {started: true};
      }},
      storage: {onChanged: {addListener: (fn) => storageListeners.push(fn)}},
      action: {setBadgeText() {}}, tabs: {create: (tab) => tabs.push(tab)},
    },
    UCSBPLAT_ORIGIN: 'https://ucsbplat.com',
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'popup.js'), 'utf8').replace(/^import .*;\n/m, ''), context);
  await new Promise((resolve) => setImmediate(resolve));
  return {elements, messages, tabs, async update(next) {
    state = next;
    storageListeners[0]({lastRun: {}}, 'local');
    await new Promise((resolve) => setImmediate(resolve));
  }};
}
(async () => {
  let s = setup(); let reply;
  s.listeners.external({type: 'UCSBPLAT_PREPARE_ACTION', action: 'add_major', requestId}, {url: 'https://evil.example'}, (r) => { reply = r; });
  check(reply === undefined && !s.storage.session.pendingWebsiteAction, 'untrusted origin rejected');
  s.listeners.external({type: 'UCSBPLAT_PREPARE_ACTION', action: 'arbitrary', requestId}, {url: 'https://ucsbplat.com'}, (r) => { reply = r; });
  check(reply.error === 'unsupported_action', 'unknown action rejected');
  s.listeners.external({type: 'UCSBPLAT_EXTENSION_PING'}, {url: 'https://ucsbplat.com'}, (r) => { reply = r; });
  check(reply.protocolVersion === 4, 'protocol version identifies request-aware extension');
  await vm.runInContext(`prepareWebsiteAction('add_major', '${requestId}')`, s.context);
  check(s.storage.session.pendingWebsiteAction.requestId === requestId && s.calls.tabs === 0, 'preparation does not start GOLD');
  await vm.runInContext(`runSync('add_major', '${requestId}')`, s.context);
  check(s.calls.posts[0].action === 'add_major' && s.calls.posts[0].request_id === requestId, 'website request carried through submission');
  check(s.calls.selections.length === 0 && s.calls.posts[0].schedule_page, 'add-major captures schedule using current GOLD choice');
  check(s.storage.local.lastRun.message === 'Website saved result.', 'popup uses website result');
  check(!JSON.stringify(s.storage).includes('<html>'), 'captured HTML never stored');
  s = setup({action: 'sync_all'}); await vm.runInContext(`runSync('sync_all', '${requestId}')`, s.context);
  check(s.calls.selections.length === 2 && s.calls.selections[1][1].value === 'CMPSC-BS', 'normal sync restores primary selectors');
  s = setup({action: 'refresh_major'}); await vm.runInContext(`runSync('refresh_major', '${requestId}')`, s.context);
  check(s.calls.selections[1][1].value === 'CMPSC-BS', 'selected major refresh uses server-owned selectors');
  s = setup({action: 'sync_all', resultStatus: 'partial'}); await vm.runInContext(`runSync('sync_all', '${requestId}')`, s.context);
  check(s.storage.local.lastRun.status === 'partial', 'partial save never presented as complete');
  s = setup({postStatus: 400}); await vm.runInContext(`runSync('add_major', '${requestId}')`, s.context);
  check(s.storage.local.lastRun.status === 'error' && s.calls.reports.some((r) => r.status === 'error'), 'failure reaches popup and website');
  s = setup({auditFails: true}); await vm.runInContext(`runSync('add_major', '${requestId}')`, s.context);
  check(s.calls.posts.length === 0 && s.storage.local.lastRun.status === 'error', 'failed add-major capture does not submit schedule-only success');
  s = setup({getStatus: 403}); await vm.runInContext(`runSync('add_major', '${requestId}')`, s.context);
  check(s.calls.tabs === 0 && s.storage.local.lastRun.status === 'error', 'rejected preflight stops before GOLD');
  s = setup(); await vm.runInContext(`prepareWebsiteAction('add_major', '${requestId}')`, s.context);
  await new Promise((resolve) => s.listeners.internal({type: 'CANCEL_WEBSITE_ACTION'}, {}, resolve));
  check(!s.storage.session.pendingWebsiteAction && s.calls.reports[0].status === 'cancelled', 'prepared cancellation reaches website');
  s = setup();
  reply = await new Promise((resolve) => s.listeners.internal({type: 'START_SYNC'}, {}, resolve));
  check(!reply.started && s.calls.tabs === 0, 'raw popup cannot fall back to standalone sync');
  await vm.runInContext(`prepareWebsiteAction('add_major', '${requestId}')`, s.context);
  reply = await new Promise((resolve) => s.listeners.internal({type: 'START_SYNC', requestId: 'other'}, {}, resolve));
  check(!reply.started && s.calls.tabs === 0, 'confirmation must match prepared website request');
  s.storage.session.pendingWebsiteAction.requestedAt = 0;
  reply = await new Promise((resolve) => s.listeners.internal({type: 'START_SYNC', requestId}, {}, resolve));
  check(!reply.started && s.calls.tabs === 0, 'expired confirmation never starts fallback sync');
  await new Promise((resolve) => s.listeners.internal({type: 'GET_POPUP_STATE'}, {}, resolve));
  check(!s.storage.session.pendingWebsiteAction && s.calls.reports.some((r) => r.status === 'cancelled'), 'expired request is cleared and reported');
  s = setup(); delete s.job.popup;
  await assert.rejects(vm.runInContext(`prepareWebsiteAction('add_major', '${requestId}')`, s.context));
  check(s.calls.tabs === 0, 'website must supply popup presentation');

  const internal = (s, message) => new Promise((resolve) => s.listeners.internal(message, {}, resolve));
  const idle = async (s) => {
    for (let i=0; i<1000; i++) {
      if (!vm.runInContext('running', s.context)) return;
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    throw new Error('worker stayed locked');
  };
  for (const action of ['sync_all', 'add_major', 'refresh_major']) {
    for (const closeAt of ['documentState', 'scheduleState', 'auditReadyState', 'domSize']) {
      s = setup({action, closeAt});
      await vm.runInContext(`prepareWebsiteAction('${action}', '${requestId}')`, s.context);
      reply = await internal(s, {type: 'START_SYNC', requestId});
      check(reply.started, 'prepared request starts after confirmation');
      await idle(s);
      check(s.calls.posts.length === 0, `${action}: closing GOLD during ${closeAt} never submits a partial capture`);
      check(s.storage.local.lastRun.status === 'error' && s.storage.local.lastRun.message.includes('GOLD tab was closed'), 'closed tab produces actionable failure');
      check(s.job.status === 'error', 'closed-tab failure reaches website');
      check(!vm.runInContext('running', s.context), 'worker releases the run lock');
      s.job.status = 'pending';
      await vm.runInContext(`prepareWebsiteAction('${action}', '${requestId}')`, s.context);
      await internal(s, {type: 'START_SYNC', requestId});
      await idle(s);
      check(s.storage.local.lastRun.status === 'success', 'new website request works after tab closure');
    }
  }
  s = setup({action: 'sync_all', closeAt: 'documentState', missingTab: true});
  await vm.runInContext(`runSync('sync_all', '${requestId}')`, s.context);
  check(s.calls.posts.length === 0 && s.storage.local.lastRun.message.includes('GOLD tab was closed'), 'missing-tab API failure works even without onRemoved notification');
  s = setup({hangChromeAt: 'documentState'});
  await vm.runInContext(`prepareWebsiteAction('add_major', '${requestId}')`, s.context);
  await internal(s, {type: 'START_SYNC', requestId}); await idle(s);
  check(s.calls.posts.length === 0 && s.storage.local.lastRun.status === 'error', 'tab closure interrupts an injection whose Chrome promise never settles');
  s = setup({action: 'sync_all', auditFails: true});
  await vm.runInContext(`runSync('sync_all', '${requestId}')`, s.context);
  check(s.calls.posts.length === 1, 'ordinary audit capture failure still allows schedule-only sync');
  s = setup(); s.listeners.removed(999);
  await vm.runInContext(`runSync('add_major', '${requestId}')`, s.context);
  check(s.storage.local.lastRun.status === 'success', 'closing unrelated tab does not abort sync');
  s = setup({closeDuringPost: true});
  await vm.runInContext(`runSync('add_major', '${requestId}')`, s.context);
  check(s.storage.local.lastRun.status === 'success', 'closing GOLD after submission does not overwrite committed success');
  s = setup({committedThenLost: true});
  await vm.runInContext(`runSync('add_major', '${requestId}')`, s.context);
  check(s.storage.local.lastRun.status === 'success' && s.storage.local.lastRun.message === s.job.message, 'website receipt resolves a lost response after commit');
  s = setup({action: 'sync_all', postStatus: 409});
  await vm.runInContext(`prepareWebsiteAction('sync_all', '${requestId}')`, s.context);
  await internal(s, {type: 'START_SYNC', requestId}); await idle(s);
  check(s.storage.local.lastRun.status === 'confirm' && s.storage.local.pendingChange.requestId === requestId, 'major replacement waits for explicit website-owned confirmation');
  reply = await internal(s, {type: 'START_SYNC', requestId});
  check(!reply.started, 'major confirmation cannot be bypassed by starting another sync');
  await internal(s, {type: 'CONFIRM_MAJOR_CHANGE'}); await idle(s);
  check(s.calls.posts[1].confirm_major_change === true && s.storage.local.lastRun.status === 'success', 'confirmed replacement resends in-memory pages and server decides success');

  s = setup({initialLocal: {lastRun: {status: 'running', requestId}}});
  await internal(s, {type: 'GET_POPUP_STATE'});
  check(s.storage.local.lastRun.status === 'error' && s.job.status === 'error', 'worker restart reports interruption instead of remaining running');
  s = setup({initialLocal: {lastRun: {status: 'running', requestId}}});
  s.job.status = 'success'; s.job.message = 'Already saved on website';
  await internal(s, {type: 'GET_POPUP_STATE'});
  check(s.storage.local.lastRun.status === 'success' && s.storage.local.lastRun.message === s.job.message, 'restart after commit preserves website success');
  s = setup({initialLocal: {lastRun: {status: 'confirm', requestId}, pendingChange: {requestId}}});
  await internal(s, {type: 'GET_POPUP_STATE'});
  check(!s.storage.local.pendingChange && s.job.status === 'error', 'restart expires confirmation whose captured pages were lost');
  for (const hangAt of ['/session', '/gold-sync']) {
    s = setup({hangAt});
    await vm.runInContext(`prepareWebsiteAction('add_major', '${requestId}')`, s.context);
    await internal(s, {type: 'START_SYNC', requestId}); await idle(s);
    check(s.storage.local.lastRun.status === 'error' && !vm.runInContext('running', s.context), 'hung website request times out and releases worker');
  }
  s = setup();
  await vm.runInContext(`prepareWebsiteAction('add_major', '${requestId}')`, s.context);
  const starts = await Promise.all([internal(s, {type: 'START_SYNC', requestId}), internal(s, {type: 'START_SYNC', requestId})]);
  await idle(s);
  check(starts.filter((r) => r.started).length === 1 && s.calls.tabs === 1, 'concurrent confirmation clicks start exactly one run');
  check(!s.storage.local.lastSync && !JSON.stringify(s.storage).includes('<html>'), 'extension stores neither detailed sync history nor captured pages');
  let p = await popupScenario({lastRun: {status: 'success', message: 'Old result', requestId}});
  check(!p.elements.intro.hidden && p.elements.run.hidden && p.elements.websiteAction.hidden, 'raw popup directs to website with no standalone action');
  check(p.elements.status.textContent === '' && !('summary' in p.elements), 'raw popup does not show past sync details');
  p.elements.website.events.click();
  check(p.tabs[0].url === 'https://ucsbplat.com/profile/', 'website link opens profile');
  s = setup();
  const popup = s.job.popup;
  p = await popupScenario({pendingWebsiteAction: {requestId, popup}});
  check(p.elements.websiteActionTitle.textContent === popup.title && p.elements.websiteActionDetail.textContent === popup.detail, 'popup renders website action copy');
  check(p.elements.run.textContent === popup.confirm_label && !p.elements.run.hidden, 'website controls confirmation label');
  await p.elements.run.events.click();
  check(p.messages.some((m) => m.type === 'START_SYNC' && m.requestId === requestId), 'popup confirms the exact website request');
  await p.update({lastRun: {requestId, popup, status: 'running', step: 'Detailed automation step'}});
  check(p.elements.run.hidden && p.elements.status.textContent === popup.running_message, 'active popup shows website running copy without automation details');
  await p.update({lastRun: {requestId, popup, status: 'partial', message: 'Website partial save message'}});
  check(p.elements.status.textContent === 'Website partial save message', 'live popup displays server partial result');
  await p.update({lastRun: {requestId, popup, status: 'confirm'}, pendingChange: {requestId, message: 'Website asks for major replacement'}});
  check(!p.elements.confirm.hidden && p.elements.confirmMessage.textContent === 'Website asks for major replacement', 'major-change prompt uses website message');
  p = await popupScenario({lastRun: {requestId, popup, status: 'running'}});
  check(!p.elements.websiteAction.hidden && p.elements.status.textContent === popup.running_message, 'reopening during a run resumes website action');
  await p.update({lastRun: {requestId, popup, status: 'error', message: 'The GOLD tab was closed.'}});
  check(p.elements.run.hidden && p.elements.status.textContent.includes('GOLD tab was closed'), 'closed tab presents failure and website link without standalone retry');
  console.log(`${passed} extension checks passed`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
