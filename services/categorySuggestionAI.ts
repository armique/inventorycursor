import { requestAIJson } from './specsAI';

export interface CategorySuggestionResult {
  category: string;
  subCategory: string;
  suggestedFields?: string[];
  reason?: string;
}

const KNOWN_CATEGORIES_EXAMPLE = `Common categories in this inventory app: PC (Custom Built PC, Pre-Built PC, Server), Laptops (Gaming Laptop, Ultrabook, MacBook), Components (Graphics Cards, Processors, Motherboards, RAM, Storage (SSD/HDD), Power Supplies, Cases, Cooling), Gadgets (Smartphones, Tablets, Consoles), Peripherals (Monitors, Keyboards, Mice), Network (Routers, Switches), Software, Bundle, Misc (Cables, Adapters, Tools).`;

function buildCategoryPrompt(itemName: string, currentCategory?: string, currentSub?: string): string {
  const current = currentCategory || currentSub ? `Current assignment: ${[currentCategory, currentSub].filter(Boolean).join(' / ')}.` : 'No category assigned yet.';
  return `You are classifying hardware/electronics inventory items into a category and subcategory.

Item name: "${itemName}"
${current}

${KNOWN_CATEGORIES_EXAMPLE}

If the item clearly fits one of these, use that category and a matching subcategory. If it fits better in a new category (e.g. "Electronics" or "Storage" with a new subcategory), suggest a short category name and subcategory name. Also suggest 5-10 spec field names that would be useful for this type of product (e.g. for Graphics Cards: Chipset, VRAM, TDP; for Monitors: Size, Resolution, Refresh Rate). Use clear English names.

Return ONLY a valid JSON object with this exact structure (no markdown, no code fence):
{"category":"CategoryName","subCategory":"SubCategory Name","suggestedFields":["Field1","Field2",...],"reason":"Brief reason"}

Rules: category and subCategory must be non-empty strings. suggestedFields must be an array of strings. reason is optional.`;
}

/**
 * Suggest category, subcategory, and spec fields for an item based on its name (and optional current category).
 * Uses the same AI provider as specs (Groq, Ollama, etc.). One API call per item.
 */
export async function suggestCategoryForItem(
  itemName: string,
  currentCategory?: string,
  currentSubCategory?: string
): Promise<CategorySuggestionResult> {
  const prompt = buildCategoryPrompt(itemName, currentCategory, currentSubCategory);
  const raw = await requestAIJson<CategorySuggestionResult & { suggestedFields?: string[] }>(prompt);
  return {
    category: String(raw?.category ?? 'Misc').trim(),
    subCategory: String(raw?.subCategory ?? 'Other').trim(),
    suggestedFields: Array.isArray(raw?.suggestedFields) ? raw.suggestedFields.filter((f) => typeof f === 'string') : undefined,
    reason: typeof raw?.reason === 'string' ? raw.reason : undefined,
  };
}
