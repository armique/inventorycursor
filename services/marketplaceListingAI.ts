/**
 * German eBay.de / Kleinanzeigen.de marketplace listing generator.
 * Produces an optimized title + full listing body (+ owner-only price/keyword hints).
 */
import type { InventoryItem } from '../types';
import { ItemStatus } from '../types';
import { requestAIJson } from './specsAI';
import { isIOShieldRelevant, listingAccessoriesReady, resolveIoShieldTriState } from '../utils/itemAccessoryToggles';
import type { AccessoryChildRef } from '../utils/itemAccessoryToggles';

export interface MarketplaceListingHints {
  /** Original packaging present — buyer-facing Lieferumfang/Zustand hint. */
  hasOVP?: boolean;
  /** IO shield included (motherboards/bundles) — buyer-facing hint. */
  hasIOShield?: boolean;
  /** Purchase receipt / Rechnung available — buyer-facing hint. */
  hasReceipt?: boolean;
  /** Short seller note the AI must factor into the listing (rephrase professionally). */
  aiDescriptionNote?: string;
  /** Bundle/PC parts — detects motherboard + rolls up IO Blende from mobo child. */
  children?: AccessoryChildRef[];
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

💻 Подробное описание (3–6 предложений: ценность, ключевые факты, для кого)

🔧 Technische Daten: …

📦 Lieferumfang: …

✅ Zustand: …

🔥 Weitere Komponenten verfügbar …

(Если нужен ℹ️ Hinweis — тоже с одной пустой строкой до и после, как у других разделов.)

Первая строка объявления — название товара (короткая строка с составом, без emoji).

Затем разделы (ровно один emoji в заголовке раздела):

💻 или 🎮 или 💾 или 🖥️ — подробное продающее описание (НЕ 1 короткое предложение):
  • 3–6 содержательных предложений на немецком
  • что это за товар, для кого подходит, ключевые преимущества
  • важные тех. факты из Specs (без воды и без выдуманных характеристик)
  • совместимость / типичные сценарии использования, если уместно
  • язык уверенный, профессиональный, как у хорошего DE-магазина

🔧 Technische Daten — максимально полно по доступным Specs:
  • каждая значимая характеристика отдельной строкой или через « · »
  • не пропускай известные поля из ITEM DATA (Kerne, Threads, Takt, Speicher, …)
  • если данных мало — всё равно структурируй то, что есть; не выдумывай цифры

📦 Lieferumfang — полный комплект (что реально входит / чего нет по флагам)

ℹ️ Hinweis — только если есть важные особенности / seller note

✅ Zustand — ясный статус + обязательный Gebrauchsspuren-notice для исправных

🔥 Weitere Komponenten verfügbar (для ПК и комплектующих / bundles)

ВАЖНО ПРО ДЕТАЛИЗАЦИЮ:
- listingText должен быть заметно информативнее «короткого тизера»: покупатель должен понять ценность товара без доп. вопросов.
- Не раздувай текст пустыми фразами («Top Angebot», «Hammer Preis», «Muss weg»).
- Не повторяй одно и то же в каждом разделе.
- Используй ВСЕ релевантные Specs из ITEM DATA в Technische Daten и отражай ключевые из них в кратком описании.

=========================
ПРОЦЕССОРЫ
=========================

Всегда указывать: Kerne, Threads, Basistakt, Turbo.

=========================
ОПЕРАТИВНАЯ ПАМЯТЬ
=========================

Всегда: Hersteller, Modell, Typ, Frequenz, ECC/Non-ECC und Registered/Unbuffered wenn bekannt.

KIT / ОБЪЁМ (критично — не путать):
- Modules = количество планок (Sticks).
- GB per Stick = объём ОДНОЙ планки.
- Kit Capacity = Modules × GB per Stick = общий объём комплекта.
- В ebayTitle и в 🔧 Technische Daten ОБЯЗАТЕЛЬНО указывай общий объём И конфигурацию, например: „16GB (2x8GB)“ или „32GB (2x16GB)“.
- Пример: specs Modules=2, GB per Stick=8GB → Kit=16GB. НИКОГДА не пиши только „8GB“ как полный объём комплекта 2x8GB.
- Не путай складской quantity товара с Modules.

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

Перечисляй комплект поставки отдельно.
Флаги OVP / IO-Blende в ITEM DATA — обязательные подсказки для покупателя.

OVP:
Если OVP = YES: Originalverpackung vorhanden
Если OVP = NO: Ohne Originalverpackung
Включи OVP в 📦 Lieferumfang.

IO-Blende / IO Shield (Mainboard / Bundle mit Mainboard):
- Упоминай IO-Blende ТОЛЬКО если в ITEM DATA есть строка IO-Blende с YES или NO (не NOT APPLICABLE).
- Если строки IO-Blende нет или NOT APPLICABLE — НИКОГДА не пиши про IO-Blende / IO Shield / Blende.
- Если IO-Blende = YES: ОБЯЗАТЕЛЬНО явно в 📦 Lieferumfang: „IO-Blende inklusive“ (нельзя пропускать).
- Если IO-Blende = NO: ОБЯЗАТЕЛЬНО явно в 📦 Lieferumfang: „Ohne IO-Blende“ (нельзя пропускать).
- Покупатель должен сразу видеть, есть IO-Blende или нет — это критично для Mainboard / Bundle.

Rechnung: упоминай ТОЛЬКО если в ITEM DATA явно Rechnung = YES. Не пиши „Ohne Rechnung“, если флаг не задан.

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

ПО УМОЛЧАНИЮ для WORKING (не defective):
- Zustand = Gebraucht / Voll funktionsfähig (товар б/у — used)
- ОБЯЗАТЕЛЬНО явно: „Normale Gebrauchsspuren sind möglich.“
- НИКОГДА не писать Privatverkauf / Keine Garantie / Keine Rücknahme для исправных.
- Не называй товар neu / OVP-neu, если Condition flag = WORKING — это б/у.

Только если Condition flag = DEFECTIVE:
Verkauf ausdrücklich als defekt.
Keine Garantie und keine Rücknahme.
(для defective можно не писать про normale Gebrauchsspuren — важнее дефект)

=========================
СТИЛЬ
=========================

Как профессиональное объявление крупного немецкого магазина. Без воды, но с достаточной детализацией.
Максимально продающее и информативное. Одинаковый стиль оформления.
Покупатель должен получить ясное представление о товаре, комплекте и состоянии уже из текста.`;

/** Resolve buyer-facing accessory hints for listing AI. */
export function resolveListingAccessoryHints(
  item: Pick<
    InventoryItem,
    'category' | 'subCategory' | 'isBundle' | 'isPC' | 'name' | 'hasOVP' | 'hasIOShield' | 'hasReceipt'
  >,
  hints?: MarketplaceListingHints
): {
  ovp: 'YES' | 'NO' | 'UNSPECIFIED';
  io: 'YES' | 'NO' | 'UNSPECIFIED' | null;
  includeIOShield: boolean;
  /** @deprecated kept for older callers — true only when present */
  hasOVP: boolean;
  hasIOShield: boolean;
  hasReceipt: boolean;
} {
  const children = hints?.children;
  const mergedOvp =
    hints?.hasOVP !== undefined ? hints.hasOVP : item.hasOVP;
  const includeIOShield = isIOShieldRelevant(item, children);
  const ioState = includeIOShield
    ? resolveIoShieldTriState(
        item,
        children,
        hints?.hasIOShield !== undefined ? hints.hasIOShield : undefined
      )
    : 'na';

  const ovp: 'YES' | 'NO' | 'UNSPECIFIED' =
    mergedOvp === true ? 'YES' : mergedOvp === false ? 'NO' : 'UNSPECIFIED';
  const io: 'YES' | 'NO' | 'UNSPECIFIED' | null =
    ioState === 'na'
      ? null
      : ioState === 'present'
        ? 'YES'
        : ioState === 'missing'
          ? 'NO'
          : 'UNSPECIFIED';

  return {
    ovp,
    io,
    includeIOShield,
    hasOVP: ovp === 'YES',
    hasIOShield: io === 'YES',
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
    item.isDefective ? 'Condition flag: DEFECTIVE — write as defekt sale' : 'Condition flag: WORKING — default Zustand is Gebraucht (used), not neu',
    `OVP: ${
      accessories.ovp === 'YES'
        ? 'YES — Originalverpackung vorhanden'
        : accessories.ovp === 'NO'
          ? 'NO — Ohne Originalverpackung'
          : 'UNSPECIFIED — ask seller flags before writing'
    }`,
    accessories.includeIOShield
      ? `IO-Blende: ${
          accessories.io === 'YES'
            ? 'YES — MUST state in 📦 Lieferumfang: „IO-Blende inklusive“'
            : accessories.io === 'NO'
              ? 'NO — MUST state in 📦 Lieferumfang: „Ohne IO-Blende“'
              : 'UNSPECIFIED — ask seller flags before writing'
        }`
      : 'IO-Blende: NOT APPLICABLE — do not mention IO-Blende / IO Shield at all',
    accessories.hasReceipt
      ? 'Rechnung: YES — Rechnung / Kaufbeleg vorhanden (optional mention)'
      : '',
    item.isDefective
      ? ''
      : 'CONDITION NOTICE (required in ✅ Zustand): Gebraucht / Voll funktionsfähig. Normale Gebrauchsspuren sind möglich.',
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
 * Deterministic: if IO YES/NO was set, ensure Lieferumfang states it (AI sometimes skips).
 */
export function ensureIoBlendeInListingText(
  listingText: string,
  io: 'YES' | 'NO' | 'UNSPECIFIED' | null
): string {
  if (io !== 'YES' && io !== 'NO') return listingText;
  const phrase = io === 'YES' ? 'IO-Blende inklusive' : 'Ohne IO-Blende';
  if (/io[\s-]?blende|io[\s-]?shield/i.test(listingText)) return listingText;

  const lines = listingText.split('\n');
  const lieferIdx = lines.findIndex((l) => /^📦\s*Lieferumfang/i.test(l.trim()));
  if (lieferIdx >= 0) {
    // Insert after the Lieferumfang header (or after first content line under it).
    let insertAt = lieferIdx + 1;
    while (insertAt < lines.length && lines[insertAt].trim() && !LISTING_SECTION_START.test(lines[insertAt].trimStart())) {
      insertAt += 1;
    }
    lines.splice(insertAt, 0, `• ${phrase}`);
    return formatListingTextSpacing(lines.join('\n'));
  }

  // No Lieferumfang block — append a minimal one before Zustand / cross-sell / end.
  const zustandIdx = lines.findIndex((l) => /^✅\s*Zustand/i.test(l.trim()));
  const block = ['📦 Lieferumfang:', `• ${phrase}`];
  if (zustandIdx >= 0) {
    lines.splice(zustandIdx, 0, ...block, '');
  } else {
    lines.push('', ...block);
  }
  return formatListingTextSpacing(lines.join('\n'));
}

/**
 * Generate marketplace title + German listing (+ owner price/keyword hints).
 */
export async function generateMarketplaceListing(
  item: InventoryItem,
  hints?: MarketplaceListingHints
): Promise<MarketplaceListingResult> {
  const children = hints?.children;
  const accessories = resolveListingAccessoryHints(item, hints);
  const gateItem = {
    ...item,
    hasOVP: hints?.hasOVP !== undefined ? hints.hasOVP : item.hasOVP,
    hasIOShield:
      accessories.io === 'YES'
        ? true
        : accessories.io === 'NO'
          ? false
          : hints?.hasIOShield !== undefined
            ? hints.hasIOShield
            : item.hasIOShield,
  };
  const gate = listingAccessoriesReady(gateItem, children);
  if (!gate.ok) {
    throw new Error(gate.reason || 'Confirm OVP / IO Blende before generating listing text.');
  }

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

  let listingText = formatListingTextSpacing(String(data.listingText || ''));
  listingText = ensureIoBlendeInListingText(listingText, accessories.io);
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
