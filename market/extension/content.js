// Content script: status + inbox/open-chat scrape for Direkt kaufen deals.

function apparentlyLoggedIn() {
  const html = document.documentElement?.innerHTML || '';
  if (/anmelden|einloggen/i.test(document.title) && /login/i.test(location.pathname)) return false;
  return /m-abmelden|logout|nachrichten|messagebox/i.test(html)
    || Boolean(document.querySelector('a[href*="m-abmelden"], a[href*="logout"]'));
}

function hashLocal(value) {
  const raw = String(value || '');
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    hash = ((hash << 5) - hash) + raw.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function parseEuroLocal(raw) {
  let s = String(raw || '').trim().replace(/\s+/g, '');
  if (!s) return null;
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(',', '.');
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0 || n >= 20000) return null;
  return Math.round(n * 100) / 100;
}

function normalizeMoneyLocal(value) {
  return String(value || '')
    .replace(/\u00a0|\u202f|\u2009|\u2007/g, ' ')
    .replace(/&euro;|EUR\b|Euro\b/gi, '€')
    .replace(/(\d)\s+([.,])\s+(\d)/g, '$1$2$3')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeDayMonthLocal(raw) {
  const m = String(raw || '').trim().match(/^(\d{1,2})[.,](\d{2})$/);
  if (!m) return false;
  const day = Number(m[1]);
  const month = Number(m[2]);
  return day >= 1 && day <= 31 && month >= 1 && month <= 12;
}

function extractAllEuroLocal(text) {
  const raw = normalizeMoneyLocal(text);
  const out = [];
  const re = /(\d{1,5}(?:[.,]\d{1,2})?)\s*€/gi;
  let m;
  while ((m = re.exec(raw))) {
    if (looksLikeDayMonthLocal(m[1])) continue;
    const n = parseEuroLocal(m[1]);
    if (n != null) out.push({ value: n, index: m.index });
  }
  const bare = /(\d{1,5}),(\d{2})(?!\d)/g;
  while ((m = bare.exec(raw))) {
    const token = `${m[1]},${m[2]}`;
    if (looksLikeDayMonthLocal(token)) continue;
    const n = parseEuroLocal(token);
    if (n == null || n < 1) continue;
    const around = raw.slice(Math.max(0, m.index - 28), m.index + 28);
    if (!/preis|betrag|k[aä]uferschutz|versand|€|eur|bezahlt|artikel/i.test(around) && n < 5) continue;
    if (out.some(a => a.value === n && Math.abs(a.index - m.index) < 4)) continue;
    out.push({ value: n, index: m.index });
  }
  return out;
}

function extractPreisLabelLocal(text) {
  const raw = normalizeMoneyLocal(text);
  const withEuro = raw.match(/\bPreis\s+(\d{1,5}(?:[.,]\d{2}))\s*€/i)
    || raw.match(/\bPreis\b[^\d]{0,16}(\d{1,5}(?:[.,]\d{2}))\s*€/i);
  if (withEuro) return parseEuroLocal(withEuro[1]);
  const bare = raw.match(/\bPreis\s+(\d{1,5}(?:[.,]\d{2}))\b/i)
    || raw.match(/\bPreis\b[^\d]{0,16}(\d{1,5}(?:[.,]\d{2}))\b/i);
  if (!bare || looksLikeDayMonthLocal(bare[1])) return null;
  return parseEuroLocal(bare[1]);
}

function amountAboveCue(text, cueSource) {
  const raw = normalizeMoneyLocal(text);
  const globalCue = new RegExp(cueSource, 'gi');
  let best = null;
  let match;
  while ((match = globalCue.exec(raw))) {
    let window = raw.slice(Math.max(0, match.index - 140), match.index);
    window = window
      .replace(/\bBetrag\s+\d{1,5}(?:[.,]\d{2})\s*€/gi, ' ')
      .replace(/\bK[aä]uferschutz\s+\d{1,5}(?:[.,]\d{2})\s*€/gi, ' ')
      .replace(/\bVersand\s+\d{1,5}(?:[.,]\d{2})\s*€/gi, ' ')
      .replace(/\bArtikel\s+\d{1,5}(?:[.,]\d{2})\s*€/gi, ' ');
    const withEuro = [...window.matchAll(/(\d{1,5}(?:[.,]\d{2}))\s*€/gi)]
      .filter(m => !looksLikeDayMonthLocal(m[1]));
    if (withEuro.length) {
      const values = withEuro.map(m => parseEuroLocal(m[1])).filter(n => n != null);
      if (values.length) best = Math.max(...values);
      continue;
    }
    if (/€/.test(window)) {
      const bare = [...window.matchAll(/(\d{1,5}),(\d{2})(?!\d)/g)]
        .map(m => `${m[1]},${m[2]}`)
        .filter(t => !looksLikeDayMonthLocal(t));
      const values = bare.map(t => parseEuroLocal(t)).filter(n => n != null);
      if (values.length) best = Math.max(...values);
    }
  }
  return best;
}

/** Buyer total: amount right above "Artikel bezahlt" (incl. fees + shipping). */
function extractBuyerPaidTotalLocal(text) {
  const raw = normalizeMoneyLocal(text);
  return amountAboveCue(raw, 'Artikel\\s+bezahlt')
    || extractPreisLabelLocal(raw)
    || extractPaymentCardTotalLocal(raw)
    || null;
}

/** Fallback card total when cue pairing fails. */
function extractPaymentCardTotalLocal(text) {
  const raw = normalizeMoneyLocal(text);
  if (!raw) return null;

  const blockRe = /(\d{1,5}(?:[.,]\d{2}))\s*€[\s\S]{0,220}?Artikel[\s\S]{0,80}?\d{1,5}(?:[.,]\d{1,2})\s*€[\s\S]{0,160}?(?:K[aä]uferschutz|Versand)[\s\S]{0,80}?\d{1,5}(?:[.,]\d{1,2})\s*€/gi;
  let best = null;
  let match;
  while ((match = blockRe.exec(raw))) {
    const amounts = extractAllEuroLocal(match[0]).map(a => a.value);
    if (!amounts.length) continue;
    const total = Math.max(...amounts);
    if (best == null || total > best) best = total;
  }
  if (best != null) return best;

  if (/Artikel[\s\S]{0,40}\d{1,5}(?:[.,]\d{1,2})\s*€/i.test(raw) && /K[aä]uferschutz|Versand/i.test(raw)) {
    const amounts = extractAllEuroLocal(raw);
    const artikelIdx = raw.search(/\bArtikel\s+\d/i);
    const before = amounts.filter(a => artikelIdx < 0 || a.index < artikelIdx);
    if (before.length) return Math.max(...before.map(a => a.value));
    if (amounts.length) return Math.max(...amounts.map(a => a.value));
  }

  const leading = raw.match(/(\d{1,5}(?:[.,]\d{2}))\s*€[\s\S]{0,80}?\bArtikel\s+\d{1,5}(?:[.,]\d{1,2})?\s*€/i);
  if (leading) return parseEuroLocal(leading[1]);
  return null;
}

function parseInboxRow(text, href = '') {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean || clean.length < 8) return null;
  if (/^alle auswählen$/i.test(clean)) return null;
  // Payment card / open-chat chrome must never become an inbox row.
  if (/\bPreis\b[\s\S]{0,40}\b(Details|Betrag|K[aä]uferschutz)\b/i.test(clean)) return null;
  if (/\bBetrag\b[\s\S]{0,40}\bK[aä]uferschutz\b/i.test(clean)) return null;
  if (/^Preis\b/i.test(clean) || /^Details\b/i.test(clean) || /^Betrag\b/i.test(clean)) return null;

  const timeMatch = clean.match(/\b(Heute|Gestern)\s+(\d{1,2}:\d{2})\b/i)
    || clean.match(/\b(\d{1,2}\.\d{1,2}\.\d{2,4})\b/);
  const whenText = timeMatch
    ? (timeMatch[2] ? `${timeMatch[1]} ${timeMatch[2]}` : timeMatch[1])
    : '';

  const reservedMatch = clean.match(/\bReserviert\s*[•·∙\-–—]\s*(.+?)(?=\s+(?:Artikel\s+bezahlt|Geld\s+ausgezahlt|Verf[uü]gbarkeit\s+best[aä]tigt)\b|$)/i);
  const paid = /\bArtikel\s+bezahlt\b/i.test(clean);
  const sold = /\bGeld\s+ausgezahlt\b/i.test(clean);
  const availabilityConfirmed = /\bVerf[uü]gbarkeit\s+best[aä]tigt\b/i.test(clean);
  const reserved = Boolean(reservedMatch);

  // General chats: need a timestamp (Heute/Gestern/date) so we can date-filter later.
  if (!paid && !sold && !availabilityConfirmed && !reserved && !whenText && !/conversation/i.test(href)) {
    return null;
  }
  if (!paid && !sold && !availabilityConfirmed && !reserved && !whenText) return null;

  let counterparty = '';
  if (whenText) {
    const before = clean.split(new RegExp(whenText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))[0] || '';
    counterparty = before.replace(/alle auswählen/i, '').trim().split(/\s{2,}|\s•\s/)[0]?.trim() || '';
  }
  if (!counterparty) {
    counterparty = clean.split(/\s{2,}|\sHeut|\sGest|\sReserviert/i)[0]?.trim().slice(0, 40) || '';
  }
  if (!counterparty || counterparty.length < 2) return null;

  const titleFromReserved = (reservedMatch?.[1] || '').replace(/\s+/g, ' ').trim();
  let title = titleFromReserved;
  if (!title && whenText) {
    const after = clean.split(new RegExp(whenText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')).slice(1).join(' ').trim();
    title = after
      .replace(/\bReserviert\s*[•·∙\-–—]\s*/i, '')
      .replace(/\bArtikel\s+bezahlt\b/ig, '')
      .replace(/\bGeld\s+ausgezahlt\b/ig, '')
      .replace(/\bVerf[uü]gbarkeit\s+best[aä]tigt\b/ig, '')
      .trim()
      .slice(0, 120);
  }
  if (!title) title = clean.slice(0, 120);

  const statusText = [
    reservedMatch ? `Reserviert • ${titleFromReserved}` : '',
    paid ? 'Artikel bezahlt' : '',
    sold ? 'Geld ausgezahlt' : '',
    availabilityConfirmed ? 'Verfügbarkeit bestätigt' : '',
    !paid && !sold && !reserved && !availabilityConfirmed ? title : '',
  ].filter(Boolean).join('\n');

  const idMatch = String(href).match(/conversation[s]?\/([a-zA-Z0-9_-]+)/i)
    || String(href).match(/cid=([a-zA-Z0-9_-]+)/i);

  let price = null;
  if (paid) price = amountAboveCue(clean, 'Artikel\\s+bezahlt');
  if (price == null && sold) price = amountAboveCue(clean, 'Geld\\s+ausgezahlt');
  if (price == null && availabilityConfirmed) price = amountAboveCue(clean, 'Verf[uü]gbarkeit\\s+best[aä]tigt');

  return {
    id: idMatch?.[1] || '',
    title,
    counterparty,
    whenText,
    statusText,
    previewText: statusText || clean.slice(0, 200),
    subtitle: paid ? 'Artikel bezahlt' : sold ? 'Geld ausgezahlt' : availabilityConfirmed ? 'Verfügbarkeit bestätigt' : '',
    href,
    text: clean,
    paid,
    sold,
    availabilityConfirmed,
    reserved,
    price,
    general: !paid && !sold && !reserved && !availabilityConfirmed,
  };
}

function scrapeInboxDom() {
  const seen = new Set();
  const items = [];

  const pushItem = (parsed) => {
    if (!parsed) return;
    if (/^preis\b/i.test(parsed.counterparty || '') || /^details\b/i.test(parsed.counterparty || '')) return;
    if (/\bpreis\b.*\bbetrag\b/i.test(parsed.title || '')) return;
    const key = parsed.id
      || `${parsed.counterparty}|${parsed.title}|${parsed.whenText}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    items.push({
      ...parsed,
      id: parsed.id || `dom-${hashLocal(key)}`,
    });
  };

  // Prefer the left conversation list — never the open chat detail (payment card leaks otherwise).
  const listRoot = document.querySelector('[class*="ConversationList"]')
    || document.querySelector('[class*="conversation-list"]')
    || document.querySelector('[data-testid*="conversation-list"]')
    || document.querySelector('aside')
    || document.querySelector('[class*="Inbox"]')
    || document.body;

  const roots = [
    ...listRoot.querySelectorAll('[data-testid*="conversation"]'),
    ...listRoot.querySelectorAll('[class*="ConversationList"] li'),
    ...listRoot.querySelectorAll('[class*="conversation-list"] li'),
    ...listRoot.querySelectorAll('.msgbox-conversation, .ConversationListItem'),
    ...listRoot.querySelectorAll('a[href*="conversation"]'),
    ...listRoot.querySelectorAll('li, article, [role="listitem"], [role="option"], [role="row"]'),
  ];

  for (const node of roots) {
    const row = node.closest('li, article, [role="listitem"], [role="option"], [role="row"], a, div') || node;
    const link = row.closest('a') || row.querySelector('a') || (row.tagName === 'A' ? row : null);
    let href = link?.getAttribute?.('href') || '';
    // Capture conversation id from data-* attrs when href is a JS handler / empty.
    const attrId = [
      row.getAttribute?.('data-conversation-id'),
      row.getAttribute?.('data-conversationid'),
      row.getAttribute?.('data-id'),
      link?.getAttribute?.('data-conversation-id'),
      link?.getAttribute?.('data-conversationid'),
      row.getAttribute?.('data-testid'),
      link?.getAttribute?.('data-testid'),
    ].map(v => String(v || '')).find(v => /[a-z0-9_-]{6,}/i.test(v)) || '';
    const idFromAttr = (attrId.match(/(?:conversation[-_]?id[=:]?\s*)?([a-z0-9_-]{6,})/i) || [])[1] || '';
    if (!href && idFromAttr) {
      href = `/m-nachrichten.html?conversationId=${encodeURIComponent(idFromAttr)}`;
    }
    const text = (row.innerText || row.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length > 500) continue;
    const parsed = parseInboxRow(text, href);
    if (parsed && !parsed.id && idFromAttr) parsed.id = idFromAttr;
    if (parsed && href) parsed.href = href;
    pushItem(parsed);
  }

  const listText = (listRoot.innerText || '').replace(/\u00a0/g, ' ');
  const cue = '(?:Artikel\\s+bezahlt|Geld\\s+ausgezahlt|Verf[uü]gbarkeit\\s+best[aä]tigt)';
  const rowRe = new RegExp(
    `([A-Za-zÄÖÜäöüß][\\wÄÖÜäöüß.'\\- ]{1,48}?)\\s+(Heute|Gestern)\\s+(\\d{1,2}:\\d{2})\\s+Reserviert\\s*[•·∙\\-–—]\\s*(.+?)\\s+${cue}`,
    'gi',
  );
  let match;
  while ((match = rowRe.exec(listText))) {
    const chunk = match[0].replace(/\s+/g, ' ').trim();
    pushItem(parseInboxRow(chunk, '') || {
      id: '',
      title: match[4].replace(/\s+/g, ' ').trim(),
      counterparty: match[1].replace(/\s+/g, ' ').trim(),
      whenText: `${match[2]} ${match[3]}`,
      statusText: chunk,
      previewText: chunk,
      subtitle: '',
      href: '',
      text: chunk,
      paid: /Artikel\s+bezahlt/i.test(chunk),
      sold: /Geld\s+ausgezahlt/i.test(chunk),
      availabilityConfirmed: /Verf[uü]gbarkeit\s+best[aä]tigt/i.test(chunk),
      reserved: true,
      price: null,
    });
  }

  return {
    items,
    debug: {
      href: location.href,
      bodyHasPaid: /Artikel\s+bezahlt/i.test(listText),
      bodyHasSold: /Geld\s+ausgezahlt/i.test(listText),
      bodyHasReserved: /Reserviert/i.test(listText),
      bodySnippet: listText.replace(/\s+/g, ' ').trim().slice(0, 180),
      itemCount: items.length,
    },
  };
}

/** Scrape the currently open conversation pane for system + free-text messages. */
function scrapeOpenChat() {
  // Scroll so the payment system card is in the DOM (often near the top of the thread).
  const scrollRoots = [
    document.querySelector('[class*="MessageList"]'),
    document.querySelector('[class*="message-list"]'),
    document.querySelector('[class*="ConversationDetail"]'),
    document.querySelector('[class*="conversation-detail"]'),
  ].filter(Boolean);
  for (const root of scrollRoots) {
    try {
      root.scrollTop = 0;
      root.scrollTop = root.scrollHeight;
      root.scrollTop = 0;
    } catch { /* ignore */ }
  }

  const paneCandidates = [
    document.querySelector('[class*="ConversationDetail"]'),
    document.querySelector('[class*="conversation-detail"]'),
    document.querySelector('[class*="MessageList"]'),
    document.querySelector('[data-testid*="message"]')?.closest('section, main, div'),
    document.querySelector('[class*="msgbox"]'),
    document.querySelector('main'),
  ].filter(Boolean);

  const pane = paneCandidates.sort((a, b) =>
    ((b.innerText || '').length) - ((a.innerText || '').length),
  )[0] || null;
  const scope = pane || document.body;
  const paneText = normalizeMoneyLocal((scope.innerText || '').replace(/\u00a0/g, ' '));

  const moneyBits = [];
  for (const el of scope.querySelectorAll('span, div, p, strong, b, li, td, dd, dt')) {
    const t = normalizeMoneyLocal(el.innerText || el.textContent || '');
    if (!t || t.length > 80) continue;
    if (/\d{1,5}(?:[.,]\d{2})/.test(t) && /€|preis|betrag|k[aä]uferschutz|versand/i.test(t)) {
      moneyBits.push(t);
    } else if (/^\d{1,5}[.,]\d{2}$/.test(t) && !looksLikeDayMonthLocal(t) && /€/.test(paneText)) {
      // Bare amount nodes next to a euro glyph elsewhere — never invent € for dates.
      moneyBits.push(`${t} €`);
    } else if (/^Preis$/i.test(t) || /^Betrag$/i.test(t)) {
      moneyBits.push(t);
    }
  }
  const moneyText = moneyBits.join(' ');
  const combined = normalizeMoneyLocal(`${paneText}\n${moneyText}`);

  const messages = [];
  const seen = new Set();
  const dealish = /€|eur|paypal|überweis|ueberweis|iban|bar\b|cash|abhol|übergabe|verkauft|gekauft|nehme|genommen|passt|danke|bezahlt|ausgezahlt|reserviert|käuferschutz|versand|artikel\s+bezahlt|geld\s+ausgezahlt|verf[uü]gbarkeit|ok\b|okay|verkauf|kauf|preis|betrag/i;

  const bubbles = [
    ...scope.querySelectorAll('[class*="Message"], [class*="message"], [data-testid*="message"], [role="listitem"]'),
  ];
  for (const bubble of bubbles.slice(-60)) {
    const text = normalizeMoneyLocal(bubble.innerText || bubble.textContent || '');
    if (text.length < 2 || text.length > 800) continue;
    if (/^alle auswählen$/i.test(text)) continue;
    if (!dealish.test(text) && text.length > 120) continue;
    const key = text.slice(0, 160).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    messages.push({
      text,
      at: null,
      outbound: false,
      system: /artikel\s+bezahlt|geld\s+ausgezahlt|verf[uü]gbarkeit|käuferschutz|versand|artikel\s+\d|preis/i.test(text),
    });
  }

  if (combined) {
    messages.unshift({
      text: combined.slice(0, 4500),
      at: null,
      outbound: false,
      system: true,
    });
  }

  // Direkt: amount right above the status cue.
  const isDirekt = /Artikel\s+bezahlt|Geld\s+ausgezahlt|K[aä]uferschutz|\bPreis\b/i.test(combined);
  let chatPrice = null;
  if (/Artikel\s+bezahlt/i.test(combined)) {
    chatPrice = amountAboveCue(combined, 'Artikel\\s+bezahlt');
  } else if (/Geld\s+ausgezahlt/i.test(combined)) {
    chatPrice = amountAboveCue(combined, 'Geld\\s+ausgezahlt');
  }
  if (chatPrice == null) chatPrice = extractPreisLabelLocal(combined);
  if (chatPrice == null && !isDirekt) {
    const amounts = extractAllEuroLocal(combined).map(a => a.value);
    chatPrice = amounts.length ? Math.max(...amounts) : null;
  }

  return {
    messages,
    chatText: combined.slice(0, 4500),
    price: chatPrice,
    paid: /Artikel\s+bezahlt|bezahlt\s*[-–—]?\s*versand|kauf\s+erfolgreich/i.test(combined),
    sold: /Geld\s+ausgezahlt/i.test(combined),
    availabilityConfirmed: /Verf[uü]gbarkeit\s+best[aä]tigt/i.test(combined),
  };
}

function clickConversationRow({ counterparty = '', title = '' } = {}) {
  const name = String(counterparty || '').trim().toLowerCase();
  const titleBit = String(title || '').trim().toLowerCase().slice(0, 18);
  if (!name && !titleBit) return { ok: false, reason: 'no-match-keys' };

  const listRoot = document.querySelector('[class*="ConversationList"]')
    || document.querySelector('[class*="conversation-list"]')
    || document.querySelector('aside')
    || document.body;

  const candidates = [
    ...listRoot.querySelectorAll('a[href*="conversation"], li, article, [role="listitem"], [role="option"], [role="row"], div'),
  ];

  let best = null;
  let bestScore = 0;
  for (const el of candidates) {
    const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length < 8 || text.length > 420) continue;
    if (/\bPreis\b.*\bBetrag\b/i.test(text)) continue;
    const lower = text.toLowerCase();
    let score = 0;
    if (name && lower.includes(name)) score += 4;
    if (titleBit && titleBit.length >= 4 && lower.includes(titleBit)) score += 2;
    if (/artikel\s+bezahlt|geld\s+ausgezahlt|verf[uü]gbarkeit\s+best[aä]tigt|reserviert/i.test(text)) score += 2;
    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (!best || bestScore < 4) return { ok: false, reason: 'row-not-found', bestScore };

  const clickable = best.closest('a') || best.querySelector('a') || best;
  clickable.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  clickable.click?.();
  return { ok: true, bestScore, text: (best.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120) };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'ka-status') {
    sendResponse({
      ok: true,
      href: location.href,
      loggedIn: apparentlyLoggedIn(),
      title: document.title,
    });
    return false;
  }
  if (message?.type === 'scrape-inbox') {
    try {
      const result = scrapeInboxDom();
      sendResponse({ ok: true, ...result });
    } catch (error) {
      sendResponse({ ok: false, error: error.message || String(error), items: [] });
    }
    return false;
  }
  if (message?.type === 'scrape-open-chat') {
    try {
      sendResponse({ ok: true, ...scrapeOpenChat() });
    } catch (error) {
      sendResponse({ ok: false, error: error.message || String(error), messages: [] });
    }
    return false;
  }
  if (message?.type === 'click-conversation') {
    try {
      sendResponse(clickConversationRow(message));
    } catch (error) {
      sendResponse({ ok: false, error: error.message || String(error) });
    }
    return false;
  }
  if (message?.type === 'get-hook-cache') {
    sendResponse({
      ok: true,
      token: window.__dealwatchKaToken || '',
      conversations: window.__dealwatchKaConversations || {},
    });
    return false;
  }
  return false;
});

// Bridge MAIN-world inject-hook.js → extension background.
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== 'dealwatch-ka-hook') return;
  if (data.type === 'auth' && data.token) {
    window.__dealwatchKaToken = data.token;
  }
  if (data.type === 'response' && data.url) {
    const idMatch = String(data.url).match(/\/conversations\/([a-zA-Z0-9_-]+)/i);
    if (idMatch) {
      window.__dealwatchKaConversations = window.__dealwatchKaConversations || {};
      window.__dealwatchKaConversations[idMatch[1]] = {
        url: data.url,
        status: data.status,
        data: data.data,
        at: Date.now(),
      };
    }
  }
  chrome.runtime.sendMessage({ type: 'ka-hook', payload: data }).catch(() => {});
});