import type { EbayMyListing } from '../services/ebayService';
import { generateItemSpecs, getSpecsAIProvider } from '../services/specsAI';
import { filterSpecsToEssentialKeys, resolveEssentialSpecKeys } from '../services/essentialSpecFields';
import { detectItemCategory } from './itemCategoryDetect';
import { cleanEbayListingTitle } from './ebayBulkSyncPlan';
import { ensureModelCodesInName } from './preserveModelCodes';

export interface EbayOrphanListingDraft {
  listing: EbayMyListing;
  parsedName: string;
  category: string;
  subCategory: string;
  categorySource: string;
  specs: Record<string, string | number>;
  specsAiSuggested?: Record<string, string | number>;
  vendor?: string;
  enrichError?: string;
}

export async function enrichOrphanListingDraft(
  listing: EbayMyListing,
  categories: Record<string, string[]>,
  categoryFields: Record<string, string[]>,
  options: { parseSpecs: boolean }
): Promise<EbayOrphanListingDraft> {
  const cleaned = cleanEbayListingTitle(listing.title);
  const originalTitle = cleaned || listing.title.trim();
  let parsedName = originalTitle;
  let category = 'Misc';
  let subCategory = 'Spare Parts';
  let categorySource = 'heuristic';
  let specs: Record<string, string | number> = {};
  let specsAiSuggested: Record<string, string | number> | undefined;
  let vendor: string | undefined;
  let enrichError: string | undefined;

  try {
    const catResult = await detectItemCategory(parsedName, categories);
    category = catResult.category;
    subCategory = catResult.subCategory;
    categorySource = catResult.source;
    if (catResult.standardizedName) {
      parsedName = ensureModelCodesInName(originalTitle, catResult.standardizedName);
    }
  } catch (e) {
    enrichError = (e as Error)?.message || 'Category detection failed.';
  }

  if (options.parseSpecs && getSpecsAIProvider()) {
    try {
      const categoryContext = `${category}${subCategory ? ` / ${subCategory}` : ''}`;
      const knownKeys = resolveEssentialSpecKeys(category, subCategory, categoryFields);
      const result = await generateItemSpecs(originalTitle, categoryContext, knownKeys);
      if (result.standardizedName?.trim()) {
        parsedName = ensureModelCodesInName(originalTitle, result.standardizedName.trim());
      }
      if (result.vendor) vendor = result.vendor;
      if (result.specs && Object.keys(result.specs).length > 0) {
        specs = filterSpecsToEssentialKeys(result.specs, knownKeys);
        specsAiSuggested = { ...specs };
      }
    } catch (e) {
      const msg = (e as Error)?.message || 'AI spec parse failed.';
      enrichError = enrichError ? `${enrichError} ${msg}` : msg;
    }
  } else if (options.parseSpecs && !getSpecsAIProvider()) {
    enrichError = enrichError
      ? enrichError
      : 'No AI provider configured — name and category only.';
  }

  return {
    listing,
    parsedName,
    category,
    subCategory,
    categorySource,
    specs,
    specsAiSuggested,
    vendor,
    enrichError,
  };
}
