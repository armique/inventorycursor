/* global periodBounds, normalizeConversation, normalizeMessages, detectDealSuggestions,
   pageResolveUserId, pageFetchJson, pageFindAccessToken, pageWaitForInbox,
   pageScrapeInboxDom, pageClickConversation, pageExtractChatPrice, parseMessageDate,
   mergeInboxDomIntoConversations, inRange, extractDirektPaidAmount, extractDirektBuyTotal,
   extractDirektSellTotal, extractHighestEuroAmount, coercePrice */

importScripts('lib.js');

const KA_ORIGIN = 'https://www.kleinanzeigen.de';
const KA_MESSAGE_URLS = [
  `${KA_ORIGIN}/m-nachrichten.html`,
  `${KA_ORIGIN}/messagebox`,
  `${KA_ORIGIN}/mein-kleinanzeigen/nachrichten`,
];
const GATEWAY = 'https://gateway.kleinanzeigen.de/messagebox/api/users';

/** Captured from SPA messagebox requests (Bearer). */
let cachedAuthToken = '';
/** conversationId -> raw API payload */
const hookedConversations = new Map();

chrome.storage.local.get(['kaAuthToken']).then((data) => {
  if (data.kaAuthToken) cachedAuthToken = String(data.kaAuthToken);
}).catch(() => {});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'ka-hook') {
    ingestHookPayload(message.payload);
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === 'scan-deals' || message?.type === 'scan-purchases') {
    scanDeals(message.period || 'today')
      .then(async (result) => {
        const status = (result.buys?.length || result.sells?.length)
          ? `Suggestions: ${result.buys.length} buy · ${result.sells.length} sell · ${result.label} · ${result.inPeriodConversations || result.scannedConversations} in range · API ${result.apiLoaded || 0} · DOM fallback ${result.openedChats || 0}.`
          : `No deal-like chats in ${String(result.label || message.period || 'today').toLowerCase()}.`;
        await chrome.storage.local.set({
          lastScan: {
            ok: true,
            period: result.period,
            buys: result.buys || [],
            sells: result.sells || [],
            status,
            statusKind: (result.buys?.length || result.sells?.length) ? 'ok' : '',
            openedChats: result.openedChats || 0,
            apiLoaded: result.apiLoaded || 0,
            inPeriodConversations: result.inPeriodConversations || 0,
            scannedConversations: result.scannedConversations || 0,
            label: result.label,
            at: Date.now(),
          },
          scanInProgress: false,
        });
        sendResponse({ ok: true, ...result });
      })
      .catch(async (error) => {
        await chrome.storage.local.set({
          lastScan: {
            ok: false,
            error: error.message || String(error),
            status: error.message || String(error),
            statusKind: 'error',
            buys: [],
            sells: [],
            at: Date.now(),
          },
          scanInProgress: false,
        });
        sendResponse({ ok: false, error: error.message || String(error) });
      });
    chrome.storage.local.set({ scanInProgress: true });
    return true;
  }
  if (message?.type === 'confirm-deals' || message?.type === 'push-purchases') {
    confirmDeals(message)
      .then(result => sendResponse({ ok: true, ...result }))
      .catch(error => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }
  return false;
});

function ingestHookPayload(payload) {
  if (!payload || typeof payload !== 'object') return;
  if (payload.type === 'auth' && payload.token) {
    cachedAuthToken = String(payload.token).replace(/^Bearer\s+/i, '').trim();
    chrome.storage.local.set({ kaAuthToken: cachedAuthToken }).catch(() => {});
  }
  if (payload.type === 'response' && payload.url) {
    const idMatch = String(payload.url).match(/\/conversations\/([a-zA-Z0-9_-]+)(?:\?|$)/i);
    if (idMatch && payload.data) {
      hookedConversations.set(idMatch[1], payload.data);
    }
  }
}
function waitForTabComplete(tabId) {
  return waitForTabUrl(tabId, null);
}

/**
 * Wait until the tab finishes loading. If urlPattern is set, require that URL
 * (avoids resolving on the previous page right after tabs.update).
 */
function waitForTabUrl(tabId, urlPattern = null, timeoutMs = 20000) {
  return new Promise(resolve => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    };
    const timeout = setTimeout(finish, timeoutMs);

    function urlOk(url) {
      if (!urlPattern) return true;
      return urlPattern.test(String(url || ''));
    }

    function listener(id, info, tab) {
      if (id !== tabId) return;
      if (info.status === 'complete' && urlOk(tab?.url || info.url)) finish();
    }

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.get(tabId).then(tab => {
      if (tab.status === 'complete' && urlOk(tab.url)) finish();
    }).catch(() => finish());
  });
}

function isNachrichtenUrl(url) {
  return /m-nachrichten|messagebox|nachricht/i.test(String(url || ''));
}

function isKleinanzeigenUrl(url) {
  return /kleinanzeigen\.de/i.test(String(url || ''));
}

/** Navigate a tab to Nachrichten and wait until that page actually loaded. */
async function navigateToNachrichten(tabId) {
  const target = KA_MESSAGE_URLS[0];
  const pattern = /m-nachrichten|messagebox|nachricht/i;

  const current = await chrome.tabs.get(tabId).catch(() => null);
  if (current && isNachrichtenUrl(current.url) && current.status === 'complete') {
    return tabId;
  }

  // Attach listener before update so we never miss the complete event.
  const waited = waitForTabUrl(tabId, pattern, 20000);
  await chrome.tabs.update(tabId, { url: target, active: true });
  await waited;
  await sleep(900);
  return tabId;
}

async function ensureKaTab() {
  // Prefer the tab the user is looking at (popup opens on that window).
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active?.id && isKleinanzeigenUrl(active.url)) {
    if (!isNachrichtenUrl(active.url)) {
      await navigateToNachrichten(active.id);
    }
    return active.id;
  }

  const tabs = await chrome.tabs.query({ url: ['https://www.kleinanzeigen.de/*'] });
  const messagesTab = tabs.find(tab => isNachrichtenUrl(tab.url));
  if (messagesTab?.id) {
    await chrome.tabs.update(messagesTab.id, { active: true });
    if (messagesTab.status !== 'complete') {
      await waitForTabUrl(messagesTab.id, /m-nachrichten|messagebox|nachricht/i);
    }
    return messagesTab.id;
  }
  if (tabs[0]?.id) {
    await navigateToNachrichten(tabs[0].id);
    return tabs[0].id;
  }

  // Not on Kleinanzeigen at all — open Nachrichten, then caller starts parsing.
  const tab = await chrome.tabs.create({ url: KA_MESSAGE_URLS[0], active: true });
  await waitForTabUrl(tab.id, /m-nachrichten|messagebox|nachricht/i);
  await sleep(900);
  return tab.id;
}

async function openNachrichten(tabId) {
  // Ensure fetch hook is present even if the tab was open before extension reload.
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: 'MAIN',
      files: ['inject-hook.js'],
    });
  } catch {
    /* ignore */
  }

  const tab = await chrome.tabs.get(tabId);
  if (!isNachrichtenUrl(tab.url)) {
    await navigateToNachrichten(tabId);
  } else {
    await sleep(500);
  }
  const waits = await runInAllFrames(tabId, pageWaitForInbox, [12000]);
  if (!waits.some(Boolean)) {
    await chrome.tabs.reload(tabId);
    await waitForTabUrl(tabId, /m-nachrichten|messagebox|nachricht/i);
    await sleep(1000);
    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        world: 'MAIN',
        files: ['inject-hook.js'],
      });
    } catch {
      /* ignore */
    }
    await runInAllFrames(tabId, pageWaitForInbox, [10000]);
  }
}

async function runInPage(tabId, func, args = []) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: false },
    world: 'MAIN',
    func,
    args,
  });
  return results?.[0]?.result;
}

async function runInAllFrames(tabId, func, args = []) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: 'MAIN',
    func,
    args,
  });
  return (results || []).map(entry => entry.result).filter(value => value != null);
}

/** Prefer Direkt cue totals (Artikel bezahlt / Geld ausgezahlt / Preis). */
async function extractPriceInTab(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: 'MAIN',
    func: pageExtractChatPrice,
  }).catch(() => []);
  let best = null;
  for (const entry of results || []) {
    const r = entry?.result;
    if (!r || r.price == null || r.source === 'none') continue;
    best = r.price;
    if (r.source === 'artikel-bezahlt' || r.source === 'geld-ausgezahlt') break;
  }
  return best;
}

async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'ka-status' });
    return;
  } catch {
    /* inject */
  }
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ['content.js'],
    });
  } catch {
    /* ignore */
  }
}

async function scrapeViaContentScript(tabId) {
  await ensureContentScript(tabId);
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'scrape-inbox' });
    if (res?.ok && Array.isArray(res.items) && res.items.length) {
      return { items: res.items, debug: res.debug || null };
    }
    return { items: [], debug: res?.debug || null };
  } catch {
    return { items: [], debug: null };
  }
}

async function loadConversationsFromDom(tabId) {
  await openNachrichten(tabId);

  // Prefer content-script scrape (stable; helpers live in the page context).
  let content = await scrapeViaContentScript(tabId);
  let domItems = content.items || [];
  let frameResults = [];

  if (!domItems.length) {
    frameResults = await runInAllFrames(tabId, pageScrapeInboxDom);
    domItems = flattenScrapeResults(frameResults);
  }
  if (!domItems.length) {
    await sleep(1500);
    content = await scrapeViaContentScript(tabId);
    domItems = content.items || [];
  }
  if (!domItems.length) {
    frameResults = await runInAllFrames(tabId, pageScrapeInboxDom);
    domItems = flattenScrapeResults(frameResults);
  }

  if (!domItems.length) {
    const debugParts = [];
    if (content.debug) {
      debugParts.push(
        `content ${content.debug.href || '?'} paid=${content.debug.bodyHasPaid} reserved=${content.debug.bodyHasReserved} snip=${JSON.stringify(content.debug.bodySnippet || '')}`,
      );
    }
    for (const r of frameResults || []) {
      if (!r?.debug) continue;
      debugParts.push(
        `frame ${r.debug.href || '?'} paid=${r.debug.bodyHasPaid} reserved=${r.debug.bodyHasReserved} snip=${JSON.stringify(r.debug.bodySnippet || '')}`,
      );
    }
    const debug = debugParts.join(' | ');
    throw new Error(
      debug
        ? `Could not parse inbox rows from the open Nachrichten page. Debug: ${debug.slice(0, 500)}`
        : 'Could not read your Nachrichten inbox. Keep https://www.kleinanzeigen.de/m-nachrichten.html focused while logged in, reload the extension on chrome://extensions, then scan again.',
    );
  }
  return mergeInboxDomIntoConversations([], domItems);
}

function flattenScrapeResults(frameResults) {
  const items = [];
  for (const result of frameResults || []) {
    if (Array.isArray(result)) items.push(...result);
    else if (Array.isArray(result?.items)) items.push(...result.items);
  }
  // Prefer paid/reserved rows first, unique by seller+title+time.
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = `${item.id || ''}|${item.counterparty || ''}|${item.title || ''}|${item.whenText || ''}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

async function loadConversationsFromApi(tabId, userId) {
  if (!userId) return { conversations: [], errors: ['no-user-id'] };
  const token = await runInPage(tabId, pageFindAccessToken);
  const errors = [];
  for (const url of [
    `${GATEWAY}/${userId}/conversations?size=50`,
    `${GATEWAY}/${userId}/conversations?page=0&size=50`,
    `${GATEWAY}/${userId}/conversations`,
  ]) {
    const res = await runInPage(tabId, pageFetchJson, [url, token || '']);
    if (!res?.ok) {
      errors.push(`${res?.status || '?'} ${url}`);
      // 401/403 = cookie/token auth not usable from this context — stop trying.
      if (res?.status === 401 || res?.status === 403) break;
      continue;
    }
    const list = extractConversationArray(res.data).map(normalizeConversation).filter(c => c.id);
    if (list.length) return { conversations: list, errors };
    if (res.data && typeof res.data === 'object') {
      const nested = extractConversationArray(res.data.data || {});
      if (nested.length) {
        return {
          conversations: nested.map(normalizeConversation).filter(c => c.id),
          errors,
        };
      }
    }
  }
  return { conversations: [], errors };
}

function extractConversationArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (const key of ['conversations', 'content', 'data', 'items', 'results', 'elements']) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  if (Array.isArray(payload?._embedded?.conversations)) return payload._embedded.conversations;
  return [];
}

async function loadConversations(tabId, userId) {
  // DOM-first: gateway messagebox often returns 401 without app tokens.
  const conversations = await loadConversationsFromDom(tabId);

  try {
    const api = await loadConversationsFromApi(tabId, userId);
    if (api.conversations.length) {
      const frameResults = await runInAllFrames(tabId, pageScrapeInboxDom);
      const domItems = flattenScrapeResults(frameResults);
      return mergeInboxDomIntoConversations(api.conversations, domItems);
    }
  } catch {
    /* API optional */
  }

  return conversations;
}

async function resolveAuthToken(tabId) {
  if (cachedAuthToken) return cachedAuthToken;
  try {
    const fromPage = await runInPage(tabId, pageFindAccessToken);
    if (fromPage) {
      cachedAuthToken = String(fromPage).replace(/^Bearer\s+/i, '').trim();
      chrome.storage.local.set({ kaAuthToken: cachedAuthToken }).catch(() => {});
      return cachedAuthToken;
    }
  } catch {
    /* ignore */
  }
  try {
    await ensureContentScript(tabId);
    const cache = await chrome.tabs.sendMessage(tabId, { type: 'get-hook-cache' });
    if (cache?.token) {
      cachedAuthToken = String(cache.token).replace(/^Bearer\s+/i, '').trim();
      chrome.storage.local.set({ kaAuthToken: cachedAuthToken }).catch(() => {});
      return cachedAuthToken;
    }
  } catch {
    /* ignore */
  }
  return '';
}

async function loadMessages(tabId, userId, conversationId) {
  const cid = String(conversationId || '');
  if (!cid || cid.startsWith('dom-')) {
    return messagesFromHook(cid);
  }

  const hooked = messagesFromHook(cid);
  if (hooked.length) return hooked;

  if (!userId) return [];

  const token = await resolveAuthToken(tabId);
  for (const url of [
    `${GATEWAY}/${userId}/conversations/${encodeURIComponent(cid)}`,
    `${GATEWAY}/${userId}/conversations/${encodeURIComponent(cid)}?size=100`,
  ]) {
    const res = await runInPage(tabId, pageFetchJson, [url, token || '']);
    if (!res?.ok) {
      if (res?.status === 401 || res?.status === 403) continue;
      continue;
    }
    const messages = normalizeMessages(res.data);
    if (messages.length) {
      hookedConversations.set(cid, res.data);
      return messages;
    }
    if (res.data?.messages || res.data?.conversation?.messages) {
      const nested = normalizeMessages(res.data.messages || res.data.conversation.messages);
      if (nested.length) return nested;
    }
  }
  return [];
}

function messagesFromHook(conversationId) {
  const cid = String(conversationId || '');
  if (!cid || !hookedConversations.has(cid)) return [];
  return normalizeMessages(hookedConversations.get(cid));
}

async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await worker(items[i], i);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: n }, () => run()));
  return results;
}

function priceFromMessages(convo, messages, sideHint = '') {
  const texts = [
    convo?.priceText,
    convo?.chatText,
    convo?.previewText,
    convo?.statusText,
    ...((messages || []).map(m => m.text)),
  ];
  const joined = texts.filter(Boolean).join('\n');
  const side = sideHint
    || (/geld\s+ausgezahlt/i.test(joined) && !/artikel\s+bezahlt/i.test(joined) ? 'sell' : 'buy');
  if (side === 'sell') return extractDirektSellTotal(texts);
  return extractDirektBuyTotal(texts);
}

async function scrapeOpenChat(tabId) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { type: 'scrape-open-chat' });
    if (!res?.ok) return { messages: [], chatText: '', price: null };
    return {
      messages: Array.isArray(res.messages) ? res.messages : [],
      chatText: res.chatText || '',
      price: res.price ?? null,
      paid: Boolean(res.paid),
      sold: Boolean(res.sold),
      availabilityConfirmed: Boolean(res.availabilityConfirmed),
    };
  } catch {
    return { messages: [], chatText: '', price: null };
  }
}

function conversationDeepLinks(convo) {
  const urls = [];
  const push = (u) => {
    const s = String(u || '').trim();
    if (!s) return;
    const abs = /^https?:\/\//i.test(s) ? s : `${KA_ORIGIN}${s.startsWith('/') ? '' : '/'}${s}`;
    if (!urls.includes(abs)) urls.push(abs);
  };

  push(convo.conversationUrl || convo.href || '');
  const id = String(convo.id || '');
  if (id && !id.startsWith('dom-')) {
    push(`${KA_ORIGIN}/m-nachrichten.html?conversationId=${encodeURIComponent(id)}`);
    push(`${KA_ORIGIN}/m-nachrichten.html?cid=${encodeURIComponent(id)}`);
    push(`${KA_ORIGIN}/m-nachrichten.html#/conversation/${encodeURIComponent(id)}`);
    push(`${KA_ORIGIN}/m-nachrichten.html#/conversations/${encodeURIComponent(id)}`);
  }
  return urls;
}

/** Open one chat by its own Nachrichten deep-link, then scrape the payment card. */
async function enrichConversationFromOpenChat(tabId, convo, { timeoutMs = 3500 } = {}) {
  await ensureContentScript(tabId);

  const links = conversationDeepLinks(convo);
  let openedVia = '';

  if (links.length) {
    const url = links[0];
    try {
      await chrome.tabs.update(tabId, { url, active: true });
      await waitForTabUrl(tabId, /m-nachrichten|messagebox|nachricht/i, 15000);
      await sleep(1000);
      openedVia = url;
    } catch {
      openedVia = '';
    }
  }

  if (convo.id && !String(convo.id).startsWith('dom-')) {
    try {
      await runInPage(tabId, (conversationId) => {
        const id = String(conversationId || '');
        const link = [...document.querySelectorAll('a[href]')].find(a =>
          String(a.getAttribute('href') || '').includes(id),
        );
        if (link) {
          link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          link.click?.();
          return { ok: true, via: 'anchor' };
        }
        location.hash = `/conversation/${id}`;
        return { ok: true, via: 'hash', hash: location.hash };
      }, [convo.id]);
      await sleep(800);
    } catch {
      /* ignore */
    }
  }

  if (!openedVia) {
    let clicked = await chrome.tabs.sendMessage(tabId, {
      type: 'click-conversation',
      counterparty: convo.counterparty || '',
      title: convo.adTitle || convo.title || '',
    }).catch(() => ({ ok: false }));

    if (!clicked?.ok) {
      try {
        clicked = await runInPage(tabId, pageClickConversation, [
          convo.counterparty || '',
          convo.adTitle || convo.title || '',
        ]);
      } catch {
        clicked = { ok: false };
      }
    }
    await sleep(clicked?.ok ? 900 : 400);
  }

  const started = Date.now();
  let open = { messages: [], chatText: '', price: null };
  let pagePrice = null;
  const wantDirektPrice = hasDirektCue(convo) || /artikel\s+bezahlt|geld\s+ausgezahlt|reserviert/i.test(
    `${convo.previewText || ''} ${convo.statusText || ''}`,
  );

  while (Date.now() - started < timeoutMs) {
    open = await scrapeOpenChat(tabId);
    try {
      const extracted = await extractPriceInTab(tabId);
      if (extracted != null) pagePrice = extracted;
    } catch {
      /* ignore */
    }

    const fromText = wantDirektPrice
      ? priceFromMessages(
        convo,
        [{ text: open.chatText || '' }, ...(open.messages || [])],
        /geld\s+ausgezahlt/i.test(open.chatText || '') ? 'sell' : 'buy',
      )
      : null;

    const price = coercePrice(fromText)
      ?? (wantDirektPrice
        ? (coercePrice(pagePrice) ?? coercePrice(open.price))
        : (coercePrice(open.price) ?? coercePrice(pagePrice)));

    if (price != null) {
      open.price = price;
      break;
    }

    if (/Artikel\s+bezahlt|Geld\s+ausgezahlt/i.test(open.chatText || '')) {
      await sleep(300);
      continue;
    }
    await sleep(350);
  }

  let price = coercePrice(open.price) ?? coercePrice(pagePrice);
  if (price == null) {
    price = priceFromMessages(
      convo,
      [{ text: open.chatText || '' }, ...(open.messages || [])],
      /geld\s+ausgezahlt/i.test(open.chatText || '') ? 'sell' : 'buy',
    );
  }
  if (price == null) {
    price = extractDirektPaidAmount(open.chatText, ...(open.messages || []).map(m => m.text));
  }

  if (open.chatText) convo.chatText = open.chatText;
  if (price != null) {
    convo.price = price;
    open.price = price;
    convo.priceText = `${String(price).replace('.', ',')} €`;
  }
  if (open.paid || /artikel\s+bezahlt/i.test(`${convo.statusText || ''}${open.chatText || ''}`)) {
    convo.statusText = [convo.statusText, 'Artikel bezahlt'].filter(Boolean).join('\n');
  }
  if (open.sold || /geld\s+ausgezahlt/i.test(`${convo.statusText || ''}${open.chatText || ''}`)) {
    convo.statusText = [convo.statusText, 'Geld ausgezahlt'].filter(Boolean).join('\n');
  }

  return {
    messages: open.messages || [],
    opened: true,
    price: price ?? null,
    via: openedVia || 'click',
  };
}

function conversationMatchesPeriod(convo, bounds) {
  const at = (convo.updatedAt instanceof Date && !Number.isNaN(convo.updatedAt.getTime()))
    ? convo.updatedAt
    : parseMessageDate(convo.whenText || '');
  if (!at) return false;
  return inRange(at, bounds.start, bounds.end);
}

function hasDirektCue(convo) {
  const text = `${convo.previewText || ''} ${convo.statusText || ''} ${convo.subtitle || ''} ${convo.chatText || ''}`;
  return /\bartikel\s+bezahlt\b|\bgeld\s+ausgezahlt\b/i.test(text);
}

function hasDealishPreview(convo) {
  const text = `${convo.previewText || ''} ${convo.statusText || ''} ${convo.subtitle || ''}`;
  return /\bartikel\s+bezahlt\b|\bgeld\s+ausgezahlt\b|\bpaypal\b|\b[uü]berwiesen\b|\bverkauft\b|\bgekauft\b|\babgeholt\b|\breserviert\b/i.test(text);
}

function messagesLookRich(messages) {
  if (!Array.isArray(messages) || messages.length < 2) return false;
  const joined = messages.map(m => m.text || '').join(' ');
  return /€|paypal|überweis|bar|abhol|bezahlt|ausgezahlt|verkauft|gekauft|nehme|passt/i.test(joined);
}

async function scanDeals(period) {
  const bounds = periodBounds(period);
  const tabId = await ensureKaTab();
  await openNachrichten(tabId);
  // Let the SPA fire messagebox requests so the hook can capture Bearer auth.
  await sleep(1200);
  await resolveAuthToken(tabId);

  // If SPA loaded before the hook, nudge a reload once so Bearer auth is captured.
  if (!cachedAuthToken) {
    await chrome.tabs.reload(tabId);
    await waitForTabUrl(tabId, /m-nachrichten|messagebox|nachricht/i);
    await sleep(1500);
    try {
      await chrome.scripting.executeScript({
        target: { tabId, allFrames: true },
        world: 'MAIN',
        files: ['inject-hook.js'],
      });
    } catch {
      /* ignore */
    }
    await openNachrichten(tabId);
    await sleep(800);
    await resolveAuthToken(tabId);
  }

  let userId = null;
  try {
    userId = await runInPage(tabId, pageResolveUserId);
  } catch {
    userId = null;
  }

  const conversations = await loadConversations(tabId, userId);
  const inPeriod = conversations.filter(c => conversationMatchesPeriod(c, bounds));

  const direktInPeriod = inPeriod.filter(hasDirektCue);
  const otherDealish = inPeriod.filter(c => !hasDirektCue(c) && hasDealishPreview(c));
  const MAX_SCAN = 40;
  const slice = [...direktInPeriod, ...otherDealish].slice(0, MAX_SCAN);

  const messagesById = new Map();
  let openedChats = 0;
  let apiLoaded = 0;

  // Parallel API message loads (no UI clicking).
  await mapPool(slice, 5, async (convo) => {
    let messages = [];
    try {
      messages = await loadMessages(tabId, userId, convo.id);
    } catch {
      messages = [];
    }
    if (messages.length) {
      apiLoaded += 1;
      const joined = messages.map(m => m.text).join('\n');
      convo.chatText = joined.slice(0, 4500);
      if (/Artikel\s+bezahlt/i.test(joined)) {
        convo.statusText = [convo.statusText, 'Artikel bezahlt'].filter(Boolean).join('\n');
      }
      if (/Geld\s+ausgezahlt/i.test(joined)) {
        convo.statusText = [convo.statusText, 'Geld ausgezahlt'].filter(Boolean).join('\n');
      }
      const price = priceFromMessages(convo, messages);
      if (price != null) {
        convo.price = price;
        convo.priceText = `${String(price).replace('.', ',')} €`;
      }
    }
    messagesById.set(convo.id, messages);
  });

  // Open each Direkt chat by its own URL when price is still missing (API often 401).
  const needDom = slice.filter(c => hasDirektCue(c) && coercePrice(c.price) == null).slice(0, 15);

  for (const convo of needDom) {
    try {
      const enriched = await enrichConversationFromOpenChat(tabId, convo, { timeoutMs: 3500 });
      const prev = messagesById.get(convo.id) || [];
      if (enriched.messages?.length) {
        messagesById.set(convo.id, [...prev, ...enriched.messages]);
      }
      if (enriched.opened) openedChats += 1;
      if (enriched.price != null) convo.price = enriched.price;
    } catch {
      /* ignore */
    }
  }

  let { buys, sells } = detectDealSuggestions(slice, messagesById, bounds);

  const attachPrice = (item) => {
    let price = coercePrice(item.price);
    if (price != null) return { ...item, price };
    const convo = slice.find(c => c.id === item.conversationId);
    const msgs = messagesById.get(item.conversationId) || [];
    const texts = [
      convo?.priceText,
      convo?.chatText,
      item.evidence,
      ...msgs.map(m => m.text),
    ];
    price = coercePrice(convo?.price)
      || (item.side === 'sell' ? extractDirektSellTotal(texts) : extractDirektBuyTotal(texts));
    if (price == null && !hasDirektCue(convo)) {
      price = extractHighestEuroAmount(...texts);
    }
    return { ...item, price: price ?? null };
  };
  buys = buys.map(attachPrice);
  sells = sells.map(attachPrice);

  const mode = cachedAuthToken
    ? (userId ? 'api+dom' : 'api-hook+dom')
    : (userId ? 'dom+api' : 'dom');

  return {
    period,
    label: bounds.label,
    userId: userId || 'dom',
    scannedConversations: slice.length,
    openedChats,
    apiLoaded,
    inboxConversations: conversations.length,
    inPeriodConversations: inPeriod.length,
    mode,
    auth: Boolean(cachedAuthToken),
    buys,
    sells,
    purchases: buys,
  };
}

async function confirmDeals(message) {
  const root = String(message.baseUrl || 'http://localhost:3000').replace(/\/$/, '');
  const period = message.period || 'today';
  const purchases = Array.isArray(message.purchases) ? message.purchases : [];
  const sales = Array.isArray(message.sales) ? message.sales : [];
  const importedAt = new Date().toISOString();

  let purchasesAdded = 0;
  let salesAdded = 0;
  let purchaseTotal = 0;
  let saleTotal = 0;

  if (purchases.length) {
    const res = await fetch(`${root}/api/ka/purchases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        period,
        source: 'extension-confirmed',
        confirmed: true,
        purchases: purchases.map(item => ({ ...item, confirmed: true })),
        importedAt,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Dealwatch purchases HTTP ${res.status}`);
    purchasesAdded = data.added || purchases.length;
    purchaseTotal = data.total || 0;
  }

  if (sales.length) {
    const res = await fetch(`${root}/api/ka/sales`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        period,
        source: 'extension-confirmed',
        confirmed: true,
        sales: sales.map(item => ({ ...item, confirmed: true })),
        importedAt,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Dealwatch sales HTTP ${res.status}`);
    salesAdded = data.added || sales.length;
    saleTotal = data.total || 0;
  }

  return {
    purchasesAdded,
    salesAdded,
    purchaseTotal,
    saleTotal,
    added: purchasesAdded,
    total: purchaseTotal,
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
