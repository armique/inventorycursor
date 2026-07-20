/**
 * Sandbox: Listing Studio "Apply to item" merge + hydration wipe regression.
 *
 * Reproduces the PC bug where Generate listing text was wiped when any other
 * field patched the item (vendor / AI note / specs), so Apply saved empty text.
 *
 * Run: npx tsx scripts/verify-apply-listing.ts
 */
import assert from 'node:assert/strict';
import type { InventoryItem } from '../types';
import { ItemStatus } from '../types';
import { formatListingTextSpacing } from '../services/marketplaceListingAI';

const PRESERVE_FROM_OLD_IF_UPDATE_MISSING: (keyof InventoryItem)[] = [
  'imageUrl',
  'imageUrls',
  'storeGalleryUrls',
  'storeDescription',
  'storeVisible',
  'storeOnSale',
  'storeSalePrice',
  'specs',
  'componentIds',
  'comment1',
  'comment2',
  'vendor',
  'hasOVP',
  'hasIOShield',
  'aiDescriptionNote',
  'platformBought',
  'buyPaymentType',
  'kleinanzeigenBuyChatUrl',
  'kleinanzeigenBuyChatImage',
  'kleinanzeigenSellerProfileUrl',
  'bulkImportId',
];

function baseItem(partial: Partial<InventoryItem> = {}): InventoryItem {
  return {
    id: 'item-ssd-1',
    name: 'Crucial BX500 480GB SSD',
    buyPrice: 25,
    buyDate: '2026-07-01',
    category: 'Storage',
    subCategory: 'SSD',
    status: ItemStatus.IN_STOCK,
    comment1: '',
    comment2: '',
    ...partial,
  };
}

/** Mirrors InventoryList studio onUpdateItem merge (session wins, then patch). */
function mergeStudioPatch(
  fromItems: InventoryItem | undefined,
  session: InventoryItem,
  patch: Partial<InventoryItem>
): InventoryItem {
  return { ...(fromItems || session), ...session, ...patch };
}

/** Mirrors App.handleUpdate preserve-if-missing behavior for one item. */
function applyHandleUpdatePreserve(oldItem: InventoryItem, incoming: InventoryItem): InventoryItem {
  const final = { ...incoming } as InventoryItem;
  for (const k of PRESERVE_FROM_OLD_IF_UPDATE_MISSING) {
    const oldVal = (oldItem as Record<string, unknown>)[k as string];
    const newVal = (final as Record<string, unknown>)[k as string];
    if (oldVal !== undefined && oldVal !== null && (newVal === undefined || newVal === null)) {
      (final as Record<string, unknown>)[k as string] = oldVal;
    }
  }
  return final;
}

/**
 * Simulates the OLD buggy hydration: any item field change resets title/description
 * from item (which does not yet have generated listing).
 */
function buggyHydrateOnAnyFieldChange(args: {
  localTitle: string;
  localDescription: string;
  item: InventoryItem;
  changedDeps: boolean;
}): { title: string; description: string } {
  if (!args.changedDeps) {
    return { title: args.localTitle, description: args.localDescription };
  }
  return {
    title: args.item.marketTitle?.trim() || args.item.name || '',
    description: args.item.marketDescription || '',
  };
}

/** Fixed hydration: only reset when item id changes. */
function fixedHydrateOnItemId(args: {
  localTitle: string;
  localDescription: string;
  item: InventoryItem;
  itemIdChanged: boolean;
}): { title: string; description: string } {
  if (!args.itemIdChanged) {
    return { title: args.localTitle, description: args.localDescription };
  }
  return {
    title: args.item.marketTitle?.trim() || args.item.name || '',
    description: args.item.marketDescription || '',
  };
}

function applyListingToItem(
  session: InventoryItem,
  fromItems: InventoryItem | undefined,
  draft: { title: string; description: string; aiNote?: string }
): InventoryItem {
  const patch: Partial<InventoryItem> = {
    marketTitle: draft.title.trim().slice(0, 80) || undefined,
    marketDescription: draft.description.trim() || undefined,
    aiDescriptionNote: (draft.aiNote || '').trim(),
    storeDescription: draft.description.trim() || session.storeDescription,
  };
  const merged = mergeStudioPatch(fromItems, session, patch);
  return applyHandleUpdatePreserve(fromItems || session, merged);
}

function run() {
  const generatedDescription = formatListingTextSpacing(`Crucial BX500 480GB SSD
💻 Schnelle und zuverlässige SSD für Ihren Computer.
🔧 Technische Daten: 480GB, SATA III
📦 Lieferumfang: Ohne Originalverpackung
✅ Zustand: Gebraucht / Voll funktionsfähig / Normale Gebrauchsspuren
🔥 In meinen weiteren Anzeigen sowie auf Lager finden Sie außerdem Grafikkarten.`);

  const generatedTitle = 'Crucial BX500 480GB SSD SATA III gebraucht';

  // --- 1) Prove the old wipe bug ---
  const itemOpen = baseItem();
  let localTitle = generatedTitle;
  let localDescription = generatedDescription;

  // User blurs AI note / vendor → item patch updates → OLD effect re-hydrates
  const afterVendorPatch = mergeStudioPatch(itemOpen, itemOpen, { vendor: 'eBay-seller' });
  const wiped = buggyHydrateOnAnyFieldChange({
    localTitle,
    localDescription,
    item: afterVendorPatch,
    changedDeps: true, // vendor changed
  });
  assert.equal(wiped.description, '', 'BUG repro: generated description wiped after vendor patch');
  assert.equal(wiped.title, itemOpen.name, 'BUG repro: title fell back to item name');

  // --- 2) Fixed hydration keeps draft after vendor patch ---
  const kept = fixedHydrateOnItemId({
    localTitle,
    localDescription,
    item: afterVendorPatch,
    itemIdChanged: false,
  });
  assert.equal(kept.description, generatedDescription, 'fixed: description survives vendor patch');
  assert.equal(kept.title, generatedTitle, 'fixed: title survives vendor patch');

  // --- 3) Apply saves listing onto inventory item (PC path) ---
  let session = afterVendorPatch;
  const itemsRow = afterVendorPatch;
  const applied = applyListingToItem(session, itemsRow, {
    title: kept.title,
    description: kept.description,
    aiNote: 'wifi antennas are fine',
  });

  assert.ok(
    (applied.marketDescription || '').includes('Technische Daten'),
    'Apply must persist generated marketDescription'
  );
  assert.equal(applied.marketTitle, generatedTitle);
  assert.equal(applied.vendor, 'eBay-seller', 'Apply must not wipe earlier vendor patch');
  assert.ok(
    (applied.storeDescription || '').includes('Technische Daten'),
    'Apply mirrors description to storeDescription'
  );
  assert.equal(applied.aiDescriptionNote, 'wifi antennas are fine');

  // --- 4) Apply after photo add must not wipe photos ---
  session = mergeStudioPatch(itemsRow, session, {
    imageUrl: 'https://example.com/a.jpg',
    imageUrls: ['https://example.com/a.jpg', 'https://example.com/b.jpg'],
  });
  const appliedWithPhotos = applyListingToItem(session, itemsRow, {
    title: generatedTitle,
    description: generatedDescription,
  });
  assert.deepEqual(appliedWithPhotos.imageUrls, [
    'https://example.com/a.jpg',
    'https://example.com/b.jpg',
  ]);
  assert.ok((appliedWithPhotos.marketDescription || '').length > 50);

  // --- 5) Spacing still applied for readable blocks ---
  assert.match(applied.marketDescription || '', /\n\n💻/);
  assert.match(applied.marketDescription || '', /\n\n🔧/);

  console.log('verify-apply-listing: all checks passed');
}

run();
