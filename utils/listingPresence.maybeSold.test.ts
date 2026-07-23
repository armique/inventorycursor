import { describe, expect, it } from 'vitest';
import { ItemStatus, type InventoryItem } from '../types';
import { applyEbayPresenceToItems } from './listingPresence';
import type { EbayMyListing } from '../services/ebayService';

function item(partial: Partial<InventoryItem> & Pick<InventoryItem, 'id' | 'name'>): InventoryItem {
  return {
    buyPrice: 50,
    buyDate: new Date().toISOString().slice(0, 10),
    category: 'Components',
    subCategory: 'RAM',
    status: ItemStatus.IN_STOCK,
    comment1: '',
    comment2: '',
    saleReady: true,
    ...partial,
  };
}

describe('listing disappearance', () => {
  it('flags maybeSold when a previously listed eBay item vanishes', () => {
    const row = item({
      id: '1',
      name: 'Corsair 16GB DDR4',
      listedOnEbay: true,
      ebayListingId: '123',
      liveEbayListPrice: 45,
    });
    const listings: EbayMyListing[] = [
      {
        listingId: '999',
        title: 'Something else entirely',
        imageUrls: [],
        source: 'seller_store',
        price: 10,
      },
    ];
    const next = applyEbayPresenceToItems([row], listings)[0];
    expect(next.listedOnEbay).toBe(false);
    expect(next.maybeSoldHint).toBe('ebay');
    expect(next.listingDisappearedAt).toBeTruthy();
  });

  it('clears maybeSold when the listing is found again', () => {
    const row = item({
      id: '1',
      name: 'Corsair 16GB DDR4',
      listedOnEbay: false,
      maybeSoldHint: 'ebay',
      listingDisappearedAt: '2026-01-01',
    });
    const listings: EbayMyListing[] = [
      {
        listingId: '55',
        title: 'Corsair 16GB DDR4 RAM',
        imageUrls: [],
        source: 'seller_store',
        price: 40,
      },
    ];
    const next = applyEbayPresenceToItems([row], listings)[0];
    expect(next.listedOnEbay).toBe(true);
    expect(next.maybeSoldHint).toBeUndefined();
  });
});
