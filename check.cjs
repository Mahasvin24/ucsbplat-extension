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
  closeDuringPost = false, committedThenLost = false, initialLocal = {}, audits = null,
  wrongSelection = false, unchecked = false, failAuditValue = null, staleResults = 0, closeAuditValue = null,
  resetSelectionAfterRun = false, scheduleDelay = 0} = {}) {
  const storage = {local: {...initialLocal}, session: {}};
  let tabExists = !missingTab;
  let shouldClose = closeAt;
  let shouldHang = hangAt;
  const listeners = {updated: []};
  const calls = {popup: 0, tabs: 0, posts: [], selections: [], reports: [], injections: [], runs: [], tabOptions: [], focused: 0};
  let syncWindowExists = false;
  const job = {request_id: requestId, action, status: 'pending', popup: {
    title: 'Website action title', detail: 'Website explanation', confirm_label: 'Website confirm label',
    running_message: 'Website running message',
  }, audit_selection: {
    major_area: {value: 'ENGR', label: 'Engineering'}, audit: {value: 'CMPSC-BS', label: 'CS'},
  }};
  if (audits) job.audits = audits;
  let selected = {major_area: {value: 'LS', label: 'Letters and Science'}, audit: {value: 'MATH-BS', label: 'Math'}};
  const makeStorage = (area) => ({
    get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map((key) => [key, storage[area][key]])),
    set: async (patch) => { if (patch.lastRun) calls.runs.push({...patch.lastRun}); Object.assign(storage[area], patch); },
    remove: async (keys) => (Array.isArray(keys) ? keys : [keys]).forEach((key) => delete storage[area][key]),
  });
  const chrome = {
    runtime: {
      id: 'synthetic', getManifest: () => ({version: '1.6'}), getURL: name => `chrome-extension://synthetic/${name}`,
      onInstalled: {addListener() {}},
      onMessageExternal: {addListener: (fn) => { listeners.external = fn; }},
      onMessage: {addListener: (fn) => { listeners.internal = fn; }},
    },
    storage: {local: makeStorage('local'), session: makeStorage('session')},
    tabs: {
      onUpdated: {addListener: (fn) => listeners.updated.push(fn)},
      onRemoved: {addListener: (fn) => { listeners.removed = fn; }},
      create: async (options) => { calls.tabs++; calls.tabOptions.push(options); tabExists = true; return {id: 1}; }, update: async () => {},
      get: async () => {
        if (!tabExists) throw new Error('No tab with id: 1');
        return {url: 'https://my.sa.ucsb.edu/gold/AcademicProgress.aspx'};
      }, remove: async (id) => { tabExists = false; listeners.removed(id); },
    },
    windows: {
      create: async (options) => { calls.popup++; syncWindowExists = true; calls.windowOptions = options; return {id: 99}; },
      update: async () => { if (!syncWindowExists) throw new Error('Closed window'); calls.focused++; return {id: 99}; },
      getLastFocused: async () => ({id: 10}),
    },
    action: {
      onClicked: {addListener: fn => {listeners.toolbarClick = fn;}},
      openPopup: async () => { calls.popup++; }, setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {},
    },
    scripting: {executeScript: async ({func, args}) => {
      calls.injections.push(func.name);
      if (func.name === hangChromeAt) {
        setImmediate(() => { tabExists = false; listeners.removed(1); });
        return new Promise(() => {});
      }
      if (func.name === shouldClose) {
        shouldClose = null;
        tabExists = false;
        if (!missingTab) listeners.removed(1);
      }
      if (func.name === 'auditReadyState' && selected.audit.value === closeAuditValue) {
        tabExists = false;
        listeners.removed(1);
      }
      if (!tabExists) throw new Error('No tab with id: 1');
      let result;
      switch (func.name) {
        case 'documentState': result = {ready: true, marked: false}; break;
        case 'scheduleState': result = {found: true, ready: scheduleDelay-- <= 0, quarter: 'FALL 2026'}; break;
        case 'auditSelectionState': result = {found: true, ready: true, signature: JSON.stringify(selected), majorArea: selected.major_area, audit: selected.audit}; break;
        case 'ensureInProgressChecked': result = {found: !auditFails, checked: !auditFails && !unchecked}; break;
        case 'clickRunAudit':
          if (resetSelectionAfterRun) selected = {major_area: {value: 'DEFAULT', label: 'Other major'}, audit: {value: 'DEFAULT-BS', label: 'Other progress check'}};
          result = {found: true};
          break;
        case 'auditReadyState': result = {hasResults: true, freshResults: staleResults-- <= 0, running: false}; break;
        case 'dismissWelcomeLetter': result = {clicked: false}; break;
        case 'domSize': result = 1; break;
        case 'capturePage': result = '<html>synthetic</html>'; break;
        case 'chooseAuditOption':
          calls.selections.push(args);
          if (!wrongSelection) selected[args[0]] = {value: args[1].value || (args[0] === 'major_area' ? 'LS' : 'MATH-BS'), label: args[1].label};
          result = {found: true, matched: args[1].value !== failAuditValue, changed: true};
          break;
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
  listeners.closeSyncWindow = () => { syncWindowExists = false; listeners.removed(50); };
  return {context, storage, listeners, calls, job};
}
let passed = 0;
function check(condition, label) { assert.ok(condition, label); passed++; }
async function popupScenario(initialState, {respond} = {}) {
  let state = initialState;
  const elements = {};
  const messages = [];
  const tabs = [];
  const storageListeners = [];
  const context = vm.createContext({
    document: {body: {dataset: {}}, createElement() { return {textContent: ''}; }, getElementById(id) {
      return elements[id] ??= {hidden: true, disabled: false, textContent: "", events: {},
        children: [], replaceChildren(...children) { this.children = children; },
        classList: {toggle() {}}, addEventListener(type, callback) { this.events[type] = callback; }};
    }},
    chrome: {
      runtime: {sendMessage: async (message) => {
        messages.push(message);
        if (respond) return respond(message, state);
        return message.type === 'GET_POPUP_STATE' ? state : {started: true};
      }},
      storage: {onChanged: {addListener: (fn) => storageListeners.push(fn)}},
      action: {setBadgeText() {}}, tabs: {create: (tab) => tabs.push(tab)},
      windows: {getLastFocused: async () => ({id: 10})},
    },
    UCSBPLAT_ORIGIN: 'https://ucsbplat.com',
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, 'popup.js'), 'utf8').replace(/^import .*;\n/m, ''), context);
  await new Promise((resolve) => setImmediate(resolve));
  return {elements, messages, tabs, body: context.document.body, async update(next) {
    state = next;
    storageListeners[0]({lastRun: {}}, 'local');
    await new Promise((resolve) => setImmediate(resolve));
  }};
}
(async () => {
  let s = setup(); let reply;
  s.storage.local.lastSync = {syncedAt: Date.now() - 3 * 86400000};
  for (const url of ['https://ucsbplat.com/', 'https://ucsbplat.com/profile/', 'https://ucsbplat.com/profile/home',
    'http://localhost:12345/', 'http://localhost:12345/profile/home', 'https://example.com/',
    'https://my.sa.ucsb.edu/gold/StudentSchedule.aspx']) {
    for (const listener of s.listeners.updated) listener(99, {status: 'complete'}, {active: true, url});
  }
  await new Promise((resolve) => setImmediate(resolve));
  check(s.calls.popup === 0 && s.calls.tabs === 0, 'loading profile or GOLD pages never opens popup or starts automation, even with stale legacy sync data');
  for (const origin of ['https://ucsbplat.com', 'http://localhost:12345']) {
    for (let i = 0; i < 3; i++) {
      s.listeners.external({type: 'UCSBPLAT_EXTENSION_PING'}, {url: origin}, () => {});
    }
  }
  check(s.calls.popup === 0, 'repeated website extension detection on production and localhost never opens popup');
  s.listeners.external({type: 'UCSBPLAT_OPEN_POPUP'}, {url: 'https://ucsbplat.com'}, (r) => { reply = r; });
  check(reply === undefined && s.calls.popup === 0, 'legacy popup-only command cannot open popup');
  for (const origin of ['https://ucsbplat.com', 'http://localhost:12345']) {
    for (const action of ['add_major', 'sync_all', 'refresh_major']) {
      const clicked = setup({action});
      const response = await new Promise((resolve) => clicked.listeners.external(
        {type: 'UCSBPLAT_PREPARE_ACTION', action, requestId}, {url: `${origin}/profile/home`}, resolve));
      check(response.ok && response.opened && clicked.calls.popup === 1 && clicked.calls.tabs === 0,
        `${origin} ${action} button request opens one confirmation without starting GOLD`);
    }
  }
  s = setup();
  s.listeners.external({type: 'UCSBPLAT_PREPARE_ACTION', action: 'add_major', requestId}, {url: 'https://evil.example'}, (r) => { reply = r; });
  check(reply === undefined && !s.storage.session.pendingWebsiteAction, 'untrusted origin rejected');
  s.listeners.external({type: 'UCSBPLAT_PREPARE_ACTION', action: 'arbitrary', requestId}, {url: 'https://ucsbplat.com'}, (r) => { reply = r; });
  check(reply.error === 'unsupported_action', 'unknown action rejected');
  s.listeners.external({type: 'UCSBPLAT_EXTENSION_PING'}, {url: 'https://ucsbplat.com'}, (r) => { reply = r; });
  check(reply.protocolVersion === 5, 'protocol version identifies multi-major extension');
  await vm.runInContext(`prepareWebsiteAction('add_major', '${requestId}')`, s.context);
  check(s.storage.session.pendingWebsiteAction.requestId === requestId && s.calls.tabs === 0, 'preparation does not start GOLD');
  await vm.runInContext(`runSync('add_major', '${requestId}')`, s.context);
  check(s.calls.posts[0].action === 'add_major' && s.calls.posts[0].request_id === requestId, 'website request carried through submission');
  check(s.calls.tabOptions[0].windowId === 10 && s.calls.tabOptions[0].active === false,
    'GOLD stays in the normal browser window without replacing the sync window');
  check(!s.calls.windowOptions && s.calls.popup === 1, 'website confirmation opens the normal toolbar popup without a new window');
  check(s.calls.runs.some(run => run.progress?.current === 2 && run.progress.total === 7)
    && s.storage.local.lastRun.progress.current === 7, 'single-major sync reports 7 numbered stages through server completion');
  check(s.calls.selections.length === 2 && s.calls.posts[0].schedule_page, 'add-major explicitly restores both requested fields and captures schedule');
  check(s.storage.local.lastRun.message === 'Website saved result.', 'popup uses website result');
  check(!JSON.stringify(s.storage).includes('<html>'), 'captured HTML never stored');
  s = setup({initialLocal: {lastRun: {requestId: 'old-request', status: 'success',
    progress: {current: 10, total: 10}}}});
  await vm.runInContext(`runSync('add_major', '${requestId}')`, s.context);
  check(s.calls.reports[0].progress === undefined && s.calls.runs[0].progress === null,
    'new run does not report or display the previous run at 100 percent');
  check(s.calls.reports.filter(r => r.progress).every(r => r.progress.total === 7),
    'new request never borrows the previous run step count');
  s = setup({resultStatus: 'partial'});
  await vm.runInContext(`runSync('add_major', '${requestId}')`, s.context);
  check(s.storage.local.lastRun.progress.current === 6 && s.storage.local.lastRun.progress.total === 7,
    'partial save keeps the progress reached instead of claiming 100 percent');
  s = setup({scheduleDelay: 2});
  await vm.runInContext(`runSync('add_major', '${requestId}')`, s.context);
  check(s.calls.injections.filter(name => name === 'scheduleState').length === 3 && s.calls.posts[0].schedule_page,
    'schedule capture polls until content is ready before capturing');
  s = setup({action: 'sync_all'}); await vm.runInContext(`runSync('sync_all', '${requestId}')`, s.context);
  check(s.calls.selections.length === 2 && s.calls.selections[1][1].value === 'CMPSC-BS', 'normal sync restores primary selectors');
  const targets = [
    {audit_id: 1, label: 'CS B.S.', audit_selection: {major_area: {value: 'ENGR', label: 'Engineering'}, audit: {value: 'CMPSC-BS', label: 'CS B.S.'}}},
    {audit_id: 2, label: 'BS - Applied Mathematics', audit_selection: {major_area: {value: 'LS', label: 'Applied Mathematics'}, audit: {value: 'MATH-BS', label: 'BS - Applied Mathematics'}}},
  ];
  s = setup({action: 'sync_all', audits: targets});
  await vm.runInContext(`runSync('sync_all', '${requestId}')`, s.context);
  check(s.calls.posts[0].major_progress_checks.length === 2 && s.calls.posts[0].major_progress_checks[1].audit_id === 2,
    'full update submits one capture per website-owned major');
  check(s.calls.injections.filter((name) => name === 'scheduleState').length === 1,
    'multi-major update captures current courses only once');
  check(s.calls.selections.map(([kind, option]) => `${kind}:${option.value}`).join(',')
    === 'major_area:ENGR,audit:CMPSC-BS,major_area:LS,audit:MATH-BS', 'both dependent selectors are applied in order for every major');
  check(s.calls.runs.some((run) => run.step.includes('Checking your current courses'))
    && s.calls.runs.some((run) => run.step.includes('Running the major progress check for CS B.S.'))
    && s.calls.runs.some((run) => run.step.includes('Running the major progress check for BS - Applied Mathematics')),
    'running progress identifies current courses and each requested major');
  check(s.calls.reports.some((report) => report.message.includes('BS - Applied Mathematics')),
    'website receives live major progress as well as the popup');
  check(!JSON.stringify(s.storage).includes('<html>'), 'multi-major HTML remains in memory only');
  check(s.calls.runs.some(run => run.progress?.current === 7 && run.progress.total === 10)
    && s.storage.local.lastRun.progress.current === 10, 'two-major sync reports 10 stages with a distinct second audit run');
  for (const action of ['add_major', 'refresh_major', 'sync_all']) {
    s = setup({action, resetSelectionAfterRun: true, ...(action === 'sync_all' ? {audits: targets} : {})});
    await vm.runInContext(`runSync('${action}', '${requestId}')`, s.context);
    const captures = s.calls.posts[0]?.major_progress_checks ?? [s.calls.posts[0]];
    check(s.storage.local.lastRun.status === 'success' && captures[0]?.audit_selection.audit.value === 'CMPSC-BS',
      `${action}: post-run dropdown reset does not invalidate the generated audit or overwrite its pre-run selection`);
    if (action === 'sync_all') check(captures[1]?.audit_selection.audit.value === 'MATH-BS',
      'next major is explicitly restored after GOLD resets the previous dropdowns');
  }
  s = setup({action: 'sync_all', audits: targets, failAuditValue: 'MATH-BS', resultStatus: 'partial'});
  await vm.runInContext(`runSync('sync_all', '${requestId}')`, s.context);
  check(s.calls.posts[0].major_progress_checks[1].major_progress_check === '' && s.storage.local.lastRun.status === 'partial',
    'one failed major is explicitly represented and server decides partial result');
  s = setup({action: 'sync_all', audits: targets, closeAuditValue: 'MATH-BS'});
  await vm.runInContext(`runSync('sync_all', '${requestId}')`, s.context);
  check(s.calls.posts.length === 0 && s.storage.local.lastRun.status === 'error',
    'closing GOLD on the second major aborts the whole capture without submitting earlier pages');
  for (const options of [{wrongSelection: true}, {unchecked: true}]) {
    s = setup(options);
    await vm.runInContext(`runSync('add_major', '${requestId}')`, s.context);
    check(!s.calls.injections.includes('clickRunAudit') && s.calls.posts.length === 0,
      'selection mismatch or unchecked in-progress courses blocks audit execution and submission');
  }
  s = setup({staleResults: 3});
  await vm.runInContext(`runSync('add_major', '${requestId}')`, s.context);
  check(s.calls.injections.filter((name) => name === 'auditReadyState').length === 4 && s.calls.posts.length === 1,
    'previous audit results are ignored until a fresh result is ready');
  s = setup(); delete s.job.audit_selection;
  await vm.runInContext(`runSync('add_major', '${requestId}')`, s.context);
  check(s.calls.tabs === 0 && s.calls.posts.length === 0, 'new major import cannot fall back to an unspecified GOLD choice');
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
  s = setup({getStatus: 401}); await vm.runInContext(`runSync('add_major', '${requestId}')`, s.context);
  check(s.storage.local.lastRun.status === 'signin' && s.calls.tabOptions[0].windowId === 10
    && s.calls.tabOptions[0].active === false, 'sign-in recovery keeps the extension window visible');
  s = setup(); await vm.runInContext(`prepareWebsiteAction('add_major', '${requestId}')`, s.context);
  await new Promise((resolve) => s.listeners.internal({type: 'CANCEL_WEBSITE_ACTION'}, {}, resolve));
  check(!s.storage.session.pendingWebsiteAction && s.calls.reports[0].status === 'cancelled', 'prepared cancellation reaches website');
  check(s.storage.local.lastRun.status === 'cancelled' && s.storage.local.lastRun.requestId === requestId,
    'prepared cancellation retains feedback for the open popup');
  s = setup();
  reply = await new Promise((resolve) => s.listeners.internal({type: 'START_SYNC'}, {}, resolve));
  check(!reply.started && s.calls.tabs === 0, 'raw popup cannot fall back to standalone sync');
  await vm.runInContext(`prepareWebsiteAction('add_major', '${requestId}')`, s.context);
  reply = await new Promise((resolve) => s.listeners.internal({type: 'START_SYNC', requestId: 'other'}, {}, resolve));
  check(!reply.started && s.calls.tabs === 0, 'confirmation must match prepared website request');
  s.storage.session.pendingWebsiteAction.requestedAt = 0;
  reply = await new Promise((resolve) => s.listeners.internal({type: 'START_SYNC', requestId}, {}, resolve));
  check(!reply.started && s.calls.tabs === 0, 'expired confirmation never starts fallback sync');
  reply = await new Promise((resolve) => s.listeners.internal({type: 'GET_POPUP_STATE'}, {}, resolve));
  check(!s.storage.session.pendingWebsiteAction && s.calls.reports.some((r) => r.status === 'cancelled'), 'expired request is cleared and reported');
  check(reply.expiredRequestId === requestId && reply.lastRun.status === 'expired' && reply.lastRun.popup,
    'expired confirmation has a visible result instead of silently reverting to idle');
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
  s = setup();
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));
  check(manifest.action.default_popup === 'popup.html', 'toolbar uses the standard Chrome popup');
  await vm.runInContext(`prepareWebsiteAction('add_major', '${requestId}')`, s.context);
  await internal(s, {type: 'START_SYNC', requestId});
  await idle(s);
  check(s.calls.posts.length === 1 && !s.calls.windowOptions,
    'background sync completes without any persistent extension window');
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
  check(s.storage.local.lastRun.progress.current === s.storage.local.lastRun.progress.total,
    'recovered committed success completes the progress bar');
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
  check(!p.elements.website.hidden, 'empty toolbar popup offers the website entry point');
  check(p.elements.status.textContent === '' && !('summary' in p.elements), 'raw popup does not show past sync details');
  await p.elements.website.events.click();
  check(p.tabs[0].url === 'https://ucsbplat.com/profile/', 'website link opens profile');
  check(!p.elements.debug.hidden, 'temporary debug button is available for manual testing');
  await p.elements.debug.events.click();
  check(p.tabs[1].url === 'https://ucsbplat.com/profile/sync-debug'
    && !p.messages.some(m => m.type === 'START_SYNC'), 'debug button opens website consent without starting automation');
  s = setup();
  const popup = s.job.popup;
  p = await popupScenario({pendingWebsiteAction: {requestId, popup}});
  check(p.elements.debug.hidden, 'manual debug button stays hidden during confirmation');
  check(p.elements.websiteActionTitle.textContent === popup.title && p.elements.websiteActionDetail.textContent === popup.detail, 'popup renders website action copy');
  check(p.elements.run.textContent === popup.confirm_label && !p.elements.run.hidden, 'website controls confirmation label');
  await p.elements.run.events.click();
  check(p.messages.some((m) => m.type === 'START_SYNC' && m.requestId === requestId), 'popup confirms the exact website request');
  await p.update({lastRun: {requestId, popup, status: 'running', step: 'Detailed automation step'}});
  check(p.elements.run.hidden && p.elements.status.textContent === 'Follow progress on your UCSBPlat profile.', 'active popup directs progress to the website');
  await p.update({lastRun: {requestId, popup, status: 'running', step: 'Running the major progress check for BS - Applied Mathematics…'}});
  check(p.elements.status.textContent === 'Follow progress on your UCSBPlat profile.' && p.elements.website.hidden,
    'progress updates name the major without adding website navigation');
  await p.update({lastRun: {requestId, popup, status: 'partial', message: 'Website partial save message'}});
  check(p.elements.status.textContent === 'Website partial save message', 'live popup displays server partial result');
  await p.update({lastRun: {requestId, popup, status: 'confirm'}, pendingChange: {requestId, message: 'Website asks for major replacement'}});
  check(!p.elements.confirm.hidden && p.elements.website.hidden && p.elements.confirmMessage.textContent === 'Website asks for major replacement', 'major-change prompt uses website message without website navigation');
  p = await popupScenario({lastRun: {requestId, popup, status: 'running'}});
  check(p.body.dataset.state === 'running' && p.elements.status.textContent === 'Follow progress on your UCSBPlat profile.', 'reopening during a run resumes website action');
  await p.update({lastRun: {requestId, popup, status: 'error', message: 'The GOLD tab was closed.'}});
  check(p.elements.run.hidden && p.elements.status.textContent.includes('GOLD tab was closed'), 'closed tab presents failure without standalone retry');

  for (const action of ['add_major', 'sync_all', 'refresh_major']) {
    const copy = setup({action}).job.popup;
    p = await popupScenario({pendingWebsiteAction: {requestId, type: action, popup: copy}});
    check(p.body.dataset.state === 'prepared' && !p.elements.run.disabled && !p.elements.cancelWebsiteAction.hidden,
      `${action} offers explicit confirmation and cancellation`);
    check(p.elements.website.hidden, `${action} confirmation omits website navigation`);
    for (const status of ['running', 'success', 'partial', 'error', 'signin', 'cancelled', 'expired']) {
      await p.update({lastRun: {requestId, popup: copy, status, message: `Server ${status}`}});
      check(p.body.dataset.state === status && p.elements.run.hidden && p.elements.confirm.hidden,
        `${action} ${status} has a distinct state without an unintended confirmation`);
      check(p.elements.websiteAction.hidden && p.elements.intro.hidden,
        `${action} ${status} focuses on the outcome instead of repeating the initial question`);
      check(p.elements.website.hidden, `${action} ${status} omits website navigation`);
      check(p.elements.status.textContent === (status === 'running' ? 'Follow progress on your UCSBPlat profile.' : `Server ${status}`),
        `${action} ${status} preserves website copy`);
    }
  }
  p = await popupScenario({expiredRequestId: requestId, lastRun: {requestId, popup, status: 'expired', message: 'Expired request'}});
  check(p.body.dataset.state === 'expired' && p.elements.run.hidden && p.elements.status.textContent === 'Expired request',
    'opening an expired prepared action displays its explanation');
  p = await popupScenario({error: 'Could not check this update.'});
  check(p.body.dataset.state === 'error' && p.elements.status.textContent === 'Could not check this update.',
    'state retrieval failure has a visible recovery state');
  p = await popupScenario({}, {respond: async () => { throw new Error('Worker unavailable'); }});
  check(p.body.dataset.state === 'error' && p.elements.status.textContent.includes("Couldn't reach the extension"),
    'unavailable worker has a visible recovery state');
  let releaseStart;
  p = await popupScenario({pendingWebsiteAction: {requestId, popup}}, {respond: (message, state) =>
    message.type === 'GET_POPUP_STATE' ? state : new Promise((resolve) => { releaseStart = resolve; })});
  const click = p.elements.run.events.click();
  await p.elements.run.events.click();
  check(p.body.dataset.state === 'starting' && p.elements.run.disabled && p.elements.cancelWebsiteAction.disabled
    && p.elements.website.hidden && p.messages.filter((m) => m.type === 'START_SYNC').length === 1,
    'starting feedback blocks duplicate confirmation and cancellation without website navigation');
  releaseStart({started: false, message: 'Request expired. Start again from your profile.'});
  await click;
  check(p.body.dataset.state === 'error' && p.elements.run.hidden && p.elements.cancelWebsiteAction.hidden
    && p.elements.status.textContent.includes('Request expired'),
    'start rejection retains actionable feedback');
  const plannedPopup = {...popup, majors: ['Computer Science B.S.', 'Applied Mathematics B.S.']};
  p = await popupScenario({pendingWebsiteAction: {requestId, popup: plannedPopup}});
  check(p.elements.majors.children.length === 2 && p.elements.majors.children[1].textContent === 'Applied Mathematics B.S.',
    'confirmation lists each requested major as a separate bullet');
  check(!('syncProgress' in p.elements) && p.elements.safeCloseNote.hidden,
    'confirmation has no duplicate progress display');
  await p.update({lastRun: {requestId, popup: plannedPopup, status: 'running', step: 'Running CS…', progress: {current: 4, total: 10}}});
  check(p.elements.status.textContent === 'Follow progress on your UCSBPlat profile.' && !p.elements.safeCloseNote.hidden,
    'running popup points to website progress and explains it is safe to close');
  console.log(`${passed} extension checks passed`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
