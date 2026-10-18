// Functions in this file are serialized and injected into GOLD pages by
// chrome.scripting.executeScript, so each one must be fully self-contained.

export function markDocument(token, watchAudit = false) {
  document.documentElement.dataset.ucsbplatRun = token;
  if (watchAudit) {
    const grid = document.querySelector('#pageContent_pageContent_DA_GridPlaceHolderRadGrid');
    if (grid) {
      grid.dataset.ucsbplatAuditRun = token;
      // GOLD can update the existing grid through AJAX rather than replace the page.
      const observer = new MutationObserver(() => {
        delete grid.dataset.ucsbplatAuditRun;
        observer.disconnect();
      });
      observer.observe(grid, {childList: true, characterData: true, subtree: true});
    }
  }
}

export function documentState(token) {
  return {
    ready: document.readyState === "complete",
    marked: document.documentElement.dataset.ucsbplatRun === token,
  };
}

export function scheduleState() {
  const dropdown = document.querySelector('[id="ctl00_pageContent_quarterDropDown"], [id="pageContent_quarterDropDown"]');
  const grid = document.querySelector('[id="ctl00_pageContent_ScheduleGrid"], [id="pageContent_ScheduleGrid"]');
  const units = document.querySelector('[id="ctl00_pageContent_totalUnitsScheduleWaitlistLabel"], [id="pageContent_totalUnitsScheduleWaitlistLabel"]');
  const busy = Array.from(document.querySelectorAll('.raDiv, .RadAjaxLoadingPanel, [aria-busy="true"]'))
    .some(element => element.getClientRects().length > 0);
  return {
    found: !!dropdown,
    ready: document.readyState === 'complete' && !!dropdown?.selectedOptions[0]
      && !busy && (!!grid || /^0(?:\.0+)?(?:\s|$)/.test(units?.textContent.trim() || '')),
    quarter: dropdown?.selectedOptions[0]?.textContent.trim() || null,
  };
}

export function dismissWelcomeLetter() {
  const button = document.querySelector("#pageContent_btnDeanLetterConfirm");
  if (!button || button.offsetParent === null) return { clicked: false };
  button.click();
  return { clicked: true };
}

export function ensureInProgressChecked() {
  const checkbox = document.querySelector("#pageContent_DegreeAuditWipCheckBox");
  if (!checkbox || checkbox.disabled) return { found: false };
  if (!checkbox.checked) checkbox.click();
  return { found: true, checked: checkbox.checked };
}

export function auditSelectionState() {
  function selectedOption(selector) {
    const select = document.querySelector(selector);
    const option = select?.selectedOptions?.[0];
    return {
      found: !!select,
      value: option?.value?.trim() || null,
      label: option?.textContent?.trim() || null,
      disabled: !!select?.disabled || !!option?.disabled,
    };
  }

  const majorArea = selectedOption("#pageContent_availableMajorsList");
  const audit = selectedOption("#pageContent_availableAuditsList");
  return {
    found: majorArea.found && audit.found,
    majorArea,
    audit,
    ready: document.readyState === 'complete' && majorArea.found
      && !Array.from(document.querySelectorAll('.raDiv, .RadAjaxLoadingPanel, [aria-busy="true"]'))
        .some((element) => element.getClientRects().length > 0),
    signature: Array.from(document.querySelectorAll('#pageContent_availableMajorsList, #pageContent_availableAuditsList'))
      .map((select) => `${select.value}:${Array.from(select.options).map((o) => `${o.value}:${o.textContent}`).join('|')}`).join(';'),
  };
}

export function chooseAuditOption(kind, expected) {
  if (!['major_area', 'audit'].includes(kind)) return {found: false, matched: false, changed: false};
  const selector = kind === "major_area"
    ? "#pageContent_availableMajorsList"
    : "#pageContent_availableAuditsList";
  const select = document.querySelector(selector);
  if (!select || select.disabled) return { found: false, matched: false, changed: false };

  const options = Array.from(select.options);
  const normalize = (label) => label?.replace(/\s+/g, ' ').trim().toLowerCase();
  const matches = options.filter((candidate) => !candidate.disabled && candidate.value.trim()
    && (expected?.value ? candidate.value === expected.value
      : expected?.label && normalize(candidate.textContent) === normalize(expected.label)));
  const option = matches.length === 1 ? matches[0] : null;
  if (!option) return { found: true, matched: false, changed: false };
  if (select.value === option.value) {
    return { found: true, matched: true, changed: false };
  }

  select.value = option.value;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  return { found: true, matched: true, changed: true };
}

export function clickRunAudit() {
  const button = document.querySelector("#pageContent_runAuditBtn");
  const checkbox = document.querySelector('#pageContent_DegreeAuditWipCheckBox');
  if (!button || button.disabled || !checkbox?.checked || checkbox.disabled) return { found: false };
  button.click();
  return { found: true };
}

export function auditReadyState(token) {
  const spinner = document.querySelector("#pageContent_processingAuditPanel");
  const gate = document.querySelector("#pageContent_btnDeanLetterConfirm");
  const grid = document.querySelector("#pageContent_pageContent_DA_GridPlaceHolderRadGrid");
  return {
    hasResults: !!grid,
    freshResults: !!grid && grid.dataset.ucsbplatAuditRun !== token,
    running: !!spinner && spinner.offsetParent !== null,
    gated: !!gate && gate.offsetParent !== null,
  };
}

export function clickExpandAll() {
  const button = document.querySelector("#pageContent_DA_ExpandAll");
  if (!button) return { found: false };
  button.click();
  return { found: true };
}

export function domSize() {
  return document.getElementsByTagName("*").length;
}

// The degree audit encodes meaning in its exact column spacing, so the markup
// is never reformatted — only whole elements the parser throws away are cut,
// which drops roughly two thirds of the bytes.
export function capturePage() {
  delete document.documentElement.dataset.ucsbplatRun;
  const clone = document.documentElement.cloneNode(true);
  for (const node of clone.querySelectorAll('[data-ucsbplat-audit-run]')) delete node.dataset.ucsbplatAuditRun;
  // HTML attributes do not track a select's current value after client-side changes.
  const selects = document.querySelectorAll('select');
  clone.querySelectorAll('select').forEach((select, index) => {
    Array.from(select.options).forEach((option, optionIndex) => {
      option.toggleAttribute('selected', selects[index].options[optionIndex].selected);
    });
  });
  for (const node of clone.querySelectorAll("style, script, noscript, svg")) node.remove();
  return clone.outerHTML;
}
