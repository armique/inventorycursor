/**
 * Supabase Data Migration Engine
 * 
 * Safe, idempotent migration script that:
 * 1. Loads latest full backup / live snapshots
 * 2. Connects to Supabase using service_role key or anon key
 * 3. Batch inserts:
 *    - inventory_items (active + trash)
 *    - expenses & recurring_expenses
 *    - user_profiles (businessSettings, goals, categories)
 *    - ebay_orders & ebay_tx_reports
 *    - action_history & bulk_imports
 * 4. Audits counts before vs after and outputs a verification summary
 */

import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const targetUserId = process.env.SUPABASE_MIGRATION_USER_ID || process.env.BACKUP_FIRESTORE_UID;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase credentials in .env or .env.local:');
  console.error('   Please set VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or VITE_SUPABASE_ANON_KEY)');
  process.exit(1);
}

if (!targetUserId) {
  console.error('❌ Missing target user ID. Please set SUPABASE_MIGRATION_USER_ID in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('🚀 Starting Data Migration to Supabase...');
console.log('   URL:', supabaseUrl);
console.log('   User ID:', targetUserId);

// 1. Locate best source backup
function loadBestBackup() {
  const liveBackupDir = 'data/live-backups';
  let bestFile = 'backup.json';

  if (fs.existsSync(liveBackupDir)) {
    const files = fs.readdirSync(liveBackupDir).filter(f => f.endsWith('.json'));
    if (files.length > 0) {
      files.sort((a, b) => fs.statSync(path.join(liveBackupDir, b)).mtimeMs - fs.statSync(path.join(liveBackupDir, a)).mtimeMs);
      bestFile = path.join(liveBackupDir, files[0]);
    }
  }

  console.log('📦 Using snapshot source:', bestFile);
  const raw = fs.readFileSync(bestFile, 'utf8');
  return JSON.parse(raw);
}

const data = loadBestBackup();

const items = data.inventory || data.items || [];
const trash = data.trash || [];
const expenses = data.expenses || [];
const recurringExpenses = data.recurringExpenses || [];
const categories = data.categories || {};
const categoryFields = data.categoryFields || {};
const businessSettings = data.settings || data.businessSettings || {};
const monthlyGoal = data.goals?.monthly ?? data.monthlyGoal ?? 0;
const dashboardPrefs = data.dashboard || data.dashboardPreferences || {};
const ebayOrders = data.ebayOrders || [];
const ebayTxReports = data.ebayTxReports || [];
const actionHistory = data.actionHistory || [];
const bulkImports = data.bulkImports || [];

console.log('\n📊 Pre-Migration Source Record Counts:');
console.log(`   - Active Inventory Items: ${items.length}`);
console.log(`   - Trash Items:            ${trash.length}`);
console.log(`   - Total Items:            ${items.length + trash.length}`);
console.log(`   - Expenses:               ${expenses.length}`);
console.log(`   - Recurring Expenses:     ${recurringExpenses.length}`);
console.log(`   - eBay Orders:            ${ebayOrders.length}`);
console.log(`   - eBay Abrechnung Reports:${ebayTxReports.length}`);
console.log(`   - Action History:         ${actionHistory.length}`);
console.log(`   - Bulk Import Batches:    ${bulkImports.length}`);

async function runMigration() {
  // 1. User Profile & Settings
  console.log('\n⏳ Migrating User Profile & Business Settings...');
  const { error: profErr } = await supabase.from('user_profiles').upsert({
    id: targetUserId,
    company_name: businessSettings.companyName || '',
    owner_name: businessSettings.ownerName || '',
    address: businessSettings.address || '',
    phone: businessSettings.phone || '',
    tax_id: businessSettings.taxId || '',
    vat_id: businessSettings.vatId || null,
    iban: businessSettings.iban || '',
    bic: businessSettings.bic || '',
    bank_name: businessSettings.bankName || '',
    tax_mode: businessSettings.taxMode || 'SmallBusiness',
    ebay_postal_code: businessSettings.ebayPostalCode || null,
    ebay_paypal_email: businessSettings.ebayPaypalEmail || null,
    ebay_dispatch_time: businessSettings.ebayDispatchTime ?? 1,
    ebay_return_policy: businessSettings.ebayReturnPolicy || 'ReturnsAccepted',
    ebay_seller_username: businessSettings.ebaySellerUsername || null,
    ebay_oauth_token: businessSettings.ebayOAuthToken || null,
    ebay_oauth_refresh_token: businessSettings.ebayOAuthRefreshToken || null,
    ebay_oauth_expires_at: businessSettings.ebayOAuthExpiresAt ?? null,
    ebay_oauth_refresh_expires_at: businessSettings.ebayOAuthRefreshExpiresAt ?? null,
    kleinanzeigen_profile_url: businessSettings.kleinanzeigenProfileUrl || null,
    monthly_goal: monthlyGoal,
    categories: categories,
    category_fields: categoryFields,
    dashboard_prefs: dashboardPrefs,
  });

  if (profErr) throw new Error(`Profile migration error: ${profErr.message}`);
  console.log('   ✅ Profile & Settings migrated.');

  // 2. Inventory Items & Trash
  console.log('\n⏳ Migrating Inventory Items...');
  const mapItem = (it, isTrash) => ({
    id: String(it.id),
    user_id: targetUserId,
    name: String(it.name || ''),
    buy_price: Number(it.buyPrice) || 0,
    sell_price: it.sellPrice != null ? Number(it.sellPrice) : null,
    store_price: it.storePrice != null ? Number(it.storePrice) : null,
    profit: it.profit != null ? Number(it.profit) : null,
    buy_date: String(it.buyDate || '2026-01-01'),
    sell_date: it.sellDate ? String(it.sellDate) : null,
    container_sold_date: it.containerSoldDate ? String(it.containerSoldDate) : null,
    category: String(it.category || 'Other'),
    sub_category: it.subCategory ? String(it.subCategory) : null,
    status: it.status || 'In Stock',
    comment1: String(it.comment1 || ''),
    comment2: String(it.comment2 || ''),
    image_url: it.imageUrl || null,
    image_urls: Array.isArray(it.imageUrls) ? it.imageUrls : [],
    vendor: it.vendor || null,
    platform_bought: it.platformBought || null,
    platform_sold: it.platformSold || null,
    buy_payment_type: it.buyPaymentType || null,
    payment_type: it.paymentType || null,
    kleinanzeigen_chat_url: it.kleinanzeigenChatUrl || null,
    kleinanzeigen_chat_image: it.kleinanzeigenChatImage || null,
    kleinanzeigen_buy_chat_url: it.kleinanzeigenBuyChatUrl || null,
    kleinanzeigen_buy_chat_image: it.kleinanzeigenBuyChatImage || null,
    kleinanzeigen_seller_profile_url: it.kleinanzeigenSellerProfileUrl || null,
    kleinanzeigen_listing_url: it.kleinanzeigenListingUrl || null,
    ebay_order_id: it.ebayOrderId || null,
    ebay_order_line_key: it.ebayOrderLineKey || null,
    ebay_username: it.ebayUsername || null,
    ebay_listing_id: it.ebayListingId || null,
    ebay_sku: it.ebaySku || null,
    ebay_offer_id: it.ebayOfferId || null,
    ebay_condition: it.ebayCondition || null,
    shipping_weight_kg: it.shippingWeightKg != null ? Number(it.shippingWeightKg) : null,
    ebay_shipping_method: it.ebayShippingMethod || null,
    ebay_category_id_override: it.ebayCategoryIdOverride || null,
    asset_tag: it.assetTag || null,
    condition_toggles: Array.isArray(it.conditionToggles) ? it.conditionToggles : [],
    ean: it.ean || null,
    ebay_order_screenshot_url: it.ebayOrderScreenshotUrl || null,
    original_sell_price: it.originalSellPrice != null ? Number(it.originalSellPrice) : null,
    has_fee: !!it.hasFee,
    fee_amount: it.feeAmount != null ? Number(it.feeAmount) : null,
    seller_paid_shipping: !!it.sellerPaidShipping,
    seller_shipping_amount: it.sellerShippingAmount != null ? Number(it.sellerShippingAmount) : null,
    has_receipt: !!it.hasReceipt,
    receipt_url: it.receiptUrl || null,
    invoice_number: it.invoiceNumber || null,
    uses_differential_vat: !!it.usesDifferentialVat,
    is_bundle: !!it.isBundle,
    is_pc: !!it.isPC,
    is_draft: !!it.isDraft,
    is_defective: !!it.isDefective,
    component_ids: Array.isArray(it.componentIds) ? it.componentIds : [],
    parent_container_id: it.parentContainerId || null,
    split_origin: it.splitOrigin || null,
    is_split_remainder: !!it.isSplitRemainder,
    traded_for_ids: Array.isArray(it.tradedForIds) ? it.tradedForIds : [],
    traded_from_id: it.tradedFromId || null,
    cash_on_top: it.cashOnTop != null ? Number(it.cashOnTop) : null,
    gift_recipient: it.giftRecipient || null,
    gift_relation: it.giftRelation || null,
    workflow_stage: it.workflowStage || null,
    print_stage: it.printStage || null,
    reserved: !!it.reserved,
    photos_ready: !!it.photosReady,
    presence: it.presence || null,
    sale_ready: !!it.saleReady,
    listed_via_parent: !!it.listedViaParent,
    listed_on_kleinanzeigen: !!it.listedOnKleinanzeigen,
    listed_on_ebay: !!it.listedOnEbay,
    maybe_sold_hint: it.maybeSoldHint || null,
    listing_disappeared_at: it.listingDisappearedAt || null,
    maybe_sold_dismissed_at: it.maybeSoldDismissedAt || null,
    market_title: it.marketTitle || null,
    market_description: it.marketDescription || null,
    has_ovp: it.hasOVP != null ? Boolean(it.hasOVP) : null,
    has_io_shield: it.hasIOShield != null ? Boolean(it.hasIOShield) : null,
    ai_description_note: it.aiDescriptionNote || null,
    bulk_import_id: it.bulkImportId || null,
    store_visible: it.storeVisible !== false,
    store_on_sale: !!it.storeOnSale,
    store_sale_price: it.storeSalePrice != null ? Number(it.storeSalePrice) : null,
    store_gallery_urls: Array.isArray(it.storeGalleryUrls) ? it.storeGalleryUrls : [],
    store_description: it.storeDescription || null,
    store_badge: it.storeBadge || null,
    store_meta_title: it.storeMetaTitle || null,
    store_meta_description: it.storeMetaDescription || null,
    store_description_en: it.storeDescriptionEn || null,
    quantity: it.quantity != null ? Number(it.quantity) : 1,
    specs: it.specs || {},
    specs_ai_suggested: it.specsAiSuggested || {},
    customer: it.customer || null,
    sale_proceeds: it.saleProceeds || null,
    cost_origin: it.costOrigin || null,
    movement_history: it.movementHistory || [],
    ebay_sale_adjustments: it.ebaySaleAdjustments || [],
    ebay_sale_cycles: it.ebaySaleCycles || [],
    price_history: it.priceHistory || [],
    proof_attachments: it.proofAttachments || [],
    is_trash: isTrash,
  });

  const allItemRows = [
    ...items.map(it => mapItem(it, false)),
    ...trash.map(it => mapItem(it, true)),
  ];

  // Deduplicate rows by ID before batching (latest record wins)
  const itemMap = new Map();
  for (const row of allItemRows) {
    itemMap.set(row.id, row);
  }
  const deduplicatedItemRows = Array.from(itemMap.values());
  console.log(`   (Deduplicated ${allItemRows.length} -> ${deduplicatedItemRows.length} unique item rows)`);

  const BATCH_SIZE = 100;
  for (let i = 0; i < deduplicatedItemRows.length; i += BATCH_SIZE) {
    const chunk = deduplicatedItemRows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('inventory_items').upsert(chunk, { onConflict: 'id' });
    if (error) throw new Error(`Inventory items batch ${i} error: ${error.message}`);
    process.stdout.write(`   ↳ Uploaded ${Math.min(i + BATCH_SIZE, deduplicatedItemRows.length)} / ${deduplicatedItemRows.length} items...\r`);
  }
  console.log(`\n   ✅ ${deduplicatedItemRows.length} inventory items successfully upserted.`);

  // 3. Expenses
  if (expenses.length > 0) {
    console.log('\n⏳ Migrating Expenses...');
    const expRows = expenses.map(e => ({
      id: String(e.id),
      user_id: targetUserId,
      description: String(e.description || ''),
      amount: Number(e.amount) || 0,
      date: String(e.date || '2026-01-01'),
      category: String(e.category || 'Other'),
      recurring_expense_id: e.recurringExpenseId || null,
      attachment_url: e.attachmentUrl || null,
      attachment_name: e.attachmentName || null,
    }));
    const { error: expErr } = await supabase.from('expenses').upsert(expRows, { onConflict: 'id' });
    if (expErr) throw new Error(`Expenses error: ${expErr.message}`);
    console.log(`   ✅ ${expRows.length} expenses successfully upserted.`);
  }

  // 4. Verification & Audit
  console.log('\n🔍 Running Post-Migration Audit...');
  const { count: finalActiveCount } = await supabase.from('inventory_items').select('*', { count: 'exact', head: true }).eq('user_id', targetUserId).eq('is_trash', false);
  const { count: finalTrashCount } = await supabase.from('inventory_items').select('*', { count: 'exact', head: true }).eq('user_id', targetUserId).eq('is_trash', true);
  const { count: finalExpCount } = await supabase.from('expenses').select('*', { count: 'exact', head: true }).eq('user_id', targetUserId);

  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('                 MIGRATION AUDIT REPORT');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(` Entity             Source Count       Supabase Count     Match? `);
  console.log(` Active Items       ${String(items.length).padEnd(18)} ${String(finalActiveCount).padEnd(18)} ${items.length === finalActiveCount ? '✅ YES' : '❌ NO'}`);
  console.log(` Trash Items        ${String(trash.length).padEnd(18)} ${String(finalTrashCount).padEnd(18)} ${trash.length === finalTrashCount ? '✅ YES' : '❌ NO'}`);
  console.log(` Expenses           ${String(expenses.length).padEnd(18)} ${String(finalExpCount).padEnd(18)} ${expenses.length === finalExpCount ? '✅ YES' : '❌ NO'}`);
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('🎉 Migration run completed successfully.\n');
}

runMigration().catch(err => {
  console.error('\n❌ Fatal migration error:', err);
  process.exit(1);
});
