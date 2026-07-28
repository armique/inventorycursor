const el = (id) => document.getElementById(id);

function euros(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(n);
}

function timeLeft(endDate) {
  if (!endDate) return '';
  const end = new Date(endDate).getTime();
  if (!Number.isFinite(end)) return '';
  const ms = end - Date.now();
  if (ms <= 0) return 'Ended';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m left`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h left`;
  return `${Math.round(hours / 24)}d left`;
}

function listedLabel(originDate) {
  if (!originDate) return '';
  const t = new Date(originDate).getTime();
  if (!Number.isFinite(t)) return '';
  const hours = Math.round((Date.now() - t) / 3600000);
  if (hours < 1) return 'Just listed';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

async function api(path) {
  const url = typeof path === 'string' && path.startsWith('/api/') && !path.startsWith('/api/est')
    ? `/api/est${path.slice(4)}`
    : path;
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function collectBuyingOptions() {
  return [...document.querySelectorAll('input[name="buying"]:checked')].map((input) => input.value);
}

function currentQuery() {
  return {
    query: el('queryInput').value.trim(),
    minPrice: el('minPrice').value,
    maxPrice: el('maxPrice').value,
    minFeedback: el('minFeedback').value,
    condition: el('condition').value,
    categoryId: el('categoryId').value.trim(),
    categoryName: el('categoryName').value.trim(),
    buyingOptions: collectBuyingOptions(),
    freeShipping: el('freeShipping').checked,
    returnsAccepted: el('returnsAccepted').checked,
    locatedInDE: el('locatedInDE').checked,
    sort: el('sort').value,
  };
}

function buildParams(q) {
  const params = new URLSearchParams({
    query: q.query,
    minPrice: String(q.minPrice || 0),
    maxPrice: String(q.maxPrice || 500),
    minFeedback: String(q.minFeedback || 0),
    condition: q.condition || 'any',
    sort: q.sort || 'newlyListed',
  });
  if (q.categoryId) params.set('categoryId', q.categoryId);
  if (q.categoryName) params.set('categoryName', q.categoryName);
  if (q.buyingOptions.length) params.set('buyingOptions', q.buyingOptions.join(','));
  if (q.freeShipping) params.set('freeShipping', '1');
  if (q.returnsAccepted) params.set('returnsAccepted', '1');
  if (q.locatedInDE) params.set('locatedInDE', '1');
  return params;
}

function setListingImage(node, item) {
  const img = node.querySelector('.listing-image img');
  const fallback = node.querySelector('.listing-fallback');
  if (item.image) {
    img.src = item.image;
    img.alt = item.title || '';
    img.hidden = false;
    fallback.hidden = true;
  } else {
    img.hidden = true;
    fallback.hidden = false;
  }
}

function exploreFingerprint(q) {
  return [
    String(q.query || '').trim().toLowerCase(),
    String(q.categoryId || ''),
    String(q.condition || 'any'),
    String(q.minPrice || 0),
    String(q.maxPrice || ''),
    String(q.minFeedback || 0),
    (q.buyingOptions || []).slice().sort().join('|'),
    q.freeShipping ? '1' : '0',
    q.returnsAccepted ? '1' : '0',
    q.locatedInDE ? '1' : '0',
    String(q.sort || 'newlyListed'),
  ].join('::');
}

function annotateClientFreshness(q, items) {
  const list = Array.isArray(items) ? items : [];
  if (list.some((item) => Object.prototype.hasOwnProperty.call(item, 'isNew'))) {
    return list;
  }
  const key = `explore::${exploreFingerprint(q)}`;
  let map = {};
  try {
    map = JSON.parse(localStorage.getItem('dealwatch-explore-seen') || '{}') || {};
  } catch {
    map = {};
  }
  const known = map[key];
  const isFirstPass = !known;
  const seen = new Set(known || []);
  const annotated = list.map((item) => {
    const id = item?.id ? String(item.id) : '';
    return {
      ...item,
      isNew: Boolean(id && !isFirstPass && !seen.has(id)),
    };
  });
  const ids = annotated.map((item) => String(item.id)).filter(Boolean);
  map[key] = [...new Set([...ids, ...(known || [])])].slice(0, 2000);
  const keys = Object.keys(map);
  if (keys.length > 40) {
    keys.slice(0, keys.length - 40).forEach((k) => { delete map[k]; });
  }
  try {
    localStorage.setItem('dealwatch-explore-seen', JSON.stringify(map));
  } catch {
    /* ignore quota */
  }
  return annotated;
}

function fillCard(node, item) {
  const card = node.querySelector('.listing-card');
  const offerBadge = node.querySelector('.offer-badge');
  const newBadge = node.querySelector('.new-badge');
  const offerHint = node.querySelector('.offer-hint');
  const hasOffer = Boolean(item.bestOffer);
  const isNew = Boolean(item.isNew);

  card.classList.toggle('has-best-offer', hasOffer);
  card.classList.toggle('is-new', isNew);
  offerBadge.hidden = !hasOffer;
  if (newBadge) newBadge.hidden = !isNew;
  offerHint.hidden = !hasOffer;

  const parts = [];
  if (isNew) parts.push('New');
  if (item.isAuction) parts.push('Auction');
  else parts.push('Buy It Now');
  if (hasOffer) parts.push('Best Offer');
  node.querySelector('.deal-label').textContent = parts.join(' · ');

  const listedEl = node.querySelector('.listed-at');
  const listedText = listedLabel(item.originDate);
  if (listedEl) {
    listedEl.hidden = !listedText;
    listedEl.textContent = listedText;
  }
  node.querySelector('.time-left').textContent = timeLeft(item.endDate);
  node.querySelector('.listing-title').textContent = item.title;
  const feedback = Number(item.feedback);
  node.querySelector('.seller').textContent = Number.isFinite(feedback)
    ? `${item.seller || 'Seller'} (${feedback})`
    : (item.seller || 'Seller');
  node.querySelector('.condition').textContent = item.condition || '—';
  node.querySelector('.total-price').textContent = euros(item.total ?? item.price);
  node.querySelector('.shipping').textContent = item.shippingKnown === false
    ? 'shipping not listed'
    : `incl. shipping ${euros(item.shipping)}`;
  node.querySelector('.offer-link').href = item.url;
  setListingImage(node, item);
}

function renderResults(items) {
  const grid = el('exploreGrid');
  const template = el('listingTemplate');
  grid.replaceChildren();
  const ordered = [...items].sort((a, b) => Number(Boolean(b.isNew)) - Number(Boolean(a.isNew)));
  ordered.forEach((item) => {
    const node = template.content.cloneNode(true);
    fillCard(node, item);
    grid.append(node);
  });
  el('exploreEmpty').hidden = items.length !== 0;
  el('exploreEmpty').textContent = items.length ? '' : 'No listings matched these filters.';
}

let categoryTimer = null;
let searching = false;

function clearCategory() {
  el('categoryId').value = '';
  el('categoryName').value = '';
  el('categoryChosen').hidden = true;
  el('categoryChosen').textContent = '';
}

function chooseCategory(cat) {
  el('categoryId').value = cat.id || '';
  el('categoryName').value = cat.name || '';
  el('categorySearch').value = '';
  el('categoryPicks').hidden = true;
  el('categoryPicks').replaceChildren();
  if (cat.id) {
    el('categoryChosen').hidden = false;
    el('categoryChosen').textContent = `${cat.path || cat.name} · clear to search all eBay.de`;
    el('categoryChosen').onclick = () => {
      clearCategory();
    };
    el('categoryChosen').style.cursor = 'pointer';
    el('categoryChosen').title = 'Click to clear category';
  } else {
    clearCategory();
  }
}

async function searchCategories(q) {
  const picks = el('categoryPicks');
  if (!q || q.length < 2) {
    picks.hidden = true;
    picks.replaceChildren();
    return;
  }
  try {
    const data = await api(`/api/categories?q=${encodeURIComponent(q)}`);
    const items = data.results || [];
    picks.replaceChildren();
    if (!items.length) {
      picks.hidden = true;
      return;
    }
    items.slice(0, 12).forEach((cat) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = cat.pathLabel || cat.name || cat.id;
      btn.addEventListener('click', () => chooseCategory({
        id: cat.id,
        name: cat.name,
        path: cat.pathLabel || cat.name,
      }));
      picks.append(btn);
    });
    picks.hidden = false;
  } catch {
    picks.hidden = true;
  }
}

async function runSearch(event) {
  event?.preventDefault();
  if (searching) return;
  const q = currentQuery();
  if (!q.query && !q.categoryId) {
    el('resultSummary').textContent = 'Enter keywords or pick a category.';
    el('exploreMeta').textContent = 'Keywords or category required.';
    return;
  }

  searching = true;
  const button = el('searchButton');
  button.disabled = true;
  button.textContent = 'Searching…';
  el('resultSummary').textContent = 'Searching eBay.de…';
  el('exploreMeta').textContent = 'Searching…';

  try {
    const data = await api(`/api/explore?${buildParams(q)}`);
    const items = annotateClientFreshness(q, data.items || []);
    const newCount = Number.isFinite(data.newCount)
      ? data.newCount
      : items.filter((item) => item.isNew).length;
    renderResults(items);
    const catBit = q.categoryName ? ` in ${q.categoryName}` : '';
    el('resultSummary').textContent = `${items.length} result${items.length === 1 ? '' : 's'}${catBit}`
      + (newCount ? ` · ${newCount} new` : '')
      + (data.totalAvailable != null ? ` · ~${data.totalAvailable} on eBay` : '')
      + (data.scanned != null ? ` · scanned ${data.scanned}` : '');
    el('exploreMeta').textContent = `Updated ${new Date(data.checkedAt || Date.now()).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
    if (data.ebayUrl) {
      el('ebayLink').href = data.ebayUrl;
    }
    const url = new URL(window.location.href);
    url.search = buildParams(q).toString();
    history.replaceState(null, '', url);
  } catch (error) {
    renderResults([]);
    el('exploreEmpty').hidden = false;
    el('exploreEmpty').textContent = error.message;
    el('resultSummary').textContent = error.message;
    el('exploreMeta').textContent = 'Search failed';
  } finally {
    searching = false;
    button.disabled = false;
    button.textContent = 'Search eBay.de';
  }
}

function hydrateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('query')) el('queryInput').value = params.get('query');
  if (params.get('minPrice') != null) el('minPrice').value = params.get('minPrice');
  if (params.get('maxPrice') != null) el('maxPrice').value = params.get('maxPrice');
  if (params.get('minFeedback') != null) el('minFeedback').value = params.get('minFeedback');
  if (params.get('condition')) el('condition').value = params.get('condition');
  if (params.get('sort')) el('sort').value = params.get('sort');
  if (params.get('categoryId')) {
    el('categoryId').value = params.get('categoryId');
    el('categoryName').value = params.get('categoryName') || params.get('categoryId');
    el('categoryChosen').hidden = false;
    el('categoryChosen').textContent = `${el('categoryName').value} · clear to search all eBay.de`;
    el('categoryChosen').onclick = () => clearCategory();
    el('categoryChosen').style.cursor = 'pointer';
  }
  el('freeShipping').checked = params.get('freeShipping') === '1';
  el('returnsAccepted').checked = params.get('returnsAccepted') === '1';
  el('locatedInDE').checked = params.get('locatedInDE') === '1';
  const buying = String(params.get('buyingOptions') || '').split(',').filter(Boolean);
  if (buying.length) {
    document.querySelectorAll('input[name="buying"]').forEach((input) => {
      input.checked = buying.includes(input.value);
    });
  }
  if (params.get('query') || params.get('categoryId')) {
    runSearch();
  }
}

el('exploreForm').addEventListener('submit', runSearch);
el('categorySearch').addEventListener('input', () => {
  clearTimeout(categoryTimer);
  const q = el('categorySearch').value.trim();
  categoryTimer = setTimeout(() => searchCategories(q), 220);
});

hydrateFromUrl();
