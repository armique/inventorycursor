import { suggestCategoryFromCorrections } from '../services/categoryCorrections';
import { getSpecsAIProvider, requestAIJson } from '../services/specsAI';

const MOTHERBOARD_PATTERN =
  /\b(mainboard|motherboard|mobo|chipset|form\s*factor|io[\s-]*shield|(?:a|b|h|x|z)\d{2,4}[a-z0-9-]*)\b/i;

export type CategoryDetectSource = 'learned' | 'ai' | 'heuristic';

export interface CategoryDetectResult {
  category: string;
  subCategory: string;
  standardizedName?: string;
  source: CategoryDetectSource;
}

export function normalizeCategory(input: string | undefined, categoryKeys: string[]): string {
  const raw = (input || '').trim().toLowerCase();
  if (!raw) return categoryKeys[0] || 'Components';
  const match = categoryKeys.find((c) => c.toLowerCase() === raw);
  return match || categoryKeys[0] || 'Components';
}

export function normalizeSubCategory(
  category: string,
  sub: string | undefined,
  categories: Record<string, string[]>
): string {
  const options = categories[category] || [];
  if (!options.length) return sub?.trim() || 'Spare Parts';
  const raw = (sub || '').trim().toLowerCase();
  const match = options.find((s) => s.toLowerCase() === raw);
  return match || options[0];
}

export function inferCategoryFromName(name: string): { category: string; subCategory: string } {
  const n = name.toLowerCase();
  if (/(rtx|gtx|radeon|rx\s?\d{3,5}|quadro|tesla|firepro|nvidia\s+[qkmt]|graphics card|grafikkarte)/i.test(n)) {
    return { category: 'Components', subCategory: 'Graphics Cards' };
  }
  if (/(intel core|ryzen|threadripper|cpu|prozessor)/i.test(n)) {
    return { category: 'Components', subCategory: 'Processors' };
  }
  if (MOTHERBOARD_PATTERN.test(n) || /socket\s?(am|lga)/i.test(n)) {
    return { category: 'Components', subCategory: 'Motherboards' };
  }
  if (/(ddr[2345]|ram\b|memory\b|\d+x\d+\s*gb|12800u|10600u|1333u|2rx8|1rx8|jedec|hynix|samsung m\d|kingston khx|sk hynix)/i.test(n)) {
    return { category: 'Components', subCategory: 'RAM' };
  }
  if (/(ssd|hdd|nvme|m\.2)/i.test(n)) {
    return { category: 'Components', subCategory: 'Storage (SSD/HDD)' };
  }
  if (/(netzteil|power supply|psu|watt|80\+)/i.test(n)) {
    return { category: 'Components', subCategory: 'Power Supplies' };
  }
  if (/(geh[aä]use|case|micro-atx|matx|atx case)/i.test(n)) {
    return { category: 'Components', subCategory: 'Cases' };
  }
  if (/(aio|k[uü]hler|cooler|liquid freezer|fan|l[uü]fter|120mm|140mm)/i.test(n)) {
    return { category: 'Components', subCategory: 'Cooling' };
  }
  if (/(laptop|notebook|macbook)/i.test(n)) {
    return { category: 'Laptops', subCategory: 'Gaming Laptop' };
  }
  if (/(monitor|display|\d{2,3}hz|ips|oled)/i.test(n)) {
    return { category: 'Peripherals', subCategory: 'Monitors' };
  }
  if (/\b(pc|gaming pc|custom build|bundle)\b/i.test(n)) {
    return { category: 'PC', subCategory: 'Custom Built PC' };
  }
  return { category: 'Misc', subCategory: 'Spare Parts' };
}

export function reconcileCategory(
  name: string,
  category: string | undefined,
  subCategory: string | undefined,
  categories: Record<string, string[]>
): { category: string; subCategory: string } {
  const keys = Object.keys(categories);
  const guessed = inferCategoryFromName(name);
  const aiCategory = normalizeCategory(category || guessed.category, keys);
  const aiSub = normalizeSubCategory(aiCategory, subCategory || guessed.subCategory, categories);

  const n = name.toLowerCase();
  if (/(intel core|ryzen|threadripper|cpu|prozessor)/i.test(n)) {
    return { category: 'Components', subCategory: normalizeSubCategory('Components', 'Processors', categories) };
  }
  if (/(ssd|nvme|m\.2|hdd|sata)/i.test(n)) {
    return { category: 'Components', subCategory: normalizeSubCategory('Components', 'Storage (SSD/HDD)', categories) };
  }
  if (/(ddr4|ddr5|\bram\b|memory)/i.test(n)) {
    return { category: 'Components', subCategory: normalizeSubCategory('Components', 'RAM', categories) };
  }
  if (MOTHERBOARD_PATTERN.test(n)) {
    return { category: 'Components', subCategory: normalizeSubCategory('Components', 'Motherboards', categories) };
  }

  if (aiCategory !== 'Components' && guessed.category === 'Components') {
    return {
      category: normalizeCategory(guessed.category, keys),
      subCategory: normalizeSubCategory(guessed.category, guessed.subCategory, categories),
    };
  }
  if (aiCategory === 'Components' && aiSub === 'Graphics Cards' && guessed.subCategory !== 'Graphics Cards') {
    return {
      category: 'Components',
      subCategory: normalizeSubCategory('Components', guessed.subCategory, categories),
    };
  }
  return { category: aiCategory, subCategory: aiSub };
}

async function detectItemCategoryWithAI(
  name: string,
  categories: Record<string, string[]>
): Promise<CategoryDetectResult> {
  const keys = Object.keys(categories);
  const catalog = keys
    .map((k) => `- ${k}: ${(categories[k] || []).join(', ') || '(no subcategories)'}`)
    .join('\n');

  const prompt = `You classify PC hardware inventory items into category and subCategory.

Return JSON only (no markdown):
{"category":"...","subCategory":"...","standardizedName":"optional cleaned product name"}

Valid categories and subcategories:
${catalog}

Rules:
- Pick exactly one category and one subCategory from the lists above.
- Do not classify CPUs, RAM, SSD/NVMe, or motherboards as Graphics Cards.
- Motherboard model codes (A320M, B450, B550, X570, Z790, H81M, H610, etc.) → Components / Motherboards.
- Bundles or full PCs → PC or Bundle if listed.

Item name: ${name}`;

  const result = await requestAIJson<{
    category?: string;
    subCategory?: string;
    standardizedName?: string;
  }>(prompt, { maxTokens: 256 });

  const reconciled = reconcileCategory(name, result.category, result.subCategory, categories);
  return {
    ...reconciled,
    standardizedName:
      typeof result.standardizedName === 'string' && result.standardizedName.trim()
        ? result.standardizedName.trim()
        : undefined,
    source: 'ai',
  };
}

/** Suggest category + subCategory from item name (learned corrections → AI → heuristics). */
export async function detectItemCategory(
  name: string,
  categories: Record<string, string[]>
): Promise<CategoryDetectResult> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Enter an item name first.');
  const keys = Object.keys(categories);
  if (!keys.length) throw new Error('No categories configured.');

  const learned = suggestCategoryFromCorrections(trimmed);
  if (learned && categories[learned]?.length) {
    const guessed = inferCategoryFromName(trimmed);
    return {
      category: learned,
      subCategory: normalizeSubCategory(learned, guessed.subCategory, categories),
      source: 'learned',
    };
  }

  if (getSpecsAIProvider()) {
    try {
      return await detectItemCategoryWithAI(trimmed, categories);
    } catch (err) {
      console.warn('AI category detect failed, using heuristics:', err);
    }
  }

  const guessed = inferCategoryFromName(trimmed);
  const category = normalizeCategory(guessed.category, keys);
  return {
    category,
    subCategory: normalizeSubCategory(category, guessed.subCategory, categories),
    source: 'heuristic',
  };
}

/** Search inventory for items matching a typed query (name, category, vendor). */
export function searchInventoryItemsForAdd(
  items: { id: string; name: string; category: string; subCategory?: string; vendor?: string; isDraft?: boolean }[],
  query: string,
  excludeId?: string,
  limit = 8
) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];

  const tokens = q.split(/\s+/).filter(Boolean);
  return items
    .filter((i) => i.id !== excludeId && !i.isDraft)
    .map((item) => {
      const hay = `${item.name} ${item.category} ${item.subCategory || ''} ${item.vendor || ''}`.toLowerCase();
      if (!tokens.every((t) => hay.includes(t))) return null;
      const nameIdx = item.name.toLowerCase().indexOf(q);
      const score = (nameIdx >= 0 ? 10 : 0) + tokens.length;
      return { item, score };
    })
    .filter((x): x is { item: (typeof items)[number]; score: number } => x !== null)
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name))
    .slice(0, limit)
    .map((x) => x.item);
}
