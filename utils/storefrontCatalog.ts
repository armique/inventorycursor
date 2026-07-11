import type { InventoryItem } from '../types';
import { ItemStatus } from '../types';
import { filterUsableImageUrls, isUsableProductImageUrl } from '../services/storefrontImageUtils';

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const PRICE_DROP_DAYS = 30;

export type StoreCatalogItem = {
  id: string;
  name: string;
  category: string;
  subCategory?: string;
  sellPrice?: number;
  storeSalePrice?: number;
  storeOnSale?: boolean;
  storeVisible?: boolean;
  imageUrl?: string;
  storeGalleryUrls?: string[];
  storeDescription?: string;
  specs?: Record<string, string | number>;
  categoryFields?: string[];
  badge?: 'New' | 'Price reduced';
  storeMetaTitle?: string;
  storeMetaDescription?: string;
  storeDescriptionEn?: string;
  quantity?: number;
};

export type StoreCatalogPayload = { items: StoreCatalogItem[] };

/** True when this inventory row would appear on the public storefront. */
export function isPublishedOnStorefront(item: InventoryItem): boolean {
  if (item.storeVisible === false) return false;
  if (item.isDraft) return false;
  if (item.status !== ItemStatus.IN_STOCK) return false;
  if (item.parentContainerId) return false;
  return true;
}

export function getStorefrontHiddenReason(item: InventoryItem): string | null {
  if (item.storeVisible === false) return 'Manually hidden from storefront';
  if (item.isDraft) return 'Draft — not published to storefront';
  if (item.status === ItemStatus.IN_COMPOSITION || item.parentContainerId) {
    return 'Inside a bundle or PC build — only the bundle/PC appears on the storefront';
  }
  if (item.status !== ItemStatus.IN_STOCK) {
    return `Not in stock (${item.status ?? 'unknown'}) — not on storefront`;
  }
  return null;
}

function computeStoreBadge(item: InventoryItem): 'New' | 'Price reduced' | null {
  const override = item.storeBadge;
  if (override === 'none') return null;
  if (override === 'New') return 'New';
  if (override === 'Price reduced') return 'Price reduced';

  const now = Date.now();
  const buyDate = item.buyDate ? new Date(item.buyDate).getTime() : 0;
  if (now - buyDate <= ONE_WEEK_MS) return 'New';

  const listedPrice = item.storePrice ?? item.sellPrice ?? 0;
  const currentSell = item.storeOnSale && item.storeSalePrice != null ? item.storeSalePrice : listedPrice;
  const history = item.priceHistory || [];
  for (let i = history.length - 1; i >= 0; i--) {
    const e = history[i];
    if ((e.type !== 'storePrice' && e.type !== 'sell') || e.previousPrice == null) continue;
    const entryDate = new Date(e.date).getTime();
    if (now - entryDate > PRICE_DROP_DAYS * 24 * 60 * 60 * 1000) break;
    if (e.previousPrice > currentSell) return 'Price reduced';
  }
  return null;
}

/** Build the public Firestore catalog from inventory. Standalone in-stock items only; bundle parts are excluded. */
export function buildStoreCatalog(
  items: InventoryItem[],
  categoryFields: Record<string, string[]>
): StoreCatalogPayload {
  const list = items.filter(isPublishedOnStorefront);
  return {
    items: list.map((i) => {
      const badge = computeStoreBadge(i);
      const inventoryGallery = filterUsableImageUrls(i.imageUrls);
      const storeGallery = filterUsableImageUrls(i.storeGalleryUrls);
      const gallery = filterUsableImageUrls([...inventoryGallery, ...storeGallery]);
      let imageUrl: string | undefined = isUsableProductImageUrl(i.imageUrl) ? i.imageUrl!.trim() : undefined;
      if (!imageUrl && gallery.length) imageUrl = gallery[0];
      const restGallery = gallery.filter((u) => u !== imageUrl);
      return {
        id: i.id,
        name: i.name,
        category: i.category,
        subCategory: i.subCategory,
        sellPrice: i.storePrice ?? i.sellPrice,
        storeSalePrice: i.storeSalePrice,
        storeOnSale: i.storeOnSale,
        storeVisible: true,
        ...(imageUrl ? { imageUrl } : {}),
        ...(restGallery.length ? { storeGalleryUrls: restGallery } : {}),
        storeDescription: i.storeDescription,
        specs: i.specs,
        categoryFields: categoryFields[`${i.category}:${i.subCategory || ''}`] || [],
        ...(badge ? { badge } : {}),
        ...(i.storeMetaTitle ? { storeMetaTitle: i.storeMetaTitle } : {}),
        ...(i.storeMetaDescription ? { storeMetaDescription: i.storeMetaDescription } : {}),
        ...(i.storeDescriptionEn ? { storeDescriptionEn: i.storeDescriptionEn } : {}),
        quantity: i.quantity ?? 1,
      };
    }),
  };
}
