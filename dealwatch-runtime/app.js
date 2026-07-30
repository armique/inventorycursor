const euros = value => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value);
const el = id => document.getElementById(id);
const feedbackCount = value => {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return '';
  return new Intl.NumberFormat('de-DE').format(Math.round(n));
};

function sellerFeedbackLabel(item) {
  const pct = Number.isFinite(Number(item.feedback)) ? `${item.feedback}%` : '—';
  const count = feedbackCount(item.feedbackScore);
  return count ? `${item.seller} · ${pct} (${count})` : `${item.seller} · ${pct}`;
}

let alertsOn = true;
let activeId = '';
let searches = [];
let trash = [];
let watchlist = [];
let watchlistIds = new Set();
let kaPurchases = [];
let kaSales = [];
let offersSentIds = new Set();
let currentListings = [];
let currentSuggestions = [];
let suggestionMeta = null;
let soldListings = [];
let lastRejected = 0;
const AUTO_SAVE_DELAY_MS = 5000;
let autoSaveTimer = null;
let autoSavePaused = 0;
let lastSavedSignature = '';
let autoSaveInFlight = false;
let soldFetching = false;
let monitorIntervalMinutes = 3;
let telegramConfigured = false;
let refreshTimer = null;
let notifyTimer = null;
let fetching = false;
let fetchGeneration = 0;
let notifications = [];
let pendingDeleteId = '';
let dragFilterId = '';
let filterDragMoved = false;
const VIEW_MODES = ['list', 'compact', 'tiles', 'large'];
let viewMode = VIEW_MODES.includes(localStorage.getItem('dealwatchViewMode'))
  ? localStorage.getItem('dealwatchViewMode')
  : 'tiles';

function timeLeft(date) {
  if (!date) return 'no end date';
  const minutes = Math.max(0, Math.round((new Date(date).getTime() - Date.now()) / 60000));
  if (minutes < 60) return `ends in ${minutes} min`;
  if (minutes < 1440) return `ends in ${Math.round(minutes / 60)} h`;
  return `ends in ${Math.round(minutes / 1440)} d`;
}

function listedLabel(date) {
  if (!date) return '';
  const then = new Date(date).getTime();
  if (!Number.isFinite(then)) return '';
  const minutes = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (minutes < 1) return 'listed just now';
  if (minutes < 60) return `listed ${minutes} min ago`;
  if (minutes < 1440) return `listed ${Math.round(minutes / 60)} h ago`;
  if (minutes < 1440 * 14) return `listed ${Math.round(minutes / 1440)} d ago`;
  return `listed ${new Date(date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

function listedTitle(date) {
  if (!date) return '';
  const then = new Date(date);
  if (!Number.isFinite(then.getTime())) return '';
  return `Listed ${then.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })}`;
}

function shortSearchLabel(search) {
  return String(search || '').replace(/^NVIDIA\s+/i, '').replace(/^GeForce\s+/i, '').trim() || 'Search';
}

const PRICE_SLIDER_MAX = 500;

const CAPACITY_NAME_LABELS = {
  'cap-120': '120 GB',
  'cap-120-128': '128 GB',
  'cap-240-256': '256 GB',
  'cap-480': '480 GB',
  'cap-500': '500 GB',
  'cap-480-512': '512 GB',
  'cap-1tb': '1 TB',
  'cap-2tb': '2 TB',
  'cap-4tb': '4 TB',
  'ram-8': '8 GB',
  'ram-16': '16 GB',
  'ram-32': '32 GB',
  'ram-64': '64 GB',
};

const CAPACITY_NAME_ORDER = [
  'cap-120',
  'cap-120-128',
  'cap-240-256',
  'cap-480',
  'cap-500',
  'cap-480-512',
  'cap-1tb',
  'cap-2tb',
  'cap-4tb',
  'ram-8',
  'ram-16',
  'ram-32',
  'ram-64',
];

function capacityNameParts(includeCapacities = []) {
  const selected = new Set((includeCapacities || []).map(String));
  return CAPACITY_NAME_ORDER
    .filter(id => selected.has(id))
    .map(id => CAPACITY_NAME_LABELS[id])
    .filter(Boolean);
}

function categorySearchLabel(filters = {}) {
  const name = String(filters.categoryName || '').trim();
  if (/\bssd\b/i.test(name)) return 'SSD';
  if (/\bgrafik|video.?kart|gpu\b/i.test(name)) return 'GPU';
  if (/\bram|arbeitsspeicher\b/i.test(name)) return 'RAM';
  if (!name) return 'Search';
  return name
    .replace(/\(.*?\)/g, '')
    .replace(/Solid State Drives?/i, 'SSD')
    .trim()
    .split(/\s+/)
    .slice(0, 3)
    .join(' ') || 'Search';
}

function makeSearchName(filters = currentFilters()) {
  const min = Number(filters.minPrice) || 1;
  const max = Number(filters.maxPrice) || 0;
  const keyword = shortSearchLabel(filters.search);
  const base = (keyword && keyword !== 'Search') ? keyword : categorySearchLabel(filters);
  const sizes = capacityNameParts(filters.includeCapacities);
  const head = sizes.length ? `${base} ${sizes.join(', ')}` : base;
  if (min > 1) return `${head} €${min}–${max}`;
  return `${head} under €${max}`;
}

function syncAutoSearchName({ force = false } = {}) {
  if (!force && el('searchName')?.dataset.manual === '1') return;
  const name = makeSearchName();
  if (el('searchName')) {
    el('searchName').value = name;
    if (force) el('searchName').dataset.manual = '';
  }
}

function getSelectedMarketplace() {
  const active = document.querySelector('.marketplace-btn.is-active');
  return active?.dataset.marketplace === 'kleinanzeigen' ? 'kleinanzeigen' : 'ebay';
}

function setMarketplace(marketplace, { silent = false } = {}) {
  const next = marketplace === 'kleinanzeigen' ? 'kleinanzeigen' : 'ebay';
  document.querySelectorAll('.marketplace-btn').forEach(btn => {
    const on = btn.dataset.marketplace === next;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  document.body.dataset.marketplace = next;
  const label = el('marketplaceSearchLabel');
  const input = el('ebayQuery');
  if (label) label.textContent = next === 'kleinanzeigen' ? 'Kleinanzeigen search' : 'eBay.de search';
  if (input) {
    input.placeholder = next === 'kleinanzeigen'
      ? 'Search like on Kleinanzeigen · e.g. GTX 1080'
      : 'Search like on ebay.de · e.g. Samsung 970 EVO 1TB';
  }
  if (el('kaDistanceFields')) el('kaDistanceFields').hidden = next !== 'kleinanzeigen';
  if (el('ebayScopeAll') && next === 'kleinanzeigen') el('ebayScopeAll').checked = false;
  if (!silent) scheduleAutoSave();
}

function currentFilters() {
  const minPrice = Number(el('minPriceInput')?.value ?? el('minPrice')?.value) || 1;
  const maxPrice = Number(el('maxPriceInput')?.value ?? el('maxPrice')?.value) || 80;
  const active = searches.find(item => item.id === activeId);
  const autoName = makeSearchName({
    search: el('ebayQuery')?.value?.trim() || '',
    minPrice,
    maxPrice,
    includeCapacities: getIncludeCapacities(),
    categoryName: active?.categoryName || '',
    categoryId: active?.categoryId || '',
  });
  const manual = el('searchName')?.dataset.manual === '1';
  return {
    name: (manual ? el('searchName').value.trim() : '') || autoName,
    search: (() => {
      const raw = el('ebayQuery')?.value?.trim() || '';
      if (raw.includes('|')) return raw.split('|').map(part => part.trim()).filter(Boolean)[0] || raw;
      return raw;
    })(),
    searchVariants: (() => {
      const raw = el('ebayQuery')?.value?.trim() || '';
      if (raw.includes('|')) {
        return [...new Set(raw.split('|').map(part => part.trim()).filter(Boolean))].slice(0, 6);
      }
      const existing = Array.isArray(active?.searchVariants)
        ? active.searchVariants.map(item => String(item || '').trim()).filter(Boolean)
        : [];
      // Keep multi-query variants unless the user clearly replaced the keywords.
      if (existing.length > 1 && (!raw || existing.includes(raw))) {
        return existing.slice(0, 6);
      }
      return [];
    })(),
    minPrice: Math.min(minPrice, maxPrice),
    maxPrice: Math.max(minPrice, maxPrice),
    minFeedback: Number(el('minFeedback').value),
    condition: el('condition').value,
    disabledSmartFilters: getDisabledSmartFilters(),
    enabledSmartFilters: getEnabledSmartFilters(),
    includeCapacities: getIncludeCapacities(),
    categoryId: active?.categoryId || '',
    categoryName: active?.categoryName || '',
    categoryPath: Array.isArray(active?.categoryPath) ? active.categoryPath : [],
    marketplace: getSelectedMarketplace(),
    kaCategory: el('kaCategory')?.value || 'all',
    locationId: el('kaLocationId')?.value || '',
    locationLabel: el('kaLocationLabel')?.value?.trim() || '',
    radiusKm: Number(el('kaRadius')?.value) || 0,
    shippingOnly: Boolean(el('kaShippingOnly')?.checked),
    monitor: active?.monitor !== false,
  };
}

function filtersFromSearch(search) {
  if (!search) return currentFilters();
  const minPrice = Number(search.minPrice) || 1;
  const maxPrice = Number(search.maxPrice) || 80;
  return {
    name: search.name || makeSearchName(search),
    search: String(search.search || '').trim(),
    minPrice: Math.min(minPrice, maxPrice),
    maxPrice: Math.max(minPrice, maxPrice),
    minFeedback: Number(search.minFeedback) || 90,
    condition: search.condition === 'used' ? 'used' : 'any',
    disabledSmartFilters: Array.isArray(search.disabledSmartFilters) ? search.disabledSmartFilters : [],
    enabledSmartFilters: Array.isArray(search.enabledSmartFilters) ? search.enabledSmartFilters : [],
    includeCapacities: Array.isArray(search.includeCapacities) ? search.includeCapacities : [],
    categoryId: search.categoryId || '',
    categoryName: search.categoryName || '',
    categoryPath: Array.isArray(search.categoryPath) ? search.categoryPath : [],
    searchVariants: Array.isArray(search.searchVariants) ? search.searchVariants : [],
    marketplace: search.marketplace === 'kleinanzeigen' ? 'kleinanzeigen' : 'ebay',
    kaCategory: search.kaCategory || 'all',
    locationId: search.locationId || '',
    locationLabel: search.locationLabel || '',
    radiusKm: Number(search.radiusKm) || 0,
    shippingOnly: Boolean(search.shippingOnly),
    monitor: search.monitor !== false,
  };
}

function getEnabledSmartFilters() {
  return [...document.querySelectorAll('#smartExcludeList input[type="checkbox"]')]
    .filter(input => input.checked)
    .map(input => input.value);
}

function getDisabledSmartFilters() {
  return [...document.querySelectorAll('#smartExcludeList input[type="checkbox"]')]
    .filter(input => !input.checked)
    .map(input => input.value);
}

function getIncludeCapacities() {
  return [...document.querySelectorAll('#smartIncludeList input[type="checkbox"]')]
    .filter(input => input.checked)
    .map(input => input.value);
}

function filtersSignature(filters = currentFilters()) {
  return JSON.stringify({
    name: filters.name || '',
    search: filters.search || '',
    minPrice: Number(filters.minPrice) || 1,
    maxPrice: Number(filters.maxPrice) || 80,
    minFeedback: Number(filters.minFeedback) || 0,
    condition: filters.condition === 'used' ? 'used' : 'any',
    enabledSmartFilters: [...(filters.enabledSmartFilters || [])].map(String).sort(),
    includeCapacities: [...(filters.includeCapacities || [])].map(String).sort(),
    categoryId: String(filters.categoryId || ''),
    marketplace: filters.marketplace === 'kleinanzeigen' ? 'kleinanzeigen' : 'ebay',
    kaCategory: filters.kaCategory || 'all',
    locationId: String(filters.locationId || ''),
    radiusKm: Number(filters.radiusKm) || 0,
    shippingOnly: Boolean(filters.shippingOnly),
  });
}

function markFiltersSaved(filters = currentFilters()) {
  lastSavedSignature = filtersSignature(filters);
}

function isFiltersDirty() {
  if (!lastSavedSignature) return true;
  return filtersSignature() !== lastSavedSignature;
}

function cancelAutoSave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = null;
}

function pauseAutoSave() {
  autoSavePaused += 1;
  cancelAutoSave();
}

function resumeAutoSave() {
  autoSavePaused = Math.max(0, autoSavePaused - 1);
}

function scheduleAutoSave() {
  if (autoSavePaused || !activeId || window.location.protocol === 'file:') return;
  cancelAutoSave();
  autoSaveTimer = setTimeout(() => {
    autoSaveTimer = null;
    runAutoSave().catch(() => {});
  }, AUTO_SAVE_DELAY_MS);
}

async function runAutoSave() {
  if (autoSavePaused || !activeId || autoSaveInFlight || !isFiltersDirty()) return;
  autoSaveInFlight = true;
  const notice = el('formNotice');
  try {
    if (notice) notice.textContent = 'Saving…';
    await saveActiveSearch();
    renderSidebar();
    if (notice) notice.textContent = 'Saved';
    await fetchListings({ quiet: true });
    setTimeout(() => {
      if (notice && notice.textContent === 'Saved') notice.textContent = '';
    }, 2000);
  } catch (error) {
    if (notice) notice.textContent = error.message;
  } finally {
    autoSaveInFlight = false;
  }
}

function ebaySoldHistoryUrl(filters = currentFilters()) {
  const params = new URLSearchParams({
    _nkw: filters.search || '',
    _sacat: filters.categoryId || '0',
    LH_Sold: '1',
    LH_Complete: '1',
    rt: 'nc',
    _sop: '13',
  });
  if (Number.isFinite(filters.minPrice) && filters.minPrice > 1) {
    params.set('_udlo', String(filters.minPrice));
  }
  if (Number.isFinite(filters.maxPrice) && filters.maxPrice > 0) {
    params.set('_udhi', String(filters.maxPrice));
  }
  if (filters.condition === 'used') {
    params.set('LH_ItemCondition', '3000');
  }
  return `https://www.ebay.de/sch/i.html?${params}`;
}

function updateSoldHistoryLink() {
  const link = el('soldHistoryButton');
  if (!link) return;
  link.href = ebaySoldHistoryUrl();
}

function syncPriceControls(from = 'slider') {
  let min = Number(from === 'input' ? el('minPriceInput').value : el('minPrice').value) || 1;
  let max = Number(from === 'input' ? el('maxPriceInput').value : el('maxPrice').value) || 80;
  min = Math.max(1, Math.min(5000, min));
  max = Math.max(1, Math.min(5000, max));
  if (min > max) {
    if (from === 'min-slider') max = min;
    else if (from === 'max-slider') min = max;
    else [min, max] = [max, min];
  }
  const sliderMax = Math.max(PRICE_SLIDER_MAX, max);
  el('minPrice').max = String(sliderMax);
  el('maxPrice').max = String(sliderMax);
  el('minPrice').value = String(Math.min(min, sliderMax));
  el('maxPrice').value = String(Math.min(max, sliderMax));
  el('minPriceInput').value = String(min);
  el('maxPriceInput').value = String(max);
  const fill = el('priceRangeFill');
  if (fill) {
    const left = ((min - 1) / (sliderMax - 1)) * 100;
    const right = ((max - 1) / (sliderMax - 1)) * 100;
    fill.style.left = `${left}%`;
    fill.style.width = `${Math.max(0, right - left)}%`;
  }
  if (el('priceRangeLabel')) el('priceRangeLabel').textContent = `€${min}–${max}`;
  document.querySelectorAll('.price-preset').forEach(button => {
    button.classList.toggle('is-active', Number(button.dataset.max) === max && min <= 1);
  });
  updateSoldHistoryLink();
  syncAutoSearchName({ force: true });
}

function syncFeedbackLabel() {
  const value = Number(el('minFeedback').value) || 0;
  if (el('feedbackLabel')) el('feedbackLabel').textContent = `${value}%`;
  updateRuleSummary();
}

function syncConditionFromChips() {
  const selected = document.querySelector('input[name="condition"]:checked');
  if (selected) el('condition').value = selected.value;
  updateRuleSummary();
}

function updateCategoryPathLabel(search) {
  const label = el('categoryPathLabel');
  if (!label) return;
  const path = Array.isArray(search?.categoryPath) ? search.categoryPath : [];
  const text = path.length
    ? path.map(item => item.name).join(' › ')
    : (search?.categoryName || '');
  label.hidden = !text;
  label.textContent = text ? `eBay · ${text}` : '';
  label.title = text || '';
}

function applySearchToForm(search) {
  if (!search) return;
  pauseAutoSave();
  try {
    const filters = filtersFromSearch(search);
    el('searchName').dataset.manual = '';
    el('searchName').value = makeSearchName(filters);
    if (el('ebayQuery')) {
      const variants = Array.isArray(filters.searchVariants)
        ? filters.searchVariants.map(item => String(item || '').trim()).filter(Boolean)
        : [];
      el('ebayQuery').value = variants.length > 1
        ? variants.join(' | ')
        : (filters.search || '');
    }
    el('minPriceInput').value = String(filters.minPrice || 1);
    el('maxPriceInput').value = String(filters.maxPrice || 80);
    el('minFeedback').value = String(filters.minFeedback ?? 90);
    el('condition').value = filters.condition === 'used' ? 'used' : 'any';
    const used = filters.condition !== 'any';
    if (el('conditionUsed')) el('conditionUsed').checked = used;
    if (el('conditionAny')) el('conditionAny').checked = !used;
    setMarketplace(filters.marketplace === 'kleinanzeigen' ? 'kleinanzeigen' : 'ebay', { silent: true });
    if (el('kaCategory')) el('kaCategory').value = filters.kaCategory || 'all';
    if (el('kaLocationId')) el('kaLocationId').value = filters.locationId || '';
    if (el('kaLocationLabel')) el('kaLocationLabel').value = filters.locationLabel || '';
    if (el('kaRadius')) el('kaRadius').value = String(filters.radiusKm || 0);
    if (el('kaShippingOnly')) el('kaShippingOnly').checked = Boolean(filters.shippingOnly);
    window.__enabledSmartFilters = Array.isArray(search.enabledSmartFilters)
      ? search.enabledSmartFilters
      : [];
    window.__includeCapacities = Array.isArray(search.includeCapacities)
      ? search.includeCapacities
      : [];
    window.__disabledSmartFilters = [];
    syncPriceControls('input');
    syncFeedbackLabel();
    renderSmartExcludeList(search.smartFilters || [], window.__enabledSmartFilters);
    renderCapacityIncludeList(search.capacityIncludes || [], window.__includeCapacities);
    updateCategoryPathLabel(search);
    updatePageMeta();
    markFiltersSaved({ ...filters, name: el('searchName').value.trim() });
  } finally {
    resumeAutoSave();
  }
}

function applyStore(store, { syncForm = true } = {}) {
  if (!store) return;
  searches = store.searches || [];
  trash = store.trash || [];
  watchlist = store.watchlist || [];
  watchlistIds = new Set(watchlist.map(item => item.id));
  if (Array.isArray(store.kaPurchases)) kaPurchases = store.kaPurchases;
  if (Array.isArray(store.kaSales)) kaSales = store.kaSales;
  if (Array.isArray(store.offersSent)) offersSentIds = new Set(store.offersSent.map(String));
  activeId = store.activeId || searches[0]?.id || '';
  alertsOn = store.alerts !== false;
  if (Array.isArray(store.notifications)) notifications = store.notifications;
  el('alertButton').textContent = `Alerts: ${alertsOn ? 'on' : 'off'}`;
  if (Number.isFinite(store.monitorIntervalMinutes)) monitorIntervalMinutes = store.monitorIntervalMinutes;
  if (typeof store.telegramConfigured === 'boolean') telegramConfigured = store.telegramConfigured;
  if (syncForm) {
    const active = searches.find(item => item.id === activeId) || searches[0];
    applySearchToForm(active);
  }
  renderSidebar();
  renderWatchlist();
  renderKaPurchases();
  renderKaSales();
  renderTrash();
  updatePageMeta();
}

function renderFilterPills(box, filters = [], enabledIds = [], { mode = 'exclude' } = {}) {
  if (!box) return [];
  const defs = (filters || []).map(item => (
    typeof item === 'string' ? { id: item, label: item } : item
  )).filter(item => item && item.id && item.label);
  const enabled = new Set(Array.isArray(enabledIds) ? enabledIds : []);
  const isInclude = mode === 'include';
  box.replaceChildren();
  defs.forEach(rule => {
    const label = document.createElement('label');
    const on = enabled.has(rule.id);
    label.className = `smart-pill${isInclude ? ' include-pill' : ''}${on ? ' is-on' : ''}`;
    label.title = isInclude
      ? (on ? `Show only: ${rule.label}` : `Show: ${rule.label}`)
      : (on ? `Hide: ${rule.label}` : `Hide lots with: ${rule.label}`);
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = rule.id;
    input.checked = on;
    input.addEventListener('change', () => {
      label.classList.toggle('is-on', input.checked);
      label.title = isInclude
        ? (input.checked ? `Show only: ${rule.label}` : `Show: ${rule.label}`)
        : (input.checked ? `Hide: ${rule.label}` : `Hide lots with: ${rule.label}`);
      if (isInclude) {
        window.__includeCapacities = getIncludeCapacities();
      } else {
        window.__enabledSmartFilters = getEnabledSmartFilters();
        window.__disabledSmartFilters = getDisabledSmartFilters();
      }
      applySmartFilterChange();
    });
    const text = document.createElement('span');
    text.textContent = rule.label;
    label.append(input, text);
    box.append(label);
  });
  return defs;
}

function renderSmartExcludeList(filters = [], enabledIds = []) {
  const box = el('smartExcludeList');
  if (!box) return;
  if (!(filters || []).length) {
    box.replaceChildren();
    const span = document.createElement('span');
    span.className = 'input-hint';
    span.textContent = 'No exclude filters for this search';
    box.append(span);
    window.__enabledSmartFilters = [];
    window.__disabledSmartFilters = [];
    return;
  }
  renderFilterPills(box, filters, enabledIds, { mode: 'exclude' });
  window.__enabledSmartFilters = getEnabledSmartFilters();
  window.__disabledSmartFilters = getDisabledSmartFilters();
}

function renderCapacityIncludeList(filters = [], enabledIds = []) {
  const box = el('smartIncludeList');
  const block = el('capacityIncludeBlock');
  if (!box || !block) return;
  const defs = (filters || []).filter(item => item && item.id && item.label);
  block.hidden = defs.length === 0;
  if (!defs.length) {
    box.replaceChildren();
    window.__includeCapacities = [];
    return;
  }
  renderFilterPills(box, defs, enabledIds, { mode: 'include' });
  window.__includeCapacities = getIncludeCapacities();
}

let smartFilterApplyTimer = null;
let smartFilterApplyGen = 0;

function applySmartFilterChange() {
  // Don't let the 5s form autosave fight pill toggles.
  cancelAutoSave();
  clearTimeout(smartFilterApplyTimer);
  // Tiny coalesce so multi-clicks become one scan; feels instant.
  smartFilterApplyTimer = setTimeout(() => {
    runSmartFilterApply().catch(error => {
      if (el('formNotice')) el('formNotice').textContent = error.message;
    });
  }, 40);
}

async function runSmartFilterApply() {
  const gen = ++smartFilterApplyGen;
  syncAutoSearchName({ force: true });
  const filters = currentFilters();
  // Scan immediately from live checkbox state; persist in parallel without resetting pills.
  const scan = fetchListings({ quiet: false, filters });
  try {
    await saveActiveSearch();
    if (gen === smartFilterApplyGen) renderSidebar();
  } catch (error) {
    if (gen === smartFilterApplyGen && el('formNotice')) {
      el('formNotice').textContent = error.message;
    }
  }
  await scan;
}

let smartFilterTimer = null;
function refreshSmartFiltersPreview() {
  const active = searches.find(item => item.id === activeId);
  const categoryId = active?.categoryId || '';
  const query = active?.categoryName || active?.search || 'SSD';
  const enabled = Array.isArray(window.__enabledSmartFilters)
    ? window.__enabledSmartFilters
    : (Array.isArray(active?.enabledSmartFilters) ? active.enabledSmartFilters : []);
  const includes = Array.isArray(window.__includeCapacities)
    ? window.__includeCapacities
    : (Array.isArray(active?.includeCapacities) ? active.includeCapacities : []);
  clearTimeout(smartFilterTimer);
  smartFilterTimer = setTimeout(async () => {
    if (!categoryId || window.location.protocol === 'file:') {
      renderSmartExcludeList(active?.smartFilters || [], enabled);
      renderCapacityIncludeList(active?.capacityIncludes || [], includes);
      return;
    }
    try {
      const data = await api(`/api/smart-filters?query=${encodeURIComponent(query)}&categoryId=${encodeURIComponent(categoryId)}`);
      renderSmartExcludeList(data.smartFilters || [], enabled);
      renderCapacityIncludeList(data.capacityIncludes || [], includes);
    } catch {
      renderSmartExcludeList(active?.smartFilters || [], enabled);
      renderCapacityIncludeList(active?.capacityIncludes || [], includes);
    }
  }, 250);
}

function updateRuleSummary() {
  updateSoldHistoryLink();
}

function updatePageMeta() {
  updateRuleSummary();
  refreshSmartFiltersPreview();
  el('filterCount').textContent = String(searches.length);
  el('watchCount').textContent = String(watchlist.length);
  if (el('kaPurchaseCount')) el('kaPurchaseCount').textContent = String(kaPurchases.length);
  if (el('kaSaleCount')) el('kaSaleCount').textContent = String(kaSales.length);
  el('trashCount').textContent = String(trash.length);
  el('deleteSearchButton').disabled = searches.length <= 1;
  updateConnectionStatus();
}

function updateConnectionStatus() {
  const status = el('connectionStatus');
  if (window.location.protocol === 'file:') {
    status.innerHTML = '<i class="warn"></i> Open via localhost';
    return;
  }
  if (!alertsOn) {
    status.innerHTML = '<i class="off"></i> Monitoring off';
    return;
  }
  const activeCount = searches.filter(item => item.monitor !== false).length;
  const pausedCount = Math.max(0, searches.length - activeCount);
  const pauseNote = pausedCount ? ` · ${pausedCount} paused` : '';
  if (!telegramConfigured) {
    status.innerHTML = `<i class="warn"></i> Auto-refresh · ${activeCount} filter(s)${pauseNote}`;
    return;
  }
  status.innerHTML = `<i></i> Monitoring · ${activeCount} filter(s)${pauseNote} · ${monitorIntervalMinutes} min`;
}

function setListingImage(node, item) {
  const wrap = node.querySelector('.listing-image');
  const img = wrap.querySelector('img');
  const fallback = wrap.querySelector('.listing-fallback');
  if (item.image) {
    img.src = item.image;
    img.alt = item.title;
    img.hidden = false;
    fallback.hidden = true;
    img.onerror = () => {
      img.hidden = true;
      fallback.hidden = false;
    };
  } else {
    img.removeAttribute('src');
    img.hidden = true;
    fallback.hidden = false;
  }
}

function ebayLegacyId(item) {
  if (item.legacyItemId) return String(item.legacyItemId);
  const fromUrl = String(item.url || '').match(/\/itm\/(?:[^/?#]+\/)?(\d{6,16})/i);
  if (fromUrl) return fromUrl[1];
  const fromId = String(item.id || '').match(/\|(\d{6,16})\|/);
  if (fromId) return fromId[1];
  if (/^\d{6,16}$/.test(String(item.id || ''))) return String(item.id);
  return '';
}

function listingOfferUrl(item) {
  if (item?.url) return item.url;
  if (item?.marketplace === 'kleinanzeigen') {
    const id = ebayLegacyId(item);
    return id ? `https://www.kleinanzeigen.de/s-anzeige/${id}` : 'https://www.kleinanzeigen.de/';
  }
  const id = ebayLegacyId(item);
  if (id) return `https://www.ebay.de/itm/${encodeURIComponent(id)}`;
  return 'https://www.ebay.de/';
}

function listingChatUrl(item) {
  // Open the listing in the same browser so KA/eBay session cookies apply.
  // KA has no stable public compose deep-link; the ad page has “Nachricht schreiben”.
  if (item?.marketplace === 'kleinanzeigen') return listingOfferUrl(item);
  const id = ebayLegacyId(item);
  if (id) {
    return `https://www.ebay.de/cnt/ContactUs?item_id=${encodeURIComponent(id)}`;
  }
  return listingOfferUrl(item);
}

function pickMessageVariant(variants) {
  return variants[Math.floor(Math.random() * variants.length)];
}

function messageContextText(item) {
  const active = searches.find(entry => entry.id === activeId);
  const fromItem = item?.searchId
    ? searches.find(entry => entry.id === item.searchId)
    : null;
  const search = fromItem || active;
  return [
    search?.search,
    search?.name,
    search?.categoryName,
    ...(Array.isArray(search?.searchVariants) ? search.searchVariants : []),
    item?.title,
    item?.condition,
  ].filter(Boolean).join(' ').toLowerCase();
}

/** Natural product noun from the active search type (not the listing title). */
function productNounForMessage(item) {
  const text = messageContextText(item)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss');

  const hit = (re) => re.test(text);

  // GPUs first — model tokens like 3070 / 1080ti are common search names.
  if (
    hit(/\b(rtx|gtx|rx|arc|grafikkarte|graka|gpu|videokarte|graphics?\s*card)\b/)
    || hit(/\b(4090|4080|4070|4060|3090|3080|3070|3060|3050|2080|2070|2060|1660|1650|1080|1070|1060|1050|1030|980|970|960|950)\s*(ti|super|xt|xl)?\b/)
  ) {
    return {
      kind: 'gpu',
      de: { ask: 'die Karte', for: 'die Karte' },
      en: { ask: 'the card', for: 'the card' },
    };
  }
  if (hit(/\b(ssd|nvme|m\.?2)\b/)) {
    return {
      kind: 'ssd',
      de: { ask: 'die SSD', for: 'die SSD' },
      en: { ask: 'the SSD', for: 'the SSD' },
    };
  }
  if (hit(/\b(hdd|festplatte|hard\s*disk|harddrive)\b/)) {
    return {
      kind: 'hdd',
      de: { ask: 'die Festplatte', for: 'die Festplatte' },
      en: { ask: 'the drive', for: 'the drive' },
    };
  }
  if (hit(/\b(ddr\d|sodimm|ram|speicher|arbeitsspeicher)\b/) || hit(/\b\d+\s*gb\b.*\b(ddr|sodimm|ram)\b/)) {
    return {
      kind: 'ram',
      de: { ask: 'der RAM', for: 'den RAM' },
      en: { ask: 'the RAM', for: 'the RAM' },
    };
  }
  if (hit(/\b(konvolut|bundle|lot|paket)\b/)) {
    return {
      kind: 'bundle',
      de: { ask: 'das Bundle', for: 'das Bundle' },
      en: { ask: 'the bundle', for: 'the bundle' },
    };
  }
  if (hit(/\b(aufruestkit|upgrade\s*kit)\b/) || (hit(/\bkit\b/) && !hit(/\b(ssd|ram|tool)\b/))) {
    return {
      kind: 'kit',
      de: { ask: 'das Kit', for: 'das Kit' },
      en: { ask: 'the kit', for: 'the kit' },
    };
  }
  if (
    hit(/\b(cpu|prozessor|ryzen|intel\s*core|i[3579]-\d|8700k|4790k|5600x|5800x|5950x|7700|12700|13700|14700)\b/)
    || hit(/\b(r[3579]\s*\d{3,4}|threadripper)\b/)
  ) {
    return {
      kind: 'cpu',
      de: { ask: 'die CPU', for: 'die CPU' },
      en: { ask: 'the CPU', for: 'the CPU' },
    };
  }
  if (hit(/\b(mainboard|motherboard|platine|chipset|b450|b550|b650|x570|x670|z690|z790|a520|a620)\b/)) {
    return {
      kind: 'board',
      de: { ask: 'das Board', for: 'das Board' },
      en: { ask: 'the board', for: 'the board' },
    };
  }
  if (hit(/\b(ps5|ps4|xbox|switch|konsole|playstation|series\s*[sx])\b/)) {
    return {
      kind: 'console',
      de: { ask: 'die Konsole', for: 'die Konsole' },
      en: { ask: 'the console', for: 'the console' },
    };
  }
  if (hit(/\b(gaming\s*pc|komplett\s*pc|komplettpc|tower|desktop|rechner)\b/) || hit(/\bgaming\b/) && hit(/\bpc\b/)) {
    return {
      kind: 'pc',
      de: { ask: 'der PC', for: 'den PC' },
      en: { ask: 'the PC', for: 'the PC' },
    };
  }
  if (hit(/\b(bluray|blu[\s-]?ray|dvd|laufwerk|optical|brenner)\b/)) {
    return {
      kind: 'drive',
      de: { ask: 'das Laufwerk', for: 'das Laufwerk' },
      en: { ask: 'the drive', for: 'the drive' },
    };
  }
  if (hit(/\b(monitor|bildschirm|display)\b/)) {
    return {
      kind: 'monitor',
      de: { ask: 'der Monitor', for: 'den Monitor' },
      en: { ask: 'the monitor', for: 'the monitor' },
    };
  }
  if (hit(/\b(netzteil|psu|power\s*supply)\b/)) {
    return {
      kind: 'psu',
      de: { ask: 'das Netzteil', for: 'das Netzteil' },
      en: { ask: 'the PSU', for: 'the PSU' },
    };
  }
  if (hit(/\b(gehaeuse|case|chassis)\b/)) {
    return {
      kind: 'case',
      de: { ask: 'das Gehäuse', for: 'das Gehäuse' },
      en: { ask: 'the case', for: 'the case' },
    };
  }
  if (hit(/\bpc\b/) || hit(/\bdesktop\b/) || hit(/\brechner\b/)) {
    return {
      kind: 'pc',
      de: { ask: 'der PC', for: 'den PC' },
      en: { ask: 'the PC', for: 'the PC' },
    };
  }

  return {
    kind: 'item',
    de: { ask: 'die Anzeige', for: 'die Anzeige' },
    en: { ask: 'the item', for: 'the item' },
  };
}

function pickupDayLabel(isKa = true) {
  // After 17:00 local, today pickup is usually unrealistic → suggest tomorrow.
  const hour = new Date().getHours();
  const useToday = hour < 17;
  if (isKa) return useToday ? 'heute' : 'morgen';
  return useToday ? 'today' : 'tomorrow';
}

const PICKUP_HOME = {
  plz: '89367',
  label: 'Waldstetten',
  locationId: '6699',
  maxKm: 50,
};

function extractPlz(text) {
  const match = String(text || '').match(/\b(\d{5})\b/);
  return match ? match[1] : '';
}

/** Conservative PLZ bands roughly ≤50 km of 89367 Waldstetten (GY / NU / UL / Krumbach). */
function plzNearWaldstetten(plz) {
  if (!/^\d{5}$/.test(plz)) return false;
  if (plz === PICKUP_HOME.plz) return true;
  const n = Number(plz);
  if (n >= 89312 && n <= 89368) return true; // Günzburg district
  if (n >= 89231 && n <= 89299) return true; // Neu-Ulm
  if (n >= 89073 && n <= 89081) return true; // Ulm
  if (n >= 86316 && n <= 86399) return true; // Krumbach area
  if (n >= 89407 && n <= 89431) return true; // Dillingen fringe
  return false;
}

function searchForListing(item) {
  if (item?.searchId) {
    const matched = searches.find(entry => entry.id === item.searchId);
    if (matched) return matched;
  }
  return searches.find(entry => entry.id === activeId) || null;
}

function isLocalPickupEligible(item) {
  if (!item || item.marketplace !== 'kleinanzeigen') return false;

  const search = searchForListing(item);
  const locId = String(search?.locationId || '');
  const radius = Number(search?.radiusKm) || 0;
  const label = String(search?.locationLabel || '');
  const centeredOnHome = locId === PICKUP_HOME.locationId
    || new RegExp(`${PICKUP_HOME.plz}|${PICKUP_HOME.label}`, 'i').test(label);

  // KA distance filter is authoritative when centered on Waldstetten within 50 km.
  if (centeredOnHome && radius > 0 && radius <= PICKUP_HOME.maxKm) return true;

  const plz = extractPlz(item.location || item.seller);
  return plzNearWaldstetten(plz);
}

function cashOfferAmount(price, discountPercent = 0) {
  if (!Number.isFinite(price) || price <= 0) return null;
  const raw = price * (1 - (Number(discountPercent) || 0) / 100);
  // Cash-friendly rounding: nearest €5 above ~€40, else whole euros.
  if (raw >= 40) return Math.max(1, Math.round(raw / 5) * 5);
  return Math.max(1, Math.round(raw));
}

function formatCashAmount(amount, isKa = true) {
  if (!Number.isFinite(amount)) return '';
  return isKa ? `${amount}€` : `€${amount}`;
}

function priceOfferRange(item) {
  const ask = Number(item?.price);
  if (!Number.isFinite(ask) || ask <= 0) return null;
  // Mild end: at least 10% under ask. Aggressive end: ~40% under.
  let maxOffer = cashOfferAmount(ask, 10);
  let minOffer = cashOfferAmount(ask, 40);
  if (!maxOffer || !minOffer) return null;
  if (minOffer > maxOffer) [minOffer, maxOffer] = [maxOffer, minOffer];
  // Keep at least a 1€ span when possible.
  if (minOffer === maxOffer && ask > 2) minOffer = Math.max(1, maxOffer - 1);
  return { min: minOffer, max: maxOffer, ask };
}

function offerSliderHue(value, min, max) {
  const span = Math.max(1, max - min);
  const t = Math.min(1, Math.max(0, (Number(value) - min) / span));
  return Math.round(t * 120); // red → green
}

function priceOfferText(item, amount, variantIndex = 0) {
  const isKa = item?.marketplace === 'kleinanzeigen';
  const noun = productNounForMessage(item);
  const ask = isKa ? noun.de.ask : noun.en.ask;
  const forObj = isKa ? noun.de.for : noun.en.for;
  const cashLabel = formatCashAmount(amount, isKa);
  if (!cashLabel) return '';

  if (isKa) {
    const variants = [
      `Hallo, wäre es möglich für ${cashLabel}?`,
      `Hey, ist ${ask} noch zu haben?\nWäre ${cashLabel} okay für Sie?`,
      `Hallo, interessiere mich für ${forObj}.\nWürde für ${cashLabel} mitnehmen — geht das?`,
      `Hi, wäre ${cashLabel} machbar?`,
    ];
    return variants[variantIndex % variants.length];
  }

  const variants = [
    `Hi, would ${cashLabel} be possible?`,
    `Hello, is ${ask} still available?\nWould you take ${cashLabel}?`,
    `Hi, interested in ${forObj} — would ${cashLabel} work for you?`,
  ];
  return variants[variantIndex % variants.length];
}

let messageOfferVariant = 0;
let messageOfferMode = false;

function setupMessageOfferSlider(item, { selectMild = true } = {}) {
  const section = el('messageOfferSection');
  const slider = el('messageOfferSlider');
  const label = el('messageOfferAmountLabel');
  const range = priceOfferRange(item);
  if (!section || !slider || !label) return null;
  if (!range) {
    section.hidden = true;
    return null;
  }
  section.hidden = false;
  slider.min = String(range.min);
  slider.max = String(range.max);
  slider.step = range.max - range.min > 40 ? '5' : '1';
  const current = Number(slider.value);
  const next = selectMild
    ? range.max
    : Math.min(range.max, Math.max(range.min, current || range.max));
  slider.value = String(next);
  syncMessageOfferSliderUi(range);
  return range;
}

function syncMessageOfferSliderUi(range) {
  const slider = el('messageOfferSlider');
  const label = el('messageOfferAmountLabel');
  const section = el('messageOfferSection');
  if (!slider || !label) return Number(slider?.value) || 0;
  const min = range?.min ?? Number(slider.min);
  const max = range?.max ?? Number(slider.max);
  const amount = Number(slider.value);
  const hue = offerSliderHue(amount, min, max);
  label.textContent = `${amount}€`;
  label.style.setProperty('--offer-hue', String(hue));
  section?.style.setProperty('--offer-hue', String(hue));
  slider.style.setProperty('--offer-hue', String(hue));
  return amount;
}

function applyMessagePriceOffer({ pickVariant = false } = {}) {
  if (!pendingMessageItem) return;
  const range = priceOfferRange(pendingMessageItem);
  if (!range) return;
  if (pickVariant) messageOfferVariant = Math.floor(Math.random() * 4);
  messageOfferMode = true;
  const amount = syncMessageOfferSliderUi(range);
  el('messageBody').value = priceOfferText(pendingMessageItem, amount, messageOfferVariant);
  document.querySelectorAll('.message-template-button').forEach(btn => {
    btn.classList.toggle('is-active', btn.dataset.template === 'price');
  });
}

function refreshMessageCashButtons(item) {
  const price = Number(item?.price);
  document.querySelectorAll('.message-cash-button').forEach(button => {
    const discount = Number(button.dataset.discount) || 0;
    const amount = cashOfferAmount(price, discount);
    if (!amount) {
      button.textContent = discount ? `−${discount}%` : 'Ask';
      button.disabled = true;
      return;
    }
    button.disabled = false;
    button.textContent = discount
      ? `−${discount}% · ${amount}€`
      : `Ask · ${amount}€`;
  });
}

function isPickupOnlyListing(item) {
  if (!item) return false;
  if (item.pickupOnly === true) return true;
  if (item.shippingPossible === true) return false;
  const text = [
    item.sourceText,
    item.title,
    item.condition,
    item.location,
    item.seller,
  ].filter(Boolean).join(' ');
  return /\bnur\s*(selbst)?abholung\b|\bpick[\s-]?up\s*only\b|\bselbstabholung\b|\bkeine[rn]?\s*versand\b|\bversand\s*(nicht|ausgeschlossen)\b|\bohne\s*versand\b/i.test(text);
}

function syncMessagePickupTemplates(item) {
  const eligible = isLocalPickupEligible(item);
  document.querySelectorAll('.message-template-button[data-requires-pickup="1"]').forEach(button => {
    button.hidden = !eligible;
    if (!eligible) button.classList.remove('is-active');
  });
  const cashSection = el('messageCashSection');
  if (cashSection) cashSection.hidden = !eligible;
  const note = el('messagePickupNote');
  if (note) {
    note.hidden = eligible || item?.marketplace !== 'kleinanzeigen';
  }
  return eligible;
}

function syncMessageShipTemplate(item) {
  const eligible = isPickupOnlyListing(item);
  document.querySelectorAll('.message-template-button[data-requires-pickup-only="1"]').forEach(button => {
    button.hidden = !eligible;
    if (!eligible) button.classList.remove('is-active');
  });
  const note = el('messageShipNote');
  if (note) note.hidden = true; // keep quiet unless we want to explain; only show when KA + not eligible and user might wonder
  return eligible;
}

function messageTemplateFor(item, kind = 'ask', discountPercent = 0) {
  const isKa = item?.marketplace === 'kleinanzeigen';
  const noun = productNounForMessage(item);
  const ask = isKa ? noun.de.ask : noun.en.ask;
  const forObj = isKa ? noun.de.for : noun.en.for;
  const priceNum = Number.isFinite(item?.price) ? Number(item.price) : null;
  const day = pickupDayLabel(isKa);
  const cashAmount = cashOfferAmount(priceNum, discountPercent);
  const cashLabel = formatCashAmount(cashAmount, isKa);

  if (kind === 'price') {
    const sliderAmount = Number(el('messageOfferSlider')?.value);
    const amount = Number.isFinite(sliderAmount) && sliderAmount > 0
      ? sliderAmount
      : (cashOfferAmount(priceNum, 10) || cashAmount);
    return priceOfferText(item, amount, messageOfferVariant);
  }

  if (kind === 'cash') {
    if (isKa) {
      if (cashLabel) {
        return pickMessageVariant([
          `Hallo, wäre es möglich ${ask} ${day} abzuholen und bar mit ${cashLabel} zu bezahlen?`,
          `Hey, könnte ich ${ask} ${day} abholen und ${cashLabel} bar mitbringen?`,
          `Hallo, ist ${ask} noch zu haben?\nKönnte ${day} vorbeikommen und bar ${cashLabel} zahlen.`,
        ]);
      }
      return pickMessageVariant([
        `Hallo, wäre es möglich ${ask} ${day} abzuholen und bar zu bezahlen?`,
        `Hey, könnte ich ${ask} ${day} abholen und bar zahlen?`,
      ]);
    }
    if (cashLabel) {
      return pickMessageVariant([
        `Hi, would it be possible to pick up ${ask} ${day} and pay cash ${cashLabel}?`,
        `Hello, could I collect ${ask} ${day} and pay ${cashLabel} in cash?`,
      ]);
    }
    return `Hi, would it be possible to pick up ${ask} ${day} and pay cash?`;
  }

  if (isKa) {
    if (kind === 'pickup') {
      return pickMessageVariant([
        `Hallo, ist ${ask} noch zu haben?\nKönnte in den nächsten Tagen abholen.`,
        `Hey, ist ${ask} noch aktuell? Würde gerne abholen.`,
        `Hallo, interessiere mich für ${forObj}.\nWann könnte ich vorbeikommen?`,
      ]);
    }
    if (kind === 'ship') {
      return pickMessageVariant([
        `Hallo, ist ${ask} noch da und Versand möglich?`,
        `Hey, ist ${ask} noch zu haben? Würde gerne per Versand nehmen, falls das geht.`,
        `Hallo, interessiert mich ${ask}.\nVersenden Sie auch?`,
      ]);
    }
    if (kind === 'offer') {
      const soft = cashOfferAmount(priceNum, 10);
      if (soft != null) {
        const softLabel = formatCashAmount(soft, true);
        return pickMessageVariant([
          `Hallo, ist ${ask} noch zu haben?\nWürden Sie ${softLabel} nehmen?`,
          `Hey, ist ${ask} noch aktuell? Hätte ${softLabel} bar / Überweisung — geht das?`,
          `Hallo, interessiere mich für ${forObj}.\nWäre ${softLabel} okay für Sie?`,
        ]);
      }
      return pickMessageVariant([
        `Hallo, ist ${ask} noch zu haben? Wäre ein bisschen Verhandlungsspielraum drin?`,
        `Hey, ist ${ask} noch aktuell? Was wäre Ihr letzter Preis?`,
      ]);
    }
    return pickMessageVariant([
      `Hallo, ist ${ask} noch zu haben?`,
      `Hey, ist ${ask} noch aktuell?`,
      `Hallo, interessiere mich für ${forObj}.\nNoch verfügbar?`,
    ]);
  }

  if (kind === 'pickup') {
    return pickMessageVariant([
      `Hi, is ${ask} still available? I could pick it up locally.`,
      `Hello, is ${ask} still for sale? Happy to collect in person.`,
    ]);
  }
  if (kind === 'ship') {
    return pickMessageVariant([
      `Hi, is ${ask} still available, and can you ship?`,
      `Hello — is ${ask} still for sale? Prefer shipping if possible.`,
    ]);
  }
  if (kind === 'offer') {
    const soft = cashOfferAmount(priceNum, 10);
    if (soft != null) {
      const softLabel = formatCashAmount(soft, false);
      return pickMessageVariant([
        `Hi, is ${ask} still available? Would you take ${softLabel}?`,
        `Hello, interested in ${forObj}. Would ${softLabel} work for you?`,
      ]);
    }
    return `Hi, is ${ask} still available? Any flexibility on the price?`;
  }
  return pickMessageVariant([
    `Hi, is ${ask} still available?`,
    `Hello, is ${ask} still for sale?`,
  ]);
}

let pendingMessageItem = null;

function openMessageDialog(item) {
  pendingMessageItem = item;
  messageOfferMode = false;
  const isKa = item.marketplace === 'kleinanzeigen';
  el('messageDialogEyebrow').textContent = isKa ? 'Kleinanzeigen chat' : 'eBay message';
  el('messageDialogHeading').textContent = isKa ? 'Nachricht schreiben' : 'Contact seller';
  el('messageDialogTitle').textContent = item.title || '';
  syncMessagePickupTemplates(item);
  syncMessageShipTemplate(item);
  refreshMessageCashButtons(item);
  setupMessageOfferSlider(item, { selectMild: true });
  el('messageBody').value = messageTemplateFor(item, 'ask');
  el('messageDialogNote').textContent = '';
  document.querySelectorAll('.message-template-button').forEach(btn => {
    btn.classList.toggle('is-active', !btn.hidden && btn.dataset.template === 'ask');
  });
  el('messageDialog').showModal();
  el('messageBody').focus();
}

async function confirmMessageDialog(event) {
  event.preventDefault();
  const item = pendingMessageItem;
  if (!item) return;
  const text = String(el('messageBody').value || '').trim();
  if (!text) {
    el('messageDialogNote').textContent = 'Write a short message first.';
    return;
  }
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch {
    copied = false;
  }
  const popup = window.open(
    listingChatUrl(item),
    'dealwatchSellerChat',
    'popup=yes,width=1100,height=900,menubar=no,toolbar=no,location=yes,status=no',
  );
  if (!popup) {
    el('messageDialogNote').textContent = 'Popup blocked — allow popups, then try again.';
    return;
  }
  el('messageDialogNote').textContent = copied
    ? (item.marketplace === 'kleinanzeigen'
      ? 'Copied. On Kleinanzeigen click “Nachricht schreiben”, then paste.'
      : 'Copied. Paste into the eBay contact form.')
    : 'Listing opened — paste your message manually.';
  setTimeout(() => el('messageDialog').close(), 1100);
}

function ebayOfferUrl(item) {
  // eBay.de has no stable public Make Offer deep link (makeoffer / ISAPI both 404).
  // Open the listing; user clicks “Preisvorschlag” and pastes the copied amount.
  return listingOfferUrl(item);
}

let pendingOfferItem = null;

async function copyOfferAmount(amount) {
  const text = String(amount).replace('.', ',');
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function roundOfferAmount(value) {
  return Math.round(value * 100) / 100;
}

function offerAmountForDiscount(price, discountPercent) {
  if (!Number.isFinite(price) || price <= 0) return '';
  if (!discountPercent) return String(roundOfferAmount(price));
  return String(roundOfferAmount(price * (1 - discountPercent / 100)));
}

function refreshOfferQuickButtons(item) {
  const price = Number(item?.price);
  document.querySelectorAll('.offer-quick-button').forEach(button => {
    const discount = Number(button.dataset.discount) || 0;
    const amount = offerAmountForDiscount(price, discount);
    if (!amount) {
      button.textContent = discount ? `−${discount}%` : 'Ask';
      button.disabled = true;
      return;
    }
    button.disabled = false;
    button.textContent = discount
      ? `−${discount}% · ${euros(Number(amount))}`
      : `Ask · ${euros(Number(amount))}`;
  });
}

function setOfferAmountFromDiscount(discountPercent) {
  const price = Number(pendingOfferItem?.price);
  const amount = offerAmountForDiscount(price, discountPercent);
  if (!amount) return;
  el('offerAmount').value = amount;
  el('offerAmount').focus();
  el('offerAmount').select();
  document.querySelectorAll('.offer-quick-button').forEach(button => {
    button.classList.toggle('active', Number(button.dataset.discount) === Number(discountPercent));
  });
}

function openOfferDialog(item) {
  pendingOfferItem = item;
  el('offerDialogTitle').textContent = item.title;
  el('offerAmount').value = Number.isFinite(item.price) ? String(item.price) : '';
  el('offerDialogNote').textContent = '';
  refreshOfferQuickButtons(item);
  setOfferAmountFromDiscount(0);
  el('offerDialog').showModal();
  el('offerAmount').focus();
  el('offerAmount').select();
}

async function confirmOfferDialog(event) {
  event.preventDefault();
  const item = pendingOfferItem;
  if (!item) return;
  const amount = Number(el('offerAmount').value);
  if (!Number.isFinite(amount) || amount <= 0) {
    el('offerDialogNote').textContent = 'Enter a valid offer amount.';
    return;
  }
  const copied = await copyOfferAmount(amount);
  const popup = window.open(
    ebayOfferUrl(item),
    'dealwatchEbayOffer',
    'popup=yes,width=1040,height=860,menubar=no,toolbar=no,location=yes,status=no',
  );
  if (!popup) {
    el('offerDialogNote').textContent = 'Popup blocked — allow popups for this site, then try again.';
    return;
  }
  try {
    await setOfferSent(item.id, true);
  } catch {
    // Still opened eBay; toggle can be set manually.
  }
  el('offerDialogNote').textContent = copied
    ? `${euros(amount)} copied. On eBay click “Preisvorschlag”, then paste.`
    : 'Popup opened. On eBay click “Preisvorschlag” and enter your offer.';
  setTimeout(() => el('offerDialog').close(), 900);
}

function dealHeatForPrice(price, minPrice = 1, maxPrice = 100) {
  const lo = Math.max(1, Number(minPrice) || 1);
  const hi = Math.max(lo, Number(maxPrice) || lo);
  const p = Number(price);
  const value = Number.isFinite(p) ? p : hi;
  const t = Math.max(0, Math.min(1, (value - lo) / Math.max(1, hi - lo)));
  // Green (great deal) → amber → red (at/near max budget).
  const hue = t <= 0.5
    ? Math.round(152 - t * 2 * 107)
    : Math.round(45 - (t - 0.5) * 2 * 37);
  let label = 'Overpriced';
  if (t <= 0.22) label = 'Great deal';
  else if (t <= 0.42) label = 'Good price';
  else if (t <= 0.62) label = 'Fair';
  else if (t <= 0.82) label = 'Pricey';
  return { t, hue, label };
}

async function setOfferSent(itemId, sent) {
  const id = String(itemId || '');
  if (!id) return;
  const data = await api('/api/offers-sent', {
    method: 'PUT',
    body: JSON.stringify({ id, sent: Boolean(sent) }),
  });
  offersSentIds = new Set((data.offersSent || []).map(String));
  const item = currentListings.find(entry => String(entry.id) === id)
    || currentSuggestions.find(entry => String(entry.id) === id)
    || watchlist.find(entry => String(entry.id) === id);
  if (item) item.offerSent = Boolean(sent);
  render();
  renderWatchlist();
  renderSuggestions();
}

function fillListingCard(node, item, { watched = false, onWatch } = {}) {
  const card = node.querySelector('.listing-card');
  const offerBadge = node.querySelector('.offer-badge');
  const newBadge = node.querySelector('.new-badge');
  const offerHint = node.querySelector('.offer-hint');
  const sendOfferButton = node.querySelector('.send-offer-button');
  const messageButton = node.querySelector('.message-button');
  const offerSentToggle = node.querySelector('.offer-sent-toggle');
  const hasOffer = Boolean(item.bestOffer);
  const isNew = Boolean(item.isNew);
  const offerSent = Boolean(item.offerSent) || offersSentIds.has(String(item.id));
  const filters = currentFilters();
  const heat = dealHeatForPrice(item.price ?? item.total, filters.minPrice, filters.maxPrice);

  const isSold = Boolean(item.sold);
  const isKa = item.marketplace === 'kleinanzeigen';
  card.classList.toggle('has-best-offer', hasOffer && !isKa);
  card.classList.toggle('is-sold', isSold);
  card.classList.toggle('is-new', isNew);
  card.classList.toggle('offer-was-sent', offerSent);
  card.classList.toggle('is-kleinanzeigen', isKa);
  card.classList.add('has-deal-heat');
  card.style.setProperty('--deal-hue', String(heat.hue));
  card.style.setProperty('--deal-t', heat.t.toFixed(3));
  card.dataset.dealHeat = heat.label;
  if (newBadge) newBadge.hidden = !isNew || isSold;
  offerBadge.hidden = !hasOffer || isKa;
  offerHint.hidden = !hasOffer || isSold || isKa;
  sendOfferButton.hidden = !hasOffer || isSold || isKa;
  if (messageButton) {
    messageButton.hidden = isSold;
    messageButton.textContent = isKa ? 'Chat' : 'Message';
    messageButton.addEventListener('click', () => openMessageDialog(item));
  }

  const parts = [];
  if (isNew) parts.push('New');
  if (isSold) parts.push('Sold');
  if (isKa) parts.push('Kleinanzeigen');
  if (item.isAuction) parts.push('Auction');
  if (hasOffer && !isKa) parts.push('Best Offer');
  if (offerSent && !isKa) parts.push('Offer sent');
  parts.push(heat.label);
  node.querySelector('.deal-label').textContent = parts.join(' · ');
  node.querySelector('.deal-label').classList.toggle('has-offer', hasOffer && !isKa);
  const listedEl = node.querySelector('.listed-at');
  const listedText = listedLabel(item.originDate) || item.listedLabel || '';
  if (listedEl) {
    listedEl.hidden = !listedText;
    listedEl.textContent = listedText;
    listedEl.title = listedTitle(item.originDate) || listedText;
  }
  node.querySelector('.time-left').textContent = isSold
    ? (item.soldLabel || 'Sold')
    : (isKa ? (item.listedLabel || 'Kleinanzeigen') : timeLeft(item.endDate));
  node.querySelector('.listing-title').textContent = item.title;
  node.querySelector('.seller').textContent = isKa
    ? (item.seller || 'Kleinanzeigen')
    : sellerFeedbackLabel(item);
  node.querySelector('.condition').textContent = item.condition;
  node.querySelector('.total-price').textContent = euros(item.total);
  node.querySelector('.shipping').textContent = isKa
    ? (item.pickupOnly
      ? 'pickup only'
      : (item.shippingPossible ? 'shipping possible' : 'pickup / see ad'))
    : (item.shippingKnown === false
      ? 'shipping not listed'
      : `incl. shipping ${euros(item.shipping)}`);
  node.querySelector('.offer-link').href = item.url;
  node.querySelector('.offer-link').textContent = isKa ? 'Open ad' : 'Open';
  setListingImage(node, item);
  if (hasOffer && !isKa) {
    sendOfferButton.addEventListener('click', () => openOfferDialog(item));
  }
  if (offerSentToggle) {
    offerSentToggle.hidden = isSold || !hasOffer || isKa;
    offerSentToggle.classList.toggle('is-on', offerSent);
    offerSentToggle.setAttribute('aria-pressed', offerSent ? 'true' : 'false');
    offerSentToggle.textContent = offerSent ? 'Sent ✓' : 'Offer sent';
    offerSentToggle.addEventListener('click', () => {
      setOfferSent(item.id, !offerSent).catch(error => {
        el('dataNote').textContent = error.message;
      });
    });
  }
  const watchButton = node.querySelector('.watch-button');
  watchButton.textContent = watched ? 'Remove' : 'Watch';
  watchButton.classList.toggle('active', watched);
  watchButton.addEventListener('click', () => onWatch?.(item, watched));
}

function unreadNotificationCount(searchId = null) {
  return notifications.filter(item => !item.read && (searchId == null || item.searchId === searchId)).length;
}

function renderSidebarNewMatches() {
  const strip = el('sidebarNewMatches');
  const countEl = el('sidebarNewCount');
  if (!strip || !countEl) return;
  const unread = unreadNotificationCount();
  strip.hidden = unread === 0;
  countEl.textContent = unread > 99 ? '99+' : String(unread);
}

function renderSidebar() {
  const list = el('searchList');
  list.replaceChildren();
  const canDelete = searches.length > 1;
  if (pendingDeleteId && !searches.some(item => item.id === pendingDeleteId)) {
    pendingDeleteId = '';
  }
  searches.forEach(search => {
    const row = document.createElement('div');
    row.className = 'search-row';
    row.dataset.searchId = search.id;
    row.dataset.marketplace = search.marketplace === 'kleinanzeigen' ? 'kleinanzeigen' : 'ebay';
    const unread = unreadNotificationCount(search.id);
    if (unread > 0) row.classList.add('has-unread');
    const confirming = pendingDeleteId === search.id;
    if (confirming) row.classList.add('is-confirming-delete');
    row.draggable = !confirming;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = `search-item${search.id === activeId ? ' active' : ''}`;
    const keyword = String(search.search || '').trim();
    const variants = Array.isArray(search.searchVariants)
      ? search.searchVariants.map(item => String(item || '').trim()).filter(Boolean)
      : [];
    const keywordLabel = variants.length > 1 ? variants.join(' · ') : keyword;
    const paused = search.monitor === false;
    const marketTag = search.marketplace === 'kleinanzeigen' ? ' · KA' : '';
    const distTag = search.marketplace === 'kleinanzeigen' && search.locationLabel
      ? ` · ${search.locationLabel}${search.radiusKm ? ` +${search.radiusKm}km` : ''}`
      : '';
    if (paused) row.classList.add('is-paused');
    button.innerHTML = confirming
      ? `<span>Move to trash?</span><small>${search.name}</small>`
      : keywordLabel
        ? `<span>${search.name}</span><small>${keywordLabel}${marketTag}${distTag}${paused ? ' · Paused' : ''}</small>`
        : `<span>${search.name}</span><small>${(marketTag + distTag).trim() || (paused ? 'Paused' : '')}</small>`;
    button.addEventListener('click', () => {
      if (confirming || filterDragMoved) {
        filterDragMoved = false;
        return;
      }
      openFilterFromSidebar(search.id).catch(error => {
        el('dataNote').textContent = error.message;
      });
    });

    const actions = document.createElement('div');
    actions.className = 'search-row-actions';

    if (confirming) {
      const confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.className = 'search-confirm';
      confirmBtn.textContent = '✓';
      confirmBtn.title = 'Confirm delete';
      confirmBtn.setAttribute('aria-label', `Confirm delete ${search.name}`);
      confirmBtn.addEventListener('click', event => {
        event.stopPropagation();
        confirmDeleteSearch(search.id).catch(error => {
          el('dataNote').textContent = error.message;
        });
      });

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'search-cancel';
      cancelBtn.textContent = '✕';
      cancelBtn.title = 'Cancel';
      cancelBtn.setAttribute('aria-label', 'Cancel delete');
      cancelBtn.addEventListener('click', event => {
        event.stopPropagation();
        pendingDeleteId = '';
        renderSidebar();
      });

      actions.append(confirmBtn, cancelBtn);
      row.append(button, actions);
      list.append(row);
      return;
    }

    if (unread > 0) {
      const badge = document.createElement('button');
      badge.type = 'button';
      badge.className = 'search-unread';
      badge.textContent = unread > 99 ? '99+' : String(unread);
      badge.title = `${unread} new match${unread === 1 ? '' : 'es'}`;
      badge.setAttribute('aria-label', `${unread} new matches for ${search.name}`);
      badge.addEventListener('click', event => {
        event.stopPropagation();
        openFilterFromSidebar(search.id).catch(error => {
          el('dataNote').textContent = error.message;
        });
      });
      actions.append(badge);
    }

    const pauseBtn = document.createElement('button');
    pauseBtn.type = 'button';
    pauseBtn.className = `pause-toggle${paused ? ' is-paused' : ''}`;
    pauseBtn.innerHTML = paused
      ? '<span class="pause-icon" aria-hidden="true">▶</span>'
      : '<span class="pause-icon" aria-hidden="true">⏸</span>';
    pauseBtn.title = paused
      ? 'Resume background scanning for this filter'
      : 'Pause background scanning for this filter';
    pauseBtn.setAttribute('aria-pressed', paused ? 'true' : 'false');
    pauseBtn.setAttribute('aria-label', paused
      ? `Resume ${search.name}`
      : `Pause ${search.name}`);
    pauseBtn.addEventListener('click', event => {
      event.stopPropagation();
      toggleSearchMonitor(search.id, paused).catch(error => {
        el('dataNote').textContent = error.message;
      });
    });

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'search-delete';
    del.textContent = '×';
    del.title = canDelete ? 'Move filter to trash' : 'Create another filter before deleting this one';
    del.setAttribute('aria-label', `Delete ${search.name}`);
    del.disabled = !canDelete;
    del.addEventListener('click', event => {
      event.stopPropagation();
      requestDeleteSearch(search.id);
    });

    actions.append(pauseBtn, del);
    row.append(button, actions);

    row.addEventListener('dragstart', event => {
      if (event.target.closest('.search-row-actions')) {
        event.preventDefault();
        return;
      }
      dragFilterId = search.id;
      filterDragMoved = false;
      row.classList.add('is-dragging');
      list.classList.add('is-reordering');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', search.id);
      try {
        const ghost = row.cloneNode(true);
        ghost.classList.add('search-row-ghost');
        ghost.style.width = `${row.getBoundingClientRect().width}px`;
        document.body.appendChild(ghost);
        event.dataTransfer.setDragImage(ghost, 24, Math.min(28, row.offsetHeight / 2));
        requestAnimationFrame(() => ghost.remove());
      } catch {
        // setDragImage is optional
      }
    });
    row.addEventListener('dragend', () => {
      clearFilterDropMarkers(list);
      row.classList.remove('is-dragging');
      list.classList.remove('is-reordering');
      dragFilterId = '';
      setTimeout(() => { filterDragMoved = false; }, 40);
    });
    row.addEventListener('dragover', event => {
      if (!dragFilterId || dragFilterId === search.id) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      const rect = row.getBoundingClientRect();
      const place = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
      clearFilterDropMarkers(list);
      row.classList.add(place === 'before' ? 'drop-before' : 'drop-after');
      row.dataset.dropPlace = place;
    });
    row.addEventListener('dragleave', event => {
      if (row.contains(event.relatedTarget)) return;
      row.classList.remove('drop-before', 'drop-after');
      delete row.dataset.dropPlace;
    });
    row.addEventListener('drop', event => {
      event.preventDefault();
      const place = row.dataset.dropPlace || 'before';
      clearFilterDropMarkers(list);
      list.classList.remove('is-reordering');
      const fromId = dragFilterId || event.dataTransfer.getData('text/plain');
      if (!fromId || fromId === search.id) return;
      filterDragMoved = true;
      reorderSearches(fromId, search.id, place).catch(error => {
        el('dataNote').textContent = error.message;
      });
    });

    list.append(row);
  });
  el('filterCount').textContent = String(searches.length);
  renderSidebarNewMatches();
}

function clearFilterDropMarkers(list = el('searchList')) {
  if (!list) return;
  list.querySelectorAll('.search-row').forEach(node => {
    node.classList.remove('drag-over', 'drop-before', 'drop-after', 'is-dragging');
    delete node.dataset.dropPlace;
  });
}

async function reorderSearches(fromId, toId, place = 'before') {
  if (!fromId || !toId || fromId === toId) return;
  const from = searches.findIndex(item => item.id === fromId);
  if (from < 0 || !searches.some(item => item.id === toId)) return;
  const next = [...searches];
  const [moved] = next.splice(from, 1);
  let insertAt = next.findIndex(item => item.id === toId);
  if (insertAt < 0) return;
  if (place === 'after') insertAt += 1;
  next.splice(insertAt, 0, moved);
  // No-op if order unchanged.
  if (next.every((item, index) => item.id === searches[index]?.id)) return;
  searches = next;
  renderSidebar();
  const data = await api('/api/searches/reorder', {
    method: 'PUT',
    body: JSON.stringify({ ids: next.map(item => item.id) }),
  });
  applyStore(data);
}

function renderNotifications() {
  renderSidebar();
}

async function toggleSearchMonitor(id, monitor) {
  const data = await api(`/api/searches/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify({ monitor: Boolean(monitor) }),
  });
  applyStore(data, { syncForm: false });
  renderSidebar();
  scheduleAutoRefresh();
  el('dataNote').textContent = monitor
    ? 'Resumed — background scanning on for this filter.'
    : 'Paused — background scanning off for this filter.';
  updateConnectionStatus();
}

async function refreshNotifications({ quiet = true } = {}) {
  if (window.location.protocol === 'file:') return;
  try {
    const data = await api('/api/notifications');
    if (Array.isArray(data.notifications)) notifications = data.notifications;
    if (data.searches) {
      searches = data.searches;
      trash = data.trash || trash;
      activeId = data.activeId || activeId;
      if (typeof data.alerts === 'boolean') alertsOn = data.alerts;
    }
    renderSidebar();
  } catch (error) {
    if (!quiet) el('dataNote').textContent = `Notifications: ${error.message}`;
  }
}

function scheduleNotificationPoll() {
  if (notifyTimer) {
    clearInterval(notifyTimer);
    notifyTimer = null;
  }
  if (!alertsOn || window.location.protocol === 'file:') return;
  notifyTimer = setInterval(() => {
    if (!document.hidden) refreshNotifications({ quiet: true });
  }, 30_000);
}

async function onTabVisibleAgain() {
  if (document.hidden || window.location.protocol === 'file:' || !alertsOn) return;
  await refreshNotifications({ quiet: true });
  const active = searches.find(item => item.id === activeId);
  if (active && active.monitor !== false) {
    await fetchListings({ quiet: true, filters: filtersFromSearch(active) });
  }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) onTabVisibleAgain().catch(() => {});
});

async function markFilterNotificationsRead(searchId) {
  const ids = notifications
    .filter(item => !item.read && item.searchId === searchId)
    .map(item => item.id);
  if (!ids.length) return;
  try {
    const data = await api('/api/notifications/read', {
      method: 'PUT',
      body: JSON.stringify({ ids }),
    });
    if (Array.isArray(data.notifications)) notifications = data.notifications;
    renderSidebar();
  } catch {
    // still open the filter if mark-read fails
  }
}

async function openFilterFromSidebar(searchId) {
  await markFilterNotificationsRead(searchId);
  if (searchId !== activeId) {
    await selectSearch(searchId);
  } else {
    await fetchListings({ quiet: false });
  }
  document.querySelectorAll('[data-nav]').forEach(link => {
    link.classList.toggle('active', link.dataset.nav === 'results');
  });
  el('results')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function openFirstUnreadFilter() {
  const first = notifications.find(item => !item.read && item.searchId);
  if (!first) return;
  await openFilterFromSidebar(first.searchId);
}

function applyViewMode() {
  const grids = [el('listingGrid'), el('watchlistGrid'), el('soldGrid'), el('suggestGrid')].filter(Boolean);
  grids.forEach(grid => {
    VIEW_MODES.forEach(mode => grid.classList.toggle(`view-${mode}`, viewMode === mode));
  });
  document.querySelectorAll('.view-toggle .view-button').forEach(button => {
    const mode = button.dataset.view || button.id?.replace(/^view/, '').toLowerCase();
    const active = mode === viewMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
}

function setViewMode(mode) {
  viewMode = VIEW_MODES.includes(mode) ? mode : 'tiles';
  localStorage.setItem('dealwatchViewMode', viewMode);
  applyViewMode();
}

function renderWatchlist() {
  const grid = el('watchlistGrid');
  const template = el('listingTemplate');
  grid.replaceChildren();
  watchlist.forEach(item => {
    const node = template.content.cloneNode(true);
    fillListingCard(node, item, {
      watched: true,
      onWatch: () => removeFromWatchlist(item.id),
    });
    grid.append(node);
  });
  applyViewMode();
  el('watchEmpty').hidden = watchlist.length !== 0;
  el('watchCount').textContent = String(watchlist.length);
}

function renderKaPurchases() {
  renderKaDealList({
    items: kaPurchases,
    listId: 'kaPurchaseList',
    emptyId: 'kaPurchaseEmpty',
    noteId: 'kaPurchaseNote',
    countId: 'kaPurchaseCount',
    side: 'buy',
  });
}

function renderKaSales() {
  renderKaDealList({
    items: kaSales,
    listId: 'kaSaleList',
    emptyId: 'kaSaleEmpty',
    noteId: 'kaSaleNote',
    countId: 'kaSaleCount',
    side: 'sell',
  });
}

function renderKaDealList({ items, listId, emptyId, noteId, countId, side }) {
  const list = el(listId);
  const empty = el(emptyId);
  const note = el(noteId);
  const count = el(countId);
  if (!list) return;
  list.replaceChildren();
  const rows = Array.isArray(items) ? items : [];
  rows.forEach(item => {
    const card = document.createElement('article');
    card.className = 'ka-purchase-card';
    const whenRaw = side === 'sell' ? (item.paidAt || item.soldAt) : (item.paidAt || item.purchasedAt);
    const when = whenRaw
      ? new Date(whenRaw).toLocaleString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
      : '—';
    card.innerHTML = `
      <strong></strong>
      <div class="ka-purchase-meta">
        <span><b class="price"></b></span>
        <span class="who"></span>
        <span class="when"></span>
        <span class="channel"></span>
        <span class="period"></span>
      </div>
      <p class="ka-purchase-evidence"></p>
      <a target="_blank" rel="noreferrer">Open</a>
    `;
    card.querySelector('strong').textContent = item.displayName || item.title || (side === 'sell' ? 'Sale' : 'Purchase');
    card.querySelector('.price').textContent = Number.isFinite(item.price) ? euros(item.price) : 'price ?';
    card.querySelector('.who').textContent = '';
    card.querySelector('.when').textContent = when;
    card.querySelector('.channel').textContent = '';
    card.querySelector('.period').textContent = '';
    card.querySelector('.ka-purchase-evidence').textContent = '';
    card.querySelector('.ka-purchase-evidence').hidden = true;
    card.querySelector('.who').hidden = true;
    card.querySelector('.channel').hidden = true;
    card.querySelector('.period').hidden = true;
    const link = card.querySelector('a');
    link.href = item.url || 'https://www.kleinanzeigen.de/m-nachrichten.html';
    list.append(card);
  });
  if (empty) empty.hidden = rows.length !== 0;
  if (count) count.textContent = String(rows.length);
  if (note) {
    const total = rows.reduce((sum, item) => sum + (Number.isFinite(item.price) ? Number(item.price) : 0), 0);
    note.textContent = rows.length
      ? `${rows.length} confirmed ${side === 'sell' ? 'sale' : 'purchase'}${rows.length === 1 ? '' : 's'} · ${euros(total)}`
      : '';
  }
}

async function fetchKaPurchases({ quiet = true } = {}) {
  try {
    const data = await api('/api/ka/purchases');
    kaPurchases = data.purchases || [];
    renderKaPurchases();
    updatePageMeta();
  } catch (error) {
    if (!quiet && el('kaPurchaseNote')) el('kaPurchaseNote').textContent = error.message;
  }
}

async function fetchKaSales({ quiet = true } = {}) {
  try {
    const data = await api('/api/ka/sales');
    kaSales = data.sales || [];
    renderKaSales();
    updatePageMeta();
  } catch (error) {
    if (!quiet && el('kaSaleNote')) el('kaSaleNote').textContent = error.message;
  }
}

function renderSold(stats = {}) {
  const grid = el('soldGrid');
  const template = el('listingTemplate');
  if (!grid || !template) return;
  grid.replaceChildren();
  soldListings.forEach(item => {
    const node = template.content.cloneNode(true);
    fillListingCard(node, item, {
      watched: watchlistIds.has(item.id),
      onWatch: (listing, watched) => (watched ? removeFromWatchlist(listing.id) : addToWatchlist(listing)),
    });
    grid.append(node);
  });
  applyViewMode();
  const kept = Number.isFinite(stats.kept) ? stats.kept : soldListings.length;
  if (el('soldMatches')) el('soldMatches').textContent = String(kept);
  if (el('soldRejected')) el('soldRejected').textContent = Number.isFinite(stats.rejected) ? String(stats.rejected) : '—';
  if (el('soldMedian')) el('soldMedian').textContent = Number.isFinite(stats.median) ? euros(stats.median) : '—';
  if (el('soldEmpty')) el('soldEmpty').hidden = soldListings.length !== 0;
}

async function fetchSoldListings() {
  const filters = currentFilters();
  const note = el('soldNote');
  const button = el('loadSoldButton');
  const topNote = el('dataNote');
  if (!button) return;
  if (window.location.protocol === 'file:') {
    const msg = 'Open the app at http://localhost:3000 to load sold comps.';
    if (note) note.textContent = msg;
    if (topNote) topNote.textContent = msg;
    return;
  }
  if (soldFetching) return;
  soldFetching = true;
  button.textContent = 'Loading sold…';
  button.disabled = true;
  if (note) note.textContent = 'Loading sold comps from eBay.de…';
  if (topNote) topNote.textContent = 'Loading sold comps from eBay.de…';
  try {
    const params = new URLSearchParams({
      query: filters.search,
      minPrice: String(filters.minPrice || 1),
      maxPrice: String(filters.maxPrice),
      minFeedback: String(filters.minFeedback),
      condition: filters.condition,
      enabledSmartFilters: (filters.enabledSmartFilters || []).join(','),
      includeCapacities: (filters.includeCapacities || []).join(','),
    });
    if (filters.categoryId) params.set('categoryId', String(filters.categoryId));
    const data = await api(`/api/sold?${params}`);
    soldListings = data.items || [];
    renderSold({
      kept: soldListings.length,
      rejected: data.rejected,
      median: data.median,
    });
    const msg = `Sold comps: kept ${soldListings.length}, rejected ${data.rejected ?? 0}, median ${Number.isFinite(data.median) ? euros(data.median) : '—'}.`;
    if (note) note.textContent = `Sold comps from eBay.de. Scanned: ${data.scanned}; kept after filters: ${soldListings.length}; rejected: ${data.rejected}.`;
    if (topNote) topNote.textContent = msg;
    el('sold')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    soldListings = [];
    renderSold({ kept: 0, rejected: 0, median: null });
    const msg = `Sold comps error: ${error.message}`;
    if (note) note.textContent = msg;
    if (topNote) topNote.textContent = msg;
  } finally {
    soldFetching = false;
    button.textContent = 'Load sold comps';
    button.disabled = false;
  }
}

function renderTrash() {
  const list = el('trashList');
  const template = el('trashItemTemplate');
  list.replaceChildren();
  trash.forEach(item => {
    const node = template.content.cloneNode(true);
    node.querySelector('.trash-name').textContent = item.name;
    const deleted = item.deletedAt
      ? new Date(item.deletedAt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
      : '';
    node.querySelector('.trash-meta').textContent = `${item.categoryName || item.name || 'Filter'} · under €${item.maxPrice}${deleted ? ` · deleted ${deleted}` : ''}`;
    node.querySelector('.restore-button').addEventListener('click', () => restoreSearch(item.id));
    node.querySelector('.purge-button').addEventListener('click', () => purgeSearch(item.id));
    list.append(node);
  });
  el('trashEmpty').hidden = trash.length !== 0;
  el('trashCount').textContent = String(trash.length);
}

function renderSuggestions() {
  const block = el('suggestBlock');
  const grid = el('suggestGrid');
  const raiseBtn = el('suggestRaiseBudget');
  if (!block || !grid) return;

  const filters = currentFilters();
  const hasSuggestions = currentSuggestions.length > 0 && currentListings.length === 0;
  block.hidden = !hasSuggestions;
  if (!hasSuggestions) {
    grid.replaceChildren();
    if (raiseBtn) raiseBtn.hidden = true;
    return;
  }

  const max = filters.maxPrice;
  const cheapest = suggestionMeta?.cheapestAbove || currentSuggestions[0]?.price;
  const upTo = suggestionMeta?.searchedUpTo;
  el('suggestTitle').textContent = `Closest lots above €${max}`;
  el('suggestCopy').textContent = cheapest
    ? `No matches in budget. Showing ${currentSuggestions.length} nearby lot${currentSuggestions.length === 1 ? '' : 's'} from €${Math.ceil(cheapest)}${upTo ? ` (checked up to €${upTo})` : ''}.`
    : 'No matches in budget. Nearby lots above your max:';

  if (raiseBtn) {
    const nextMax = Math.ceil(Number(cheapest) || max + 10);
    raiseBtn.hidden = !Number.isFinite(nextMax) || nextMax <= max;
    raiseBtn.textContent = `Raise budget to €${nextMax}`;
    raiseBtn.dataset.max = String(nextMax);
  }

  const template = el('listingTemplate');
  grid.replaceChildren();
  currentSuggestions.forEach(item => {
    const node = template.content.cloneNode(true);
    fillListingCard(node, item, {
      watched: watchlistIds.has(item.id),
      onWatch: (listing, watched) => (watched ? removeFromWatchlist(listing.id) : addToWatchlist(listing)),
    });
    const card = node.querySelector('.listing-card');
    card?.classList.add('is-suggestion');
    const deal = node.querySelector('.deal-label');
    if (deal && item.overBudgetBy > 0) {
      deal.textContent = `+€${Math.ceil(item.overBudgetBy)} over budget · ${deal.textContent}`;
    }
    grid.append(node);
  });
}

function render() {
  const sort = el('sort').value;
  const valid = [...currentListings].sort((a, b) => {
    const newDelta = Number(Boolean(b.isNew)) - Number(Boolean(a.isNew));
    if (newDelta) return newDelta;
    if (sort === 'price') return a.total - b.total;
    if (sort === 'ending') return new Date(a.endDate || 0) - new Date(b.endDate || 0);
    if (sort === 'offer') return Number(b.bestOffer) - Number(a.bestOffer) || b.dealScore - a.dealScore;
    return b.dealScore - a.dealScore;
  });
  const grid = el('listingGrid');
  const template = el('listingTemplate');
  grid.replaceChildren();
  valid.forEach(item => {
    const node = template.content.cloneNode(true);
    fillListingCard(node, item, {
      watched: watchlistIds.has(item.id),
      onWatch: (listing, watched) => (watched ? removeFromWatchlist(listing.id) : addToWatchlist(listing)),
    });
    grid.append(node);
  });
  el('resultCount').textContent = valid.length;
  if (el('matchingCount')) {
    el('matchingCount').textContent = String(valid.length);
    el('matchingCount').title = lastRejected
      ? `${valid.length} shown · ${lastRejected} rejected by filters`
      : `${valid.length} matching offer${valid.length === 1 ? '' : 's'}`;
  }
  el('metricMatches').textContent = valid.length;
  el('metricBest').textContent = valid.length ? euros(Math.min(...valid.map(item => item.total))) : '—';
  el('metricRejected').textContent = lastRejected;
  el('emptyState').hidden = valid.length !== 0;
  if (el('emptyStateCopy')) {
    el('emptyStateCopy').textContent = currentSuggestions.length
      ? `Nothing under €${currentFilters().maxPrice}. Nearby options are listed below.`
      : 'Raise the budget or loosen one of the filters.';
  }
  renderSuggestions();
  applyViewMode();
  updatePageMeta();
}

async function api(path, options = {}) {
  const url = typeof path === 'string' && path.startsWith('/api/') && !path.startsWith('/api/dealwatch')
    ? `/api/dealwatch${path.slice(4)}`
    : path;
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const raw = data && data.error;
    const message = typeof raw === 'string'
      ? raw
      : raw && typeof raw.message === 'string'
        ? raw.message
        : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return data;
}

async function flushAutoSaveIfNeeded() {
  cancelAutoSave();
  if (!activeId || autoSavePaused || !isFiltersDirty()) return;
  try {
    await saveActiveSearch();
  } catch {
    // Keep switching even if save fails; notice already set by caller paths if needed.
  }
}

async function selectSearch(id) {
  if (id !== activeId) {
    await flushAutoSaveIfNeeded();
    const data = await api('/api/searches/active', { method: 'PUT', body: JSON.stringify({ id }) });
    applyStore(data, { syncForm: false });
  }
  cancelAutoSave();
  smartFilterApplyGen += 1;
  clearTimeout(smartFilterApplyTimer);
  const active = searches.find(item => item.id === id) || searches.find(item => item.id === activeId);
  if (!active) return;
  applySearchToForm(active);
  await fetchListings({ quiet: false, filters: filtersFromSearch(active) });
}

async function saveActiveSearch() {
  if (!activeId) throw new Error('No active filter.');
  cancelAutoSave();
  const payload = currentFilters();
  const data = await api(`/api/searches/${encodeURIComponent(activeId)}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });
  pauseAutoSave();
  try {
    // Form is source of truth while editing — never clobber in-progress pill toggles.
    applyStore(data, { syncForm: false });
  } finally {
    resumeAutoSave();
  }
  markFiltersSaved(payload);
  return data;
}

async function createSearch(fromForm = false) {
  const payload = fromForm
    ? currentFilters()
    : {
      name: 'New search',
      search: '',
      minPrice: 1,
      maxPrice: 80,
      minFeedback: 90,
      condition: 'any',
      enabledSmartFilters: [],
      includeCapacities: [],
      marketplace: getSelectedMarketplace(),
    };
  if (!fromForm) payload.name = makeSearchName(payload);
  const data = await api('/api/searches', { method: 'POST', body: JSON.stringify(payload) });
  applyStore(data);
  await fetchListings({ quiet: false });
  el('searchName')?.focus();
}

const wizardState = {
  step: 1,
  parentId: '',
  path: [],
  selected: null,
  categories: [],
  searchQuery: '',
  searchResults: [],
  searching: false,
};

let wizardSearchTimer = null;

function setWizardStep(step) {
  wizardState.step = step;
  el('wizardStepCategory').hidden = step !== 1;
  el('wizardStepDetails').hidden = step !== 2;
  el('wizardTitle').textContent = step === 1 ? 'Pick a category' : 'Filter details';
  el('wizardSubtitle').textContent = step === 1
    ? 'eBay.de PC parts · search or drill down'
    : 'Name and budget for this category';
  document.querySelectorAll('#wizardSteps li').forEach(item => {
    const n = Number(item.dataset.step);
    item.classList.toggle('is-active', n === step);
    item.classList.toggle('is-done', n < step);
  });
  if (step === 1) el('wizardCategorySearch')?.focus();
}

function renderWizardBreadcrumb() {
  const nav = el('wizardBreadcrumb');
  nav.hidden = Boolean(wizardState.searchQuery);
  nav.replaceChildren();
  if (wizardState.searchQuery) return;
  const root = document.createElement('button');
  root.type = 'button';
  root.className = 'wizard-crumb';
  root.textContent = 'PC parts';
  root.disabled = !wizardState.parentId;
  root.addEventListener('click', () => loadWizardCategories(''));
  nav.append(root);
  wizardState.path.forEach((crumb, index) => {
    const sep = document.createElement('span');
    sep.className = 'wizard-crumb-sep';
    sep.textContent = '›';
    nav.append(sep);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'wizard-crumb';
    btn.textContent = crumb.name;
    const isLast = index === wizardState.path.length - 1;
    btn.disabled = isLast;
    if (!isLast) btn.addEventListener('click', () => loadWizardCategories(crumb.id));
    nav.append(btn);
  });
}

function appendWizardCategoryButton(cat, { search = false } = {}) {
  const list = el('wizardCategoryList');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `wizard-cat-button${search ? ' is-search' : ''}${wizardState.selected?.id === cat.id ? ' is-selected' : ''}`;
  const name = document.createElement('span');
  name.textContent = cat.name;
  button.append(name);
  if (search && cat.pathLabel) {
    const path = document.createElement('span');
    path.className = 'wizard-cat-path';
    path.textContent = cat.pathLabel;
    button.append(path);
  } else {
    const meta = document.createElement('span');
    meta.className = 'wizard-cat-meta';
    meta.textContent = cat.leaf ? 'Leaf' : `${cat.childCount || 0} ›`;
    button.append(meta);
  }
  button.addEventListener('click', () => {
    if (search) {
      selectWizardCategory(cat, cat.path || []);
      return;
    }
    if (!cat.leaf && (cat.childCount || 0) > 0) {
      loadWizardCategories(cat.id);
      return;
    }
    selectWizardCategory(cat, wizardState.path);
  });
  button.addEventListener('dblclick', () => {
    const path = search
      ? (cat.path || [])
      : (cat.leaf ? wizardState.path : [...wizardState.path, { id: cat.id, name: cat.name }]);
    selectWizardCategory(cat, path);
    goWizardDetails();
  });
  list.append(button);
}

function renderWizardCategories() {
  const list = el('wizardCategoryList');
  list.replaceChildren();
  if (wizardState.searchQuery) {
    if (wizardState.searching) {
      el('wizardCategoryNote').textContent = 'Searching…';
      return;
    }
    if (!wizardState.searchResults.length) {
      el('wizardCategoryNote').textContent = `No categories match “${wizardState.searchQuery}”.`;
      return;
    }
    el('wizardCategoryNote').textContent = `${wizardState.searchResults.length} match${wizardState.searchResults.length === 1 ? '' : 'es'} · click to select, double-click to continue`;
    wizardState.searchResults.forEach(cat => appendWizardCategoryButton(cat, { search: true }));
    return;
  }
  if (!wizardState.categories.length) {
    el('wizardCategoryNote').textContent = 'No subcategories here. Use this category or go back.';
    return;
  }
  el('wizardCategoryNote').textContent = 'Select a category to drill down, or continue with the highlighted one.';
  wizardState.categories.forEach(cat => appendWizardCategoryButton(cat));
}

function selectWizardCategory(cat, path = wizardState.path) {
  const fullPath = Array.isArray(path) && path.length
    ? (path.some(item => item.id === cat.id) ? path : [...path, { id: cat.id, name: cat.name }])
    : [{ id: cat.id, name: cat.name }];
  wizardState.selected = {
    id: cat.id,
    name: cat.name,
    leaf: Boolean(cat.leaf),
    path: fullPath,
  };
  el('wizardNextDetails').disabled = false;
  el('wizardUseCategory').hidden = false;
  renderWizardCategories();
}

async function loadWizardCategories(parentId = '') {
  el('wizardCategoryNote').textContent = 'Loading eBay categories…';
  el('wizardNextDetails').disabled = true;
  try {
    const data = await api(`/api/categories?parent=${encodeURIComponent(parentId || '')}`);
    wizardState.parentId = parentId || '';
    wizardState.path = Array.isArray(data.path) ? data.path : [];
    wizardState.categories = Array.isArray(data.categories) ? data.categories : [];
    wizardState.searchQuery = '';
    wizardState.searchResults = [];
    wizardState.searching = false;
    if (el('wizardCategorySearch')) el('wizardCategorySearch').value = '';
    if (data.parent) {
      selectWizardCategory(data.parent, wizardState.path);
    } else {
      wizardState.selected = null;
      el('wizardUseCategory').hidden = true;
    }
    renderWizardBreadcrumb();
    renderWizardCategories();
  } catch (error) {
    el('wizardCategoryNote').textContent = error.message;
  }
}

async function runWizardCategorySearch(query) {
  const q = String(query || '').trim();
  wizardState.searchQuery = q;
  if (!q) {
    wizardState.searchResults = [];
    wizardState.searching = false;
    renderWizardBreadcrumb();
    renderWizardCategories();
    return;
  }
  wizardState.searching = true;
  renderWizardBreadcrumb();
  renderWizardCategories();
  const requestId = q;
  try {
    const data = await api(`/api/categories?q=${encodeURIComponent(q)}`);
    if (wizardState.searchQuery !== requestId) return;
    wizardState.searchResults = Array.isArray(data.results) ? data.results : [];
    wizardState.searching = false;
    renderWizardCategories();
  } catch (error) {
    if (wizardState.searchQuery !== requestId) return;
    wizardState.searching = false;
    wizardState.searchResults = [];
    el('wizardCategoryNote').textContent = error.message;
  }
}

function onWizardCategorySearchInput() {
  const q = el('wizardCategorySearch')?.value || '';
  clearTimeout(wizardSearchTimer);
  wizardSearchTimer = setTimeout(() => {
    runWizardCategorySearch(q).catch(error => {
      el('wizardCategoryNote').textContent = error.message;
    });
  }, 120);
}

function keywordsFromFilterName(name) {
  return String(name || '')
    .replace(/\s+under\s+€\s*\d+(?:[.,]\d+)?/i, '')
    .replace(/\s+€\s*\d+(?:[.,]\d+)?\s*[–\-]\s*€?\s*\d+(?:[.,]\d+)?/i, '')
    .replace(/\s+до\s+€\s*\d+/i, '')
    .trim();
}

function suggestWizardDefaults() {
  const selected = wizardState.selected;
  const name = selected?.name || 'PC part';
  const short = name
    .replace(/\(.*?\)/g, '')
    .replace(/Computer-Komponenten\s*&\s*-Teile/i, 'PC parts')
    .replace(/Grafik-\/?Videokarten/i, 'GPU')
    .replace(/Arbeitsspeicher\s*\(RAM\)/i, 'RAM')
    .replace(/CPUs?\/Prozessoren/i, 'CPU')
    .replace(/Solid State Drives?/i, 'SSD')
    .trim();
  const isGpu = String(selected?.id || '') === '27386' || /\bgpu\b/i.test(short);
  const isPc = String(selected?.id || '') === '179'
    || String(selected?.id || '') === '171957'
    || /\bdesktop|all-in-one|\bpcs?\b/i.test(short);
  const isRam = String(selected?.id || '') === '170083' || /\bram\b/i.test(short);
  const isSsd = /\bssd\b/i.test(short);
  const label = isSsd ? 'SSD' : isPc ? 'PC' : isRam ? 'RAM' : short.split(/\s+/).slice(0, 2).join(' ');
  if (el('wizardSearch')) {
    el('wizardSearch').value = '';
    el('wizardSearch').required = true;
    el('wizardSearch').placeholder = isGpu
      ? 'Required · e.g. GTX 1080'
      : isPc
        ? 'Required · e.g. PC or Desktop'
        : isRam
          ? 'Required · e.g. DDR5 SODIMM'
          : isSsd
            ? 'Required · e.g. Samsung 970 EVO 1TB'
            : 'Required · ebay.de keywords';
  }
  if (el('wizardName')) el('wizardName').dataset.manual = '';
  el('wizardName').value = isGpu
    ? 'GPU under €80'
    : isPc
      ? 'PC under €50'
      : isRam
        ? 'DDR5 SODIMM under €80'
        : `${label} under €100`;
  if (isGpu && el('wizardMaxPrice')) el('wizardMaxPrice').value = '80';
  if (isPc && el('wizardMaxPrice')) el('wizardMaxPrice').value = '50';
  if (isRam && el('wizardMaxPrice')) el('wizardMaxPrice').value = '80';
  if (isPc && el('wizardSearch')) el('wizardSearch').value = 'PC';
  if (isRam && el('wizardSearch')) el('wizardSearch').value = 'DDR5 SODIMM';
  el('wizardSelectedCategory').textContent = (selected?.path || [])
    .map(item => item.name)
    .join(' › ') || selected?.name || '';
}

function goWizardDetails() {
  if (!wizardState.selected?.id) return;
  suggestWizardDefaults();
  setWizardStep(2);
  (el('wizardSearch') || el('wizardName'))?.focus();
}

async function openFilterWizard() {
  wizardState.selected = null;
  wizardState.searchQuery = '';
  wizardState.searchResults = [];
  if (el('wizardCategorySearch')) el('wizardCategorySearch').value = '';
  setWizardStep(1);
  el('wizardNotice').textContent = '';
  el('wizardDialog').showModal();
  await loadWizardCategories('');
  el('wizardCategorySearch')?.focus();
}

async function submitFilterWizard(event) {
  event.preventDefault();
  if (!wizardState.selected?.id) {
    el('wizardNotice').textContent = 'Pick a category first.';
    setWizardStep(1);
    return;
  }
  const minPrice = Number(el('wizardMinPrice').value) || 1;
  const maxPrice = Number(el('wizardMaxPrice').value) || 100;
  const condition = document.querySelector('input[name="wizardCondition"]:checked')?.value || 'any';
  const isGpu = String(wizardState.selected.id) === '27386';
  const isPc = String(wizardState.selected.id) === '179'
    || String(wizardState.selected.id) === '171957';
  const isRam = String(wizardState.selected.id) === '170083';
  const search = (el('wizardSearch')?.value || '').trim();
  if (!search) {
    el('wizardNotice').textContent = 'Keywords are required — enter what you’d search on ebay.de.';
    el('wizardSearch')?.focus();
    return;
  }
  const payload = {
    name: el('wizardName').value.trim() || `${search} under €${Math.max(minPrice, maxPrice)}`,
    search,
    minPrice: Math.min(minPrice, maxPrice),
    maxPrice: Math.max(minPrice, maxPrice),
    minFeedback: Number(el('wizardFeedback').value) || 90,
    condition,
    // GPU / PC / RAM searches: turn on junk exclude pills by default.
    enabledSmartFilters: isGpu
      ? [
        'parts-defekt',
        'ovp-waterblock',
        'gpu-adapter',
        'replacement-fans',
        'compat-dumps',
        'fake-replica',
        'laptop-mobile',
        'require-model',
        'require-complete',
        'wrong-ti',
        'wrong-gt',
        'nearby-models',
        'hard-junk',
        'storage-collision',
      ]
      : isPc
        ? [
          'parts-defekt',
          'empty-case',
          'pc-parts-only',
          'pc-accessories',
          'laptop-notebook',
          'barebone-incomplete',
          'fake-replica',
          'require-complete',
          'hard-junk',
        ]
        : isRam
          ? [
            'parts-defekt',
            'fake-replica',
            'desktop-dimm',
            'ram-adapter',
            'storage-collision',
            'require-sodimm',
            'require-ddr5',
            'wrong-ddr4',
            'wrong-ddr3',
            'hard-junk',
          ]
          : [],
    includeCapacities: isRam ? ['ram-8', 'ram-16', 'ram-32', 'ram-64'] : [],
    monitor: true,
    categoryId: wizardState.selected.id,
    categoryName: wizardState.selected.name,
    categoryPath: wizardState.selected.path,
  };
  el('wizardNotice').textContent = 'Creating…';
  try {
    const data = await api('/api/searches', { method: 'POST', body: JSON.stringify(payload) });
    applyStore(data);
    el('wizardDialog').close();
    await fetchListings({ quiet: false });
    el('ebayQuery')?.focus();
  } catch (error) {
    el('wizardNotice').textContent = error.message;
  }
}

function requestDeleteSearch(id) {
  if (!id || searches.length <= 1) return;
  pendingDeleteId = id;
  renderSidebar();
}

async function confirmDeleteSearch(id) {
  if (!id || searches.length <= 1) return;
  pendingDeleteId = '';
  const data = await api(`/api/searches/${encodeURIComponent(id)}`, { method: 'DELETE' });
  applyStore(data);
  await fetchListings({ quiet: false });
}

async function deleteSearch(id) {
  requestDeleteSearch(id);
}

async function deleteActiveSearch() {
  requestDeleteSearch(activeId);
}

async function restoreSearch(id) {
  const data = await api(`/api/searches/${encodeURIComponent(id)}/restore`, { method: 'POST', body: '{}' });
  applyStore(data);
  await fetchListings({ quiet: false });
  el('formNotice').textContent = 'Filter restored.';
  setTimeout(() => { el('formNotice').textContent = ''; }, 2500);
}

async function purgeSearch(id) {
  if (!confirm('Delete this filter forever?')) return;
  const data = await api(`/api/trash/${encodeURIComponent(id)}`, { method: 'DELETE' });
  applyStore(data);
}

async function addToWatchlist(item) {
  const data = await api('/api/watchlist', {
    method: 'POST',
    body: JSON.stringify(item),
  });
  watchlist = data.watchlist || [];
  watchlistIds = new Set(watchlist.map(entry => entry.id));
  render();
  renderWatchlist();
}

async function removeFromWatchlist(id) {
  const data = await api(`/api/watchlist/${encodeURIComponent(id)}`, { method: 'DELETE' });
  watchlist = data.watchlist || [];
  watchlistIds = new Set(watchlist.map(entry => entry.id));
  render();
  renderWatchlist();
}

function scheduleAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  if (!alertsOn || window.location.protocol === 'file:') return;
  const active = searches.find(item => item.id === activeId);
  if (active && active.monitor === false) return;
  refreshTimer = setInterval(() => {
    if (document.hidden) return;
    const current = searches.find(item => item.id === activeId);
    if (!current || current.monitor === false) return;
    fetchListings({ quiet: true, filters: filtersFromSearch(current) });
  }, monitorIntervalMinutes * 60 * 1000);
}

async function fetchListings({
  quiet = false,
  filters: overrideFilters = null,
  restoreForm = false,
} = {}) {
  const generation = ++fetchGeneration;
  let filters = overrideFilters || currentFilters();
  // One-shot / Scan: "All eBay.de" drops category so keywords search site-wide like ebay.de.
  if (!overrideFilters && !quiet && el('ebayScopeAll')?.checked) {
    filters = {
      ...filters,
      categoryId: '',
      categoryName: '',
      categoryPath: [],
      includeCapacities: [],
    };
  }
  const note = el('dataNote');
  if (window.location.protocol === 'file:') {
    note.textContent = 'Open the app at http://localhost:3000 — not as a local index.html file.';
    updateConnectionStatus();
    return;
  }
  // Quiet background scans yield to an in-flight request; forced scans (filter switch / Scan now) always run.
  if (quiet && fetching) return;
  fetching = true;
  if (!quiet) {
    const channelName = filters.marketplace === 'kleinanzeigen' ? 'Kleinanzeigen' : 'eBay.de';
    note.textContent = filters.search
      ? `Searching ${channelName} for “${filters.search}”…`
      : `Scanning ${channelName}…`;
    el('scanButton').textContent = 'Scanning…';
    el('scanButton').disabled = true;
    if (el('ebaySearchButton')) {
      el('ebaySearchButton').textContent = 'Searching…';
      el('ebaySearchButton').disabled = true;
    }
  }
  try {
    const params = new URLSearchParams({
      query: filters.search,
      minPrice: String(filters.minPrice || 1),
      maxPrice: String(filters.maxPrice),
      minFeedback: String(filters.minFeedback),
      condition: filters.condition,
      alerts: alertsOn ? '1' : '0',
      enabledSmartFilters: (filters.enabledSmartFilters || []).join(','),
      includeCapacities: (filters.includeCapacities || []).join(','),
      marketplace: filters.marketplace === 'kleinanzeigen' ? 'kleinanzeigen' : 'ebay',
      kaCategory: filters.kaCategory || 'all',
      locationId: filters.locationId || '',
      locationLabel: filters.locationLabel || '',
      radiusKm: String(filters.radiusKm || 0),
      shippingOnly: filters.shippingOnly ? '1' : '0',
    });
    if (filters.categoryId) params.set('categoryId', String(filters.categoryId));
    else params.set('categoryId', '');
    const data = await api(`/api/listings?${params}`);
    if (generation !== fetchGeneration) return;
    currentListings = data.items || [];
    currentSuggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
    suggestionMeta = data.suggestionMeta || null;
    lastRejected = data.rejected ?? 0;
    if (Array.isArray(data.offersSent)) offersSentIds = new Set(data.offersSent.map(String));
    if (data.store) {
      searches = data.store.searches || searches;
      trash = data.store.trash || trash;
      watchlist = data.store.watchlist || watchlist;
      watchlistIds = new Set(watchlist.map(item => item.id));
      if (Array.isArray(data.store.offersSent)) offersSentIds = new Set(data.store.offersSent.map(String));
      activeId = data.store.activeId || activeId;
      if (typeof data.store.alerts === 'boolean') alertsOn = data.store.alerts;
      if (Array.isArray(data.store.notifications)) notifications = data.store.notifications;
      renderSidebar();
      renderWatchlist();
      renderTrash();
    } else if (Array.isArray(data.watchlistIds)) {
      watchlistIds = new Set(data.watchlistIds);
    }
    if (Number.isFinite(data.monitorIntervalMinutes)) monitorIntervalMinutes = data.monitorIntervalMinutes;
    if (typeof data.telegramConfigured === 'boolean') telegramConfigured = data.telegramConfigured;
    // Only restore the form when a one-shot override intentionally left it (e.g. All eBay.de).
    if (restoreForm) {
      const active = searches.find(item => item.id === activeId);
      if (active) applySearchToForm(active);
    }
    render();
    el('lastScan').textContent = `Last scan: ${new Date(data.checkedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
    const telegramStatus = !alertsOn
      ? ' Alerts are off.'
      : data.telegramConfigured
        ? ` Auction reminders scheduled: ${data.remindersScheduled}.`
        : ' Telegram reminders are not configured yet.';
    const pool = Number.isFinite(data.totalAvailable) ? ` Pool: ${data.totalAvailable}.` : '';
    const suggestNote = currentSuggestions.length
      ? ` No lots under €${filters.maxPrice} — showing ${currentSuggestions.length} closer option${currentSuggestions.length === 1 ? '' : 's'} above budget.`
      : '';
    const channelName = filters.marketplace === 'kleinanzeigen' || data.marketplace === 'kleinanzeigen'
      ? 'Kleinanzeigen'
      : 'eBay.de';
    note.textContent = `Live ${channelName} lots. Scanned: ${data.scanned}; rejected by rules: ${data.rejected}.${pool}${suggestNote}${telegramStatus}`;
    const marketLabel = document.querySelector('.sidebar-footer strong');
    if (marketLabel) marketLabel.textContent = channelName;
    scheduleAutoRefresh();
    scheduleNotificationPoll();
  } catch (error) {
    if (generation !== fetchGeneration) return;
    if (!quiet) {
      currentListings = [];
      currentSuggestions = [];
      suggestionMeta = null;
      lastRejected = 0;
      render();
    }
    note.textContent = `Connection error: ${error.message}`;
    updateConnectionStatus();
  } finally {
    if (generation === fetchGeneration) {
      fetching = false;
      el('scanButton').textContent = 'Scan now';
      el('scanButton').disabled = false;
      if (el('ebaySearchButton')) {
        el('ebaySearchButton').textContent = 'Search';
        el('ebaySearchButton').disabled = false;
      }
    }
  }
}

async function runEbaySearch() {
  cancelAutoSave();
  syncAutoSearchName({ force: true });
  const notice = el('formNotice');
  if (notice) notice.textContent = 'Searching…';
  try {
    await saveActiveSearch();
    const filters = currentFilters();
    const scopeAll = Boolean(el('ebayScopeAll')?.checked);
    await fetchListings({
      quiet: false,
      filters: scopeAll
        ? {
          ...filters,
          categoryId: '',
          categoryName: '',
          categoryPath: [],
          includeCapacities: [],
        }
        : filters,
      restoreForm: scopeAll,
    });
    if (notice) {
      notice.textContent = scopeAll
        ? 'Searched all eBay.de.'
        : (filters.categoryName ? `Searched in ${filters.categoryName}.` : 'Search updated.');
    }
  } catch (error) {
    if (notice) notice.textContent = error.message;
  }
  setTimeout(() => {
    if (notice && /Search|eBay\.de/.test(notice.textContent)) notice.textContent = '';
  }, 3500);
}

const STORE_CACHE_KEY = 'dealwatch_store_cache_v1';

function cacheStore(store) {
  try {
    if (store && Array.isArray(store.searches) && store.searches.length) {
      localStorage.setItem(STORE_CACHE_KEY, JSON.stringify({
        savedAt: new Date().toISOString(),
        store,
      }));
    }
  } catch {
    /* ignore quota */
  }
}

function readCachedStore() {
  try {
    const raw = localStorage.getItem(STORE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const store = parsed?.store || parsed;
    if (!store || !Array.isArray(store.searches) || !store.searches.length) return null;
    return store;
  } catch {
    return null;
  }
}

function setConnectionStatus(text, ok = true) {
  const node = el('connectionStatus');
  if (!node) return;
  node.innerHTML = `<i></i> ${text}`;
  node.classList.toggle('is-error', !ok);
  node.classList.toggle('is-ok', !!ok);
}

async function loadStoreFromApi() {
  const store = await api('/api/store');
  if (!store || !Array.isArray(store.searches)) {
    throw new Error('Dealwatch API returned an empty store.');
  }
  cacheStore(store);
  return store;
}

function hydrateFromStore(store, sourceLabel) {
  applyStore(store);
  const n = store.searches?.length || 0;
  setConnectionStatus(
    n ? `Loaded ${n} saved searches (${sourceLabel})` : `Connected (${sourceLabel}) · no searches yet`,
    true,
  );
}

window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin) return;
  const data = event?.data;
  if (!data || data.type !== 'dealwatch-hydrate' || !data.store) return;
  try {
    hydrateFromStore(data.store, 'panel');
    cacheStore(data.store);
  } catch (err) {
    console.error('[dealwatch] hydrate failed', err);
  }
});

async function bootstrap() {
  setConnectionStatus('Loading saved searches…', true);
  let loaded = false;
  let lastError = '';

  try {
    const store = await loadStoreFromApi();
    hydrateFromStore(store, 'API');
    loaded = true;
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    console.error('[dealwatch] store API failed:', lastError);
  }

  if (!loaded) {
    const cached = readCachedStore();
    if (cached) {
      hydrateFromStore(cached, 'local cache');
      setConnectionStatus(
        `Using cached searches (${cached.searches.length}). API: ${lastError || 'unavailable'}`,
        false,
      );
      loaded = true;
    }
  }

  if (!loaded) {
    try {
      const seedRes = await fetch('/dealwatch/store.json', { cache: 'no-store' });
      if (seedRes.ok) {
        const seed = await seedRes.json();
        if (seed && Array.isArray(seed.searches) && seed.searches.length) {
          hydrateFromStore(seed, 'static seed');
          setConnectionStatus(
            `Using static seed (${seed.searches.length} searches). API: ${lastError || 'unavailable'}`,
            false,
          );
          loaded = true;
        }
      }
    } catch (seedErr) {
      console.warn('[dealwatch] static seed failed:', seedErr);
    }
  }

  if (!loaded) {
    setConnectionStatus(
      `Saved searches not loaded. ${lastError || 'Start with npm run dev (Dealwatch API).'}`,
      false,
    );
  }

  updatePageMeta();
  try {
    await fetchListings();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[dealwatch] initial scan failed:', msg);
    if (!loaded) {
      setConnectionStatus(`Dealwatch API unavailable: ${msg}`, false);
    } else {
      setConnectionStatus(`Loaded ${searches.length} saved searches · scan error: ${msg}`, false);
    }
  }
  await fetchKaPurchases({ quiet: true });
  await fetchKaSales({ quiet: true });
  await refreshNotifications({ quiet: true });
  scheduleNotificationPoll();
}

el('refreshKaPurchasesButton')?.addEventListener('click', () => {
  fetchKaPurchases({ quiet: false }).catch(() => {});
});
el('refreshKaSalesButton')?.addEventListener('click', () => {
  fetchKaSales({ quiet: false }).catch(() => {});
});

el('filters').addEventListener('submit', async event => {
  event.preventDefault();
  cancelAutoSave();
  el('formNotice').textContent = 'Saving…';
  try {
    await saveActiveSearch();
    await fetchListings();
    el('formNotice').textContent = 'Filter saved.';
  } catch (error) {
    el('formNotice').textContent = error.message;
  }
  setTimeout(() => { el('formNotice').textContent = ''; }, 3500);
});

el('filters').addEventListener('input', () => scheduleAutoSave());
el('filters').addEventListener('change', () => scheduleAutoSave());

document.querySelectorAll('.marketplace-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const next = btn.dataset.marketplace === 'kleinanzeigen' ? 'kleinanzeigen' : 'ebay';
    if (getSelectedMarketplace() === next) return;
    setMarketplace(next);
    el('formNotice').textContent = next === 'kleinanzeigen'
      ? 'Marketplace: Kleinanzeigen'
      : 'Marketplace: eBay.de';
    setTimeout(() => {
      if (el('formNotice').textContent.startsWith('Marketplace:')) el('formNotice').textContent = '';
    }, 2200);
  });
});

let kaLocationTimer = null;
async function resolveKaLocation(queryText, { pickFirst = false } = {}) {
  const q = String(queryText || '').trim();
  const list = el('kaLocationSuggestions');
  if (!list) return;
  if (q.length < 2) {
    list.replaceChildren();
    if (el('kaLocationId')) el('kaLocationId').value = '';
    return;
  }
  try {
    const data = await api(`/api/ka/locations?q=${encodeURIComponent(q)}`);
    const locations = Array.isArray(data.locations) ? data.locations : [];
    list.replaceChildren();
    locations.forEach(loc => {
      const opt = document.createElement('option');
      opt.value = loc.label;
      opt.dataset.id = loc.id;
      list.append(opt);
    });
    const exact = locations.find(loc => loc.label.toLowerCase() === q.toLowerCase());
    if (exact && el('kaLocationId')) {
      el('kaLocationId').value = exact.id;
    } else if (pickFirst && locations[0] && el('kaLocationId')) {
      el('kaLocationId').value = locations[0].id;
      if (el('kaLocationLabel')) el('kaLocationLabel').value = locations[0].label;
    } else if (!exact && el('kaLocationId') && !locations.some(loc => loc.id === el('kaLocationId').value)) {
      // Keep existing id if label still matches a suggestion id via dataset later.
    }
  } catch {
    /* ignore lookup errors while typing */
  }
}

el('kaLocationLabel')?.addEventListener('input', () => {
  clearTimeout(kaLocationTimer);
  kaLocationTimer = setTimeout(() => {
    resolveKaLocation(el('kaLocationLabel').value);
    scheduleAutoSave();
  }, 280);
});
el('kaLocationLabel')?.addEventListener('change', async () => {
  const label = el('kaLocationLabel')?.value?.trim() || '';
  const match = [...(el('kaLocationSuggestions')?.options || [])].find(opt => opt.value === label);
  if (match?.dataset.id && el('kaLocationId')) el('kaLocationId').value = match.dataset.id;
  else await resolveKaLocation(label, { pickFirst: true });
  scheduleAutoSave();
});
el('kaRadius')?.addEventListener('change', () => scheduleAutoSave());
el('kaCategory')?.addEventListener('change', () => scheduleAutoSave());
el('kaShippingOnly')?.addEventListener('change', () => scheduleAutoSave());

el('sort').addEventListener('change', render);
document.querySelectorAll('.view-toggle .view-button').forEach(button => {
  button.addEventListener('click', () => {
    const mode = button.dataset.view || 'tiles';
    setViewMode(mode);
  });
});
el('scanButton').addEventListener('click', () => fetchListings());
el('ebaySearchButton')?.addEventListener('click', () => {
  runEbaySearch().catch(() => {});
});
el('ebayQuery')?.addEventListener('keydown', event => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  runEbaySearch().catch(() => {});
});
el('ebayQuery')?.addEventListener('input', () => {
  syncAutoSearchName({ force: true });
  updateSoldHistoryLink();
});
el('suggestRaiseBudget')?.addEventListener('click', async () => {
  const max = Number(el('suggestRaiseBudget').dataset.max);
  if (!Number.isFinite(max) || max < 1) return;
  el('minPriceInput').value = '1';
  el('maxPriceInput').value = String(max);
  syncPriceControls('input');
  try {
    await saveActiveSearch();
    updatePageMeta();
    await fetchListings({ quiet: false });
  } catch (error) {
    el('dataNote').textContent = error.message;
  }
});
el('loadSoldButton')?.addEventListener('click', () => {
  fetchSoldListings().catch(error => {
    const msg = `Sold comps error: ${error.message}`;
    if (el('soldNote')) el('soldNote').textContent = msg;
    if (el('dataNote')) el('dataNote').textContent = msg;
  });
});
el('soldHistoryButton')?.addEventListener('click', event => {
  updateSoldHistoryLink();
  if (!el('soldHistoryButton').href || el('soldHistoryButton').getAttribute('href') === '#') {
    event.preventDefault();
  }
});
['maxPrice', 'condition'].forEach(id => {
  el(id)?.addEventListener('input', updateSoldHistoryLink);
  el(id)?.addEventListener('change', updateSoldHistoryLink);
});
el('minPrice')?.addEventListener('input', () => syncPriceControls('min-slider'));
el('maxPrice')?.addEventListener('input', () => syncPriceControls('max-slider'));
el('minPriceInput')?.addEventListener('change', () => syncPriceControls('input'));
el('maxPriceInput')?.addEventListener('change', () => syncPriceControls('input'));
el('minPriceInput')?.addEventListener('input', updateSoldHistoryLink);
el('maxPriceInput')?.addEventListener('input', updateSoldHistoryLink);
document.querySelectorAll('.price-preset').forEach(button => {
  button.addEventListener('click', async () => {
    const max = Number(button.dataset.max) || 80;
    el('minPriceInput').value = '1';
    el('maxPriceInput').value = String(max);
    syncPriceControls('input');
    try {
      await saveActiveSearch();
      updatePageMeta();
      await fetchListings({ quiet: false });
    } catch (error) {
      el('dataNote').textContent = error.message;
    }
  });
});
el('minFeedback')?.addEventListener('input', syncFeedbackLabel);
document.querySelectorAll('input[name="condition"]').forEach(input => {
  input.addEventListener('change', syncConditionFromChips);
});
syncPriceControls('input');
syncFeedbackLabel();
updateSoldHistoryLink();
renderSold();
refreshSmartFiltersPreview();
el('offerForm').addEventListener('submit', confirmOfferDialog);
el('cancelOfferButton').addEventListener('click', () => el('offerDialog').close());
el('offerDialog').addEventListener('close', () => { pendingOfferItem = null; });
document.querySelectorAll('.offer-quick-button').forEach(button => {
  button.addEventListener('click', () => setOfferAmountFromDiscount(Number(button.dataset.discount) || 0));
});
el('messageForm')?.addEventListener('submit', confirmMessageDialog);
el('cancelMessageButton')?.addEventListener('click', () => el('messageDialog').close());
el('messageDialog')?.addEventListener('close', () => {
  pendingMessageItem = null;
  messageOfferMode = false;
});
document.querySelectorAll('.message-template-button').forEach(button => {
  button.addEventListener('click', () => {
    if (!pendingMessageItem) return;
    const kind = button.dataset.template || 'ask';
    if (button.dataset.requiresPickup === '1' && !isLocalPickupEligible(pendingMessageItem)) return;
    if (button.dataset.requiresPickupOnly === '1' && !isPickupOnlyListing(pendingMessageItem)) return;
    if (kind === 'price') {
      applyMessagePriceOffer({ pickVariant: true });
      el('messageOfferSlider')?.focus();
      return;
    }
    messageOfferMode = false;
    const discount = Number(button.dataset.discount) || 0;
    el('messageBody').value = messageTemplateFor(pendingMessageItem, kind, discount);
    document.querySelectorAll('.message-template-button').forEach(btn => {
      btn.classList.toggle('is-active', btn === button);
    });
    el('messageBody').focus();
  });
});
el('messageOfferSlider')?.addEventListener('input', () => {
  if (!pendingMessageItem) return;
  if (!messageOfferMode) {
    applyMessagePriceOffer({ pickVariant: true });
    return;
  }
  applyMessagePriceOffer({ pickVariant: false });
});
applyViewMode();
updateRuleSummary();
el('addSearchButton').addEventListener('click', () => openFilterWizard().catch(error => {
  el('dataNote').textContent = error.message;
}));
el('addSearchFromForm').addEventListener('click', () => createSearch(true).catch(error => {
  el('formNotice').textContent = error.message;
}));
el('wizardCloseButton')?.addEventListener('click', () => el('wizardDialog').close());
el('wizardBackCategory')?.addEventListener('click', () => setWizardStep(1));
el('wizardNextDetails')?.addEventListener('click', goWizardDetails);
el('wizardUseCategory')?.addEventListener('click', () => {
  if (wizardState.parentId && wizardState.path.length) {
    const parent = wizardState.path.at(-1);
    selectWizardCategory({ id: parent.id, name: parent.name, leaf: false }, wizardState.path);
  }
  goWizardDetails();
});
el('wizardRefreshCats')?.addEventListener('click', async () => {
  el('wizardCategoryNote').textContent = 'Refreshing categories from eBay…';
  try {
    await api('/api/categories/refresh', { method: 'POST', body: '{}' });
    await loadWizardCategories(wizardState.parentId);
  } catch (error) {
    el('wizardCategoryNote').textContent = error.message;
  }
});
el('wizardForm')?.addEventListener('submit', submitFilterWizard);
el('wizardSearch')?.addEventListener('input', () => {
  const q = el('wizardSearch').value.trim();
  if (!q || el('wizardName')?.dataset.manual === '1') return;
  const max = Number(el('wizardMaxPrice')?.value) || 100;
  el('wizardName').value = `${q} under €${max}`;
});
el('wizardName')?.addEventListener('input', () => {
  if (el('wizardName')) el('wizardName').dataset.manual = '1';
});
el('wizardCategorySearch')?.addEventListener('input', onWizardCategorySearchInput);
el('wizardCategorySearch')?.addEventListener('keydown', event => {
  if (event.key === 'Escape' && el('wizardCategorySearch').value) {
    event.preventDefault();
    el('wizardCategorySearch').value = '';
    onWizardCategorySearchInput();
  }
});
el('wizardCategorySearch')?.addEventListener('keydown', event => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  const first = wizardState.searchResults[0] || wizardState.categories[0];
  if (!first) return;
  const path = wizardState.searchQuery ? (first.path || []) : wizardState.path;
  selectWizardCategory(first, path);
  if (event.shiftKey || first.leaf || wizardState.searchQuery) goWizardDetails();
});
el('deleteSearchButton').addEventListener('click', () => deleteActiveSearch().catch(error => {
  el('formNotice').textContent = error.message;
}));

el('alertButton').addEventListener('click', async () => {
  alertsOn = !alertsOn;
  el('alertButton').textContent = `Alerts: ${alertsOn ? 'on' : 'off'}`;
  updateConnectionStatus();
  scheduleAutoRefresh();
  scheduleNotificationPoll();
  try {
    const data = await api('/api/alerts', { method: 'PUT', body: JSON.stringify({ alerts: alertsOn }) });
    applyStore(data);
    el('dataNote').textContent = alertsOn
      ? 'Alerts on. Background refresh and new-match badges are active.'
      : 'Alerts off. Background refresh and new-match badges are stopped.';
  } catch (error) {
    el('dataNote').textContent = `Could not save alert setting: ${error.message}`;
  }
});

el('sidebarNewMatches')?.addEventListener('click', () => {
  openFirstUnreadFilter().catch(error => {
    el('dataNote').textContent = error.message;
  });
});

document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || !pendingDeleteId) return;
  pendingDeleteId = '';
  renderSidebar();
});

document.querySelectorAll('[data-nav]').forEach(link => {
  link.addEventListener('click', () => {
    document.querySelectorAll('[data-nav]').forEach(item => item.classList.remove('active'));
    link.classList.add('active');
  });
});

el('maxPrice')?.addEventListener('input', () => {
  syncAutoSearchName({ force: true });
});
el('maxPriceInput')?.addEventListener('input', () => {
  syncAutoSearchName({ force: true });
});
el('searchName')?.addEventListener('input', () => {
  el('searchName').dataset.manual = '1';
  scheduleAutoSave();
});

bootstrap();
