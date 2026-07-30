const MAX_CARDS = 8;
const CATEGORY_STORAGE = 'dealwatchCompareCategory';
const DISPLAY_STORAGE = 'dealwatchCompareDisplay';
const DISPLAY_MODES = new Set(['comfort', 'wide', 'full']);

const CATEGORIES = {
  gpu: {
    label: 'GPU',
    listPath: '/api/gpus',
    comparePath: '/api/gpus/compare',
    storageKey: 'dealwatchGpuCompareIds',
    itemsKey: 'gpus',
    defaultBaseline: 'gtx-980',
    searchLabel: 'Add a GPU',
    searchPlaceholder: 'Search · e.g. 3070, 1080 Ti, 4090',
    emptyTitle: 'Add at least two cards',
    emptyLead: 'Try RTX 5070 vs RTX 4070 — or load a generational ladder.',
    presetIds: ['rtx-4070', 'rtx-5070'],
    ladderIds: ['gtx-980', 'gtx-1080', 'rtx-2080', 'rtx-3070', 'rtx-4070', 'rtx-5070'],
    scoreOptions: false,
    defaultScore: 'relativeRaster',
    metaScore: 'baseline index GTX 980 = 100',
    pickerMeta: (item) => `${item.series} · ${item.memoryGb} GB · index ${item.relativeRaster}`,
    chipMeta: (item) => `${item.relativeRaster}`,
    specsNote: 'Green / red % vs the weaker side of each metric (or vs first column in the table). Prices in €.',
    matrixNote: 'Raster performance % difference matrix.',
    relatedKey: 'series',
  },
  cpu: {
    label: 'CPU',
    listPath: '/api/cpus',
    comparePath: '/api/cpus/compare',
    storageKey: 'dealwatchCpuCompareIds',
    itemsKey: 'cpus',
    defaultBaseline: 'ryzen-5-1600',
    searchLabel: 'Add a CPU',
    searchPlaceholder: 'Search · e.g. 5600X, i7-12700K, 7800X3D',
    emptyTitle: 'Add at least two CPUs',
    emptyLead: 'Try a ladder like Ryzen 5 1600 → 5600X → 7600X, or Intel i5 gens.',
    presetIds: ['ryzen-5-5600x', 'ryzen-5-7600x'],
    ladderIds: ['ryzen-5-1600', 'ryzen-5-3600', 'ryzen-5-5600x', 'core-i5-12400f', 'ryzen-5-7600x', 'core-i5-14600k'],
    scoreOptions: true,
    defaultScore: 'relativeMulti',
    metaScore: 'baseline index Ryzen 5 1600 = 100',
    pickerMeta: (item) => `${item.series} · ${item.socket} · ${item.cores}/${item.threads} · ST ${item.relativeSingle} · MT ${item.relativeMulti}`,
    chipMeta: (item) => `${item.cores}/${item.threads}`,
    specsNote: 'Green / red % vs the weaker side of each metric. Prices in €.',
    matrixNote: 'Uses the selected score (multi-thread or single-thread) for pairwise % differences.',
    relatedKey: 'series',
  },
  ssd: {
    label: 'SSD',
    listPath: '/api/ssds',
    comparePath: '/api/ssds/compare',
    storageKey: 'dealwatchSsdCompareIds',
    itemsKey: 'ssds',
    defaultBaseline: 'samsung-850-pro-256gb',
    searchLabel: 'Add an SSD',
    searchPlaceholder: 'Search · e.g. 990 Pro, SN850X, MX500',
    emptyTitle: 'Add at least two SSDs',
    emptyLead: 'Try 990 Pro vs SN850X — or an NVMe ladder vs SATA EVO.',
    presetIds: ['samsung-990-pro-m-2-2tb', 'wd-black-sn850x-m-2-2tb'],
    ladderIds: [
      'samsung-850-pro-256gb',
      'samsung-870-evo-1tb',
      'samsung-970-evo-plus-nvme-pcie-m-2-1tb',
      'samsung-990-pro-m-2-2tb',
      'wd-black-sn850x-m-2-2tb',
      'crucial-t705-m-2-2tb',
    ],
    scoreOptions: false,
    defaultScore: 'relativeEffective',
    metaScore: 'UserBenchmark effective speed · 850 Pro ≈ 100',
    pickerMeta: (item) => `${item.interface || item.series} · ${formatCapacity(item.capacityGb)} · score ${item.relativeEffective}`,
    chipMeta: (item) => `${item.relativeEffective}`,
    specsNote: 'Effective speed from UserBenchmark (Samsung 850 Pro ≈ 100). Green / red % vs the weaker side.',
    matrixNote: 'Effective speed % difference matrix.',
    relatedKey: 'family',
  },
  hdd: {
    label: 'HDD',
    listPath: '/api/hdds',
    comparePath: '/api/hdds/compare',
    storageKey: 'dealwatchHddCompareIds',
    itemsKey: 'hdds',
    defaultBaseline: 'seagate-barracuda-1tb-2016',
    searchLabel: 'Add an HDD',
    searchPlaceholder: 'Search · e.g. Barracuda, IronWolf, WD Red',
    emptyTitle: 'Add at least two HDDs',
    emptyLead: 'Try Barracuda vs IronWolf — or a WD Blue / Black / Red ladder.',
    presetIds: ['seagate-barracuda-1tb-2016', 'seagate-ironwolf-4tb-2016'],
    ladderIds: [
      'wd-blue-1tb-2012',
      'seagate-barracuda-1tb-2016',
      'seagate-barracuda-2tb-2016',
      'wd-black-2tb-2013',
      'seagate-ironwolf-4tb-2016',
      'wd-gold-12tb-2017',
    ],
    scoreOptions: false,
    defaultScore: 'relativeEffective',
    metaScore: 'UserBenchmark HDD effective speed',
    pickerMeta: (item) => `${item.brand} · ${formatCapacity(item.capacityGb)} · score ${item.relativeEffective}`,
    chipMeta: (item) => `${item.relativeEffective}`,
    specsNote: 'Effective speed from UserBenchmark HDD chart. Green / red % vs the weaker side.',
    matrixNote: 'Effective speed % difference matrix.',
    relatedKey: 'family',
  },
};

const KEY_METRIC_KEYS = new Set(['relativeRaster', 'relativeMulti', 'relativeSingle', 'relativeEffective']);

const el = (id) => document.getElementById(id);

let category = loadCategory();
let displayMode = loadDisplayMode();
let allItems = [];
let seriesList = [];
let selectedIds = [];
let baselineId = '';
let scoreKey = CATEGORIES[category].defaultScore;
let activeSeries = '';
let catalogCounts = { gpu: null, cpu: null, ssd: null, hdd: null };
let pickerOpen = false;
let lastCompareData = null;
let deepPickIds = [];
let deepDiveOpen = false;
let deepDiveToken = 0;

function formatCapacity(gb) {
  const n = Number(gb);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n >= 1000) {
    const tb = n / 1000;
    return `${Number.isInteger(tb) ? tb : Math.round(tb * 10) / 10} TB`;
  }
  return `${Math.round(n)} GB`;
}

function loadCategory() {
  const raw = localStorage.getItem(CATEGORY_STORAGE) || 'gpu';
  return CATEGORIES[raw] ? raw : 'gpu';
}

function loadDisplayMode() {
  const raw = localStorage.getItem(DISPLAY_STORAGE) || 'wide';
  return DISPLAY_MODES.has(raw) ? raw : 'wide';
}

function applyDisplayMode(mode = displayMode) {
  displayMode = DISPLAY_MODES.has(mode) ? mode : 'comfort';
  localStorage.setItem(DISPLAY_STORAGE, displayMode);
  document.body.dataset.display = displayMode;
  document.querySelectorAll('.display-mode-btn').forEach(btn => {
    const on = btn.dataset.display === displayMode;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
}

function loadSelectedIds(cat) {
  try {
    const raw = JSON.parse(localStorage.getItem(CATEGORIES[cat].storageKey) || '[]');
    return Array.isArray(raw) ? raw.map(String).filter(Boolean).slice(0, MAX_CARDS) : [];
  } catch {
    return [];
  }
}

function persistSelected() {
  localStorage.setItem(CATEGORIES[category].storageKey, JSON.stringify(selectedIds));
  syncShareUrl();
}

function persistCategory() {
  localStorage.setItem(CATEGORY_STORAGE, category);
}

function syncShareUrl() {
  const url = new URL(window.location.href);
  url.searchParams.set('cat', category);
  if (selectedIds.length) url.searchParams.set('ids', selectedIds.join(','));
  else url.searchParams.delete('ids');
  history.replaceState(null, '', url);
}

function readShareUrl() {
  const params = new URLSearchParams(window.location.search);
  const cat = params.get('cat');
  if (CATEGORIES[cat]) category = cat;
  const ids = String(params.get('ids') || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, MAX_CARDS);
  return ids;
}

function brandTheme(card) {
  const brand = String(card.brand || '').toLowerCase();
  const name = String(card.name || '').toLowerCase();
  if (category === 'ssd' || category === 'hdd') {
    if (brand.includes('samsung')) return { key: 'samsung', accent: '#1428a0', glow: 'rgb(20 40 160 / .4)', ink: '#fff' };
    if (brand === 'wd' || brand.includes('western')) return { key: 'wd', accent: '#1a1a1a', glow: 'rgb(30 30 30 / .35)', ink: '#fff' };
    if (brand.includes('crucial') || brand.includes('micron')) return { key: 'crucial', accent: '#0b6e4f', glow: 'rgb(11 110 79 / .4)', ink: '#fff' };
    if (brand.includes('seagate')) return { key: 'seagate', accent: '#6bba1d', glow: 'rgb(107 186 29 / .4)', ink: '#10200a' };
    if (brand.includes('kingston') || brand.includes('hyperx')) return { key: 'kingston', accent: '#c8102e', glow: 'rgb(200 16 46 / .4)', ink: '#fff' };
    if (brand.includes('corsair')) return { key: 'corsair', accent: '#ffd200', glow: 'rgb(255 210 0 / .35)', ink: '#1a1a1a' };
    if (brand.includes('intel')) return { key: 'intel', accent: '#0071c5', glow: 'rgb(0 113 197 / .4)', ink: '#fff' };
    if (brand.includes('toshiba') || brand.includes('kioxia')) return { key: 'toshiba', accent: '#e60012', glow: 'rgb(230 0 18 / .35)', ink: '#fff' };
    if (brand.includes('sandisk')) return { key: 'sandisk', accent: '#8c1d40', glow: 'rgb(140 29 64 / .4)', ink: '#fff' };
    return { key: 'storage', accent: '#0f7a66', glow: 'rgb(15 122 102 / .4)', ink: '#fff' };
  }
  if (brand.includes('amd') || brand.includes('radeon') || name.includes('ryzen') || name.includes('radeon')) {
    return { key: 'amd', accent: '#d9402a', glow: 'rgb(217 64 42 / .45)', ink: '#fff' };
  }
  if (brand.includes('intel') || name.startsWith('core ')) {
    return { key: 'intel', accent: '#0071c5', glow: 'rgb(0 113 197 / .4)', ink: '#fff' };
  }
  return { key: 'nvidia', accent: '#76b900', glow: 'rgb(118 185 0 / .4)', ink: '#10200a' };
}

function valuePerEuro(card, data) {
  const score = scoreForCard(card, data);
  const price = Number(card.marketPriceEur);
  if (!Number.isFinite(score) || !Number.isFinite(price) || price <= 0) return null;
  return Math.round((score / price) * 100) / 100;
}

function perfPerWatt(card, data) {
  const score = scoreForCard(card, data);
  const tdp = Number(card.tdpW || card.tdp);
  if (!Number.isFinite(score) || !Number.isFinite(tdp) || tdp <= 0) return null;
  return Math.round((score / tdp) * 100) / 100;
}

function countUp(elStrong, target, duration = 700) {
  const end = Number(target);
  if (!elStrong || !Number.isFinite(end)) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    elStrong.textContent = String(Math.round(end * 10) / 10);
    return;
  }
  const start = performance.now();
  const from = 0;
  const tick = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - (1 - t) ** 3;
    const value = from + (end - from) * eased;
    elStrong.textContent = String(Math.round(value * 10) / 10);
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function productArtSvg(card) {
  const theme = brandTheme(card);
  if (category === 'ssd' || category === 'hdd') {
    const nvme = category === 'ssd' && String(card.interface || card.series || '').toLowerCase() === 'nvme';
    if (nvme) {
      return `
        <svg viewBox="0 0 320 120" aria-hidden="true">
          <defs>
            <linearGradient id="ssdGrad-${card.id}" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#1c2a33"/>
              <stop offset="100%" stop-color="#0d1419"/>
            </linearGradient>
          </defs>
          <rect x="36" y="42" width="248" height="36" rx="6" fill="url(#ssdGrad-${card.id})" stroke="${theme.accent}" stroke-opacity=".7"/>
          <rect x="48" y="50" width="28" height="20" rx="3" fill="${theme.accent}" opacity=".85"/>
          ${Array.from({ length: 8 }, (_, i) => `<rect x="${92 + i * 22}" y="52" width="14" height="16" rx="2" fill="${theme.accent}" opacity="${0.25 + (i % 3) * 0.15}"/>`).join('')}
          <text x="160" y="98" text-anchor="middle" fill="${theme.accent}" font-size="11" font-weight="700" font-family="IBM Plex Sans,sans-serif">${escapeXml((card.interface || 'NVMe') + ' · ' + formatCapacity(card.capacityGb))}</text>
        </svg>
      `;
    }
    return `
      <svg viewBox="0 0 320 120" aria-hidden="true">
        <defs>
          <linearGradient id="diskGrad-${card.id}" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="${theme.accent}" stop-opacity=".9"/>
            <stop offset="100%" stop-color="#1a2730"/>
          </linearGradient>
        </defs>
        <rect x="92" y="18" width="136" height="84" rx="10" fill="url(#diskGrad-${card.id})"/>
        <rect x="108" y="34" width="104" height="52" rx="6" fill="#0b1217" opacity=".45"/>
        <circle cx="160" cy="60" r="18" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="3"/>
        <circle cx="160" cy="60" r="5" fill="#fff" opacity=".7"/>
        <text x="160" y="112" text-anchor="middle" fill="${theme.accent}" font-size="11" font-weight="700" font-family="IBM Plex Sans,sans-serif">${escapeXml(formatCapacity(card.capacityGb))}</text>
      </svg>
    `;
  }
  if (category === 'cpu') {
    return `
      <svg viewBox="0 0 320 120" aria-hidden="true">
        <defs>
          <linearGradient id="cpuGrad-${card.id}" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="${theme.accent}" stop-opacity=".95"/>
            <stop offset="100%" stop-color="#1a2730"/>
          </linearGradient>
        </defs>
        <rect x="96" y="18" width="128" height="84" rx="10" fill="url(#cpuGrad-${card.id})"/>
        <rect x="112" y="32" width="96" height="56" rx="6" fill="#0b1217" opacity=".55"/>
        <rect x="128" y="44" width="64" height="32" rx="4" fill="${theme.accent}" opacity=".85"/>
        ${Array.from({ length: 8 }, (_, i) => `<rect x="${104 + i * 14}" y="8" width="4" height="10" rx="1" fill="#9aa8b2"/>`).join('')}
        ${Array.from({ length: 8 }, (_, i) => `<rect x="${104 + i * 14}" y="102" width="4" height="10" rx="1" fill="#9aa8b2"/>`).join('')}
        <text x="160" y="64" text-anchor="middle" fill="#fff" font-size="11" font-weight="700" font-family="IBM Plex Sans,sans-serif">${escapeXml(shortName(card.name).slice(0, 12))}</text>
      </svg>
    `;
  }
  return `
    <svg viewBox="0 0 320 120" aria-hidden="true">
      <defs>
        <linearGradient id="gpuGrad-${card.id}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#1c2a33"/>
          <stop offset="100%" stop-color="#0d1419"/>
        </linearGradient>
      </defs>
      <rect x="18" y="28" width="284" height="68" rx="12" fill="url(#gpuGrad-${card.id})" stroke="${theme.accent}" stroke-opacity=".55"/>
      <rect x="30" y="40" width="54" height="44" rx="6" fill="${theme.accent}" opacity=".22"/>
      <g transform="translate(57 62)">
        <g class="fan">
          <circle r="16" fill="none" stroke="${theme.accent}" stroke-width="3"/>
          <circle r="3" fill="${theme.accent}"/>
          <path d="M0-16 L3-3 L-3-3 Z M0 16 L3 3 L-3 3 Z M-16 0 L-3 3 L-3-3 Z M16 0 L3 3 L3-3 Z" fill="${theme.accent}" opacity=".55"/>
        </g>
      </g>
      <g transform="translate(120 62)">
        <g class="fan fan-b">
          <circle r="16" fill="none" stroke="${theme.accent}" stroke-width="3" opacity=".85"/>
          <circle r="3" fill="${theme.accent}"/>
          <path d="M0-16 L3-3 L-3-3 Z M0 16 L3 3 L-3 3 Z M-16 0 L-3 3 L-3-3 Z M16 0 L3 3 L3-3 Z" fill="${theme.accent}" opacity=".45"/>
        </g>
      </g>
      <rect x="156" y="42" width="128" height="36" rx="6" fill="#0b1217" opacity=".65"/>
      <text x="220" y="64" text-anchor="middle" fill="#fff" font-size="12" font-weight="700" font-family="IBM Plex Sans,sans-serif">${escapeXml(shortName(card.name).slice(0, 14))}</text>
      <rect x="270" y="84" width="22" height="6" rx="2" fill="${theme.accent}"/>
      <rect x="246" y="84" width="18" height="6" rx="2" fill="#5c6b75"/>
    </svg>
  `;
}

function escapeXml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function api(path) {
  const url = typeof path === 'string' && path.startsWith('/api/') && !path.startsWith('/api/dealwatch')
    ? `/api/dealwatch${path.slice(4)}`
    : path;
  const response = await fetch(url);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}

function formatValue(value, kind, unit = '') {
  if (value == null || value === '') return '—';
  if (kind === 'bool') return value ? 'Yes' : 'No';
  if (kind === 'number') {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    if (unit === 'EUR') return `€${Math.round(n)}`;
    const formatted = Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
    return unit ? `${formatted} ${unit}` : formatted;
  }
  return String(value);
}

function shortName(name) {
  return String(name || '')
    .replace(/^GeForce /, '')
    .replace(/^Ryzen /, 'R')
    .replace(/^Core Ultra /, 'U')
    .replace(/^Core /, '');
}

function formatPct(delta) {
  if (!delta || !Number.isFinite(delta.pct)) return '';
  if (delta.equal || delta.pct === 0) return 'same';
  const sign = delta.pct > 0 ? '+' : '';
  return `${sign}${delta.pct}%`;
}

function cfg() {
  return CATEGORIES[category];
}

function selectedItems() {
  const byId = new Map(allItems.map(item => [item.id, item]));
  return selectedIds.map(id => byId.get(id)).filter(Boolean);
}

function scoreForCard(card, data) {
  if (data?.scoreKey && card[data.scoreKey] != null) return Number(card[data.scoreKey]);
  if (card.relativeEffective != null) return Number(card.relativeEffective);
  if (card.relativeRaster != null) return Number(card.relativeRaster);
  if (card.relativeMulti != null) return Number(card.relativeMulti);
  return 0;
}

function setPickerOpen(open) {
  pickerOpen = open;
  const drawer = el('pickerDrawer');
  const backdrop = el('pickerBackdrop');
  const toggle = el('togglePicker');
  document.body.classList.toggle('picker-open', open);
  drawer.classList.toggle('is-open', open);
  drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
  drawer.inert = !open;
  backdrop.hidden = !open;
  toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) requestAnimationFrame(() => el('partSearch').focus());
}

function addItem(id) {
  if (!id || selectedIds.includes(id)) return;
  if (selectedIds.length >= MAX_CARDS) {
    el('compareMeta').textContent = `You can compare up to ${MAX_CARDS} parts.`;
    return;
  }
  selectedIds.push(id);
  if (!baselineId) baselineId = id;
  persistSelected();
  renderAll();
}

function removeItem(id) {
  selectedIds = selectedIds.filter(item => item !== id);
  deepPickIds = deepPickIds.filter(item => item !== id);
  if (baselineId === id) baselineId = selectedIds[0] || '';
  persistSelected();
  renderAll();
}

function replaceSlot(index, nextId) {
  if (!nextId || selectedIds[index] === nextId) return;
  if (selectedIds.includes(nextId) && selectedIds[index] !== nextId) {
    const other = selectedIds.indexOf(nextId);
    selectedIds[other] = selectedIds[index];
  }
  const prev = selectedIds[index];
  selectedIds[index] = nextId;
  deepPickIds = deepPickIds.map(id => (id === prev ? nextId : id));
  deepPickIds = [...new Set(deepPickIds.filter(id => selectedIds.includes(id)))];
  if (baselineId === prev) baselineId = nextId;
  persistSelected();
  renderAll();
}

function updateCategoryChrome() {
  const c = cfg();
  el('searchLabel').textContent = c.searchLabel;
  el('partSearch').placeholder = c.searchPlaceholder;
  el('emptyTitle').textContent = c.emptyTitle;
  el('emptyLead').textContent = c.emptyLead;
  el('specsNote').textContent = c.specsNote;
  el('matrixNote').textContent = c.matrixNote;
  el('pickerTitle').textContent = `${c.label} catalog`;
  el('scoreMetricWrap').hidden = !c.scoreOptions;
  el('scoreMetricWrap').classList.toggle('is-hidden', !c.scoreOptions);
  document.querySelectorAll('.part-switch-btn').forEach(btn => {
    const on = btn.dataset.category === category;
    btn.classList.toggle('is-active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  updateCatalogCounts();
}

function updateCatalogCounts() {
  if (catalogCounts.gpu != null && el('gpuCount')) el('gpuCount').textContent = `${catalogCounts.gpu}`;
  if (catalogCounts.cpu != null && el('cpuCount')) el('cpuCount').textContent = `${catalogCounts.cpu}`;
  if (catalogCounts.ssd != null && el('ssdCount')) el('ssdCount').textContent = `${catalogCounts.ssd}`;
  if (catalogCounts.hdd != null && el('hddCount')) el('hddCount').textContent = `${catalogCounts.hdd}`;
}

function relatedFor(item) {
  const key = cfg().relatedKey;
  const series = item[key];
  if (!series) return [];
  return allItems
    .filter(other => other[key] === series)
    .sort((a, b) => scoreForCard(b, lastCompareData) - scoreForCard(a, lastCompareData))
    .slice(0, 8);
}

function renderSeriesFilters() {
  const box = el('seriesFilters');
  box.replaceChildren();
  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = `series-chip${activeSeries ? '' : ' is-on'}`;
  allBtn.textContent = 'All';
  allBtn.addEventListener('click', () => {
    activeSeries = '';
    renderSeriesFilters();
    renderPicker();
  });
  box.append(allBtn);
  seriesList.forEach(series => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `series-chip${activeSeries === series ? ' is-on' : ''}`;
    btn.textContent = series;
    btn.addEventListener('click', () => {
      activeSeries = series;
      renderSeriesFilters();
      renderPicker();
    });
    box.append(btn);
  });
}

function renderPicker() {
  const q = (el('partSearch').value || '').trim().toLowerCase();
  const list = el('partPickerList');
  list.replaceChildren();
  const matches = allItems.filter(item => {
    if (activeSeries && item.series !== activeSeries) return false;
    if (!q) return true;
    return `${item.name} ${item.id} ${item.architecture || ''} ${item.series || ''} ${item.socket || ''} ${item.brand || ''} ${item.family || ''} ${item.interface || ''} ${item.partNumber || ''}`
      .toLowerCase()
      .includes(q);
  }).slice(0, 60);

  if (!matches.length) {
    const empty = document.createElement('p');
    empty.className = 'demo-note';
    empty.textContent = 'No parts match that search.';
    list.append(empty);
    return;
  }

  matches.forEach(item => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `gpu-pick-row${selectedIds.includes(item.id) ? ' is-selected' : ''}`;
    row.disabled = selectedIds.includes(item.id);
    row.innerHTML = `
      <span class="gpu-pick-name">${item.name}${item.approx ? ' <em>~approx</em>' : ''}</span>
      <span class="gpu-pick-meta">${cfg().pickerMeta(item)}</span>
    `;
    row.addEventListener('click', () => {
      addItem(item.id);
      if (selectedIds.length >= 2) setPickerOpen(false);
    });
    list.append(row);
  });
}

function matchParts(query, limit = 12) {
  const q = String(query || '').trim().toLowerCase();
  const scored = allItems.map(item => {
    const hay = `${item.name} ${item.id} ${item.series || ''} ${item.architecture || ''} ${item.brand || ''} ${item.socket || ''} ${item.family || ''} ${item.interface || ''} ${item.partNumber || ''}`.toLowerCase();
    if (!q) return { item, score: scoreForCard(item, lastCompareData) };
    if (!hay.includes(q) && !q.split(/\s+/).every(tok => hay.includes(tok))) return null;
    let score = 0;
    const name = String(item.name || '').toLowerCase();
    if (name === q) score = 1000;
    else if (name.startsWith(q)) score = 800;
    else if (name.includes(q)) score = 600;
    else score = 300;
    score += scoreForCard(item, lastCompareData) / 1000;
    return { item, score };
  }).filter(Boolean);
  scored.sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name));
  return scored.slice(0, limit).map(entry => entry.item);
}

function buildSlotSearch(card, index) {
  const wrap = document.createElement('div');
  wrap.className = 'duel-search';

  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'duel-search-input';
  input.value = card.name;
  input.setAttribute('aria-label', `Search ${cfg().label} model`);
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('spellcheck', 'false');
  input.placeholder = cfg().searchPlaceholder.replace(/^Search · /, 'Search ');

  const list = document.createElement('div');
  list.className = 'duel-search-results';
  list.hidden = true;
  list.setAttribute('role', 'listbox');

  let activeIndex = -1;
  let open = false;

  const close = () => {
    open = false;
    list.hidden = true;
    list.replaceChildren();
    activeIndex = -1;
    wrap.classList.remove('is-open');
  };

  const paint = (items) => {
    list.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'duel-search-empty';
      empty.textContent = 'No models match.';
      list.append(empty);
      list.hidden = false;
      wrap.classList.add('is-open');
      open = true;
      return;
    }
    items.forEach((item, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `duel-search-option${item.id === card.id ? ' is-current' : ''}${i === activeIndex ? ' is-active' : ''}`;
      btn.setAttribute('role', 'option');
      btn.innerHTML = `
        <span class="duel-search-name">${item.name}</span>
        <span class="duel-search-meta">${cfg().pickerMeta(item)}</span>
      `;
      btn.addEventListener('mousedown', (event) => {
        event.preventDefault();
        replaceSlot(index, item.id);
      });
      list.append(btn);
    });
    list.hidden = false;
    wrap.classList.add('is-open');
    open = true;
  };

  const refresh = () => {
    activeIndex = -1;
    const q = input.value.trim();
    // Empty query: show top catalog suggestions; typing filters live
    paint(matchParts(q, q ? 10 : 8));
  };

  input.addEventListener('focus', () => {
    if (input.value === card.name) input.select();
    refresh();
  });
  input.addEventListener('input', refresh);
  input.addEventListener('keydown', (event) => {
    const options = [...list.querySelectorAll('.duel-search-option')];
    if (event.key === 'Escape') {
      input.value = card.name;
      close();
      input.blur();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) refresh();
      activeIndex = Math.min(options.length - 1, activeIndex + 1);
      options.forEach((btn, i) => btn.classList.toggle('is-active', i === activeIndex));
      options[activeIndex]?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      activeIndex = Math.max(0, activeIndex - 1);
      options.forEach((btn, i) => btn.classList.toggle('is-active', i === activeIndex));
      options[activeIndex]?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const pick = options[activeIndex] || options[0];
      if (pick) pick.dispatchEvent(new Event('mousedown'));
    }
  });
  input.addEventListener('blur', () => {
    // Restore label if they didn't pick
    setTimeout(() => {
      if (!wrap.contains(document.activeElement)) {
        input.value = card.name;
        close();
      }
    }, 120);
  });

  wrap.append(input, list);
  return wrap;
}

function renderInsights(data) {
  const strip = el('insightStrip');
  if (!strip) return;
  if (!data?.cards?.length) {
    strip.hidden = true;
    strip.replaceChildren();
    return;
  }

  const scored = data.cards.map(card => ({
    card,
    score: scoreForCard(card, data),
    value: valuePerEuro(card, data),
    watt: perfPerWatt(card, data),
    capacity: Number(card.capacityGb),
    samples: Number(card.samples),
  }));

  const bestPerf = [...scored].sort((a, b) => b.score - a.score)[0];
  const bestValue = [...scored].filter(item => item.value != null).sort((a, b) => b.value - a.value)[0];
  const bestWatt = [...scored].filter(item => item.watt != null).sort((a, b) => b.watt - a.watt)[0];
  const bestCap = (category === 'ssd' || category === 'hdd')
    ? [...scored].filter(item => Number.isFinite(item.capacity)).sort((a, b) => b.capacity - a.capacity)[0]
    : null;
  const mostTested = (category === 'ssd' || category === 'hdd')
    ? [...scored].filter(item => Number.isFinite(item.samples)).sort((a, b) => b.samples - a.samples)[0]
    : null;
  const years = data.cards.map(card => Number(card.releaseYear)).filter(Number.isFinite);
  const ageGap = years.length >= 2 ? Math.max(...years) - Math.min(...years) : null;

  const chips = [
    bestPerf && {
      label: 'Fastest',
      title: shortName(bestPerf.card.name),
      note: `${Math.round(bestPerf.score * 10) / 10} score`,
      hot: true,
      glow: brandTheme(bestPerf.card).glow,
    },
    bestValue && {
      label: 'Best value',
      title: shortName(bestValue.card.name),
      note: `${bestValue.value} score / €`,
      glow: 'rgb(15 122 102 / .18)',
    },
    bestWatt && {
      label: 'Most efficient',
      title: shortName(bestWatt.card.name),
      note: `${bestWatt.watt} score / W`,
      glow: 'rgb(42 111 158 / .18)',
    },
    bestCap && {
      label: 'Largest',
      title: shortName(bestCap.card.name),
      note: formatCapacity(bestCap.capacity),
      glow: 'rgb(15 122 102 / .18)',
    },
    mostTested && mostTested.card.id !== bestPerf?.card.id && {
      label: 'Most tested',
      title: shortName(mostTested.card.name),
      note: `${mostTested.samples.toLocaleString()} samples`,
      glow: 'rgb(42 111 158 / .18)',
    },
    ageGap != null && ageGap > 0 && {
      label: 'Generation gap',
      title: `${ageGap} year${ageGap === 1 ? '' : 's'}`,
      note: `${Math.min(...years)} → ${Math.max(...years)}`,
      glow: 'rgb(196 90 26 / .16)',
    },
  ].filter(Boolean);

  strip.hidden = !chips.length;
  strip.replaceChildren();
  chips.forEach(chip => {
    const card = document.createElement('article');
    card.className = `insight-card${chip.hot ? ' is-hot' : ''}`;
    card.style.setProperty('--insight-glow', chip.glow || 'rgb(15 122 102 / .12)');
    card.innerHTML = `
      <p class="label">${chip.label}</p>
      <strong>${chip.title}</strong>
      <span>${chip.note}</span>
    `;
    strip.append(card);
  });

  if (bestPerf) {
    document.body.dataset.winnerBrand = brandTheme(bestPerf.card).key;
  }
}

function duelPlaceRanks(cards, data) {
  return cards
    .map((card, index) => ({
      id: card.id,
      index,
      score: scoreForCard(card, data),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry, place) => ({ ...entry, place: place + 1 }));
}

function rankedContestantIds(direction = 'ltr') {
  const cards = lastCompareData?.cards?.length
    ? lastCompareData.cards
    : selectedItems();
  if (cards.length < 2) return [...selectedIds];
  const places = duelPlaceRanks(cards, lastCompareData);
  const byId = new Map(places.map(item => [item.id, item.place]));
  const ordered = [...selectedIds].sort((a, b) => {
    const pa = byId.get(a) ?? 9999;
    const pb = byId.get(b) ?? 9999;
    return direction === 'rtl' ? pb - pa : pa - pb;
  });
  return ordered;
}

function currentRankSortDirection() {
  if (selectedIds.length < 2) return null;
  const ltr = rankedContestantIds('ltr');
  const rtl = rankedContestantIds('rtl');
  if (selectedIds.every((id, i) => id === ltr[i])) return 'ltr';
  if (selectedIds.every((id, i) => id === rtl[i])) return 'rtl';
  return null;
}

function updateRankSortChrome() {
  const wrap = el('rankSortWrap');
  const ltrBtn = el('sortRankLtr');
  const rtlBtn = el('sortRankRtl');
  if (!wrap || !ltrBtn || !rtlBtn) return;
  const show = selectedIds.length >= 2;
  wrap.hidden = !show;
  if (!show) return;
  const dir = currentRankSortDirection();
  ltrBtn.classList.toggle('is-active', dir === 'ltr');
  rtlBtn.classList.toggle('is-active', dir === 'rtl');
  ltrBtn.setAttribute('aria-pressed', dir === 'ltr' ? 'true' : 'false');
  rtlBtn.setAttribute('aria-pressed', dir === 'rtl' ? 'true' : 'false');
}

function sortContestantsByRank(direction = 'ltr') {
  if (selectedIds.length < 2) return;
  const next = rankedContestantIds(direction);
  if (next.every((id, i) => id === selectedIds[i])) {
    updateRankSortChrome();
    return;
  }
  selectedIds = next;
  const box = el('duelCards');
  box?.classList.add('is-sorting');
  persistSelected();
  renderAll();
  requestAnimationFrame(() => {
    el('duelCards')?.classList.remove('is-sorting');
  });
}

function duelRankBadgeHtml(place) {
  if (place === 1) {
    return `
      <span class="duel-place-badge is-top" title="1st in this compare">
        <svg class="duel-place-crown" viewBox="0 0 24 24" aria-hidden="true">
          <path fill="currentColor" d="M3 8.5 6.5 13 12 5l5.5 8L21 8.5V18H3V8.5Zm0 11h18v2H3v-2Z"/>
        </svg>
        <span class="duel-place-copy"><em>TOP</em><strong>1</strong></span>
      </span>
    `;
  }
  return `
    <span class="duel-place-badge is-place-${Math.min(place, 8)}" title="${place}${ordinal(place)} in this compare">
      <span class="duel-place-copy"><em>#</em><strong>${place}</strong></span>
    </span>
  `;
}

function wireRemoveConfirm(wrap, cardId, cardName) {
  const paintIdle = () => {
    wrap.replaceChildren();
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'duel-remove';
    button.title = 'Remove';
    button.setAttribute('aria-label', `Remove ${cardName}`);
    button.innerHTML = '<span aria-hidden="true">−</span>';
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      paintConfirm();
    });
    wrap.append(button);
  };

  const paintConfirm = () => {
    wrap.replaceChildren();
    const group = document.createElement('div');
    group.className = 'duel-remove is-confirming';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', `Confirm remove ${cardName}`);

    const yes = document.createElement('button');
    yes.type = 'button';
    yes.className = 'duel-remove-yes';
    yes.title = 'Confirm remove';
    yes.setAttribute('aria-label', `Confirm remove ${cardName}`);
    yes.innerHTML = '<span aria-hidden="true">✓</span>';
    yes.addEventListener('click', (event) => {
      event.stopPropagation();
      removeItem(cardId);
    });

    const no = document.createElement('button');
    no.type = 'button';
    no.className = 'duel-remove-no';
    no.title = 'Cancel';
    no.setAttribute('aria-label', 'Cancel remove');
    no.innerHTML = '<span aria-hidden="true">✕</span>';
    no.addEventListener('click', (event) => {
      event.stopPropagation();
      paintIdle();
    });

    group.append(yes, no);
    wrap.append(group);

    const onDoc = (event) => {
      if (!wrap.contains(event.target)) {
        document.removeEventListener('click', onDoc, true);
        if (wrap.isConnected) paintIdle();
      }
    };
    setTimeout(() => document.addEventListener('click', onDoc, true), 0);
  };

  paintIdle();
}

function wireReplaceSearch(wrap, index, card) {
  let open = false;
  let activeIndex = -1;

  const close = () => {
    open = false;
    activeIndex = -1;
    wrap.classList.remove('is-open');
    paintIdle();
  };

  const paintIdle = () => {
    wrap.replaceChildren();
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'duel-replace';
    button.title = 'Replace';
    button.setAttribute('aria-label', `Replace ${card.name}`);
    button.innerHTML = '<span aria-hidden="true">⇄</span><span class="duel-replace-label">Replace</span>';
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      openPanel();
    });
    wrap.append(button);
  };

  const paintResults = (list, query) => {
    const items = matchParts(query, 10);
    list.replaceChildren();
    if (!items.length) {
      list.innerHTML = '<p class="duel-replace-empty">No models match.</p>';
      return;
    }
    items.forEach((item, i) => {
      const current = item.id === card.id;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `duel-replace-option${current ? ' is-current' : ''}${i === activeIndex ? ' is-active' : ''}`;
      btn.innerHTML = `
        <span class="name">${item.name}</span>
        <span class="meta">${cfg().pickerMeta(item)}</span>
        <span class="action">${current ? 'Current' : 'Use'}</span>
      `;
      if (current) {
        btn.disabled = true;
      } else {
        btn.addEventListener('mousedown', (event) => {
          event.preventDefault();
          event.stopPropagation();
          replaceSlot(index, item.id);
        });
      }
      list.append(btn);
    });
  };

  const openPanel = () => {
    open = true;
    wrap.classList.add('is-open');
    wrap.replaceChildren();

    const panel = document.createElement('div');
    panel.className = 'duel-replace-panel';
    panel.innerHTML = `
      <div class="duel-replace-panel-head">
        <strong>Replace ${shortName(card.name)}</strong>
        <button type="button" class="duel-replace-cancel text-button">Cancel</button>
      </div>
      <input type="search" class="duel-replace-input" placeholder="${cfg().searchPlaceholder.replace(/^Search · /, '')}" autocomplete="off" spellcheck="false" />
      <div class="duel-replace-list" role="listbox"></div>
    `;
    wrap.append(panel);

    const input = panel.querySelector('.duel-replace-input');
    const list = panel.querySelector('.duel-replace-list');
    panel.querySelector('.duel-replace-cancel').addEventListener('click', (event) => {
      event.stopPropagation();
      close();
    });

    const refresh = () => {
      activeIndex = -1;
      paintResults(list, input.value);
    };

    input.addEventListener('input', refresh);
    input.addEventListener('keydown', (event) => {
      const options = [...list.querySelectorAll('.duel-replace-option:not(:disabled)')];
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        activeIndex = Math.min(options.length - 1, activeIndex + 1);
        options.forEach((btn, i) => btn.classList.toggle('is-active', i === activeIndex));
        options[activeIndex]?.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        activeIndex = Math.max(0, activeIndex - 1);
        options.forEach((btn, i) => btn.classList.toggle('is-active', i === activeIndex));
        options[activeIndex]?.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const pick = options[activeIndex] || options[0];
        pick?.dispatchEvent(new Event('mousedown'));
      }
    });

    refresh();
    requestAnimationFrame(() => input.focus());

    const onDoc = (event) => {
      if (!wrap.contains(event.target)) {
        document.removeEventListener('click', onDoc, true);
        if (wrap.isConnected && open) close();
      }
    };
    setTimeout(() => document.addEventListener('click', onDoc, true), 0);
  };

  paintIdle();
}

function buildAddSlotCard() {
  const article = document.createElement('article');
  article.className = 'duel-add-slot';
  article.dataset.addSlot = '1';

  const idle = document.createElement('button');
  idle.type = 'button';
  idle.className = 'duel-add-idle';
  idle.setAttribute('aria-label', 'Add contestant');
  idle.innerHTML = `
    <span class="duel-add-plus" aria-hidden="true">+</span>
    <span class="duel-add-copy">
      <strong>Add</strong>
      <span>contestant</span>
    </span>
  `;

  const panel = document.createElement('div');
  panel.className = 'duel-add-panel';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="duel-add-panel-head">
      <strong>Add ${cfg().label}s</strong>
      <button type="button" class="duel-add-cancel text-button">Cancel</button>
    </div>
    <input type="search" class="duel-add-input" placeholder="${cfg().searchPlaceholder.replace(/^Search · /, '')}" autocomplete="off" spellcheck="false" />
    <div class="duel-add-list" role="listbox" aria-label="Search results"></div>
    <div class="duel-add-footer">
      <span class="duel-add-picked-count">0 selected</span>
      <button type="button" class="primary-button duel-add-confirm" disabled>Add selected</button>
    </div>
  `;

  const input = panel.querySelector('.duel-add-input');
  const list = panel.querySelector('.duel-add-list');
  const confirm = panel.querySelector('.duel-add-confirm');
  const countEl = panel.querySelector('.duel-add-picked-count');
  const picked = new Set();

  const updateFooter = () => {
    const n = picked.size;
    countEl.textContent = `${n} selected`;
    confirm.disabled = n === 0;
    confirm.textContent = n <= 1 ? 'Add selected' : `Add ${n} selected`;
  };

  const paint = () => {
    const room = Math.max(0, MAX_CARDS - selectedIds.length);
    const items = matchParts(input.value, 12).filter(item => !selectedIds.includes(item.id));
    list.replaceChildren();
    if (!items.length) {
      list.innerHTML = '<p class="duel-add-empty">No models match.</p>';
      return;
    }
    items.forEach(item => {
      const on = picked.has(item.id);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `duel-add-option${on ? ' is-checked' : ''}`;
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', on ? 'true' : 'false');
      row.innerHTML = `
        <span class="duel-add-tick" aria-hidden="true">${on ? '✓' : ''}</span>
        <span class="duel-add-option-copy">
          <strong>${item.name}</strong>
          <small>${cfg().pickerMeta(item)}</small>
        </span>
      `;
      row.addEventListener('click', () => {
        if (picked.has(item.id)) picked.delete(item.id);
        else {
          if (picked.size >= room) {
            el('compareMeta').textContent = `Only ${room} more slot${room === 1 ? '' : 's'} available.`;
            return;
          }
          picked.add(item.id);
        }
        paint();
        updateFooter();
      });
      list.append(row);
    });
  };

  const openPanel = () => {
    article.classList.add('is-open');
    idle.hidden = true;
    panel.hidden = false;
    picked.clear();
    updateFooter();
    paint();
    requestAnimationFrame(() => input.focus());
  };

  const closePanel = () => {
    article.classList.remove('is-open');
    idle.hidden = false;
    panel.hidden = true;
    input.value = '';
    picked.clear();
    list.replaceChildren();
    updateFooter();
  };

  idle.addEventListener('click', openPanel);
  panel.querySelector('.duel-add-cancel').addEventListener('click', closePanel);
  input.addEventListener('input', paint);
  confirm.addEventListener('click', () => {
    const ids = [...picked];
    if (!ids.length) return;
    ids.forEach(id => {
      if (selectedIds.length < MAX_CARDS && !selectedIds.includes(id)) {
        selectedIds.push(id);
        if (!baselineId) baselineId = id;
      }
    });
    persistSelected();
    closePanel();
    renderAll();
  });

  article.append(idle, panel);
  return article;
}

function reorderContestant(fromIndex, insertIndex) {
  const n = selectedIds.length;
  if (fromIndex < 0 || fromIndex >= n) return;
  let dest = Math.max(0, Math.min(n, insertIndex));
  if (dest > fromIndex) dest -= 1;
  if (dest === fromIndex) return;
  const next = [...selectedIds];
  const [id] = next.splice(fromIndex, 1);
  next.splice(dest, 0, id);
  selectedIds = next;
  const box = el('duelCards');
  box?.classList.add('is-sorting');
  persistSelected();
  renderAll();
  requestAnimationFrame(() => {
    el('duelCards')?.classList.remove('is-sorting');
  });
}

function wireDuelCardDrag(box) {
  const cards = [...box.querySelectorAll('.duel-card[data-contestant-index]')];
  if (cards.length < 2) return;

  let fromIndex = -1;
  let insertIndex = -1;
  let placeholder = null;

  const clearDropUi = () => {
    box.classList.remove('is-dragging-contestant');
    cards.forEach(card => {
      card.classList.remove('is-dragging', 'is-drop-before', 'is-drop-after');
    });
    placeholder?.remove();
    placeholder = null;
    insertIndex = -1;
  };

  const ensurePlaceholder = () => {
    if (placeholder) return placeholder;
    placeholder = document.createElement('div');
    placeholder.className = 'duel-drop-placeholder';
    placeholder.setAttribute('aria-hidden', 'true');
    placeholder.innerHTML = `
      <span class="duel-drop-placeholder-mark"></span>
      <strong>Drop here</strong>
      <span>Releases into this slot</span>
    `;
    return placeholder;
  };

  const placePlaceholder = (index) => {
    const node = ensurePlaceholder();
    const contestants = [...box.querySelectorAll('.duel-card[data-contestant-index]')];
    if (index >= contestants.length) box.append(node);
    else box.insertBefore(node, contestants[index]);
    insertIndex = index;
  };

  const dropIndexFromPoint = (clientX, clientY) => {
    const contestants = [...box.querySelectorAll('.duel-card[data-contestant-index]:not(.is-dragging)')];
    if (!contestants.length) return 0;
    for (let i = 0; i < contestants.length; i += 1) {
      const rect = contestants[i].getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      const midY = rect.top + rect.height / 2;
      const before = rect.width >= rect.height
        ? clientX < midX
        : clientY < midY;
      if (before) {
        const raw = Number(contestants[i].dataset.contestantIndex);
        return Number.isFinite(raw) ? raw : i;
      }
    }
    return cards.length;
  };

  cards.forEach(card => {
    const handle = card.querySelector('.duel-drag-handle');
    if (!handle) return;

    handle.addEventListener('pointerdown', () => {
      card.draggable = true;
    });
    handle.addEventListener('mousedown', () => {
      card.draggable = true;
    });
    handle.addEventListener('click', (event) => {
      event.preventDefault();
    });

    card.addEventListener('dragstart', (event) => {
      if (!card.draggable) {
        event.preventDefault();
        return;
      }
      fromIndex = Number(card.dataset.contestantIndex);
      if (!Number.isFinite(fromIndex)) {
        event.preventDefault();
        return;
      }
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(fromIndex));
      try {
        event.dataTransfer.setDragImage(card, Math.min(48, card.offsetWidth / 4), 24);
      } catch {
        /* some browsers reject custom drag images */
      }
      box.classList.add('is-dragging-contestant');
      requestAnimationFrame(() => {
        card.classList.add('is-dragging');
        placePlaceholder(fromIndex);
      });
    });

    card.addEventListener('dragend', () => {
      card.draggable = false;
      clearDropUi();
      fromIndex = -1;
    });
  });

  box.addEventListener('dragover', (event) => {
    if (fromIndex < 0) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (event.target.closest?.('.duel-drop-placeholder')) return;
    const next = dropIndexFromPoint(event.clientX, event.clientY);
    if (next !== insertIndex) placePlaceholder(next);
  });

  box.addEventListener('drop', (event) => {
    if (fromIndex < 0) return;
    event.preventDefault();
    const dest = insertIndex >= 0 ? insertIndex : dropIndexFromPoint(event.clientX, event.clientY);
    const from = fromIndex;
    clearDropUi();
    fromIndex = -1;
    cards.forEach(card => { card.draggable = false; });
    reorderContestant(from, dest);
  });
}

function renderDuelCards(data) {
  const box = el('duelCards');
  const addMount = el('duelAddMount');
  box.replaceChildren();
  if (addMount) {
    addMount.replaceChildren();
    addMount.hidden = true;
  }
  const cards = data?.cards || [];
  box.dataset.count = String(cards.length);
  const scores = cards.map(card => scoreForCard(card, data));
  const places = cards.length ? duelPlaceRanks(cards, data) : [];
  const placeById = new Map(places.map(item => [item.id, item.place]));
  const ranked = [...allItems]
    .map(item => ({ id: item.id, score: scoreForCard(item, data) }))
    .sort((a, b) => b.score - a.score);
  const total = ranked.length || 1;
  const swapBtn = el('swapCompare');
  if (swapBtn) swapBtn.hidden = cards.length !== 2;
  updateRankSortChrome();

  cards.forEach((card, index) => {
    const article = document.createElement('article');
    const score = scores[index];
    const theme = brandTheme(card);
    const place = placeById.get(card.id) || index + 1;
    const isWinner = place === 1 && cards.length >= 2;
    const picked = deepPickIds.includes(card.id);
    article.className = `duel-card is-place-${place}${isWinner ? ' is-winner' : ''}${picked ? ' is-picked' : ''}`;
    article.dataset.contestantIndex = String(index);
    article.dataset.contestantId = card.id;
    article.setAttribute('aria-pressed', picked ? 'true' : 'false');
    article.title = picked
      ? `Selected for deep compare · ${card.name}`
      : `Click to select ${card.name} for deep compare`;
    article.style.setProperty('--part-accent', theme.accent);
    article.style.setProperty('--part-glow', theme.glow);
    article.style.setProperty('--place-delay', `${0.04 * (place - 1)}s`);

    const rankIdx = ranked.findIndex(item => item.id === card.id);
    const rankLabel = rankIdx >= 0 ? `${rankIdx + 1}${ordinal(rankIdx + 1)} / ${total}` : '—';
    const value = valuePerEuro(card, data);
    const watt = perfPerWatt(card, data);

    const related = relatedFor(card);
    const relatedHtml = related.map(item => {
      const current = item.id === card.id;
      return `<button type="button" class="${current ? 'is-current' : ''}" ${current ? 'disabled' : ''} data-id="${item.id}">${shortRelated(item.name)}</button>`;
    }).join('');

    const flags = [];
    if (category === 'gpu') {
      flags.push(`<span class="duel-flag${card.rayTracing ? '' : ' is-off'}">RT</span>`);
      flags.push(`<span class="duel-flag${card.dlss ? '' : ' is-off'}">DLSS</span>`);
      if (card.memoryType) flags.push(`<span class="duel-flag">${card.memoryType}</span>`);
    } else if (category === 'ssd' || category === 'hdd') {
      if (card.interface) flags.push(`<span class="duel-flag">${card.interface}</span>`);
      if (card.formFactor) flags.push(`<span class="duel-flag">${card.formFactor}</span>`);
      if (card.pcie) flags.push(`<span class="duel-flag">PCIe ${card.pcie}</span>`);
      if (card.capacityGb) flags.push(`<span class="duel-flag">${formatCapacity(card.capacityGb)}</span>`);
    } else {
      if (card.socket) flags.push(`<span class="duel-flag">${card.socket}</span>`);
      if (card.tdpW) flags.push(`<span class="duel-flag">${card.tdpW}W</span>`);
    }

    article.innerHTML = `
      <div class="duel-art">
        ${cards.length >= 2 ? duelRankBadgeHtml(place) : ''}
        ${productArtSvg(card)}
      </div>
      <div class="duel-card-top">
        <div class="duel-card-heading">
          ${cards.length >= 2 ? `
            <button type="button" class="duel-drag-handle" title="Drag to reorder" aria-label="Drag to reorder ${card.name}">
              <span aria-hidden="true"></span>
            </button>
          ` : ''}
          <p class="duel-brand">${card.brand || cfg().label}</p>
        </div>
        <div class="duel-card-actions">
          <div class="duel-replace-wrap"></div>
          <div class="duel-remove-wrap"></div>
        </div>
      </div>
      <div class="duel-select-wrap"></div>
      <div class="duel-score-row">
        <div class="duel-score">
          <strong data-count="${Number.isFinite(score) ? score : ''}">0</strong>
          <span>${data.scoreLabel || 'Effective score'}</span>
        </div>
        <div class="duel-rank">
          <strong>${rankLabel}</strong>
          catalog rank
        </div>
      </div>
      <div class="duel-stats-mini">
        <div class="duel-stat">
          <b>${category === 'ssd' || category === 'hdd'
            ? (card.capacityGb ? formatCapacity(card.capacityGb) : '—')
            : (value != null ? value : '—')}</b>
          <span>${category === 'ssd' || category === 'hdd' ? 'Capacity' : 'Score / €'}</span>
        </div>
        <div class="duel-stat">
          <b>${category === 'ssd' || category === 'hdd'
            ? (card.rank != null ? `#${card.rank}` : '—')
            : (watt != null ? watt : '—')}</b>
          <span>${category === 'ssd' || category === 'hdd' ? 'UB rank' : 'Score / W'}</span>
        </div>
      </div>
      <div class="duel-flags">${flags.join('')}</div>
      <div class="duel-meta">
        ${card.marketPriceEur != null ? `<span class="duel-pill price">Used · €${Math.round(card.marketPriceEur)}</span>` : ''}
        ${card.launchPriceEur != null ? `<span class="duel-pill msrp">MSRP · €${Math.round(card.launchPriceEur)}</span>` : ''}
        ${card.releaseYear ? `<span class="duel-pill">${card.releaseYear}</span>` : ''}
        ${card.memoryGb != null ? `<span class="duel-pill">${card.memoryGb} GB</span>` : ''}
        ${card.cores != null ? `<span class="duel-pill">${card.cores}/${card.threads}c/t</span>` : ''}
        ${card.architecture ? `<span class="duel-pill">${card.architecture}</span>` : ''}
        ${card.samples != null ? `<span class="duel-pill">${Number(card.samples).toLocaleString()} samples</span>` : ''}
        ${card.family && (category === 'ssd' || category === 'hdd') ? `<span class="duel-pill">${card.family}</span>` : ''}
      </div>
      <div class="duel-related">${relatedHtml || ''}</div>
      ${index === 0 && cards.length === 2 ? '<span class="duel-vs-badge">VS</span>' : ''}
    `;
    article.querySelector('.duel-select-wrap').append(buildSlotSearch(card, index));
    wireReplaceSearch(article.querySelector('.duel-replace-wrap'), index, card);
    wireRemoveConfirm(article.querySelector('.duel-remove-wrap'), card.id, card.name);
    article.querySelectorAll('.duel-related button[data-id]').forEach(btn => {
      btn.addEventListener('click', () => replaceSlot(index, btn.dataset.id));
    });
    article.addEventListener('click', (event) => {
      if (event.target.closest('button, a, input, select, textarea, label, .duel-search, .duel-related, .duel-drag-handle, .duel-remove-wrap, .duel-replace-wrap, .duel-select-wrap')) {
        return;
      }
      toggleDeepPick(card.id);
    });
    box.append(article);
    const strong = article.querySelector('.duel-score strong[data-count]');
    if (strong && Number.isFinite(score)) countUp(strong, score, 750 + index * 80);
  });

  if (selectedIds.length < MAX_CARDS && addMount) {
    addMount.hidden = false;
    addMount.append(buildAddSlotCard());
  }

  wireDuelCardDrag(box);
}

function localCompareStub() {
  const cards = selectedItems();
  return {
    cards,
    baselineId: cards[0]?.id || '',
    baselineName: cards[0]?.name || '',
    scoreKey: scoreKey,
    scoreLabel: category === 'cpu'
      ? (scoreKey === 'relativeSingle' ? 'Single-thread' : 'Multi-thread')
      : (category === 'ssd' || category === 'hdd' ? 'Effective speed' : 'Relative raster'),
    rows: [],
    pairwise: [],
    vsMatrix: [],
  };
}

async function renderComparison() {
  const empty = el('compareEmpty');
  const results = el('compareResults');
  empty.hidden = true;
  results.hidden = false;

  const enough = selectedIds.length >= 2;
  el('insightStrip').hidden = !enough;
  if (!enough) {
    el('insightStrip').replaceChildren();
    el('swapCompare').hidden = true;
    updateRankSortChrome();
    document.body.dataset.winnerBrand = '';
    el('speedVerdict').hidden = true;
    el('speedVerdict').replaceChildren();
    el('metricDuels').replaceChildren();
    el('specsDetails').hidden = true;
    el('matrixDetails').hidden = true;
  } else {
    el('specsDetails').hidden = false;
    el('matrixDetails').hidden = false;
  }

  try {
    let data;
    if (enough) {
      const c = cfg();
      const scoreParam = c.scoreOptions ? `&score=${encodeURIComponent(scoreKey)}` : '';
      data = await api(`${c.comparePath}?ids=${encodeURIComponent(selectedIds.join(','))}&baseline=${encodeURIComponent(baselineId || selectedIds[0])}${scoreParam}`);
      baselineId = data.baselineId || baselineId;
      lastCompareData = data;
      updateHeading(data);
      renderInsights(data);
      renderSpeedVerdict(data);
      renderMetricDuels(data);
      renderTable(data);
      renderPairwise(data);
    } else {
      data = localCompareStub();
      lastCompareData = data;
      if (!data.cards.length) {
        el('compareTitle').textContent = `Add a ${cfg().label} to start`;
        el('compareLead').textContent = `Use the + card to pick contestants · up to ${MAX_CARDS}`;
      } else {
        el('compareTitle').textContent = shortName(data.cards[0].name);
        el('compareLead').textContent = `Add at least one more ${cfg().label} to compare`;
      }
    }
    renderDuelCards(data);
    renderQuickAdd();
    syncShareUrl();
  } catch (error) {
    el('compareMeta').textContent = error.message;
  }
}

function shortRelated(name) {
  return String(name || '')
    .replace(/^GeForce (RTX|GTX) /, '')
    .replace(/^Ryzen \d+ /, '')
    .replace(/^Core /, '')
    .replace(/GeForce /, '')
    .replace(/^(Samsung|WD|Crucial|Seagate|Kingston|Corsair|Intel|Toshiba|SanDisk|ADATA|PNY|Lexar)\s+/i, '')
    .replace(/\bNVMe PCIe\b/gi, '')
    .replace(/\bM\.?\s*2\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return 'th';
  switch (n % 10) {
    case 1: return 'st';
    case 2: return 'nd';
    case 3: return 'rd';
    default: return 'th';
  }
}

function metricBoardColumnsHtml(ranked, valueHtml, deltaHtml) {
  return `
    <div class="metric-board metric-board-cols" style="--metric-cols:${Math.max(ranked.length, 1)}">
      ${ranked.map(item => `
        <div class="metric-col ${item.place === 1 ? 'is-lead' : ''}">
          <span class="metric-col-place">${item.place === 1 ? 'TOP 1' : `#${item.place}`}</span>
          <span class="metric-col-name" title="${item.card.name}">${shortName(item.card.name)}</span>
          <strong class="metric-col-val">${valueHtml(item)}</strong>
          <span class="metric-col-delta ${toneClass(item.delta)}">${deltaHtml(item)}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function renderSpeedVerdict(data) {
  const box = el('speedVerdict');
  if (data.cards.length < 2) {
    box.hidden = true;
    box.replaceChildren();
    return;
  }

  const scores = data.cards.map(card => ({ card, score: scoreForCard(card, data) }));
  scores.sort((a, b) => b.score - a.score || 0);
  const winner = scores[0];
  const loser = scores[1];
  const delta = loser.score > 0
    ? Math.round(((winner.score - loser.score) / loser.score) * 1000) / 10
    : 0;
  const max = Math.max(...scores.map(item => item.score), 1);

  box.hidden = false;
  if (data.cards.length === 2) {
    const left = data.cards[0];
    const right = data.cards[1];
    const leftScore = scoreForCard(left, data);
    const rightScore = scoreForCard(right, data);
    const leftPct = Math.round((leftScore / max) * 1000) / 10;
    const rightPct = Math.round((rightScore / max) * 1000) / 10;
    box.innerHTML = `
      <div class="speed-verdict-head">
        <h2>Effective speed</h2>
        <p><strong>${shortName(winner.card.name)}</strong> is <strong>+${delta}%</strong> faster than ${shortName(loser.card.name)}</p>
      </div>
      <div class="speed-duel">
        <div class="speed-duel-side ${leftScore >= rightScore ? 'is-lead' : ''}">
          <span class="speed-duel-name">${shortName(left.name)}</span>
          <strong>${leftPct}%</strong>
        </div>
        <div class="speed-duel-mid" aria-hidden="true">vs</div>
        <div class="speed-duel-side is-right ${rightScore >= leftScore ? 'is-lead' : ''}">
          <span class="speed-duel-name">${shortName(right.name)}</span>
          <strong>${rightPct}%</strong>
        </div>
      </div>
    `;
  } else {
    const ranked = scores.map((item, i) => ({
      card: item.card,
      place: i + 1,
      score: item.score,
      delta: i === 0
        ? { pct: 0, better: false, equal: true }
        : {
          pct: Math.round(((item.score - winner.score) / Math.abs(winner.score || 1)) * 1000) / 10,
          better: false,
          equal: item.score === winner.score,
        },
    }));
    box.innerHTML = `
      <div class="speed-verdict-head">
        <h2>Effective speed</h2>
        <p><strong>${shortName(winner.card.name)}</strong> leads · ${data.scoreLabel || 'relative score'}</p>
      </div>
      ${metricBoardColumnsHtml(
        ranked,
        item => `${Math.round((item.score / max) * 1000) / 10}%`,
        item => (item.delta?.equal ? 'leader' : (formatPct(item.delta) || '—')),
      )}
    `;
  }
}

function metricLeaderEntries(row, cards) {
  const higherBetter = row.higherBetter !== false;
  const entries = cards.map((card, index) => {
    const raw = row.values[index]?.value;
    const n = Number(raw);
    return {
      card,
      index,
      raw,
      n: Number.isFinite(n) ? n : null,
    };
  }).filter(item => item.n != null || item.raw != null);

  const numeric = entries.filter(item => item.n != null);
  if (!numeric.length) return { leader: null, ranked: entries.map((item, i) => ({ ...item, place: i + 1, delta: null })) };

  const leader = [...numeric].sort((a, b) => (
    higherBetter ? b.n - a.n : a.n - b.n
  ) || a.index - b.index)[0];

  const ranked = [...entries].sort((a, b) => {
    if (a.n == null && b.n == null) return a.index - b.index;
    if (a.n == null) return 1;
    if (b.n == null) return -1;
    return (higherBetter ? b.n - a.n : a.n - b.n) || a.index - b.index;
  }).map((item, place) => {
    let delta = null;
    if (item.n != null && leader?.n != null && leader.n !== 0) {
      if (item.card.id === leader.card.id) {
        delta = { pct: 0, better: false, equal: true };
      } else {
        const pct = Math.round(((item.n - leader.n) / Math.abs(leader.n)) * 1000) / 10;
        delta = {
          pct,
          better: higherBetter ? item.n > leader.n : item.n < leader.n,
          equal: item.n === leader.n,
        };
      }
    }
    return { ...item, place: place + 1, delta };
  });

  return { leader, ranked };
}

function renderMetricDuels(data) {
  const box = el('metricDuels');
  box.replaceChildren();
  const numericRows = (data.rows || []).filter(row => row.kind === 'number' && row.values.some(v => v.value != null));

  if (data.cards.length === 2) {
    numericRows.forEach(row => {
      const a = Number(row.values[0]?.value);
      const b = Number(row.values[1]?.value);
      if (!Number.isFinite(a) && !Number.isFinite(b)) return;
      const higherBetter = row.higherBetter !== false;
      const aBest = Number.isFinite(a) && Number.isFinite(b)
        ? (higherBetter ? a >= b : a <= b)
        : Number.isFinite(a);
      const bBest = Number.isFinite(a) && Number.isFinite(b)
        ? (higherBetter ? b >= a : b <= a)
        : Number.isFinite(b);
      const headDelta = Number.isFinite(a) && Number.isFinite(b) && b !== 0
        ? {
          pct: Math.round(((a - b) / Math.abs(b)) * 1000) / 10,
          better: higherBetter ? a > b : a < b,
          equal: a === b,
        }
        : null;
      const headDeltaB = headDelta
        ? { pct: headDelta.pct === 0 ? 0 : -headDelta.pct, better: !headDelta.better && !headDelta.equal, equal: headDelta.equal }
        : null;

      const rowEl = document.createElement('div');
      rowEl.className = `metric-row metric-row-clean${KEY_METRIC_KEYS.has(row.key) ? ' is-key' : ''}`;
      rowEl.innerHTML = `
        <div class="metric-side is-left ${aBest ? 'is-best' : ''}">
          <span class="metric-val">${formatValue(row.values[0]?.value, row.kind, row.unit)}</span>
          <span class="metric-delta ${toneClass(headDelta)}">${formatPct(headDelta) || ''}</span>
        </div>
        <div class="metric-label"><strong>${row.label}</strong>${row.unit ? `<small>${row.unit}</small>` : ''}</div>
        <div class="metric-side is-right ${bBest ? 'is-best' : ''}">
          <span class="metric-val">${formatValue(row.values[1]?.value, row.kind, row.unit)}</span>
          <span class="metric-delta ${toneClass(headDeltaB)}">${formatPct(headDeltaB) || ''}</span>
        </div>
      `;
      box.append(rowEl);
    });
    return;
  }

  const ordered = [
    ...numericRows.filter(row => KEY_METRIC_KEYS.has(row.key)),
    ...numericRows.filter(row => !KEY_METRIC_KEYS.has(row.key)),
  ].slice(0, 12);

  ordered.forEach(row => {
    const { leader, ranked } = metricLeaderEntries(row, data.cards);
    const panel = document.createElement('div');
    panel.className = `metric-board-card${KEY_METRIC_KEYS.has(row.key) ? ' is-key' : ''}`;
    const leadNote = leader
      ? `${shortName(leader.card.name)} leads`
      : (row.unit || '');
    panel.innerHTML = `
      <div class="metric-board-head">
        <strong>${row.label}</strong>
        <span>${leadNote}</span>
      </div>
      ${metricBoardColumnsHtml(
        ranked,
        item => formatValue(item.raw, row.kind, row.unit),
        item => (item.delta?.equal ? 'best' : (formatPct(item.delta) || '—')),
      )}
    `;
    box.append(panel);
  });
}

function toneClass(delta) {
  if (!delta || delta.equal) return 'is-same';
  return delta.better ? 'is-up' : 'is-down';
}

function renderTable(data) {
  const table = el('compareTable');
  const thead = table.querySelector('thead');
  const tbody = table.querySelector('tbody');
  thead.replaceChildren();
  tbody.replaceChildren();

  const headRow = document.createElement('tr');
  headRow.innerHTML = `<th scope="col">Spec</th>${data.cards.map(card => `
    <th scope="col" class="${card.id === data.baselineId ? 'is-baseline' : ''}" title="${card.name}">
      <span>${shortName(card.name)}</span>
      ${card.id === data.baselineId ? '<small>baseline</small>' : ''}
    </th>
  `).join('')}`;
  thead.append(headRow);

  data.rows.forEach(row => {
    const tr = document.createElement('tr');
    const cells = row.values.map((cell, index) => {
      const card = data.cards[index];
      const isBase = card.id === data.baselineId;
      const valueText = formatValue(cell.value, row.kind, row.unit);
      if (row.kind !== 'number' || isBase || !cell.delta) {
        return `<td class="${isBase ? 'is-baseline' : ''}"><span class="spec-value">${valueText}</span></td>`;
      }
      return `<td>
        <span class="spec-value">${valueText}</span>
        <span class="spec-delta ${toneClass(cell.delta)}">${formatPct(cell.delta)}</span>
      </td>`;
    }).join('');
    tr.innerHTML = `<th scope="row">${row.label}</th>${cells}`;
    tbody.append(tr);
  });

  const matrix = Array.isArray(data.vsMatrix) ? data.vsMatrix : [];
  if (matrix.length >= 2) {
    const sep = document.createElement('tr');
    sep.className = 'compare-section-sep';
    sep.innerHTML = `<th scope="row" colspan="${data.cards.length + 1}">Perf vs each other · ${data.scoreLabel || 'score'}</th>`;
    tbody.append(sep);
    matrix.forEach(row => {
      const tr = document.createElement('tr');
      tr.className = 'compare-vs-row';
      const cells = row.values.map((cell, index) => {
        const card = data.cards[index];
        const isBase = card.id === data.baselineId;
        if (!cell.delta) {
          return `<td class="${isBase ? 'is-baseline' : ''}"><span class="spec-value">—</span></td>`;
        }
        return `<td class="${isBase ? 'is-baseline' : ''}">
          <span class="spec-delta ${toneClass(cell.delta)} is-large">${formatPct(cell.delta)}</span>
        </td>`;
      }).join('');
      tr.innerHTML = `<th scope="row" title="${row.vsName}">vs ${shortName(row.vsName)}</th>${cells}`;
      tbody.append(tr);
    });
  }
}

function renderPairwise(data) {
  const box = el('pairwiseGrid');
  box.replaceChildren();
  data.pairwise.forEach(card => {
    const panel = document.createElement('article');
    panel.className = 'pairwise-card';
    const list = card.vsOthers.map(item => `
      <li><span>${item.vsName}</span><strong class="${toneClass(item.delta)}">${formatPct(item.delta) || '—'}</strong></li>
    `).join('');
    const score = card.relativeScore ?? card.relativeRaster ?? card.relativeMulti;
    panel.innerHTML = `
      <h3>${card.name}</h3>
      <p class="demo-note">${data.scoreLabel || 'Score'} ${score}</p>
      <ul>${list || '<li>Select more parts to compare.</li>'}</ul>
    `;
    box.append(panel);
  });
}

function updateHeading(data) {
  const names = data.cards.map(card => shortName(card.name));
  if (names.length === 2) {
    el('compareTitle').textContent = `${names[0]} vs ${names[1]}`;
    el('compareLead').textContent = `${data.scoreLabel || 'Performance'} · ${cfg().metaScore}`;
  } else {
    el('compareTitle').textContent = `${names.length} ${cfg().label}s compared`;
    el('compareLead').textContent = names.join(' · ');
  }
}

function renderAll() {
  renderQuickAdd();
  renderPicker();
  renderComparison();
}

function contestPlaceMap() {
  if (!lastCompareData?.cards?.length) {
    return new Map(selectedIds.map((id, i) => [id, i + 1]));
  }
  return new Map(duelPlaceRanks(lastCompareData.cards, lastCompareData).map(item => [item.id, item.place]));
}

function pruneDeepPicks() {
  const allowed = new Set(selectedIds);
  deepPickIds = deepPickIds.filter(id => allowed.has(id));
}

function toggleDeepPick(id) {
  if (!id || !selectedIds.includes(id)) return;
  if (deepPickIds.includes(id)) {
    deepPickIds = deepPickIds.filter(item => item !== id);
  } else {
    deepPickIds = [...deepPickIds, id];
  }
  syncDeepPickVisuals();
}

function clearDeepPick() {
  deepPickIds = [];
  syncDeepPickVisuals();
}

function syncDeepPickVisuals() {
  document.querySelectorAll('.duel-card[data-contestant-id]').forEach((card, index) => {
    const on = deepPickIds.includes(card.dataset.contestantId);
    card.classList.toggle('is-picked', on);
    card.setAttribute('aria-pressed', on ? 'true' : 'false');
    const pickOrder = on ? deepPickIds.indexOf(card.dataset.contestantId) + 1 : 0;
    let badge = card.querySelector('.duel-pick-badge');
    if (on) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'duel-pick-badge';
        badge.setAttribute('aria-hidden', 'true');
        card.append(badge);
      }
      badge.textContent = String(pickOrder);
    } else if (badge) {
      badge.remove();
    }
    card.title = on
      ? `Selected for deep compare (#${pickOrder})`
      : `Click to select for deep compare`;
  });
  renderQuickAdd();
  updateDeepCompareChrome();
}

function updateDeepCompareChrome() {
  const actions = el('deepCompareActions');
  const hint = el('contestantHint');
  const btn = el('runDeepCompare');
  const n = deepPickIds.length;
  if (actions) actions.hidden = n < 2;
  if (hint) {
    if (n === 0) hint.textContent = 'Tap cards to pick a focused duel';
    else if (n === 1) hint.textContent = 'Pick one more for a head-to-head';
    else if (n === 2) {
      const names = deepPickIds.map(id => shortName(selectedItems().find(c => c.id === id)?.name || id));
      hint.textContent = `${names[0]} vs ${names[1]} ready`;
    } else {
      hint.textContent = `${n} picked · deep compare the shortlist`;
    }
  }
  if (btn) {
    const label = btn.querySelector('.deep-compare-btn-label');
    if (label) {
      label.textContent = n === 2 ? 'Deep compare · H2H' : `Deep compare · ${n}`;
    }
    btn.disabled = n < 2;
  }
  el('quickAddBar')?.classList.toggle('has-deep-pick', n > 0);
  el('quickAddBar')?.classList.toggle('has-deep-ready', n >= 2);
}

function closeDeepDive() {
  deepDiveOpen = false;
  const dive = el('deepDive');
  if (!dive) return;
  dive.classList.remove('is-open');
  dive.hidden = true;
  document.body.classList.remove('deep-dive-active');
}

async function openDeepDive() {
  pruneDeepPicks();
  if (deepPickIds.length < 2) return;
  const dive = el('deepDive');
  const body = el('deepDiveBody');
  const title = el('deepDiveTitle');
  const isolate = el('deepDiveIsolate');
  if (!dive || !body) return;

  deepDiveOpen = true;
  const token = ++deepDiveToken;
  dive.hidden = false;
  document.body.classList.add('deep-dive-active');
  requestAnimationFrame(() => {
    dive.classList.add('is-open');
    dive.querySelector('.deep-dive-panel')?.focus();
  });

  const names = deepPickIds
    .map(id => shortName(allItems.find(item => item.id === id)?.name || id));
  if (title) {
    title.textContent = deepPickIds.length === 2
      ? `${names[0]} vs ${names[1]}`
      : `${deepPickIds.length} ${cfg().label}s · focused`;
  }
  if (isolate) {
    isolate.hidden = deepPickIds.length < 2;
    isolate.textContent = deepPickIds.length === selectedIds.length
      ? 'Already the lineup'
      : 'Use as lineup';
    isolate.disabled = deepPickIds.length === selectedIds.length
      && deepPickIds.every((id, i) => id === selectedIds[i]);
  }

  body.innerHTML = `
    <div class="deep-dive-loading">
      <span class="deep-dive-spinner" aria-hidden="true"></span>
      <p>Building live analysis…</p>
    </div>
  `;

  try {
    const c = cfg();
    const scoreParam = c.scoreOptions ? `&score=${encodeURIComponent(scoreKey)}` : '';
    const data = await api(
      `${c.comparePath}?ids=${encodeURIComponent(deepPickIds.join(','))}&baseline=${encodeURIComponent(deepPickIds[0])}${scoreParam}`,
    );
    if (token !== deepDiveToken || !deepDiveOpen) return;
    renderDeepDive(data);
  } catch (error) {
    if (token !== deepDiveToken) return;
    body.innerHTML = `<p class="deep-dive-error">${error.message || 'Could not load analysis'}</p>`;
  }
}

function isolateDeepPickAsLineup() {
  if (deepPickIds.length < 2) return;
  selectedIds = [...deepPickIds];
  baselineId = selectedIds[0];
  persistSelected();
  closeDeepDive();
  renderAll();
}

function renderDeepDive(data) {
  const body = el('deepDiveBody');
  if (!body || !data?.cards?.length) return;

  const scored = data.cards.map(card => ({
    card,
    score: scoreForCard(card, data),
    value: valuePerEuro(card, data),
    watt: perfPerWatt(card, data),
  }));
  const ranked = [...scored].sort((a, b) => b.score - a.score);
  const winner = ranked[0];
  const runner = ranked[1];
  const max = Math.max(...scored.map(item => item.score), 1);
  const delta = runner && runner.score > 0
    ? Math.round(((winner.score - runner.score) / runner.score) * 1000) / 10
    : 0;

  const years = data.cards.map(card => Number(card.releaseYear)).filter(Number.isFinite);
  const ageGap = years.length >= 2 ? Math.max(...years) - Math.min(...years) : null;
  const bestValue = [...scored].filter(item => item.value != null).sort((a, b) => b.value - a.value)[0];
  const bestWatt = [...scored].filter(item => item.watt != null).sort((a, b) => b.watt - a.watt)[0];

  const insightBits = [
    winner && { label: 'Leads', value: shortName(winner.card.name), note: `${Math.round(winner.score * 10) / 10} score` },
    Number.isFinite(delta) && runner && { label: 'Margin', value: `+${delta}%`, note: `vs ${shortName(runner.card.name)}` },
    bestValue && { label: 'Value', value: shortName(bestValue.card.name), note: `${bestValue.value} / €` },
    bestWatt && { label: 'Efficiency', value: shortName(bestWatt.card.name), note: `${bestWatt.watt} / W` },
    ageGap != null && ageGap > 0 && { label: 'Age gap', value: `${ageGap}y`, note: `${Math.min(...years)} → ${Math.max(...years)}` },
  ].filter(Boolean).slice(0, 4);

  const numericRows = (data.rows || [])
    .filter(row => row.kind === 'number' && row.values.some(v => v.value != null))
    .slice(0, data.cards.length === 2 ? 10 : 8);

  body.replaceChildren();

  const arena = document.createElement('div');
  arena.className = `deep-arena${data.cards.length === 2 ? ' is-duo' : ''}`;
  scored.forEach((item, index) => {
    const theme = brandTheme(item.card);
    const pct = Math.round((item.score / max) * 1000) / 10;
    const isLead = item.card.id === winner?.card.id;
    const side = document.createElement('article');
    side.className = `deep-arena-card${isLead ? ' is-lead' : ''}`;
    side.style.setProperty('--part-accent', theme.accent);
    side.style.setProperty('--part-glow', theme.glow);
    side.style.setProperty('--arena-delay', `${index * 0.06}s`);
    side.innerHTML = `
      <div class="deep-arena-top">
        <span class="deep-arena-place">${isLead ? 'LEAD' : `#${ranked.findIndex(r => r.card.id === item.card.id) + 1}`}</span>
        <span class="deep-arena-brand">${item.card.brand || cfg().label}</span>
      </div>
      <h3 title="${item.card.name}">${shortName(item.card.name)}</h3>
      <div class="deep-arena-score">
        <strong data-count="${item.score}">0</strong>
        <span>${data.scoreLabel || 'Score'}</span>
      </div>
      <div class="deep-arena-bar" aria-hidden="true">
        <span style="--bar-pct:${pct}%"></span>
      </div>
      <div class="deep-arena-meta">
        ${item.value != null ? `<span>${item.value} / €</span>` : ''}
        ${item.watt != null ? `<span>${item.watt} / W</span>` : ''}
        ${item.card.releaseYear ? `<span>${item.card.releaseYear}</span>` : ''}
      </div>
    `;
    arena.append(side);
  });
  if (data.cards.length === 2) {
    const mid = document.createElement('div');
    mid.className = 'deep-arena-vs';
    mid.innerHTML = `<span>VS</span><strong data-count-delta="${delta}">0%</strong>`;
    arena.append(mid);
  }
  body.append(arena);

  if (insightBits.length) {
    const strip = document.createElement('div');
    strip.className = 'deep-insight-strip';
    insightBits.forEach((bit, i) => {
      const card = document.createElement('article');
      card.className = 'deep-insight-card';
      card.style.setProperty('--insight-delay', `${0.08 + i * 0.05}s`);
      card.innerHTML = `
        <p>${bit.label}</p>
        <strong>${bit.value}</strong>
        <span>${bit.note}</span>
      `;
      strip.append(card);
    });
    body.append(strip);
  }

  if (numericRows.length) {
    const metrics = document.createElement('div');
    metrics.className = 'deep-metric-list';
    const head = document.createElement('div');
    head.className = 'deep-metric-list-head';
    head.innerHTML = `<h3>Metric breakdown</h3><p>Live deltas vs the weaker side</p>`;
    metrics.append(head);

    numericRows.forEach((row, rowIndex) => {
      if (data.cards.length === 2) {
        const a = Number(row.values[0]?.value);
        const b = Number(row.values[1]?.value);
        if (!Number.isFinite(a) && !Number.isFinite(b)) return;
        const higherBetter = row.higherBetter !== false;
        const aBest = Number.isFinite(a) && Number.isFinite(b)
          ? (higherBetter ? a >= b : a <= b)
          : Number.isFinite(a);
        const bBest = Number.isFinite(a) && Number.isFinite(b)
          ? (higherBetter ? b >= a : b <= a)
          : Number.isFinite(b);
        const headDelta = Number.isFinite(a) && Number.isFinite(b) && b !== 0
          ? {
            pct: Math.round(((a - b) / Math.abs(b)) * 1000) / 10,
            better: higherBetter ? a > b : a < b,
            equal: a === b,
          }
          : null;
        const headDeltaB = headDelta
          ? { pct: headDelta.pct === 0 ? 0 : -headDelta.pct, better: !headDelta.better && !headDelta.equal, equal: headDelta.equal }
          : null;
        const rowEl = document.createElement('div');
        rowEl.className = `deep-metric-row${KEY_METRIC_KEYS.has(row.key) ? ' is-key' : ''}`;
        rowEl.style.setProperty('--metric-delay', `${0.12 + rowIndex * 0.04}s`);
        rowEl.innerHTML = `
          <div class="deep-metric-side ${aBest ? 'is-best' : ''}">
            <strong>${formatValue(row.values[0]?.value, row.kind, row.unit)}</strong>
            <span class="${toneClass(headDelta)}">${formatPct(headDelta) || ''}</span>
          </div>
          <div class="deep-metric-label">
            <strong>${row.label}</strong>
            ${row.unit ? `<small>${row.unit}</small>` : ''}
          </div>
          <div class="deep-metric-side is-right ${bBest ? 'is-best' : ''}">
            <strong>${formatValue(row.values[1]?.value, row.kind, row.unit)}</strong>
            <span class="${toneClass(headDeltaB)}">${formatPct(headDeltaB) || ''}</span>
          </div>
        `;
        metrics.append(rowEl);
      } else {
        const { leader, ranked: metricRanked } = metricLeaderEntries(row, data.cards);
        const panel = document.createElement('div');
        panel.className = `deep-metric-board${KEY_METRIC_KEYS.has(row.key) ? ' is-key' : ''}`;
        panel.style.setProperty('--metric-delay', `${0.12 + rowIndex * 0.04}s`);
        panel.innerHTML = `
          <div class="deep-metric-board-head">
            <strong>${row.label}</strong>
            <span>${leader ? `${shortName(leader.card.name)} leads` : (row.unit || '')}</span>
          </div>
          <div class="deep-metric-board-cols">
            ${metricRanked.map(item => `
              <div class="deep-metric-board-col${item.place === 1 ? ' is-best' : ''}">
                <em>${shortName(item.card.name)}</em>
                <strong>${formatValue(item.raw, row.kind, row.unit)}</strong>
                <span class="${toneClass(item.delta)}">${item.delta?.equal ? 'best' : (formatPct(item.delta) || '—')}</span>
              </div>
            `).join('')}
          </div>
        `;
        metrics.append(panel);
      }
    });
    body.append(metrics);
  }

  body.querySelectorAll('[data-count]').forEach((node, i) => {
    countUp(node, Number(node.dataset.count), 700 + i * 90);
  });
  const deltaNode = body.querySelector('[data-count-delta]');
  if (deltaNode) {
    const target = Number(deltaNode.dataset.countDelta);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      deltaNode.textContent = `+${target}%`;
    } else {
      const start = performance.now();
      const tick = (now) => {
        const t = Math.min(1, (now - start) / 900);
        const eased = 1 - (1 - t) ** 3;
        deltaNode.textContent = `+${Math.round(target * eased * 10) / 10}%`;
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  }
  requestAnimationFrame(() => {
    body.querySelectorAll('.deep-arena-bar > span').forEach(bar => {
      bar.classList.add('is-on');
    });
  });
}

function renderQuickAdd() {
  const box = el('quickAddSelected');
  if (!box) return;
  pruneDeepPicks();
  box.replaceChildren();

  const cards = selectedItems();
  if (!cards.length) {
    const hint = document.createElement('div');
    hint.className = 'contestant-card is-empty';
    hint.textContent = 'No contestants yet — add parts to start';
    box.append(hint);
    updateDeepCompareChrome();
    return;
  }

  const places = contestPlaceMap();
  const data = lastCompareData;
  cards.forEach((card, index) => {
    const place = places.get(card.id) || index + 1;
    const picked = deepPickIds.includes(card.id);
    const pickOrder = picked ? deepPickIds.indexOf(card.id) + 1 : 0;
    const theme = brandTheme(card);
    const score = scoreForCard(card, data);
    const article = document.createElement('article');
    article.className = `contestant-card${place === 1 ? ' is-top' : ''}${picked ? ' is-picked' : ''}`;
    article.style.setProperty('--part-accent', theme.accent);
    article.style.setProperty('--part-glow', theme.glow);
    article.style.setProperty('--card-delay', `${index * 0.04}s`);
    article.tabIndex = 0;
    article.setAttribute('role', 'button');
    article.setAttribute('aria-pressed', picked ? 'true' : 'false');
    article.title = picked ? `Selected for deep compare · ${card.name}` : `Select ${card.name} for deep compare`;
    article.innerHTML = `
      <span class="contestant-card-check" aria-hidden="true">${picked ? pickOrder : ''}</span>
      <span class="contestant-card-place">${place === 1 ? 'TOP' : `#${place}`}</span>
      <span class="contestant-card-brand">${card.brand || cfg().label}</span>
      <strong class="contestant-card-name" title="${card.name}">${shortName(card.name)}</strong>
      <span class="contestant-card-score">${Number.isFinite(score) ? Math.round(score * 10) / 10 : '—'}</span>
      <span class="contestant-card-meta">${data?.scoreLabel || 'Score'}</span>
    `;
    const activate = () => toggleDeepPick(card.id);
    article.addEventListener('click', activate);
    article.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        activate();
      }
    });

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'contestant-card-remove';
    remove.setAttribute('aria-label', `Remove ${card.name}`);
    remove.textContent = '×';
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      removeItem(card.id);
    });
    article.append(remove);
    box.append(article);
  });
  updateDeepCompareChrome();
  // Keep duel-card pick badges in sync when only the deck re-renders.
  document.querySelectorAll('.duel-card[data-contestant-id]').forEach((card) => {
    const on = deepPickIds.includes(card.dataset.contestantId);
    card.classList.toggle('is-picked', on);
    card.setAttribute('aria-pressed', on ? 'true' : 'false');
    let badge = card.querySelector('.duel-pick-badge');
    if (on) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'duel-pick-badge';
        badge.setAttribute('aria-hidden', 'true');
        card.append(badge);
      }
      badge.textContent = String(deepPickIds.indexOf(card.dataset.contestantId) + 1);
    } else if (badge) {
      badge.remove();
    }
  });
}

async function prefetchCounts() {
  try {
    const [gpus, cpus, ssds, hdds] = await Promise.all([
      api('/api/gpus'),
      api('/api/cpus'),
      api('/api/ssds'),
      api('/api/hdds'),
    ]);
    catalogCounts.gpu = gpus.count ?? gpus.gpus?.length ?? 0;
    catalogCounts.cpu = cpus.count ?? cpus.cpus?.length ?? 0;
    catalogCounts.ssd = ssds.count ?? ssds.ssds?.length ?? 0;
    catalogCounts.hdd = hdds.count ?? hdds.hdds?.length ?? 0;
    updateCatalogCounts();
  } catch {
    /* ignore */
  }
}

async function loadCategoryData() {
  const c = cfg();
  updateCategoryChrome();
  activeSeries = '';
  selectedIds = loadSelectedIds(category);
  baselineId = selectedIds[0] || c.defaultBaseline;
  scoreKey = c.defaultScore;
  if (c.scoreOptions) el('scoreSelect').value = scoreKey;
  el('partSearch').value = '';

  const data = await api(c.listPath);
  allItems = Array.isArray(data[c.itemsKey]) ? data[c.itemsKey] : [];
  seriesList = Array.isArray(data.series) ? data.series : [];
  catalogCounts[category] = data.count ?? allItems.length;
  updateCatalogCounts();
  el('compareMeta').textContent = `${allItems.length} ${c.label}s · ${c.metaScore}`;
  selectedIds = selectedIds.filter(id => allItems.some(item => item.id === id));
  if (!selectedIds.includes(baselineId)) baselineId = selectedIds[0] || data.baselineId || c.defaultBaseline;
  persistSelected();
  renderSeriesFilters();
  renderAll();
}

async function switchCategory(next) {
  if (!CATEGORIES[next] || next === category) return;
  category = next;
  deepPickIds = [];
  closeDeepDive();
  persistCategory();
  try {
    await loadCategoryData();
  } catch (error) {
    el('compareMeta').textContent = error.message;
  }
}

function loadPresetLadder() {
  const ids = (cfg().ladderIds || cfg().presetIds)
    .filter(id => allItems.some(item => item.id === id))
    .slice(0, MAX_CARDS);
  selectedIds = ids;
  baselineId = selectedIds[0] || cfg().defaultBaseline;
  persistSelected();
  setPickerOpen(false);
  renderAll();
}

function loadDuelPreset() {
  selectedIds = cfg().presetIds
    .filter(id => allItems.some(item => item.id === id))
    .slice(0, 2);
  baselineId = selectedIds[0] || cfg().defaultBaseline;
  persistSelected();
  setPickerOpen(false);
  renderAll();
}

document.querySelectorAll('.part-switch-btn').forEach(btn => {
  btn.addEventListener('click', () => switchCategory(btn.dataset.category));
});

function swapSides() {
  if (selectedIds.length !== 2) return;
  selectedIds = [selectedIds[1], selectedIds[0]];
  persistSelected();
  renderAll();
}

async function copyShareLink() {
  syncShareUrl();
  const btn = el('shareCompare');
  try {
    await navigator.clipboard.writeText(window.location.href);
    const prev = btn.textContent;
    btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = prev; }, 1200);
  } catch {
    btn.textContent = 'Copy failed';
    setTimeout(() => { btn.textContent = 'Share'; }, 1200);
  }
}

el('partSearch').addEventListener('input', () => renderPicker());
el('scoreSelect').addEventListener('change', () => {
  scoreKey = el('scoreSelect').value || 'relativeMulti';
  renderComparison();
});
el('clearCompare').addEventListener('click', () => {
  selectedIds = [];
  baselineId = '';
  deepPickIds = [];
  closeDeepDive();
  persistSelected();
  renderAll();
});
el('presetLadder').addEventListener('click', loadPresetLadder);
el('presetLadderEmpty').addEventListener('click', () => {
  if (cfg().presetIds?.length >= 2) loadDuelPreset();
  else loadPresetLadder();
});
el('togglePicker').addEventListener('click', () => setPickerOpen(!pickerOpen));
el('closePicker').addEventListener('click', () => setPickerOpen(false));
el('pickerBackdrop').addEventListener('click', () => setPickerOpen(false));
el('openPickerEmpty').addEventListener('click', () => setPickerOpen(true));
el('shareCompare').addEventListener('click', copyShareLink);
el('swapCompare').addEventListener('click', swapSides);
el('sortRankLtr')?.addEventListener('click', () => sortContestantsByRank('ltr'));
el('sortRankRtl')?.addEventListener('click', () => sortContestantsByRank('rtl'));
el('clearDeepPick')?.addEventListener('click', clearDeepPick);
el('runDeepCompare')?.addEventListener('click', () => openDeepDive());
el('closeDeepDive')?.addEventListener('click', closeDeepDive);
el('deepDiveBackdrop')?.addEventListener('click', closeDeepDive);
el('deepDiveIsolate')?.addEventListener('click', isolateDeepPickAsLineup);

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (deepDiveOpen) {
    closeDeepDive();
    return;
  }
  if (pickerOpen) setPickerOpen(false);
});

(async function bootstrap() {
  el('pickerDrawer').inert = true;
  applyDisplayMode(displayMode);
  document.querySelectorAll('.display-mode-btn').forEach(btn => {
    btn.addEventListener('click', () => applyDisplayMode(btn.dataset.display));
  });
  const urlIds = readShareUrl();
  persistCategory();
  prefetchCounts();
  try {
    await loadCategoryData();
    if (urlIds.length >= 2) {
      selectedIds = urlIds.filter(id => allItems.some(item => item.id === id)).slice(0, MAX_CARDS);
      baselineId = selectedIds[0] || cfg().defaultBaseline;
      persistSelected();
      renderAll();
    } else if (selectedIds.length < 2 && category === 'gpu') {
      const seeded = cfg().presetIds.filter(id => allItems.some(item => item.id === id));
      if (seeded.length >= 2) {
        selectedIds = seeded.slice(0, 2);
        baselineId = selectedIds[0];
        persistSelected();
        renderAll();
      }
    }
  } catch (error) {
    el('compareMeta').textContent = error.message;
  }
})();
