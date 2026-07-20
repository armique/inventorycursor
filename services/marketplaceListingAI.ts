/**
 * German eBay.de / Kleinanzeigen.de marketplace listing generator.
 * Produces an optimized title + full listing body (+ owner-only price/keyword hints).
 */
import type { InventoryItem } from '../types';
import { ItemStatus } from '../types';
import { requestAIJson } from './specsAI';
import { isMotherboardItem } from '../utils/builderSlotMatch';

export interface MarketplaceListingHints {
  hasOVP?: boolean;
  hasIOShield?: boolean;
}

export interface MarketplaceListingResult {
  /** Optimized eBay title (~80 chars). */
  ebayTitle: string;
  /** Owner-only: approx new price in Germany. */
  newPriceGermany: string;
  /** Owner-only: recommended used sell price. */
  recommendedUsedPrice: string;
  /** Full German listing body (copy-ready). */
  listingText: string;
  /** Owner-only search keywords. */
  searchKeywords: string[];
}

const LISTING_PROMPT_RULES = `Ты являешься профессиональным специалистом по созданию объявлений для eBay.de и Kleinanzeigen.de.

Твоя задача — писать максимально продающие, аккуратные и профессиональные объявления исключительно на немецком языке.

=========================
ОБЩИЕ ПРАВИЛА
=========================

listingText и ebayTitle — только немецкий язык.

Между РАЗДЕЛАМИ (перед каждым заголовком с emoji) всегда оставляй ровно одну пустую строку.
Внутри раздела (список Technische Daten, строки Lieferumfang и т.д.) — без пустых строк, только обычный перевод строки.
Не используй две и более пустых строк подряд — после копирования в eBay не должно быть больших пробелов.
Используй максимум один эмодзи на раздел.
Не используй горизонтальные линии -----.
Описание должно одинаково хорошо выглядеть на ПК и в приложении eBay.

=========================
СТРУКТУРА listingText
=========================

Первая строка объявления — название товара (короткая строка с составом, без emoji).

Затем разделы (ровно один emoji в заголовке раздела).
Между разделами — ровно одна пустая строка:

💻 или 🎮 или 💾 или 🖥️ — краткое описание (1–2 коротких предложения)

🔧 Technische Daten

📦 Lieferumfang

ℹ️ Hinweis (только если есть важные особенности)

✅ Zustand

🔥 Weitere Komponenten verfügbar (для ПК и комплектующих / bundles)

=========================
ПРОЦЕССОРЫ
=========================

Всегда указывать: Kerne, Threads, Basistakt, Turbo.

=========================
ОПЕРАТИВНАЯ ПАМЯТЬ
=========================

Всегда: Hersteller, Modell, Volumen, Typ, Frequenz, ECC/Non-ECC und Registered/Unbuffered wenn bekannt.

=========================
ВИДЕОКАРТЫ
=========================

Всегда: Hersteller, Modell, Speicher, Speichertyp, PCI Express, Architektur wenn aktuell, Videoausgänge.

=========================
PC BUNDLE / FERTIG-PC
=========================

В конце listingText всегда добавляй:

🔥 In meinen weiteren Anzeigen sowie auf Lager finden Sie außerdem Grafikkarten, Netzteile, SSDs, NVMe-SSDs, Arbeitsspeicher, Mainboards, Prozessoren, PC-Gehäuse, Luft- und Wasserkühlungen sowie viele weitere PC-Komponenten. Bei Interesse einfach eine Nachricht schreiben – ich stelle Ihnen gerne ein passendes Komplettpaket zusammen.

Для готовых ПК: CPU, Kerne, Threads, Takte, RAM, SSD, Windows (если есть), царапины на корпусе если есть.

=========================
LIEFERUMFANG / OVP / IO
=========================

Перечисляй комплект отдельно.
Если нет OVP: Ohne Originalverpackung
Если есть OVP: Originalverpackung vorhanden

IO-Blende / IO Shield:
- Упоминай IO-Blende ТОЛЬКО для Mainboards / Motherboards.
- Для всех остальных товаров (RAM, CPU, GPU, SSD, PSU, Gehäuse, Fertig-PC, Bundle и т.д.) НИКОГДА не пиши IO-Blende, Ohne IO-Blende, IO Shield и подобные строки.
- Для Mainboard: если IO-Blende есть — «IO-Blende»; если нет — «Ohne IO-Blende».

=========================
ZUSTAND
=========================

Используй ✅ Zustand (НЕ "Zustandsbeschreibung").
Пример: Gebraucht / Voll funktionsfähig / Normale Gebrauchsspuren

Исправные товары: НИКОГДА не писать Privatverkauf / Keine Garantie / Keine Rücknahme.

Дефектные: всегда
Verkauf ausdrücklich als defekt.
Keine Garantie und keine Rücknahme.

=========================
СТИЛЬ
=========================

Как профессиональное объявление крупного немецкого магазина. Без воды. Максимально продающее.
Одинаковый стиль оформления.`;

function buildItemContext(item: InventoryItem, hints?: MarketplaceListingHints): string {
  const specs = item.specs
    ? Object.entries(item.specs)
        .filter(([, v]) => v != null && String(v).trim())
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n')
    : '';
  const hasOVP = hints?.hasOVP === true || item.hasOVP === true;
  const isMobo = isMotherboardItem(item);
  const hasIO = isMobo && (hints?.hasIOShield === true || item.hasIOShield === true);
  const lines = [
    `Product name: ${item.name}`,
    `Category: ${item.category}${item.subCategory ? ` / ${item.subCategory}` : ''}`,
    item.vendor ? `Vendor: ${item.vendor}` : '',
    item.isPC ? 'Type: Fertig-PC' : '',
    item.isBundle || item.category === 'Bundle' || item.category === 'Mixed Bundle'
      ? 'Type: PC Bundle / Komponenten-Bundle'
      : '',
    item.isDefective ? 'Condition flag: DEFECTIVE' : 'Condition flag: WORKING',
    `OVP: ${hasOVP ? 'YES — Originalverpackung vorhanden' : 'NO — Ohne Originalverpackung'}`,
    isMobo
      ? `IO-Blende: ${hasIO ? 'YES — include IO-Blende in Lieferumfang' : 'NO — Ohne IO-Blende in Lieferumfang'}`
      : 'IO-Blende: NOT APPLICABLE — do not mention IO-Blende / IO Shield at all',
    item.comment1 ? `Notes: ${item.comment1}` : '',
    specs ? `Specs:\n${specs}` : '',
  ].filter(Boolean);
  return lines.join('\n');
}

function clampTitle(title: string): string {
  const t = String(title || '').replace(/\s+/g, ' ').trim();
  if (t.length <= 80) return t;
  return t.slice(0, 80).trim();
}

/** Emoji section headers used in German marketplace listings. */
const LISTING_SECTION_HEADER =
  /^(?:💻|🎮|💾|🖥️|🔧\s*Technische|📦\s*Lieferumfang|ℹ️\s*Hinweis|✅\s*Zustand|🔥)/u;

/**
 * Ensure exactly one blank line before each section header.
 * Keeps bullet/spec lines inside a section tight (no blank lines).
 */
export function normalizeListingSectionSpacing(text: string): string {
  const lines = String(text || '')
    .replace(/\r\n/g, '\n')
    .split('\n');
  const out: string[] = [];

  for (const raw of lines) {
    const trimmed = raw.trimEnd();
    const isHeader = LISTING_SECTION_HEADER.test(trimmed.trim());

    if (isHeader && out.length > 0) {
      while (out.length && out[out.length - 1].trim() === '') out.pop();
      out.push('');
    } else if (trimmed.trim() === '') {
      // Drop blank lines that are not the intentional section separator.
      // (Headers insert their own blank line above.)
      continue;
    }

    out.push(trimmed);
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** IO-Blende / IO Shield lines — only allowed for motherboards. */
const IO_BLENDE_LINE =
  /(?:🔧\s*)?(?:ohne\s+)?io[\s-]*(?:blende|shield)\b|i\/?o[\s-]*(?:blende|shield)\b/i;

/**
 * Strip IO-Blende mentions from listings that are not motherboards.
 */
export function stripIoBlendeUnlessMotherboard(
  text: string,
  item: Pick<InventoryItem, 'category' | 'subCategory' | 'name'>
): string {
  if (isMotherboardItem(item as InventoryItem)) return String(text || '');
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !IO_BLENDE_LINE.test(line.trim()))
    .join('\n');
}

/**
 * Generate marketplace title + German listing (+ owner price/keyword hints).
 */
export async function generateMarketplaceListing(
  item: InventoryItem,
  hints?: MarketplaceListingHints
): Promise<MarketplaceListingResult> {
  const prompt = `${LISTING_PROMPT_RULES}

=========================
ITEM DATA
=========================
${buildItemContext(item, hints)}

=========================
OUTPUT FORMAT (JSON ONLY)
=========================
Return ONE valid JSON object (no markdown fences) with keys:
{
  "ebayTitle": "German eBay title, use almost 80 characters, SEO-optimized",
  "newPriceGermany": "approx new price in Germany as short German text e.g. ca. 329 €",
  "recommendedUsedPrice": "recommended used price range for Germany e.g. 199–229 €",
  "listingText": "full German listing body following STRUCTURE above (plain text + newlines; one blank line between sections only)",
  "searchKeywords": ["15-25 popular German/eBay search terms as short strings"]
}`;

  const data = await requestAIJson<{
    ebayTitle?: string;
    newPriceGermany?: string;
    recommendedUsedPrice?: string;
    listingText?: string;
    searchKeywords?: string[];
  }>(prompt, { maxTokens: 2200 });

  const listingText = normalizeListingSectionSpacing(
    stripIoBlendeUnlessMotherboard(String(data.listingText || ''), item)
  );
  if (!listingText) {
    throw new Error('AI returned an empty listing. Try again.');
  }

  const keywords = Array.isArray(data.searchKeywords)
    ? data.searchKeywords.map((k) => String(k || '').trim()).filter(Boolean).slice(0, 25)
    : [];

  return {
    ebayTitle: clampTitle(data.ebayTitle || item.name),
    newPriceGermany: String(data.newPriceGermany || '').trim() || '—',
    recommendedUsedPrice: String(data.recommendedUsedPrice || '').trim() || '—',
    listingText,
    searchKeywords: keywords,
  };
}

/** Owner-only preview block (not part of the public listing). */
export function formatOwnerListingHints(result: MarketplaceListingResult): string {
  const kw = result.searchKeywords.length
    ? `\n\n🔍 Suchbegriffe\n${result.searchKeywords.join(', ')}`
    : '';
  return `💶 Für dich (nicht Teil der Anzeige)

Titel für eBay:
${result.ebayTitle}

Neue Preis in Deutschland:
${result.newPriceGermany}

Empfohlene Preis b/u:
${result.recommendedUsedPrice}${kw}`;
}
