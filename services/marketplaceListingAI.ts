/**
 * German eBay.de / Kleinanzeigen.de marketplace listing generator.
 * Produces an optimized title + full listing body (+ owner-only price/keyword hints).
 */
import type { InventoryItem } from '../types';
import { ItemStatus } from '../types';
import { requestAIJson } from './specsAI';

export interface MarketplaceListingHints {
  /** Original packaging present — buyer-facing Lieferumfang/Zustand hint. */
  hasOVP?: boolean;
  /** IO shield included (motherboards/bundles) — buyer-facing hint. */
  hasIOShield?: boolean;
  /** Purchase receipt / Rechnung available — buyer-facing hint. */
  hasReceipt?: boolean;
  /** Short seller note the AI must factor into the listing (rephrase professionally). */
  aiDescriptionNote?: string;
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

Между РАЗДЕЛАМИ — ровно ОДНА пустая строка (после названия товара и перед каждым emoji-блоком).
Внутри одного раздела — без пустых строк.
Никогда 0 пустых строк между разделами (текст не должен слипаться).
Никогда 2 и более пустых строк подряд (чтобы в eBay не было огромных дыр).
Используй максимум один эмодзи на раздел.
Не используй горизонтальные линии -----.
Описание должно одинаково хорошо выглядеть на ПК и в приложении eBay.

=========================
СТРУКТУРА listingText (пример интервалов)
=========================

Название товара

💻 Краткое описание (1–2 предложения)

🔧 Technische Daten: …

📦 Lieferumfang: …

✅ Zustand: …

🔥 Weitere Komponenten verfügbar …

(Если нужен ℹ️ Hinweis — тоже с одной пустой строкой до и после, как у других разделов.)

Первая строка объявления — название товара (короткая строка с составом, без emoji).

Затем разделы (ровно один emoji в заголовке раздела):

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
LIEFERUMFANG / OVP / IO / RECHNUNG
=========================

Перечисляй комплект поставки отдельно.
Флаги OVP / IO-Blende / Rechnung в ITEM DATA — это обязательные подсказки для покупателя (как notices о состоянии/комплекте). Включи их в 📦 Lieferumfang и/или ℹ️ Hinweis / ✅ Zustand — где уместно:

Если OVP = YES: Originalverpackung vorhanden
Если OVP = NO: Ohne Originalverpackung
Если IO-Blende = YES: IO-Blende inklusive
Если IO-Blende = NO (для Mainboard/Bundle где актуально): Ohne IO-Blende
Если Rechnung = YES: Rechnung / Kaufbeleg vorhanden
Если Rechnung = NO: Ohne Rechnung

Не игнорируй эти флаги. Не противоречь им.

=========================
SELLER NOTE (AI HINT)
=========================

Если в ITEM DATA есть блок SELLER NOTE FOR AI — это обязательный контекст от продавца.
Ты ДОЛЖЕН учесть его в listingText (обычно в ℹ️ Hinweis и/или в кратком описании / Zustand / Lieferumfang — где уместно).
Переформулируй профессионально на немецком; не копируй сырую английскую/разговорную фразу дословно.
Пример: note "wifi antennas aren't original" → ясно укажи, что WLAN-/WiFi-Antennen nicht original / durch Drittanbieter-Antennen ersetzt (или аналогично по смыслу).
Не игнорируй note. Не выдумывай дефекты сверх note.

=========================
ZUSTAND
=========================

Используй ✅ Zustand (НЕ "Zustandsbeschreibung").
Пример: Gebraucht / Voll funktionsfähig

Для КАЖДОГО исправного (не defective) товара ОБЯЗАТЕЛЬНО явно укажи, что нормальные следы использования возможны, например:
„Normale Gebrauchsspuren sind möglich.“
Это стандартный notice для покупателя — не пропускай.

Исправные товары: НИКОГДА не писать Privatverkauf / Keine Garantie / Keine Rücknahme.

Дефектные: всегда
Verkauf ausdrücklich als defekt.
Keine Garantie und keine Rücknahme.
(для defective можно не писать про normale Gebrauchsspuren — важнее дефект)

=========================
СТИЛЬ
=========================

Как профессиональное объявление крупного немецкого магазина. Без воды. Максимально продающее.
Одинаковый стиль оформления.`;

/** Resolve buyer-facing accessory hints for listing AI (not for product-card image gen). */
export function resolveListingAccessoryHints(
  item: Pick<InventoryItem, 'hasOVP' | 'hasIOShield' | 'hasReceipt'>,
  hints?: MarketplaceListingHints
): { hasOVP: boolean; hasIOShield: boolean; hasReceipt: boolean } {
  return {
    hasOVP: hints?.hasOVP === true || item.hasOVP === true,
    hasIOShield: hints?.hasIOShield === true || item.hasIOShield === true,
    hasReceipt: hints?.hasReceipt === true || item.hasReceipt === true,
  };
}

function buildItemContext(item: InventoryItem, hints?: MarketplaceListingHints): string {
  const specs = item.specs
    ? Object.entries(item.specs)
        .filter(([, v]) => v != null && String(v).trim())
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n')
    : '';
  const accessories = resolveListingAccessoryHints(item, hints);
  const aiNote = (hints?.aiDescriptionNote ?? item.aiDescriptionNote ?? '').trim();
  const lines = [
    `Product name: ${item.name}`,
    `Category: ${item.category}${item.subCategory ? ` / ${item.subCategory}` : ''}`,
    item.vendor ? `Vendor: ${item.vendor}` : '',
    item.isPC ? 'Type: Fertig-PC' : '',
    item.isBundle || item.category === 'Bundle' || item.category === 'Mixed Bundle'
      ? 'Type: PC Bundle / Komponenten-Bundle'
      : '',
    item.isDefective ? 'Condition flag: DEFECTIVE' : 'Condition flag: WORKING',
    `OVP: ${
      accessories.hasOVP ? 'YES — Originalverpackung vorhanden' : 'NO — Ohne Originalverpackung'
    }`,
    `IO-Blende: ${
      accessories.hasIOShield
        ? 'YES — IO-Blende inklusive'
        : 'NO — Ohne IO-Blende (if motherboard/bundle relevant)'
    }`,
    `Rechnung: ${
      accessories.hasReceipt
        ? 'YES — Rechnung / Kaufbeleg vorhanden'
        : 'NO — Ohne Rechnung'
    }`,
    item.isDefective
      ? ''
      : 'CONDITION NOTICE (required in ✅ Zustand): Normale Gebrauchsspuren sind möglich.',
    aiNote
      ? `SELLER NOTE FOR AI (must incorporate — rephrase professionally in German; do not ignore):\n${aiNote}`
      : '',
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

/** Section headers in our German listing template (emoji-led blocks). */
const LISTING_SECTION_START =
  /^(💻|🎮|💾|🖥️|🔧|📦|ℹ️|✅|🔥|⚡|📌|💡|🛠️|🔋|🌡️)\s/u;

/**
 * Normalize listing body spacing for eBay / Kleinanzeigen:
 * exactly one blank line before each emoji section, never glued blocks, never huge gaps.
 */
export function formatListingTextSpacing(raw: string): string {
  const lines = String(raw || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/g, ''));

  const out: string[] = [];

  for (const line of lines) {
    if (!line.trim()) continue; // drop AI blanks; we insert our own between sections

    const trimmed = line.trimEnd();
    const isSection = LISTING_SECTION_START.test(trimmed.trimStart());

    if (isSection && out.length > 0) {
      if (out[out.length - 1] !== '') out.push('');
    }

    out.push(trimmed);
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
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
  "listingText": "full German listing body following STRUCTURE above — plain text, exactly one blank line between sections",
  "searchKeywords": ["15-25 popular German/eBay search terms as short strings"]
}`;

  const data = await requestAIJson<{
    ebayTitle?: string;
    newPriceGermany?: string;
    recommendedUsedPrice?: string;
    listingText?: string;
    searchKeywords?: string[];
  }>(prompt, { maxTokens: 2200 });

  const listingText = formatListingTextSpacing(String(data.listingText || ''));
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
