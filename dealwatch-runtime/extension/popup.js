const periodButtons = [...document.querySelectorAll('.period-btn')];
const scanButton = document.getElementById('scanButton');
const confirmButton = document.getElementById('confirmButton');
const statusEl = document.getElementById('status');
const dealwatchUrl = document.getElementById('dealwatchUrl');
const buySection = document.getElementById('buySection');
const sellSection = document.getElementById('sellSection');
const buyResults = document.getElementById('buyResults');
const sellResults = document.getElementById('sellResults');

let selectedPeriod = 'today';
let suggestedBuys = [];
let suggestedSells = [];

chrome.storage.local.get(['dealwatchUrl', 'period', 'lastScan', 'scanInProgress']).then(data => {
  if (data.dealwatchUrl) dealwatchUrl.value = data.dealwatchUrl;
  if (data.period) {
    selectedPeriod = data.period;
    syncPeriodButtons();
  }
  if (data.scanInProgress) {
    setStatus('Scan still running in background… reopen after a few seconds.');
  }
  if (data.lastScan) restoreLastScan(data.lastScan);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.lastScan) return;
  restoreLastScan(changes.lastScan.newValue);
});

periodButtons.forEach(button => {
  button.addEventListener('click', () => {
    selectedPeriod = button.dataset.period || 'today';
    chrome.storage.local.set({ period: selectedPeriod });
    syncPeriodButtons();
  });
});

dealwatchUrl.addEventListener('change', () => {
  chrome.storage.local.set({ dealwatchUrl: dealwatchUrl.value.trim() });
});

document.querySelectorAll('[data-select]').forEach(button => {
  button.addEventListener('click', () => {
    const group = button.dataset.select;
    const on = button.dataset.mode === 'all';
    const root = group === 'sells' ? sellResults : buyResults;
    root.querySelectorAll('input[type="checkbox"]').forEach(box => {
      box.checked = on;
    });
    syncConfirmState();
  });
});

scanButton.addEventListener('click', async () => {
  setStatus('API scan: Nachrichten → inbox → parallel message fetch… (safe to close popup)');
  scanButton.disabled = true;
  confirmButton.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'scan-deals',
      period: selectedPeriod,
    });
    if (!response?.ok) throw new Error(response?.error || 'Scan failed');
    suggestedBuys = Array.isArray(response.buys) ? response.buys : [];
    suggestedSells = Array.isArray(response.sells) ? response.sells : [];
    renderSuggestions();
    const total = suggestedBuys.length + suggestedSells.length;
    const opened = Number(response.openedChats) || 0;
    const apiLoaded = Number(response.apiLoaded) || 0;
    const status = total
      ? `Suggestions: ${suggestedBuys.length} buy · ${suggestedSells.length} sell · ${response.label} · ${response.inPeriodConversations || response.scannedConversations} in range · API ${apiLoaded} · DOM ${opened}. Confirm to import.`
      : `No deal-like chats in ${response.label?.toLowerCase() || selectedPeriod}. ${response.inPeriodConversations || 0} in range, API ${apiLoaded}, DOM ${opened}.`;
    setStatus(status, total ? 'ok' : '');
    await chrome.storage.local.set({
      lastScan: {
        ok: true,
        period: selectedPeriod,
        buys: suggestedBuys,
        sells: suggestedSells,
        status,
        statusKind: total ? 'ok' : '',
        at: Date.now(),
      },
    });
    syncConfirmState();
  } catch (error) {
    // Popup may have closed mid-scan; results still land in storage from background.
    if (/Receiving end does not exist|message port closed/i.test(String(error.message || error))) {
      setStatus('Scan continues in background. Reopen the popup in a moment.');
    } else {
      suggestedBuys = [];
      suggestedSells = [];
      setStatus(error.message || String(error), 'error');
    }
  } finally {
    scanButton.disabled = false;
  }
});

confirmButton.addEventListener('click', async () => {
  const buys = selectedItems(buyResults, suggestedBuys);
  const sells = selectedItems(sellResults, suggestedSells);
  if (!buys.length && !sells.length) {
    setStatus('Select at least one suggestion to confirm.', 'error');
    return;
  }
  setStatus('Importing confirmed deals into Dealwatch…');
  confirmButton.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'confirm-deals',
      baseUrl: dealwatchUrl.value.trim() || 'http://localhost:3000',
      period: selectedPeriod,
      purchases: buys,
      sales: sells,
    });
    if (!response?.ok) throw new Error(response?.error || 'Import failed');
    setStatus(
      `Imported ${response.purchasesAdded || 0} purchase(s) and ${response.salesAdded || 0} sale(s) into Dealwatch.`,
      'ok',
    );
    const buyIds = new Set(buys.map(item => item.id));
    const sellIds = new Set(sells.map(item => item.id));
    suggestedBuys = suggestedBuys.filter(item => !buyIds.has(item.id));
    suggestedSells = suggestedSells.filter(item => !sellIds.has(item.id));
    renderSuggestions();
    await chrome.storage.local.set({
      lastScan: {
        ok: true,
        period: selectedPeriod,
        buys: suggestedBuys,
        sells: suggestedSells,
        status: statusEl.textContent,
        statusKind: 'ok',
        at: Date.now(),
      },
    });
    syncConfirmState();
  } catch (error) {
    setStatus(error.message || String(error), 'error');
    syncConfirmState();
  }
});

function restoreLastScan(lastScan) {
  if (!lastScan || lastScan.ok === false && !lastScan.buys?.length) {
    if (lastScan?.status) setStatus(lastScan.status, lastScan.statusKind || 'error');
    return;
  }
  suggestedBuys = Array.isArray(lastScan.buys) ? lastScan.buys : [];
  suggestedSells = Array.isArray(lastScan.sells) ? lastScan.sells : [];
  if (lastScan.period) {
    selectedPeriod = lastScan.period;
    syncPeriodButtons();
  }
  renderSuggestions();
  if (lastScan.status) setStatus(lastScan.status, lastScan.statusKind || '');
  syncConfirmState();
}

function selectedItems(root, source) {
  const checked = new Set(
    [...root.querySelectorAll('input[type="checkbox"]:checked')].map(box => box.value),
  );
  return source.filter(item => checked.has(item.id)).map(item => ({ ...item, confirmed: true }));
}

function syncPeriodButtons() {
  periodButtons.forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.period === selectedPeriod);
  });
}

function syncConfirmState() {
  const any = Boolean(
    buyResults.querySelector('input[type="checkbox"]:checked')
    || sellResults.querySelector('input[type="checkbox"]:checked'),
  );
  confirmButton.disabled = !any;
}

function setStatus(text, kind = '') {
  statusEl.textContent = text;
  statusEl.classList.toggle('is-error', kind === 'error');
  statusEl.classList.toggle('is-ok', kind === 'ok');
}

function euros(value) {
  if (value == null || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return '—';
  return `${n.toLocaleString('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`;
}

function renderSuggestions() {
  renderGroup(buySection, buyResults, suggestedBuys, 'buy');
  renderGroup(sellSection, sellResults, suggestedSells, 'sell');
}

function renderGroup(section, root, items, side) {
  if (!items.length) {
    section.hidden = true;
    root.innerHTML = '';
    return;
  }
  section.hidden = false;
  root.innerHTML = items.map(item => {
    const name = item.displayName || item.title || (side === 'sell' ? 'Sale' : 'Purchase');
    const paid = item.paidAt || item.purchasedAt || item.soldAt || item.at;
    const amount = item.price ?? item.paidTotal ?? item.amount;
    return `
      <label class="card selectable">
        <input type="checkbox" value="${escapeHtml(item.id)}" checked />
        <span class="card-body">
          <strong>${escapeHtml(name)}</strong>
          <span class="meta">
            <span class="price">${euros(amount)}</span>
            <span>${escapeHtml(formatWhen(paid))}</span>
          </span>
        </span>
      </label>
    `;
  }).join('');
  root.querySelectorAll('input[type="checkbox"]').forEach(box => {
    box.addEventListener('change', syncConfirmState);
  });
}

function formatWhen(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
