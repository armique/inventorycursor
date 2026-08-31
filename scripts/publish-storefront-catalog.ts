/**
 * Publish the public storefront catalog from Supabase inventory.
 *
 * The app publishes automatically after edits, but that only fires when there
 * are unsaved changes — so a freshly created storefront_catalog table stays
 * empty (and the shop shows nothing) until someone happens to edit an item.
 * This does the same publish on demand, server-side.
 *
 * Reuses buildStoreCatalog so the published payload is byte-for-byte what the
 * app would produce: in-stock, non-draft, store-visible, standalone items only,
 * with no buy price, profit, vendor or customer data.
 *
 *   npx tsx scripts/publish-storefront-catalog.ts            (dry run)
 *   npx tsx scripts/publish-storefront-catalog.ts --apply
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { buildStoreCatalog } from '../utils/storefrontCatalog';
import type { InventoryItem } from '../types';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const apply = process.argv.includes('--apply');
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OWNER_UID = process.env.BACKUP_OWNER_UID || '568865df-ee65-4de7-870b-ef73cd1f9c35';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

/** Only the fields buildStoreCatalog reads — kept narrow on purpose. */
function rowToItem(r: Record<string, any>): InventoryItem {
  return {
    id: String(r.id),
    name: String(r.name ?? ''),
    category: String(r.category ?? ''),
    subCategory: r.sub_category ?? undefined,
    status: r.status,
    isDraft: !!r.is_draft,
    parentContainerId: r.parent_container_id ?? undefined,
    storeVisible: r.store_visible,
    storePrice: r.store_price ?? undefined,
    sellPrice: r.sell_price ?? undefined,
    storeSalePrice: r.store_sale_price ?? undefined,
    storeOnSale: !!r.store_on_sale,
    storeBadge: r.store_badge ?? undefined,
    buyDate: r.buy_date ?? '',
    buyPrice: Number(r.buy_price ?? 0),
    imageUrl: r.image_url ?? undefined,
    imageUrls: r.image_urls ?? [],
    storeGalleryUrls: r.store_gallery_urls ?? [],
    storeDescription: r.store_description ?? undefined,
    storeDescriptionEn: r.store_description_en ?? undefined,
    storeMetaTitle: r.store_meta_title ?? undefined,
    storeMetaDescription: r.store_meta_description ?? undefined,
    specs: r.specs ?? {},
    priceHistory: r.price_history ?? [],
    quantity: r.quantity ?? 1,
    comment1: '',
    comment2: '',
  } as InventoryItem;
}

async function fetchAll(table: string, col: string, val: string) {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select('*').eq(col, val).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

async function main() {
  const rows = await fetchAll('inventory_items', 'user_id', OWNER_UID);
  const items = rows.filter((r) => !r.is_trash).map(rowToItem);

  const { data: profile } = await sb
    .from('user_profiles')
    .select('custom_category_fields')
    .eq('id', OWNER_UID)
    .maybeSingle();
  const categoryFields = (profile?.custom_category_fields as Record<string, string[]>) || {};

  const catalog = buildStoreCatalog(items, categoryFields);

  const withImage = catalog.items.filter((i) => i.imageUrl).length;
  const onSale = catalog.items.filter((i) => i.storeOnSale).length;
  const byCategory: Record<string, number> = {};
  for (const i of catalog.items) byCategory[i.category] = (byCategory[i.category] || 0) + 1;

  console.log(`inventory rows (non-trash) : ${items.length}`);
  console.log(`published to storefront    : ${catalog.items.length}`);
  console.log(`  with a usable image      : ${withImage}`);
  console.log(`  on sale                  : ${onSale}`);
  console.log(`categories:`, JSON.stringify(byCategory, null, 1));

  // Guard against publishing a payload that leaks internals, in case
  // buildStoreCatalog ever changes shape.
  const FORBIDDEN = ['buyPrice', 'profit', 'vendor', 'customer', 'ebayOrderId', 'saleProceeds', 'feeAmount'];
  const sample = JSON.stringify(catalog.items.slice(0, 200));
  const leaked = FORBIDDEN.filter((f) => sample.includes(`"${f}"`));
  if (leaked.length) {
    console.error(`\nREFUSING TO PUBLISH — payload contains private fields: ${leaked.join(', ')}`);
    process.exit(1);
  }
  console.log('\nprivacy check: no buyPrice / profit / vendor / customer / order-id fields present');

  if (!apply) {
    console.log('\nDry run — nothing written. Re-run with --apply to publish.');
    return;
  }

  const { error } = await sb.from('storefront_catalog').upsert({
    user_id: OWNER_UID,
    catalog_data: catalog,
    updated_at: new Date().toISOString(),
  });
  if (error) {
    console.error('Publish failed:', error.message);
    process.exit(1);
  }

  const { data: check } = await sb
    .from('storefront_catalog')
    .select('updated_at, catalog_data')
    .eq('user_id', OWNER_UID)
    .maybeSingle();
  console.log(`\nPublished. Stored items: ${check?.catalog_data?.items?.length ?? 0} at ${check?.updated_at}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
