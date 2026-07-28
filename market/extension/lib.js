/* Shared chat heuristics + date ranges for the extension service worker. */

const DEAL_PATTERNS = [
  /\bverkauft\b/i,
  /\bgekauft\b/i,
  /\bkauf\s*(abgeschlossen|passt|erledigt)\b/i,
  /\bist\s+dein[es]?\b/i,
  /\breserviert\b/i,
  /\bartikel\s+bezahlt\b/i,
  /\bgeld\s+ausgezahlt\b/i,
  /\bverf[uü]gbarkeit\s+best[aä]tigt\b/i,
  /\bbezahlt\b/i,
  /\b[uü]berwiesen\b/i,
  /\bpaypal\b/i,
  /\babgeholt\b/i,
  /\b[uü]bergabe\b/i,
  /\bdanke\s+f[uü]r\s+den\s+kauf\b/i,
  /\bdanke\s+f[uü]r(?:s|\s+das)\s+gesch[aä]ft\b/i,
  /\bdeal\b/i,
  /\bpasst\b.*\b(€|euro|eur)\b/i,
  /\b(€|euro|eur)\b.*\bpasst\b/i,
  /\bgenommen\b/i,
  /\bich\s+nehme\b/i,
  /\bwird\s+abgeholt\b/i,
  /\bverkauf\s+an\s+dich\b/i,
  /\bdirekt\s*kaufen\b/i,
  /\bsofortkauf\b/i,
  /\bkauf\s*jetzt\b/i,
  /\bgeld\s+(ist\s+)?(da|angekommen|drinn)\b/i,
  /\bzahlung\s+(erhalten|eingegangen|erfolgreich)\b/i,
  /\bkauf\s+abgeschlossen\b/i,
  /\btransaktion\s+(abgeschlossen|erfolgreich)\b/i,
];

const SELL_BIAS_PATTERNS = [
  /\bgeld\s+ausgezahlt\b/i,
  /\bverf[uü]gbarkeit\s+best[aä]tigt\b/i,
  /\bhat\s+(dein|das)\s+angebot\s+gekauft\b/i,
  /\bjemand\s+hat\s+gekauft\b/i,
  /\bverkauf(?:t)?\s+an\b/i,
  /\bist\s+verkauft\b/i,
  /\bzahlung\s+(erhalten|eingegangen)\b/i,
  /\bpaypal\b.*\b(erhalten|angekommen|da)\b/i,
  /\bgeld\s+(ist\s+)?(da|angekommen|drinn)\b/i,
  /\bdanke\s+f[uü]r\s+den\s+kauf\b/i,
  /\babholung\s+(passt|heute|morgen)\b/i,
  /\bdein\s+artikel\s+wurde\s+gekauft\b/i,
];

const BUY_BIAS_PATTERNS = [
  /\bartikel\s+bezahlt\b/i,
  /\bich\s+habe\s+bezahlt\b/i,
  /\bich\s+nehme\b/i,
  /\bw[uü]rde\s+nehmen\b/i,
  /\bhab(?:e)?\s+(bezahlt|überwiesen)\b/i,
  /\bpaypal\b.*\b(gesendet|geschickt|überwiesen)\b/i,
  /\bkann\s+(heute|morgen)\s+abholen\b/i,
  /\bist\s+das\s+noch\s+zu\s+haben\b/i,
  /\bkauf\s+erfolgreich\b/i,
  /\bdu\s+hast\s+bezahlt\b/i,
];

/** Buyer completed Direkt kaufen payment. */
const DIREKT_BUY_DONE = /\bartikel\s+bezahlt\b/i;
/** Seller payout completed — treat as sold. */
const DIREKT_SELL_DONE = /\bgeld\s+ausgezahlt\b/i;
/** Seller-side progress cue (amount shown above); not sold yet by itself. */
const DIREKT_SELL_PROGRESS = /\bverf[uü]gbarkeit\s+best[aä]tigt\b/i;
const DIREKT_KAUFEN_DONE = /\bartikel\s+bezahlt\b|\bgeld\s+ausgezahlt\b|\bverf[uü]gbarkeit\s+best[aä]tigt\b|\breserviert\b.*\bbezahlt\b|\bbezahlt\b.*\breserviert\b|\bdirekt\s*kaufen\b|\bsofortkauf\b/i;

function parseEuroNumber(raw) {
  let s = String(raw || '').trim().replace(/\s+/g, '');
  if (!s) return null;
  // 1.234,56 → 1234.56
  if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else {
    s = s.replace(',', '.');
  }
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0 || n >= 20000) return null;
  return Math.round(n * 100) / 100;
}

/** Normalize money text so regexes see plain "60,44 €". */
function normalizeMoneyText(value) {
  return String(value || '')
    .replace(/\u00a0|\u202f|\u2009|\u2007/g, ' ')
    .replace(/&euro;|€|EUR\b|Euro\b/gi, '€')
    .replace(/(\d)\s+([.,])\s+(\d)/g, '$1$2$3')
    .replace(/(\d[.,]\d{2})\s*€/g, '$1 €')
    .replace(/\s+/g, ' ')
    .trim();
}

const EURO_AMOUNT_RE = /(\d{1,5}(?:[.,]\d{1,2})?)\s*€/gi;

/** DD.MM / DD,MM calendar fragments must never become euro amounts. */
function looksLikeDayMonth(raw) {
  const m = String(raw || '').trim().match(/^(\d{1,2})[.,](\d{2})$/);
  if (!m) return false;
  const day = Number(m[1]);
  const month = Number(m[2]);
  return day >= 1 && day <= 31 && month >= 1 && month <= 12;
}

/**
 * Paid total for Direkt kaufen = labeled "Preis <amount>".
 * Never optional-€ (that turns dates into money). Never invent from Betrag alone.
 */
function extractPreisLabelAmount(text) {
  const joined = normalizeMoneyText(text);
  if (!joined) return null;
  const withEuro = joined.match(/\bPreis\s+(\d{1,5}(?:[.,]\d{2}))\s*€/i)
    || joined.match(/\bPreis\b[^\d]{0,16}(\d{1,5}(?:[.,]\d{2}))\s*€/i);
  if (withEuro) return parseEuroNumber(withEuro[1]);
  const bare = joined.match(/\bPreis\s+(\d{1,5}(?:[.,]\d{2}))\b/i)
    || joined.match(/\bPreis\b[^\d]{0,16}(\d{1,5}(?:[.,]\d{2}))\b/i);
  if (!bare || looksLikeDayMonth(bare[1])) return null;
  return parseEuroNumber(bare[1]);
}

function extractAllEuroAmounts(text) {
  const raw = normalizeMoneyText(text);
  const out = [];
  let m;
  const re = new RegExp(EURO_AMOUNT_RE.source, 'gi');
  while ((m = re.exec(raw))) {
    if (looksLikeDayMonth(m[1])) continue;
    const n = parseEuroNumber(m[1]);
    if (n != null) out.push({ value: n, index: m.index, raw: m[1] });
  }
  // Bare German money "76,64" when the € glyph is in another node.
  const bare = /(\d{1,5}),(\d{2})(?!\d)/g;
  while ((m = bare.exec(raw))) {
    const token = `${m[1]},${m[2]}`;
    if (looksLikeDayMonth(token)) continue;
    const n = parseEuroNumber(token);
    if (n == null || n < 1) continue;
    const around = raw.slice(Math.max(0, m.index - 28), m.index + 28);
    if (!/preis|betrag|k[aä]uferschutz|versand|€|eur|bezahlt|artikel/i.test(around) && n < 5) continue;
    if (out.some(a => a.value === n && Math.abs(a.index - m.index) < 4)) continue;
    out.push({ value: n, index: m.index, raw: m[0] });
  }
  return out;
}

function coercePrice(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.round(value * 100) / 100;
  }
  return parseEuroNumber(String(value));
}

/**
 * Direkt-kaufen payment card in the open chat usually looks like:
 *   60,44 €
 *   Artikel 50,00 €
 *   Käuferschutz 2,75 €
 *   Versand 7,69 €
 * Total paid = the largest figure (or the one above the Artikel line).
 */
function extractPaymentCardTotal(text) {
  const raw = normalizeMoneyText(text);
  if (!raw) return null;

  // Block that contains Artikel + Käuferschutz and/or Versand.
  const blockRe = /(.{0,80}?)(\d{1,5}(?:[.,]\d{2}))\s*€(.{0,200}?Artikel.{0,80}?\d{1,5}(?:[.,]\d{1,2})\s*€.{0,160}?(?:K[aä]uferschutz|Versand).{0,80}?\d{1,5}(?:[.,]\d{1,2})\s*€)/gi;
  let best = null;
  let match;
  while ((match = blockRe.exec(raw))) {
    const chunk = `${match[1]}${match[2]} €${match[3]}`;
    const amounts = extractAllEuroAmounts(chunk).map(a => a.value);
    if (!amounts.length) continue;
    const total = Math.max(...amounts);
    if (best == null || total > best) best = total;
  }
  if (best != null) return best;

  // Softer: any window that has both "Artikel … €" and Käuferschutz/Versand.
  if (/Artikel[\s\S]{0,40}\d{1,5}(?:[.,]\d{1,2})\s*€/i.test(raw)
    && /K[aä]uferschutz|Versand/i.test(raw)) {
    const amounts = extractAllEuroAmounts(raw);
    // Prefer amounts with cents that appear before the first "Artikel <price>"
    const artikelIdx = raw.search(/\bArtikel\s+\d/i);
    const before = amounts.filter(a => artikelIdx < 0 || a.index < artikelIdx);
    if (before.length) return Math.max(...before.map(a => a.value));
    if (amounts.length) return Math.max(...amounts.map(a => a.value));
  }
  return null;
}

/**
 * Paid total sits immediately ABOVE the status cue, e.g.:
 *   60,44 €
 *   Artikel bezahlt
 *   Betrag / Käuferschutz / Versand   ← ignore (these are below the cue)
 *
 * Strip labeled fee lines, then take the remaining euro amount closest to the cue
 * (or the max if several unlabeled totals remain).
 */
function extractAmountAboveCue(text, cueRe) {
  const raw = normalizeMoneyText(text);
  if (!raw || !cueRe) return null;
  const flags = cueRe.flags?.includes('g') ? cueRe.flags : `${cueRe.flags || ''}g`;
  const globalCue = new RegExp(cueRe.source, flags);
  let best = null;
  let match;
  while ((match = globalCue.exec(raw))) {
    let window = raw.slice(Math.max(0, match.index - 140), match.index);
    // Never treat fee/base lines as the paid total.
    window = window
      .replace(/\bBetrag\s+\d{1,5}(?:[.,]\d{2})\s*€/gi, ' ')
      .replace(/\bK[aä]uferschutz\s+\d{1,5}(?:[.,]\d{2})\s*€/gi, ' ')
      .replace(/\bVersand\s+\d{1,5}(?:[.,]\d{2})\s*€/gi, ' ')
      .replace(/\bArtikel\s+\d{1,5}(?:[.,]\d{2})\s*€/gi, ' ');

    const withEuro = [...window.matchAll(/(\d{1,5}(?:[.,]\d{2}))\s*€/gi)]
      .filter(m => !looksLikeDayMonth(m[1]));
    if (withEuro.length) {
      const values = withEuro
        .map(m => parseEuroNumber(m[1]))
        .filter(n => n != null);
      if (values.length) {
        // Total paid is the largest figure above the cue (fees already stripped).
        best = Math.max(...values);
      }
      continue;
    }
    if (/€/.test(window)) {
      const bare = [...window.matchAll(/(\d{1,5}),(\d{2})(?!\d)/g)]
        .map(m => `${m[1]},${m[2]}`)
        .filter(t => !looksLikeDayMonth(t));
      const values = bare.map(t => parseEuroNumber(t)).filter(n => n != null);
      if (values.length) best = Math.max(...values);
    }
  }
  return best;
}

/**
 * Direkt-buy paid total = amount right above "Artikel bezahlt".
 * Fallback: labeled Preis, then payment-card max.
 */
function extractDirektBuyTotal(texts = []) {
  const joined = normalizeMoneyText(texts.filter(Boolean).join('\n'));
  if (!joined) return null;

  // 1) Canonical UI: big total directly above "Artikel bezahlt"
  const nearPaid = extractAmountAboveCue(joined, DIREKT_BUY_DONE);
  if (nearPaid != null) return nearPaid;

  // Tight one-shot pattern (same rule, helps when whitespace is odd)
  const direct = joined.match(
    /(\d{1,5}(?:[.,]\d{2}))\s*€[\s\S]{0,80}?Artikel\s+bezahlt/i,
  );
  if (direct && !looksLikeDayMonth(direct[1])) {
    const n = parseEuroNumber(direct[1]);
    if (n != null) return n;
  }

  // 2) Labeled Preis (Details panel)
  const preis = extractPreisLabelAmount(joined);
  if (preis != null) return preis;

  // 3) Payment card breakdown as last resort
  const card = extractPaymentCardTotal(joined);
  if (card != null) return card;

  return null;
}

/**
 * Direkt-sell received total = amount right above "Geld ausgezahlt".
 * (Same card layout as buys, different status line.)
 */
function extractDirektSellTotal(texts = []) {
  const joined = normalizeMoneyText(texts.filter(Boolean).join('\n'));
  if (!joined) return null;

  // 1) Canonical UI: amount directly above "Geld ausgezahlt"
  const nearPaidOut = extractAmountAboveCue(joined, DIREKT_SELL_DONE);
  if (nearPaidOut != null) return nearPaidOut;

  const direct = joined.match(
    /(\d{1,5}(?:[.,]\d{2}))\s*€[\s\S]{0,80}?Geld\s+ausgezahlt/i,
  );
  if (direct && !looksLikeDayMonth(direct[1])) {
    const n = parseEuroNumber(direct[1]);
    if (n != null) return n;
  }

  // 2) Not sold yet — optional preview amount above "Verfügbarkeit bestätigt"
  const nearAvail = extractAmountAboveCue(joined, DIREKT_SELL_PROGRESS);
  if (nearAvail != null) return nearAvail;

  return null;
}

/** Direkt amounts by side: buy = above Artikel bezahlt, sell = above Geld ausgezahlt. */
function extractDirektPaidAmount(...texts) {
  const joined = texts.filter(Boolean).join('\n');
  if (/\bgeld\s+ausgezahlt\b/i.test(joined) && !/\bartikel\s+bezahlt\b/i.test(joined)) {
    return extractDirektSellTotal(texts);
  }
  if (/\bartikel\s+bezahlt\b/i.test(joined)) {
    return extractDirektBuyTotal(texts);
  }
  return extractDirektBuyTotal(texts) ?? extractDirektSellTotal(texts);
}

function periodBounds(period, now = new Date()) {
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === 'yesterday') {
    const start = new Date(startToday);
    start.setDate(start.getDate() - 1);
    return { start, end: startToday, label: 'Yesterday' };
  }
  if (period === 'week') {
    const day = startToday.getDay(); // 0 = Sun
    const mondayOffset = day === 0 ? 6 : day - 1;
    const start = new Date(startToday);
    start.setDate(start.getDate() - mondayOffset);
    return { start, end: now, label: 'This week' };
  }
  return { start: startToday, end: now, label: 'Today' };
}

function parseMessageDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'number') {
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const raw = String(value).trim();
  if (!raw) return null;
  const iso = new Date(raw);
  if (!Number.isNaN(iso.getTime())) return iso;

  const lower = raw.toLowerCase();
  const now = new Date();
  const timeMatch = raw.match(/(\d{1,2}):(\d{2})/);
  const hm = timeMatch ? [Number(timeMatch[1]), Number(timeMatch[2])] : [12, 0];
  if (lower.startsWith('heute')) {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hm[0], hm[1]);
  }
  if (lower.startsWith('gestern')) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hm[0], hm[1]);
    d.setDate(d.getDate() - 1);
    return d;
  }
  const de = raw.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (de) {
    const year = Number(de[3]) < 100 ? 2000 + Number(de[3]) : Number(de[3]);
    return new Date(year, Number(de[2]) - 1, Number(de[1]), hm[0], hm[1]);
  }
  return null;
}

function inRange(date, start, end) {
  if (!date) return false;
  const t = date.getTime();
  return t >= start.getTime() && t <= end.getTime();
}

function extractEuroAmount(text) {
  const amounts = extractAllEuroAmounts(text);
  if (!amounts.length) return null;
  return Math.max(...amounts.map(a => a.value));
}

function extractHighestEuroAmount(...texts) {
  let best = null;
  for (const text of texts) {
    if (!text) continue;
    for (const amount of extractAllEuroAmounts(text)) {
      if (best == null || amount.value > best) best = amount.value;
    }
  }
  return best;
}

function looksLikePaymentDump(text) {
  const raw = String(text || '');
  return /\bpreis\b[\s\S]{0,40}\b(details|betrag|k[aä]uferschutz)\b/i.test(raw)
    || /\bbetrag\b[\s\S]{0,40}\bk[aä]uferschutz\b/i.test(raw)
    || /\bk[aä]uferschutz\b[\s\S]{0,40}\bversand\b/i.test(raw);
}

/** Price = Direkt cue totals by side, otherwise highest € in this chat. */
function extractPaidTotal(messages = [], convo = {}, side = 'buy') {
  const fromConvo = coercePrice(convo.price);
  if (fromConvo != null) return fromConvo;

  const texts = [
    convo.priceText,
    convo.chatText,
    ...messages.map(m => m.text),
  ].filter(Boolean);

  const joined = texts.join('\n');
  const isDirekt = /\bartikel\s+bezahlt\b|\bpreis\b|\bk[aä]uferschutz\b|\bgeld\s+ausgezahlt\b|\bbetrag\b/i.test(
    `${joined} ${convo.previewText || ''} ${convo.statusText || ''}`,
  );

  if (isDirekt) {
    if (side === 'sell') return extractDirektSellTotal(texts);
    return extractDirektBuyTotal(texts);
  }

  return extractHighestEuroAmount(...texts);
}

function scorePatterns(text, patterns) {
  const body = String(text || '');
  if (!body.trim()) return { score: 0, hits: [] };
  const hits = [];
  for (const pattern of patterns) {
    if (pattern.test(body)) hits.push(pattern.source);
  }
  return { score: hits.length, hits };
}

function normalizeConversation(raw = {}) {
  const id = String(
    raw.id
    || raw.conversationId
    || raw.conversation_id
    || raw.uuid
    || '',
  );
  const adTitle = String(
    raw.adTitle
    || raw.ad_title
    || raw.advertisement?.title
    || raw.ad?.title
    || raw.title
    || 'Untitled ad',
  );
  const adId = String(
    raw.adId
    || raw.ad_id
    || raw.advertisement?.id
    || raw.ad?.id
    || '',
  );
  const counterparty = String(
    raw.counterpartName
    || raw.counterparty
    || raw.otherPartyName
    || raw.other_party_name
    || raw.partner?.name
    || raw.userName
    || 'Counterparty',
  );
  const role = String(
    raw.role
    || raw.userRole
    || raw.buyerOrSeller
    || raw.conversationRole
    || raw.adRole
    || '',
  ).toLowerCase();
  const updatedAt = parseMessageDate(
    raw.receivedDate
    || raw.updatedAt
    || raw.modifiedAt
    || raw.lastMessageDate
    || raw.timestamp
    || raw.latestMessage?.receivedDate
    || raw.latestMessage?.timestamp,
  );
  const priceHint = Number(
    raw.adPrice
    || raw.advertisement?.price
    || raw.ad?.price
    || raw.price,
  );
  const adBelongsToUser = Boolean(
    raw.adBelongsToUser
    || raw.belongsToUser
    || raw.advertisement?.userIsOwner
    || raw.ad?.userIsOwner
    || raw.seller,
  );
  const buying = String(raw.buyingOption || raw.purchaseMethod || raw.salesType || '').toLowerCase();
  return {
    id,
    adTitle,
    adId,
    counterparty,
    role,
    updatedAt,
    price: Number.isFinite(priceHint) && priceHint > 0 ? priceHint : null,
    adBelongsToUser,
    buying,
    previewText: String(raw.previewText || raw.statusText || raw.lastMessageText || raw.latestMessage?.text || ''),
    statusText: String(raw.statusText || ''),
    subtitle: String(raw.subtitle || ''),
    whenText: String(raw.whenText || ''),
    chatText: String(raw.chatText || ''),
    priceText: String(raw.priceText || ''),
    url: adId
      ? `https://www.kleinanzeigen.de/s-anzeige/${adId}`
      : 'https://www.kleinanzeigen.de/m-nachrichten.html',
    href: String(raw.href || raw.conversationUrl || raw.url || ''),
    conversationUrl: String(raw.conversationUrl || raw.href || ''),
    raw,
  };
}

function stripHtmlToText(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&euro;/gi, '€')
    .replace(/&#8364;/g, '€')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function messageTextFromItem(item) {
  if (item == null) return '';
  if (typeof item === 'string') return stripHtmlToText(item);
  const candidates = [
    item.message,
    item.text,
    item.body,
    item.content,
    item.shortMessage,
    item.payload?.text,
    item.payload?.message,
    item.payload?.body,
    item.messageText,
    item.html,
    item.richText,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return stripHtmlToText(c);
    if (c && typeof c === 'object') {
      const nested = messageTextFromItem(c);
      if (nested) return nested;
    }
  }
  return '';
}

function normalizeMessages(payload) {
  let list = [];
  if (Array.isArray(payload)) list = payload;
  else if (payload && typeof payload === 'object') {
    list = payload.messages
      || payload.content
      || payload.data?.messages
      || payload.data
      || payload.items
      || payload.conversation?.messages
      || payload._embedded?.messages
      || [];
  }
  if (!Array.isArray(list)) list = [];
  return list.map(item => {
    const text = messageTextFromItem(item);
    const at = parseMessageDate(
      item?.receivedDate
      || item?.sentDate
      || item?.timestamp
      || item?.createdAt
      || item?.date
      || item?.time
      || item?.payload?.timestamp,
    );
    const boundness = String(item?.boundness || item?.direction || item?.type || '').toLowerCase();
    const outbound = /out|sent|self/.test(boundness) || item?.boundness === 'OUTBOUND';
    const system = /system|auto|notification/.test(boundness)
      || Boolean(item?.systemMessage)
      || /artikel\s+bezahlt|geld\s+ausgezahlt|verf[uü]gbarkeit/i.test(text);
    return { text, at, outbound, system, raw: item };
  }).filter(item => item.text);
}

function inferDealSide(convo, messages) {
  if (convo.adBelongsToUser) return 'sell';
  if (/sell|seller|anbieter|owner|verkäufer/.test(convo.role)) return 'sell';
  if (/buy|buyer|käufer|seeker|interessent/.test(convo.role)) return 'buy';

  const joined = [
    convo.previewText || '',
    convo.statusText || '',
    convo.subtitle || '',
    ...messages.map(m => m.text),
  ].join('\n');

  // Direkt kaufen: explicit cues beat heuristics.
  // "Geld ausgezahlt" = you sold (payout done).
  if (DIREKT_SELL_DONE.test(joined)) return 'sell';
  // "Artikel bezahlt" = you bought (buyer payment done).
  if (DIREKT_BUY_DONE.test(joined) && !convo.adBelongsToUser) {
    if (/\bdein\s+artikel\s+wurde\s+gekauft\b|\bzahlung\s+erhalten\b/i.test(joined)) return 'sell';
    return 'buy';
  }
  // Verfügbarkeit bestätigt alone is seller-side progress.
  if (DIREKT_SELL_PROGRESS.test(joined) && !DIREKT_BUY_DONE.test(joined)) return 'sell';

  const sellBias = scorePatterns(joined, SELL_BIAS_PATTERNS).score;
  const buyBias = scorePatterns(joined, BUY_BIAS_PATTERNS).score;

  const outboundSell = messages.some(m => m.outbound && (
    /\bverkauft\b/i.test(m.text)
    || /\bdanke\s+f[uü]r\s+den\s+kauf\b/i.test(m.text)
    || /\bzahlung\s+erhalten\b/i.test(m.text)
  ));
  if (outboundSell) return 'sell';

  if (messages.some(m => /\bdein\s+artikel\s+wurde\s+gekauft\b|\bhat\s+dein\s+angebot\s+gekauft\b/i.test(m.text))) {
    return 'sell';
  }

  if (sellBias > buyBias) return 'sell';
  if (buyBias > sellBias) return 'buy';
  return 'unknown';
}

function detectChannel(messages, convo) {
  const text = [
    convo.previewText || '',
    convo.statusText || '',
    convo.buying || '',
    ...messages.map(m => m.text),
  ].join(' ');
  if (
    DIREKT_BUY_DONE.test(text)
    || DIREKT_SELL_DONE.test(text)
    || DIREKT_SELL_PROGRESS.test(text)
    || /\bdirekt\s*kaufen\b|\bsofortkauf\b|\breserviert\b/i.test(text)
  ) {
    return 'direkt-kaufen';
  }
  if (/\bpaypal\b/i.test(text)) return 'paypal';
  if (/\b[uü]berwiesen\b|\b[uü]berweisung\b/i.test(text)) return 'bank-transfer';
  if (/\bbar\b|\bcash\b/i.test(text)) return 'cash';
  return 'chat';
}

function titleCaseWords(value) {
  return String(value || '')
    .split(/\s+/)
    .filter(Boolean)
    .map(part => {
      if (/^(gtx|rtx|rx|ti|fe|ssd|hdd|ram|gb|tb|mhz)$/i.test(part)) return part.toUpperCase();
      if (/^\d/.test(part)) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
    })
    .join(' ');
}

function normalizeGpuModelToken(raw) {
  let text = String(raw || '').replace(/\s+/g, ' ').trim();
  text = text.replace(/\bgeforce\b/ig, '').replace(/\s+/g, ' ').trim();
  text = text.replace(/\b(rtx|gtx|rx)\s*(\d{3,4})\s*(ti|super)?\b/i, (_, series, model, suffix) => {
    return `${String(series).toUpperCase()} ${model}${suffix ? ` ${String(suffix).toUpperCase()}` : ''}`;
  });
  return text.replace(/\s+/g, ' ').trim();
}

function formatIntelCpu(match) {
  if (!match) return '';
  const family = String(match[1] || '').replace(/\D/g, '');
  const model = String(match[2] || '').toUpperCase();
  if (!family || !model) return '';
  return `Intel Core i${family} ${model}`;
}

/** Clean marketplace titles into a short product name. */
function cleanItemName(...sources) {
  const filtered = sources.filter(s => s && !looksLikePaymentDump(s));
  const hay = (filtered.length ? filtered : sources).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  if (!hay) return 'Item';
  if (looksLikePaymentDump(hay)) return 'Item';

  const makers = 'asus|msi|gigabyte|evga|zotac|palit|gainward|inno3d|pny|sapphire|xfx|powercolor|asrock|nvidia|amd|corsair|kingston|samsung|wd|western\\s*digital|crucial|seagate|intel|amd';
  const boards = 'rog\\s*strix|strix|tuf|dual|gaming\\s*x|gaming\\s*oc|twin\\s*edge|ventus|eagle|windforce|amp\\s*extreme|ftw3?|kingpin|founders?(?:\\s*edition)?|fe|aorus|nitro|pulse|hellhound';

  // PC Teile / multi-part PC listings → "PC Bundle: …"
  const looksLikePcBundle = (
    /\bpc\s*teile\b|\bpc\s*bundle\b|\bpc\s*set\b|\bkompletter?\s*pc\b/i.test(hay)
    || (
      /\b(?:intel\s+)?(?:core\s+)?i\s*[3579]\b|\bryzen\b/i.test(hay)
      && /\b\d+\s*gb\b/i.test(hay)
      && /\b(netzteil|ram|grafikkarte|mainboard|main\s*board|ssd|hdd)\b/i.test(hay)
    )
  );
  if (looksLikePcBundle) {
    const parts = [];
    const cpu = hay.match(/\b(?:intel\s+)?(?:core\s+)?i\s*([3579])\s*[-]?(\d{3,5}\w*)\b/i)
      || hay.match(/\bi\s*([3579])\s+(\d{3,5}\w*)\b/i);
    if (cpu) parts.push(formatIntelCpu(cpu));
    const ryzen = hay.match(/\bryzen\s*([3579])\s*[- ]?(\d{3,4}\w*)\b/i);
    if (!cpu && ryzen) parts.push(`AMD Ryzen ${ryzen[1]} ${ryzen[2].toUpperCase()}`);

    const ram = hay.match(/\b(\d+)\s*gb(?:\s*ram)?\b/i);
    if (ram) parts.push(`${ram[1]}GB ram`);

    if (/\bnetzteil\b/i.test(hay)) parts.push('Netzteil');

    const gpuNamed = hay.match(/\b((?:geforce\s+)?(?:gtx|rtx|rx)\s*\d{3,4}(?:\s*(?:ti|super))?)\b/i);
    if (gpuNamed) parts.push(normalizeGpuModelToken(gpuNamed[1]));
    // Skip bare "Grafikkarte" when no model — keeps names clean.

    if (/\bmainboard\b|\bmain\s*board\b|\bmotherboard\b/i.test(hay)) parts.push('Mainboard');
    const ssd = hay.match(/\b(\d+)\s*(gb|tb)\s*(?:nvme|ssd|m\.?2)?\b/i);
    if (ssd && /\b(ssd|nvme|m\.?2)\b/i.test(hay)) {
      parts.push(`${ssd[1]}${ssd[2].toUpperCase()} SSD`);
    }

    const unique = [...new Set(parts.filter(Boolean))];
    if (unique.length >= 2) return `PC Bundle: ${unique.join(', ')}`;
    if (unique.length === 1) return `PC Bundle: ${unique[0]}`;
  }

  // GPU with optional maker + board
  let gpu = hay.match(new RegExp(
    `\\b(${makers})\\b([\\s\\S]{0,48}?)\\b((?:geforce\\s+)?(?:gtx|rtx|rx)\\s*\\d{3,4}(?:\\s*(?:ti|super))?)\\b`,
    'i',
  ));
  if (!gpu) {
    gpu = hay.match(/\b((?:geforce\s+)?(?:gtx|rtx|rx)\s*\d{3,4}(?:\s*(?:ti|super))?)\b/i);
    if (gpu) {
      const model = normalizeGpuModelToken(gpu[1]);
      const makerOnly = hay.match(new RegExp(`\\b(${makers})\\b`, 'i'));
      const boardOnly = hay.match(new RegExp(`\\b(${boards})\\b`, 'i'));
      if (makerOnly && !/^(nvidia|amd)$/i.test(makerOnly[1])) {
        const maker = titleCaseWords(makerOnly[1].replace(/western\s*digital/i, 'WD'));
        if (boardOnly) return `${maker} ${titleCaseWords(boardOnly[1].replace(/\s+/g, ' '))} ${model}`;
        return `${maker} ${model}`;
      }
      return model;
    }
  } else {
    const makerRaw = gpu[1];
    const mid = gpu[2] || '';
    const model = normalizeGpuModelToken(gpu[3]);
    if (/^(nvidia|amd)$/i.test(makerRaw)) return model;
    const maker = titleCaseWords(makerRaw);
    const board = mid.match(new RegExp(`\\b(${boards})\\b`, 'i'));
    if (board) return `${maker} ${titleCaseWords(board[1].replace(/\s+/g, ' '))} ${model}`;
    return `${maker} ${model}`;
  }

  // CPU only
  let cpu = hay.match(/\b(intel\s+)?(core\s+)?(i[3579])[-\s]?(\d{3,5}\w*)\b/i);
  if (cpu) {
    return `Intel Core ${cpu[3].toLowerCase()} ${String(cpu[4] || '').toUpperCase()}`;
  }
  cpu = hay.match(/\bi\s*([3579])\s*(\d{3,4}\w*)\b/i);
  if (cpu) return `Intel Core i${cpu[1]} ${cpu[2].toUpperCase()}`;
  cpu = hay.match(/\b(ryzen\s*[3579]|r[3579])\s*[- ]?(\d{3,4}\w*)\b/i);
  if (cpu) {
    const series = /ryzen/i.test(cpu[1]) ? `Ryzen ${cpu[1].replace(/ryzen\s*/i, '')}` : cpu[1].toUpperCase();
    return `${titleCaseWords(series)} ${cpu[2].toUpperCase()}`.replace(/\s+/g, ' ').trim();
  }

  // RAM
  const ram = hay.match(/\b(\d+\s*gb)\s*(ddr[345])\b|\b(ddr[345])\s*(\d+\s*gb)\b/i);
  if (ram) {
    const size = (ram[1] || ram[4] || '').toUpperCase().replace(/\s+/g, '');
    const ddr = (ram[2] || ram[3] || '').toUpperCase();
    return `${size} ${ddr}`;
  }

  // SSD
  const ssd = hay.match(/\b(\d+\s*(?:gb|tb))\s*(nvme|ssd|m\.?2)?\b|\b(nvme|ssd|m\.?2)\b.*?\b(\d+\s*(?:gb|tb))\b/i);
  if (ssd && /\b(ssd|nvme|m\.?2)\b/i.test(hay)) {
    const size = (ssd[1] || ssd[4] || '').toUpperCase().replace(/\s+/g, '');
    return `${size} SSD`;
  }

  // Generic cleanup: drop Reserviert / truncation junk
  let cleaned = hay
    .replace(/\bReserviert\s*[•·∙\-–—]\s*/ig, '')
    .replace(/\bArtikel\s+bezahlt\b/ig, '')
    .replace(/\bGeld\s+ausgezahlt\b/ig, '')
    .replace(/\bVerf[uü]gbarkeit\s+best[aä]tigt\b/ig, '')
    .replace(/\b(Heute|Gestern)\s+\d{1,2}:\d{2}\b/ig, '')
    .replace(/\bi\s*7\b/ig, 'i7')
    .replace(/[|/·]+/g, ' ')
    .replace(/\.{2,}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  cleaned = cleaned.slice(0, 72).replace(/[,:;]+$/, '').trim();
  return cleaned || 'Item';
}

function extractPaidAt(messages = [], convo = {}, bounds, side = 'buy') {
  const cue = side === 'sell'
    ? /\bgeld\s+ausgezahlt\b|\bverf[uü]gbarkeit\s+best[aä]tigt\b|\bgezahlt\b|\bzahlung\b/i
    : /\bartikel\s+bezahlt\b|\bgezahlt\b|\bbezahlt\b|\bzahlung\b/i;
  for (const msg of messages) {
    if (cue.test(msg.text || '') && msg.at) return msg.at;
  }
  if (convo.updatedAt) return convo.updatedAt;
  const fromPreview = parseMessageDate(convo.whenText || '');
  if (fromPreview) return fromPreview;
  return bounds?.start || new Date();
}

function suggestionDedupeKey(item) {
  return [
    item.side || '',
    String(item.counterparty || item.seller || item.buyer || '').toLowerCase(),
    String(item.displayName || item.title || '').toLowerCase(),
  ].join('|');
}

function buildSuggestion(side, convo, msg, bounds, extra = {}) {
  const messages = extra.messages || [];
  const paidAt = extractPaidAt(messages, { ...convo, whenText: convo.whenText }, bounds, side);
  let price = extractPaidTotal(messages, convo, side);
  if (price == null) {
    price = extractDirektPaidAmount(
      convo.priceText,
      convo.chatText,
      msg?.text,
      ...messages.map(m => m.text),
    );
  }
  if (price == null && extra.price != null) price = coercePrice(extra.price);
  price = coercePrice(price);
  const displayName = cleanItemName(
    convo.adTitle,
    convo.previewText,
    convo.statusText,
    msg?.text,
    ...messages.map(m => m.text),
  );
  const prefix = side === 'sell' ? 'ka-sell' : 'ka-buy';
  const idSeed = [
    convo.id || '',
    String(convo.counterparty || '').toLowerCase(),
    displayName.toLowerCase(),
    paidAt.toISOString().slice(0, 16),
  ].join('|');
  return {
    id: `${prefix}|${idSeed}`,
    side,
    conversationId: convo.id,
    title: displayName,
    displayName,
    adId: convo.adId,
    counterparty: convo.counterparty,
    seller: side === 'buy' ? convo.counterparty : 'You',
    buyer: side === 'sell' ? convo.counterparty : 'You',
    price,
    at: paidAt.toISOString(),
    purchasedAt: paidAt.toISOString(),
    soldAt: paidAt.toISOString(),
    paidAt: paidAt.toISOString(),
    evidence: String(msg?.text || extra.evidence || '').slice(0, 240),
    url: convo.url,
    role: convo.role,
    channel: extra.channel || 'chat',
    score: Number(extra.score) || 1,
    confirmed: false,
  };
}

/** Returns suggested buys + sells. Nothing is imported until the user confirms. */
function detectDealSuggestions(conversations, messagesById, bounds) {
  const buys = [];
  const sells = [];
  const seen = new Set();

  for (const convo of conversations) {
    if (looksLikePaymentDump(convo.adTitle) || looksLikePaymentDump(convo.previewText)) continue;

    const messages = [...(messagesById.get(convo.id) || [])];

    if (convo.previewText || convo.statusText || convo.chatText) {
      const preview = [convo.statusText, convo.previewText, convo.subtitle, convo.chatText]
        .filter(Boolean)
        .join('\n');
      messages.unshift({
        text: preview,
        at: convo.updatedAt || bounds.start,
        outbound: false,
        system: true,
      });
    }

    const joinedInbox = `${convo.previewText || ''} ${convo.statusText || ''} ${convo.subtitle || ''} ${convo.chatText || ''}`;
    const inboxBuy = DIREKT_BUY_DONE.test(joinedInbox);
    // Sold only when payout completed — not merely Verfügbarkeit bestätigt.
    const inboxSold = DIREKT_SELL_DONE.test(joinedInbox)
      || messages.some(m => DIREKT_SELL_DONE.test(m.text || ''));
    const inboxSellProgress = DIREKT_SELL_PROGRESS.test(joinedInbox)
      || messages.some(m => DIREKT_SELL_PROGRESS.test(m.text || ''));
    const messageSold = messages.some(m => DIREKT_SELL_DONE.test(m.text || ''));
    const messageBuy = messages.some(m => DIREKT_BUY_DONE.test(m.text || ''));

    const inWindow = messages.filter(m => !m.at || inRange(m.at, bounds.start, bounds.end));
    const pool = inWindow.length ? inWindow : (
      (convo.updatedAt && inRange(convo.updatedAt, bounds.start, bounds.end))
      || inboxBuy
      || inboxSold
      || messageSold
      || messageBuy
        ? messages.slice(-10)
        : []
    );
    if (
      !pool.length
      && !inboxBuy
      && !inboxSold
      && !messageSold
      && !messageBuy
      && !(convo.updatedAt && inRange(convo.updatedAt, bounds.start, bounds.end))
    ) {
      continue;
    }
    const effectivePool = pool.length ? pool : messages.slice(-8);

    const side = inferDealSide(convo, messages.length ? messages : effectivePool);
    const channel = detectChannel(messages.length ? messages : effectivePool, convo);

    let best = null;
    for (const msg of effectivePool) {
      const deal = scorePatterns(msg.text, DEAL_PATTERNS);
      const isBuyDone = DIREKT_BUY_DONE.test(msg.text) || inboxBuy;
      const isSellDone = DIREKT_SELL_DONE.test(msg.text) || inboxSold;
      const isDirektCue = isBuyDone || isSellDone
        || DIREKT_SELL_PROGRESS.test(msg.text)
        || (/\breserviert\b/i.test(msg.text) && /\bbezahlt\b/i.test(msg.text));
      // Require a real deal cue — skip weak single-word hits from unrelated chats.
      if (!isBuyDone && !isSellDone && !inboxBuy && !inboxSold && deal.score < 2) continue;
      if (DIREKT_SELL_PROGRESS.test(msg.text) && !isSellDone && !inboxSold && !isBuyDone && !inboxBuy) {
        continue;
      }
      const sellExtra = scorePatterns(msg.text, SELL_BIAS_PATTERNS).score;
      const buyExtra = scorePatterns(msg.text, BUY_BIAS_PATTERNS).score;
      let msgSide = side;
      if (isSellDone || inboxSold) msgSide = 'sell';
      else if (isBuyDone || inboxBuy) msgSide = 'buy';
      else if (side === 'unknown') msgSide = sellExtra > buyExtra ? 'sell' : 'buy';

      const looksLikeDirektSellFlow = DIREKT_SELL_PROGRESS.test(joinedInbox)
        || DIREKT_SELL_DONE.test(joinedInbox)
        || messages.some(m => DIREKT_SELL_PROGRESS.test(m.text || '') || DIREKT_SELL_DONE.test(m.text || ''));

      if (msgSide === 'sell' && looksLikeDirektSellFlow && !isSellDone && !inboxSold && !messageSold) {
        continue;
      }

      const candidate = buildSuggestion(msgSide, convo, msg, bounds, {
        channel: (isDirektCue || inboxBuy || inboxSold) ? 'direkt-kaufen' : channel,
        score: (deal.score || 1)
          + ((isBuyDone || isSellDone || inboxBuy || inboxSold) ? 3 : 0)
          + sellExtra * 0.35
          + buyExtra * 0.25,
        messages,
        price: convo.price,
      });
      if (!best || candidate.score > best.score) best = candidate;
    }

    // Soft fallback only for clear Direkt-kaufen inbox/message cues — not every opened chat.
    if (!best && (inboxBuy || inboxSold || messageBuy || messageSold)) {
      const softText = [
        convo.statusText,
        convo.previewText,
        convo.chatText,
        ...messages.slice(-6).map(m => m.text),
      ].filter(Boolean).join(' · ');
      const softSold = inboxSold || messageSold;
      const softBuy = inboxBuy || messageBuy;
      let softSide = side;
      if (softSold) softSide = 'sell';
      else if (softBuy) softSide = 'buy';
      else if (softSide === 'unknown') softSide = softBuy ? 'buy' : 'sell';
      const looksLikeDirektSellFlow = DIREKT_SELL_PROGRESS.test(softText) || DIREKT_SELL_DONE.test(softText);
      if (!(softSide === 'sell' && looksLikeDirektSellFlow && !softSold)) {
        best = buildSuggestion(softSide, convo, { text: softText, at: convo.updatedAt }, bounds, {
          channel: 'direkt-kaufen',
          score: 3,
          evidence: softText,
          messages,
          price: convo.price,
        });
      }
    }

    // Ignore Verfügbarkeit-only chats (amount noted for later, but not sold yet).
    if (!best && inboxSellProgress && !inboxSold && !messageSold) continue;

    if (!best) continue;
    if (looksLikePaymentDump(best.displayName) || looksLikePaymentDump(best.title)) continue;
    const key = suggestionDedupeKey(best);
    if (seen.has(key)) continue;
    seen.add(key);
    if (best.side === 'sell') sells.push(best);
    else buys.push(best);
  }

  buys.sort((a, b) => String(b.paidAt || b.at).localeCompare(String(a.paidAt || a.at)));
  sells.sort((a, b) => String(b.paidAt || b.at).localeCompare(String(a.paidAt || a.at)));
  return { buys, sells };
}

// Back-compat alias used by older background code paths.
function detectPurchases(conversations, messagesById, bounds) {
  return detectDealSuggestions(conversations, messagesById, bounds).buys;
}

function pageResolveUserId() {
  const html = document.documentElement?.innerHTML || '';
  const patterns = [
    /"userId"\s*:\s*"?(\d{5,})"?/i,
    /"user_id"\s*:\s*"?(\d{5,})"?/i,
    /userId=(\d{5,})/i,
    /\/messagebox\/api\/users\/(\d{5,})\//i,
    /data-user-id="(\d{5,})"/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return m[1];
  }
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      const val = localStorage.getItem(key) || '';
      const m = `${key} ${val}`.match(/userId["\s:=]+(\d{5,})/i);
      if (m) return m[1];
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function pageFetchJson(url, accessToken = '') {
  const headers = {
    Accept: 'application/json, text/plain, */*',
    'X-Requested-With': 'XMLHttpRequest',
  };
  if (accessToken) headers.Authorization = `Bearer ${String(accessToken).replace(/^Bearer\s+/i, '')}`;
  const res = await fetch(url, {
    credentials: 'include',
    headers,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  return { ok: res.ok, status: res.status, url, data, text: text.slice(0, 500) };
}

function pageFindAccessToken() {
  const bags = [];
  try { bags.push(localStorage); } catch { /* ignore */ }
  try { bags.push(sessionStorage); } catch { /* ignore */ }
  for (const store of bags) {
    try {
      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i) || '';
        const val = store.getItem(key) || '';
        if (/access[_-]?token|id[_-]?token|auth.*token/i.test(key) && val.length > 20 && !val.includes('{')) {
          return val.replace(/^Bearer\s+/i, '');
        }
        const m = val.match(/"(?:access_token|accessToken|id_token|idToken)"\s*:\s*"([^"]{20,})"/);
        if (m) return m[1];
      }
    } catch {
      /* ignore */
    }
  }
  try {
    const cookie = document.cookie || '';
    const m = cookie.match(/(?:access_token|authorization)=([^;]+)/i);
    if (m) return decodeURIComponent(m[1]).replace(/^Bearer\s+/i, '');
  } catch {
    /* ignore */
  }
  return '';
}

/**
 * Must be self-contained for executeScript({ func }).
 * Clicks an inbox row matching counterparty / Direkt cues.
 */
/**
 * Must be self-contained for executeScript({ func }).
 * Direkt buy paid total = euro amount immediately ABOVE "Artikel bezahlt"
 * (e.g. 60,44 € then Artikel bezahlt; ignore Betrag/Käuferschutz/Versand below).
 */
function pageExtractChatPrice() {
  function parseN(raw) {
    let s = String(raw || '').trim().replace(/\s+/g, '');
    if (!s) return null;
    if (/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(',', '.');
    const n = Number(s);
    if (!Number.isFinite(n) || n <= 0 || n >= 20000) return null;
    return Math.round(n * 100) / 100;
  }

  function normalize(value) {
    return String(value || '')
      .replace(/\u00a0|\u202f|\u2009/g, ' ')
      .replace(/EUR\b|Euro\b/gi, '€')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function looksLikeDayMonth(raw) {
    const m = String(raw || '').trim().match(/^(\d{1,2})[.,](\d{2})$/);
    if (!m) return false;
    const day = Number(m[1]);
    const month = Number(m[2]);
    return day >= 1 && day <= 31 && month >= 1 && month <= 12;
  }

  function amountAboveCue(text, cueSource) {
    const raw = normalize(text);
    const cue = new RegExp(cueSource, 'gi');
    let best = null;
    let match;
    while ((match = cue.exec(raw))) {
      let window = raw.slice(Math.max(0, match.index - 140), match.index);
      window = window
        .replace(/\bBetrag\s+\d{1,5}(?:[.,]\d{2})\s*€/gi, ' ')
        .replace(/\bK[aä]uferschutz\s+\d{1,5}(?:[.,]\d{2})\s*€/gi, ' ')
        .replace(/\bVersand\s+\d{1,5}(?:[.,]\d{2})\s*€/gi, ' ')
        .replace(/\bArtikel\s+\d{1,5}(?:[.,]\d{2})\s*€/gi, ' ');
      const withEuro = [...window.matchAll(/(\d{1,5}(?:[.,]\d{2}))\s*€/gi)]
        .filter(m => !looksLikeDayMonth(m[1]));
      if (withEuro.length) {
        const values = withEuro.map(m => parseN(m[1])).filter(n => n != null);
        if (values.length) best = Math.max(...values);
        continue;
      }
      if (/€/.test(window)) {
        const bare = [...window.matchAll(/(\d{1,5}),(\d{2})(?!\d)/g)]
          .map(m => `${m[1]},${m[2]}`)
          .filter(t => !looksLikeDayMonth(t));
        const values = bare.map(t => parseN(t)).filter(n => n != null);
        if (values.length) best = Math.max(...values);
      }
    }
    return best;
  }

  const list = document.querySelector('[class*="ConversationList"]')
    || document.querySelector('[class*="conversation-list"]')
    || document.querySelector('aside');

  const pane = document.querySelector('[class*="ConversationDetail"]')
    || document.querySelector('[class*="conversation-detail"]')
    || document.querySelector('[class*="MessageList"]');

  const scope = (pane && !(list && list.contains(pane)))
    ? pane
    : (document.querySelector('main') || document.body);

  const leaves = [];
  try {
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_ELEMENT);
    let node = walker.currentNode;
    while (node) {
      if (list && scope !== list && list.contains(node)) {
        node = walker.nextNode();
        continue;
      }
      if (node.childElementCount === 0) {
        const t = normalize(node.textContent || '');
        if (t && t.length <= 48) leaves.push(t);
      }
      node = walker.nextNode();
    }
  } catch {
    /* ignore */
  }

  const bestText = normalize(`${scope.innerText || ''} ${leaves.join(' ')}`);

  // Buy: amount right above "Artikel bezahlt"
  const buyTotal = amountAboveCue(bestText, 'Artikel\\s+bezahlt');
  if (buyTotal != null) {
    return { price: buyTotal, source: 'artikel-bezahlt', snip: bestText.slice(0, 240) };
  }

  // Sell: amount right above "Geld ausgezahlt"
  const sellTotal = amountAboveCue(bestText, 'Geld\\s+ausgezahlt');
  if (sellTotal != null) {
    return { price: sellTotal, source: 'geld-ausgezahlt', snip: bestText.slice(0, 240) };
  }

  // Fallback: labeled Preis … €
  const withEuro = bestText.match(/\bPreis\s+(\d{1,5}(?:[.,]\d{2}))\s*€/i)
    || bestText.match(/\bPreis\b[^\d]{0,16}(\d{1,5}(?:[.,]\d{2}))\s*€/i);
  if (withEuro && !looksLikeDayMonth(withEuro[1])) {
    const n = parseN(withEuro[1]);
    if (n != null) return { price: n, source: 'preis', snip: bestText.slice(0, 240) };
  }

  return { price: null, source: 'none', snip: bestText.slice(0, 240) };
}

function pageClickConversation(counterparty = '', title = '') {
  const name = String(counterparty || '').trim().toLowerCase();
  const titleBit = String(title || '').trim().toLowerCase().slice(0, 18);
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
    if (/artikel\s+bezahlt|geld\s+ausgezahlt|reserviert/i.test(text)) score += 2;
    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (!best || bestScore < 4) return { ok: false, bestScore };
  const clickable = best.closest('a') || best.querySelector('a') || best;
  clickable.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  if (typeof clickable.click === 'function') clickable.click();
  return { ok: true, bestScore };
}

async function pageWaitForInbox(timeoutMs = 14000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const body = document.body?.innerText || '';
    if (/Artikel\s+bezahlt|Geld\s+ausgezahlt|Verf[uü]gbarkeit\s+best[aä]tigt|Reserviert\s*[•·]|Nachrichten/i.test(body)) return true;
    if (document.querySelectorAll('a[href*="conversation"], [class*="onversation"]').length > 0) return true;
    await new Promise(resolve => setTimeout(resolve, 350));
  }
  return false;
}

function parseInboxRowText(text, href = '') {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean || clean.length < 8) return null;
  if (/^alle auswählen$/i.test(clean)) return null;

  const timeMatch = clean.match(/\b(Heute|Gestern)\s+(\d{1,2}:\d{2})\b/i)
    || clean.match(/\b(\d{1,2}\.\d{1,2}\.\d{2,4})\b/);
  const whenText = timeMatch
    ? (timeMatch[2] ? `${timeMatch[1]} ${timeMatch[2]}` : timeMatch[1])
    : '';

  const reservedMatch = clean.match(/\bReserviert\s*[•·\-–—]\s*(.+?)(?=\s+Artikel\s+bezahlt\b|$)/i);
  const paid = /\bArtikel\s+bezahlt\b/i.test(clean);
  const reserved = Boolean(reservedMatch);
  if (!paid && !reserved && !/conversation/i.test(href)) return null;

  const titleFromReserved = (reservedMatch?.[1] || '').replace(/\s+/g, ' ').trim();
  const statusText = [
    reservedMatch ? `Reserviert • ${titleFromReserved}` : '',
    paid ? 'Artikel bezahlt' : '',
  ].filter(Boolean).join('\n');

  let counterparty = '';
  if (whenText) {
    const before = clean.split(new RegExp(whenText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))[0] || '';
    counterparty = before.replace(/alle auswählen/i, '').trim().split(/\s{2,}|\s•\s/)[0]?.trim() || '';
  }
  if (!counterparty) {
    counterparty = clean.split(/\s{2,}|\sHeut|\sGest|\sReserviert/i)[0]?.trim().slice(0, 40) || '';
  }

  const idMatch = String(href).match(/conversation[s]?\/([a-zA-Z0-9_-]+)/i)
    || String(href).match(/cid=([a-zA-Z0-9_-]+)/i);

  return {
    id: idMatch?.[1] || '',
    title: titleFromReserved || clean.slice(0, 120),
    counterparty,
    whenText,
    statusText,
    previewText: statusText || clean.slice(0, 200),
    subtitle: paid ? 'Artikel bezahlt' : '',
    href,
    text: clean,
    paid,
    reserved,
  };
}

/**
 * Must be self-contained: chrome.scripting.executeScript({ func }) only injects
 * this function's source — sibling helpers like parseInboxRowText are NOT available.
 */
async function pageScrapeInboxDom() {
  function hashLocal(value) {
    const raw = String(value || '');
    let hash = 0;
    for (let i = 0; i < raw.length; i += 1) {
      hash = ((hash << 5) - hash) + raw.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }

  function parseRow(text, href = '') {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean || clean.length < 8) return null;
    if (/^alle auswählen$/i.test(clean)) return null;

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
    if (!paid && !sold && !availabilityConfirmed && !reserved && !/conversation/i.test(href)) return null;

    const titleFromReserved = (reservedMatch?.[1] || '').replace(/\s+/g, ' ').trim();
    const statusText = [
      reservedMatch ? `Reserviert • ${titleFromReserved}` : '',
      paid ? 'Artikel bezahlt' : '',
      sold ? 'Geld ausgezahlt' : '',
      availabilityConfirmed ? 'Verfügbarkeit bestätigt' : '',
    ].filter(Boolean).join('\n');

    let counterparty = '';
    if (whenText) {
      const before = clean.split(new RegExp(whenText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'))[0] || '';
      counterparty = before.replace(/alle auswählen/i, '').trim().split(/\s{2,}|\s•\s/)[0]?.trim() || '';
    }
    if (!counterparty) {
      counterparty = clean.split(/\s{2,}|\sHeut|\sGest|\sReserviert/i)[0]?.trim().slice(0, 40) || '';
    }

    const idMatch = String(href).match(/conversation[s]?\/([a-zA-Z0-9_-]+)/i)
      || String(href).match(/cid=([a-zA-Z0-9_-]+)/i);

    return {
      id: idMatch?.[1] || '',
      title: titleFromReserved || clean.slice(0, 120),
      counterparty,
      whenText,
      statusText,
      previewText: statusText || clean.slice(0, 200),
      subtitle: paid ? 'Artikel bezahlt' : sold ? 'Geld ausgezahlt' : '',
      href,
      text: clean,
      paid,
      sold,
      availabilityConfirmed,
      reserved,
    };
  }

  const seen = new Set();
  const items = [];

  const pushItem = (parsed) => {
    if (!parsed) return;
    const key = parsed.id
      || `${parsed.counterparty}|${parsed.title}|${parsed.whenText}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    items.push({
      ...parsed,
      id: parsed.id || `dom-${hashLocal(key)}`,
    });
  };

  const roots = [
    ...document.querySelectorAll('[data-testid*="conversation"]'),
    ...document.querySelectorAll('[class*="ConversationList"] li'),
    ...document.querySelectorAll('[class*="conversation-list"] li'),
    ...document.querySelectorAll('[class*="Conversation"]'),
    ...document.querySelectorAll('.msgbox-conversation, .ConversationListItem'),
    ...document.querySelectorAll('a[href*="conversation"]'),
    ...document.querySelectorAll('li, article, [role="listitem"], [role="option"], [role="row"]'),
  ];

  for (const node of roots) {
    const row = node.closest('li, article, [role="listitem"], [role="option"], [role="row"], a, div') || node;
    const link = row.closest('a') || row.querySelector('a') || (row.tagName === 'A' ? row : null);
    const href = link?.getAttribute?.('href') || '';
    const text = (row.innerText || row.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length > 500) continue;
    pushItem(parseRow(text, href));
  }

  // Visible-text fallback: parse the inbox list even when React nodes don't match.
  const bodyText = (document.body?.innerText || '').replace(/\u00a0/g, ' ');
  const rowRe = /([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß.'\- ]{1,48}?)\s+(Heute|Gestern)\s+(\d{1,2}:\d{2})\s+Reserviert\s*[•·∙\-–—]\s*(.+?)\s+Artikel\s+bezahlt/gi;
  let match;
  while ((match = rowRe.exec(bodyText))) {
    const counterparty = match[1].replace(/\s+/g, ' ').trim();
    const whenText = `${match[2]} ${match[3]}`;
    const title = match[4].replace(/\s+/g, ' ').trim();
    pushItem({
      id: '',
      title,
      counterparty,
      whenText,
      statusText: `Reserviert • ${title}\nArtikel bezahlt`,
      previewText: `Reserviert • ${title}\nArtikel bezahlt`,
      subtitle: 'Artikel bezahlt',
      href: '',
      text: match[0].replace(/\s+/g, ' ').trim(),
      paid: true,
      reserved: true,
    });
  }

  // Softer paid-only rows (layout quirks / missing Reserviert prefix).
  if (!items.some(i => i.paid)) {
    const softRe = /([A-Za-zÄÖÜäöüß][\wÄÖÜäöüß.'\- ]{1,48}?)\s+(Heute|Gestern)\s+(\d{1,2}:\d{2})[\s\S]{0,160}?Artikel\s+bezahlt/gi;
    while ((match = softRe.exec(bodyText))) {
      const counterparty = match[1].replace(/\s+/g, ' ').trim();
      const whenText = `${match[2]} ${match[3]}`;
      const chunk = match[0].replace(/\s+/g, ' ').trim();
      const titleMatch = chunk.match(/Reserviert\s*[•·∙\-–—]\s*(.+?)\s+Artikel\s+bezahlt/i);
      pushItem(parseRow(chunk, '') || {
        id: '',
        title: titleMatch?.[1]?.trim() || chunk.slice(0, 80),
        counterparty,
        whenText,
        statusText: titleMatch ? `Reserviert • ${titleMatch[1].trim()}\nArtikel bezahlt` : 'Artikel bezahlt',
        previewText: chunk.slice(0, 200),
        subtitle: 'Artikel bezahlt',
        href: '',
        text: chunk,
        paid: true,
        reserved: Boolean(titleMatch),
      });
    }
  }

  return {
    items,
    debug: {
      href: location.href,
      bodyHasPaid: /Artikel\s+bezahlt/i.test(bodyText),
      bodyHasReserved: /Reserviert/i.test(bodyText),
      bodySnippet: bodyText.replace(/\s+/g, ' ').trim().slice(0, 180),
      itemCount: items.length,
    },
  };
}

function hashText(value) {
  const raw = String(value || '');
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    hash = ((hash << 5) - hash) + raw.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function mergeInboxDomIntoConversations(conversations, domItems) {
  if (!Array.isArray(domItems) || !domItems.length) return conversations || [];

  // Include Direkt-kaufen rows and general dated inbox chats (PayPal/cash/etc.).
  const byKey = new Map();

  const add = (convo, key) => {
    if (!key || byKey.has(key)) return;
    byKey.set(key, convo);
  };

  for (const [index, item] of domItems.entries()) {
    const hasDirekt = item.paid || item.reserved || item.sold || item.availabilityConfirmed;
    const hasDate = Boolean(item.whenText || item.text);
    if (!hasDirekt && !hasDate) continue;
    if (!item.counterparty && !item.title) continue;

    const updatedAt = parseMessageDate(item.whenText || item.text);
    const title = item.title || 'Untitled ad';
    const key = `${String(item.counterparty || '').toLowerCase()}|${String(title).toLowerCase().slice(0, 40)}|${item.whenText || ''}`;
    const statusBits = [
      item.reserved && title ? `Reserviert • ${title}` : '',
      item.paid ? 'Artikel bezahlt' : '',
      item.sold ? 'Geld ausgezahlt' : '',
      item.availabilityConfirmed ? 'Verfügbarkeit bestätigt' : '',
      item.general ? (item.previewText || title) : '',
    ].filter(Boolean);
    add(normalizeConversation({
      id: item.id || `dom-${index}`,
      adTitle: title,
      title,
      counterpartName: item.counterparty,
      updatedAt,
      previewText: item.previewText || statusBits.join('\n'),
      statusText: item.statusText || statusBits.join('\n'),
      subtitle: item.subtitle || (item.paid ? 'Artikel bezahlt' : item.sold ? 'Geld ausgezahlt' : ''),
      whenText: item.whenText,
      price: item.price || null,
      chatText: item.chatText || '',
      href: item.href || '',
      conversationUrl: item.href || '',
    }), key);
    const convo = byKey.get(key);
    if (convo) {
      convo.whenText = item.whenText || '';
      convo.previewText = item.previewText || convo.previewText;
      convo.statusText = item.statusText || convo.statusText;
      convo.subtitle = item.subtitle || convo.subtitle;
      convo.updatedAt = updatedAt || convo.updatedAt;
      if (item.price) convo.price = item.price;
      if (item.chatText) convo.chatText = item.chatText;
      if (item.href) {
        convo.href = item.href;
        convo.conversationUrl = item.href;
      }
      if (item.id) convo.id = item.id;
    }
  }

  // Attach API conversations that don't collide with an existing DOM paid row.
  for (const convo of conversations || []) {
    const key = `${String(convo.counterparty || '').toLowerCase()}|${String(convo.adTitle || '').toLowerCase().slice(0, 40)}`;
    if (byKey.has(key) || [...byKey.keys()].some(k => k.startsWith(key))) {
      // merge into best match
      const existingKey = byKey.has(key) ? key : [...byKey.keys()].find(k => k.startsWith(key));
      const existing = byKey.get(existingKey);
      byKey.set(existingKey, {
        ...convo,
        ...existing,
        id: convo.id || existing.id,
        adId: convo.adId || existing.adId,
        price: existing.price || convo.price || existing.price,
        previewText: existing.previewText || convo.previewText,
        statusText: existing.statusText || convo.statusText,
        subtitle: existing.subtitle || convo.subtitle,
        whenText: existing.whenText || convo.whenText,
        updatedAt: existing.updatedAt || convo.updatedAt,
        chatText: existing.chatText || convo.chatText || '',
      });
      continue;
    }
    add({ ...convo }, key || `api-${convo.id}`);
  }

  // Also keep unpaid API chats for other deal types.
  for (const convo of conversations || []) {
    const key = `api-id|${convo.id}`;
    if (![...byKey.values()].some(c => c.id === convo.id)) add({ ...convo }, key);
  }

  return [...byKey.values()];
}
