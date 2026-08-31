/**
 * Supabase Service Layer
 * 
 * Single authoritative source of truth for database (PostgreSQL), 
 * Auth (Google OAuth / Session), Storage, and Realtime updates.
 */

import { createClient, type SupabaseClient, type User, type Session } from '@supabase/supabase-js';
import type {
  BusinessSettings,
  DashboardPreferences,
  Expense,
  InventoryItem,
  RecurringExpense,
  ActionHistoryEntry,
  BulkImportRecord,
  StoreInquiry
} from '../types';
import type { EbayOrderRecord } from './ebayOrderIndex';
import type { EbayTxReport } from '../utils/ebayTransactionReport';
import { canonicalizeInventoryItems } from '../utils/canonicalItemOrders';

// ------------------------------------------------------------------------------
// 1. CONFIGURATION & CLIENT INITIALIZATION
// ------------------------------------------------------------------------------

export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

const SUPABASE_CONFIG_STORAGE_KEY = 'deinv_supabase_config_v1';
export const DEFAULT_SUPABASE_URL = 'https://lkmxlwpszekfuzqpqtrb.supabase.co';
export const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_QR62aggcb-KO0H6pwig2zw_EyoQp0WJ';

export function getSupabaseConfig(): SupabaseConfig | null {
  const envUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
  const envKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();
  if (envUrl && envKey) {
    return { url: envUrl, anonKey: envKey };
  }

  if (typeof localStorage !== 'undefined') {
    try {
      const stored = localStorage.getItem(SUPABASE_CONFIG_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as SupabaseConfig;
        if (parsed.url && parsed.anonKey) return parsed;
      }
    } catch {
      // ignore
    }
  }

  return {
    url: DEFAULT_SUPABASE_URL,
    anonKey: DEFAULT_SUPABASE_ANON_KEY,
  };
}

export function saveSupabaseConfig(config: SupabaseConfig): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(SUPABASE_CONFIG_STORAGE_KEY, JSON.stringify(config));
  }
}

let supabaseInstance: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (supabaseInstance) return supabaseInstance;

  const cfg = getSupabaseConfig();
  if (!cfg) return null;

  supabaseInstance = createClient(cfg.url, cfg.anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'deinv_supabase_auth_token',
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  });

  return supabaseInstance;
}

export const SUPABASE_TEMPORARILY_DISABLED = false;

export function isSupabaseConfigured(): boolean {
  if (SUPABASE_TEMPORARILY_DISABLED) return false;
  return !!getSupabase();
}

// ------------------------------------------------------------------------------
// 2. AUTHENTICATION
// ------------------------------------------------------------------------------

const DEV_AUTH_STORAGE_KEY = 'deinv_dev_auth_user';
export const OWNER_ADMIN_EMAIL = 'abelyanarmen@gmail.com';

export function isLocalOrDevEnvironment(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return (
    Boolean(import.meta.env.DEV) ||
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.endsWith('.local')
  );
}

export function getDevAdminUser(): User | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(DEV_AUTH_STORAGE_KEY);
    if (raw) return JSON.parse(raw) as User;
  } catch {}
  return null;
}

export const DEFAULT_MASTER_PIN = '7788';

/**
 * Developer passcode sign-in — LOCAL DEVELOPMENT ONLY.
 *
 * These passcodes are compiled into the client bundle, so on a deployed site
 * they are readable by anyone who opens the JS. They are therefore not a secret
 * and cannot be treated as an authentication factor in production; the only
 * thing that makes them acceptable at all is that they never leave localhost.
 * Production sign-in must go through real Supabase auth (Google / email OTP).
 *
 * Returns a REAL Supabase session on success (see establishDevOwnerSession), not
 * a synthetic user object — without a JWT every write is rejected by RLS, which
 * made dev sessions silently read-only.
 */
export async function verifyAndSignInWithPin(
  pin: string,
  email = OWNER_ADMIN_EMAIL
): Promise<{ success: boolean; user?: User; error?: string }> {
  if (!isLocalOrDevEnvironment()) {
    return { success: false, error: 'Developer access is only available on localhost.' };
  }
  const cleanPin = String(pin || '').trim();
  const validPins = [DEFAULT_MASTER_PIN, '123456'];
  if (!validPins.includes(cleanPin)) {
    return { success: false, error: 'Invalid Developer Passcode. Access denied.' };
  }

  // Mint a genuine Supabase session so RLS treats this exactly like the owner.
  // Falls back to the legacy synthetic user (read-only) if that cannot be done,
  // so local work still functions rather than failing to sign in at all.
  const real = await establishDevOwnerSession();
  const user = signInWithDevAdmin(email);
  if (!real.ok) {
    console.warn(
      `[dev-auth] Signed in without a Supabase session (${real.error}). ` +
        'Reads work via the local proxy, but writes will be rejected by RLS.'
    );
  }
  return { success: true, user };
}

/**
 * Ask the localhost-only dev endpoint to mint a real session for the owner, then
 * install it on the client. The service role key stays server-side; what comes
 * back is an ordinary user session subject to the same RLS as a normal login.
 */
export async function establishDevOwnerSession(): Promise<{ ok: boolean; error?: string }> {
  if (!isLocalOrDevEnvironment()) return { ok: false, error: 'not local' };
  const sb = getSupabase();
  if (!sb) return { ok: false, error: 'supabase not configured' };

  try {
    const res = await fetch('/api/supabase-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'dev-session' }),
    });
    if (!res.ok) return { ok: false, error: `dev-session HTTP ${res.status}` };
    const payload = await res.json();
    if (!payload?.ok || !payload.tokenHash) {
      return { ok: false, error: payload?.error || 'no token returned' };
    }
    const { data, error } = await sb.auth.verifyOtp({
      token_hash: payload.tokenHash,
      type: 'magiclink',
    });
    if (error) return { ok: false, error: error.message };
    if (!data.session) return { ok: false, error: 'no session established' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'dev session failed' };
  }
}

export function isDevAdminSession(): boolean {
  return !!getDevAdminUser();
}

export const PRIMARY_OWNER_UID = '568865df-ee65-4de7-870b-ef73cd1f9c35';

export function signInWithDevAdmin(email = OWNER_ADMIN_EMAIL): User {
  const user = {
    id: PRIMARY_OWNER_UID,
    app_metadata: { provider: 'dev' },
    user_metadata: { name: 'Owner / Developer' },
    aud: 'authenticated',
    confirmation_sent_at: new Date().toISOString(),
    confirmed_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
    email: email.toLowerCase(),
    email_confirmed_at: new Date().toISOString(),
    phone: '',
    role: 'authenticated',
    updated_at: new Date().toISOString(),
  } as unknown as User;
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(DEV_AUTH_STORAGE_KEY, JSON.stringify(user));
    window.dispatchEvent(new Event('deinv_auth_state_changed'));
  }
  return user;
}

export function logOutDevAdmin(): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(DEV_AUTH_STORAGE_KEY);
    window.dispatchEvent(new Event('deinv_auth_state_changed'));
  }
}

export async function signInWithGoogleOAuth(redirectTo?: string): Promise<{ error: Error | null }> {
  const sb = getSupabase();
  if (!sb) return { error: new Error('Supabase is not configured') };

  const targetUrl = (typeof redirectTo === 'string' && redirectTo.trim())
    ? redirectTo.trim()
    : (typeof window !== 'undefined' ? `${window.location.origin}/panel/dashboard` : '');
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: targetUrl,
      queryParams: {
        access_type: 'offline',
        prompt: 'select_account',
      },
    },
  });

  return { error };
}

export async function signInWithEmailOtp(email: string): Promise<{ error: Error | null }> {
  const sb = getSupabase();
  if (!sb) return { error: new Error('Supabase is not configured') };
  const { error } = await sb.auth.signInWithOtp({
    email: email.trim(),
    options: {
      emailRedirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
    },
  });
  return { error };
}

export async function verifyEmailOtp(email: string, token: string): Promise<{ data: { user: User | null; session: Session | null }; error: Error | null }> {
  const sb = getSupabase();
  if (!sb) return { data: { user: null, session: null }, error: new Error('Supabase is not configured') };
  const { data, error } = await sb.auth.verifyOtp({
    email: email.trim(),
    token: token.trim(),
    type: 'email',
  });
  return { data, error };
}

export async function signInWithPassword(email: string, password: string): Promise<{ data: { user: User | null; session: Session | null }; error: Error | null }> {
  const sb = getSupabase();
  if (!sb) return { data: { user: null, session: null }, error: new Error('Supabase is not configured') };
  const { data, error } = await sb.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
  return { data, error };
}

export async function logOutSupabase(): Promise<{ error: Error | null }> {
  logOutDevAdmin();
  const sb = getSupabase();
  if (!sb) return { error: null };
  const { error } = await sb.auth.signOut();
  return { error };
}

export function onSupabaseAuthChange(callback: (user: User | null, session: Session | null) => void): () => void {
  const devUser = getDevAdminUser();
  if (devUser) {
    callback(devUser, null);
  }

  const handleDevChange = () => {
    const current = getDevAdminUser();
    if (current) {
      callback(current, null);
    } else {
      const sb = getSupabase();
      if (sb) {
        sb.auth.getSession().then(({ data: { session } }) => {
          callback(session?.user ?? null, session);
        });
      } else {
        callback(null, null);
      }
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('deinv_auth_state_changed', handleDevChange);
  }

  const sb = getSupabase();
  let unsubscribeSb = () => {};
  if (sb) {
    sb.auth.getSession().then(({ data: { session } }) => {
      if (!getDevAdminUser()) {
        callback(session?.user ?? null, session);
      }
    }).catch(() => {});

    const { data: { subscription } } = sb.auth.onAuthStateChange((_event, session) => {
      if (!getDevAdminUser()) {
        callback(session?.user ?? null, session);
      }
    });
    unsubscribeSb = () => subscription.unsubscribe();
  } else if (!devUser) {
    callback(null, null);
  }

  return () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('deinv_auth_state_changed', handleDevChange);
    }
    unsubscribeSb();
  };
}

export async function getCurrentSupabaseUser(): Promise<User | null> {
  const devUser = getDevAdminUser();
  if (devUser) return devUser;
  const sb = getSupabase();
  if (!sb) return null;
  const { data: { user } } = await sb.auth.getUser();
  return user;
}

// ------------------------------------------------------------------------------
// 3. INVENTORY & APP STATE PAYLOAD TYPES
// ------------------------------------------------------------------------------

export interface SupabaseSyncSnapshot {
  items: InventoryItem[];
  trash: InventoryItem[];
  expenses: Expense[];
  recurringExpenses?: RecurringExpense[];
  categories: Record<string, string[]>;
  categoryFields: Record<string, string[]>;
  businessSettings: BusinessSettings;
  monthlyGoal: number;
  dashboardPrefs?: DashboardPreferences;
  actionHistory?: ActionHistoryEntry[];
  bulkImports?: BulkImportRecord[];
  ebayOrders?: EbayOrderRecord[];
  ebayTxReports?: EbayTxReport[];
}

// ------------------------------------------------------------------------------
// 4. MAPPER HELPERS (Item <-> DB Row)
// ------------------------------------------------------------------------------

function mapItemToRow(item: InventoryItem, userId: string, isTrash: boolean): Record<string, unknown> {
  return {
    id: item.id,
    user_id: userId,
    name: item.name,
    buy_price: item.buyPrice ?? 0,
    sell_price: item.sellPrice ?? null,
    store_price: item.storePrice ?? null,
    profit: item.profit ?? null,
    buy_date: item.buyDate,
    sell_date: item.sellDate ?? null,
    container_sold_date: item.containerSoldDate ?? null,
    category: item.category,
    sub_category: item.subCategory ?? null,
    status: item.status,
    comment1: item.comment1 ?? '',
    comment2: item.comment2 ?? '',
    image_url: item.imageUrl ?? null,
    image_urls: item.imageUrls ?? [],
    vendor: item.vendor ?? null,
    platform_bought: item.platformBought ?? null,
    platform_sold: item.platformSold ?? null,
    buy_payment_type: item.buyPaymentType ?? null,
    payment_type: item.paymentType ?? null,
    kleinanzeigen_chat_url: item.kleinanzeigenChatUrl ?? null,
    kleinanzeigen_chat_image: item.kleinanzeigenChatImage ?? null,
    kleinanzeigen_buy_chat_url: item.kleinanzeigenBuyChatUrl ?? null,
    kleinanzeigen_buy_chat_image: item.kleinanzeigenBuyChatImage ?? null,
    kleinanzeigen_seller_profile_url: item.kleinanzeigenSellerProfileUrl ?? null,
    kleinanzeigen_listing_url: item.kleinanzeigenListingUrl ?? null,
    ebay_order_id: item.ebayOrderId ?? null,
    ebay_order_line_key: item.ebayOrderLineKey ?? null,
    ebay_username: item.ebayUsername ?? null,
    ebay_listing_id: item.ebayListingId ?? null,
    ebay_sku: item.ebaySku ?? null,
    ebay_offer_id: item.ebayOfferId ?? null,
    ebay_condition: item.ebayCondition ?? null,
    shipping_weight_kg: item.shippingWeightKg ?? null,
    ebay_shipping_method: item.ebayShippingMethod ?? null,
    ebay_category_id_override: item.ebayCategoryIdOverride ?? null,
    asset_tag: item.assetTag ?? null,
    condition_toggles: item.conditionToggles ?? [],
    ean: item.ean ?? null,
    ebay_order_screenshot_url: item.ebayOrderScreenshotUrl ?? null,
    original_sell_price: item.originalSellPrice ?? null,
    has_fee: !!item.hasFee,
    fee_amount: item.feeAmount ?? null,
    seller_paid_shipping: !!item.sellerPaidShipping,
    seller_shipping_amount: item.sellerShippingAmount ?? null,
    has_receipt: !!item.hasReceipt,
    receipt_url: item.receiptUrl ?? null,
    invoice_number: item.invoiceNumber ?? null,
    uses_differential_vat: !!item.usesDifferentialVat,
    is_bundle: !!item.isBundle,
    is_pc: !!item.isPC,
    is_draft: !!item.isDraft,
    is_defective: !!item.isDefective,
    component_ids: item.componentIds ?? [],
    parent_container_id: item.parentContainerId ?? null,
    split_origin: item.splitOrigin ?? null,
    is_split_remainder: !!item.isSplitRemainder,
    traded_for_ids: item.tradedForIds ?? [],
    traded_from_id: item.tradedFromId ?? null,
    cash_on_top: item.cashOnTop ?? null,
    gift_recipient: item.giftRecipient ?? null,
    gift_relation: item.giftRelation ?? null,
    workflow_stage: item.workflowStage ?? null,
    print_stage: item.printStage ?? null,
    reserved: !!item.reserved,
    photos_ready: !!item.photosReady,
    presence: item.presence ?? null,
    sale_ready: !!item.saleReady,
    listed_via_parent: !!item.listedViaParent,
    listed_on_kleinanzeigen: !!item.listedOnKleinanzeigen,
    listed_on_ebay: !!item.listedOnEbay,
    maybe_sold_hint: item.maybeSoldHint ?? null,
    listing_disappeared_at: item.listingDisappearedAt ?? null,
    maybe_sold_dismissed_at: item.maybeSoldDismissedAt ?? null,
    market_title: item.marketTitle ?? null,
    market_description: item.marketDescription ?? null,
    has_ovp: item.hasOVP ?? null,
    has_io_shield: item.hasIOShield ?? null,
    ai_description_note: item.aiDescriptionNote ?? null,
    bulk_import_id: item.bulkImportId ?? null,
    store_visible: item.storeVisible !== false,
    store_on_sale: !!item.storeOnSale,
    store_sale_price: item.storeSalePrice ?? null,
    store_gallery_urls: item.storeGalleryUrls ?? [],
    store_description: item.storeDescription ?? null,
    store_badge: item.storeBadge ?? null,
    store_meta_title: item.storeMetaTitle ?? null,
    store_meta_description: item.storeMetaDescription ?? null,
    store_description_en: item.storeDescriptionEn ?? null,
    quantity: item.quantity ?? 1,
    specs: item.specs ?? {},
    specs_ai_suggested: item.specsAiSuggested ?? {},
    customer: item.customer ?? null,
    sale_proceeds: item.saleProceeds ?? null,
    cost_origin: item.costOrigin ?? null,
    movement_history: item.movementHistory ?? [],
    ebay_sale_adjustments: item.ebaySaleAdjustments ?? [],
    ebay_sale_cycles: item.ebaySaleCycles ?? [],
    price_history: item.priceHistory ?? [],
    history: item.history ?? [],
    proof_attachments: item.proofAttachments ?? [],
    is_trash: isTrash,
  };
}

function mapRowToItem(row: Record<string, unknown>): InventoryItem {
  return {
    id: String(row.id),
    name: String(row.name || ''),
    buyPrice: Number(row.buy_price) || 0,
    sellPrice: row.sell_price != null ? Number(row.sell_price) : undefined,
    storePrice: row.store_price != null ? Number(row.store_price) : undefined,
    profit: row.profit != null ? Number(row.profit) : undefined,
    buyDate: String(row.buy_date || ''),
    sellDate: row.sell_date ? String(row.sell_date) : undefined,
    containerSoldDate: row.container_sold_date ? String(row.container_sold_date) : undefined,
    category: String(row.category || ''),
    subCategory: row.sub_category ? String(row.sub_category) : undefined,
    status: (row.status as InventoryItem['status']) || ('In Stock' as InventoryItem['status']),
    comment1: String(row.comment1 || ''),
    comment2: String(row.comment2 || ''),
    imageUrl: row.image_url ? String(row.image_url) : undefined,
    imageUrls: Array.isArray(row.image_urls) ? (row.image_urls as string[]) : undefined,
    vendor: row.vendor ? String(row.vendor) : undefined,
    platformBought: row.platform_bought as InventoryItem['platformBought'],
    platformSold: row.platform_sold as InventoryItem['platformSold'],
    buyPaymentType: row.buy_payment_type as InventoryItem['buyPaymentType'],
    paymentType: row.payment_type as InventoryItem['paymentType'],
    kleinanzeigenChatUrl: row.kleinanzeigen_chat_url ? String(row.kleinanzeigen_chat_url) : undefined,
    kleinanzeigenChatImage: row.kleinanzeigen_chat_image ? String(row.kleinanzeigen_chat_image) : undefined,
    kleinanzeigenBuyChatUrl: row.kleinanzeigen_buy_chat_url ? String(row.kleinanzeigen_buy_chat_url) : undefined,
    kleinanzeigenBuyChatImage: row.kleinanzeigen_buy_chat_image ? String(row.kleinanzeigen_buy_chat_image) : undefined,
    kleinanzeigenSellerProfileUrl: row.kleinanzeigen_seller_profile_url ? String(row.kleinanzeigen_seller_profile_url) : undefined,
    kleinanzeigenListingUrl: row.kleinanzeigen_listing_url ? String(row.kleinanzeigen_listing_url) : undefined,
    ebayOrderId: row.ebay_order_id ? String(row.ebay_order_id) : undefined,
    ebayOrderLineKey: row.ebay_order_line_key ? String(row.ebay_order_line_key) : undefined,
    ebayUsername: row.ebay_username ? String(row.ebay_username) : undefined,
    ebayListingId: row.ebay_listing_id ? String(row.ebay_listing_id) : undefined,
    ebaySku: row.ebay_sku ? String(row.ebay_sku) : undefined,
    ebayOfferId: row.ebay_offer_id ? String(row.ebay_offer_id) : undefined,
    ebayCondition: row.ebay_condition as InventoryItem['ebayCondition'],
    shippingWeightKg: row.shipping_weight_kg != null ? Number(row.shipping_weight_kg) : undefined,
    ebayShippingMethod: row.ebay_shipping_method as InventoryItem['ebayShippingMethod'],
    ebayCategoryIdOverride: row.ebay_category_id_override ? String(row.ebay_category_id_override) : undefined,
    assetTag: row.asset_tag ? String(row.asset_tag) : undefined,
    conditionToggles: Array.isArray(row.condition_toggles) ? (row.condition_toggles as string[]) : undefined,
    ean: row.ean ? String(row.ean) : undefined,
    ebayOrderScreenshotUrl: row.ebay_order_screenshot_url ? String(row.ebay_order_screenshot_url) : undefined,
    originalSellPrice: row.original_sell_price != null ? Number(row.original_sell_price) : undefined,
    hasFee: !!row.has_fee,
    feeAmount: row.fee_amount != null ? Number(row.fee_amount) : undefined,
    sellerPaidShipping: !!row.seller_paid_shipping,
    sellerShippingAmount: row.seller_shipping_amount != null ? Number(row.seller_shipping_amount) : undefined,
    hasReceipt: !!row.has_receipt,
    receiptUrl: row.receipt_url ? String(row.receipt_url) : undefined,
    invoiceNumber: row.invoice_number ? String(row.invoice_number) : undefined,
    usesDifferentialVat: !!row.uses_differential_vat,
    isBundle: !!row.is_bundle,
    isPC: !!row.is_pc,
    isDraft: !!row.is_draft,
    isDefective: !!row.is_defective,
    componentIds: Array.isArray(row.component_ids) ? (row.component_ids as string[]) : undefined,
    parentContainerId: row.parent_container_id ? String(row.parent_container_id) : undefined,
    splitOrigin: row.split_origin as InventoryItem['splitOrigin'],
    isSplitRemainder: !!row.is_split_remainder,
    tradedForIds: Array.isArray(row.traded_for_ids) ? (row.traded_for_ids as string[]) : undefined,
    tradedFromId: row.traded_from_id ? String(row.traded_from_id) : undefined,
    cashOnTop: row.cash_on_top != null ? Number(row.cash_on_top) : undefined,
    giftRecipient: row.gift_recipient ? String(row.gift_recipient) : undefined,
    giftRelation: row.gift_relation as InventoryItem['giftRelation'],
    workflowStage: row.workflow_stage as InventoryItem['workflowStage'],
    printStage: row.print_stage as InventoryItem['printStage'],
    reserved: !!row.reserved,
    photosReady: !!row.photos_ready,
    presence: row.presence as InventoryItem['presence'],
    saleReady: !!row.sale_ready,
    listedViaParent: !!row.listed_via_parent,
    listedOnKleinanzeigen: !!row.listed_on_kleinanzeigen,
    listedOnEbay: !!row.listed_on_ebay,
    maybeSoldHint: row.maybe_sold_hint as InventoryItem['maybeSoldHint'],
    listingDisappearedAt: row.listing_disappeared_at ? String(row.listing_disappeared_at) : undefined,
    maybeSoldDismissedAt: row.maybe_sold_dismissed_at ? String(row.maybe_sold_dismissed_at) : undefined,
    marketTitle: row.market_title ? String(row.market_title) : undefined,
    marketDescription: row.market_description ? String(row.market_description) : undefined,
    hasOVP: row.has_ovp != null ? Boolean(row.has_ovp) : undefined,
    hasIOShield: row.has_io_shield != null ? Boolean(row.has_io_shield) : undefined,
    aiDescriptionNote: row.ai_description_note ? String(row.ai_description_note) : undefined,
    bulkImportId: row.bulk_import_id ? String(row.bulk_import_id) : undefined,
    storeVisible: row.store_visible !== false,
    storeOnSale: !!row.store_on_sale,
    storeSalePrice: row.store_sale_price != null ? Number(row.store_sale_price) : undefined,
    storeGalleryUrls: Array.isArray(row.store_gallery_urls) ? (row.store_gallery_urls as string[]) : undefined,
    storeDescription: row.store_description ? String(row.store_description) : undefined,
    storeBadge: row.store_badge as InventoryItem['storeBadge'],
    storeMetaTitle: row.store_meta_title ? String(row.store_meta_title) : undefined,
    storeMetaDescription: row.store_meta_description ? String(row.store_meta_description) : undefined,
    storeDescriptionEn: row.store_description_en ? String(row.store_description_en) : undefined,
    quantity: row.quantity != null ? Number(row.quantity) : 1,
    specs: (row.specs as Record<string, string | number>) || {},
    specsAiSuggested: (row.specs_ai_suggested as Record<string, string | number>) || {},
    customer: (row.customer as InventoryItem['customer']) || undefined,
    saleProceeds: (row.sale_proceeds as InventoryItem['saleProceeds']) || undefined,
    costOrigin: (row.cost_origin as InventoryItem['costOrigin']) || undefined,
    movementHistory: Array.isArray(row.movement_history) ? (row.movement_history as InventoryItem['movementHistory']) : [],
    ebaySaleAdjustments: Array.isArray(row.ebay_sale_adjustments) ? (row.ebay_sale_adjustments as InventoryItem['ebaySaleAdjustments']) : [],
    ebaySaleCycles: Array.isArray(row.ebay_sale_cycles) ? (row.ebay_sale_cycles as InventoryItem['ebaySaleCycles']) : [],
    priceHistory: Array.isArray(row.price_history) ? (row.price_history as InventoryItem['priceHistory']) : [],
    history: Array.isArray(row.history) ? (row.history as InventoryItem['history']) : [],
    proofAttachments: Array.isArray(row.proof_attachments) ? (row.proof_attachments as InventoryItem['proofAttachments']) : [],
  };
}

// ------------------------------------------------------------------------------
// 5. READ FULL STATE FROM SUPABASE (WITH PAGINATION BEYOND 1000 ROWS)
// ------------------------------------------------------------------------------

export const LEGACY_MIGRATION_USER_ID = PRIMARY_OWNER_UID;

async function fetchPaginatedTable<T = any>(
  tableName: string,
  userId?: string,
  orderByCol = 'id'
): Promise<T[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const PAGE_SIZE = 1000;

  const fetchWithFilter = async (filterUserId?: string): Promise<T[]> => {
    let all: T[] = [];
    let from = 0;
    while (true) {
      let query = sb
        .from(tableName)
        .select('*')
        .order(orderByCol, { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (filterUserId) {
        query = query.eq('user_id', filterUserId);
      }

      const { data, error } = await query;
      if (error) {
        console.error(`[supabase] Fetch error on ${tableName}:`, error);
        break;
      }
      if (!data || data.length === 0) break;
      all.push(...(data as T[]));
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    return all;
  };

  const effectiveId = (userId && !userId.startsWith('dev-owner')) ? userId : PRIMARY_OWNER_UID;
  let rows = await fetchWithFilter(effectiveId);
  if (rows.length === 0 && effectiveId !== PRIMARY_OWNER_UID) {
    rows = await fetchWithFilter(PRIMARY_OWNER_UID);
  }
  if (rows.length === 0) {
    rows = await fetchWithFilter();
  }
  return rows;
}

export async function fetchSupabaseSnapshotDirect(userId: string): Promise<SupabaseSyncSnapshot | null> {
  const effectiveId = (userId && !userId.startsWith('dev-owner')) ? userId : PRIMARY_OWNER_UID;

  // 1. Try high-performance server API first
  try {
    const apiRes = await fetch(`/api/supabase-sync?userId=${encodeURIComponent(effectiveId)}`);
    if (apiRes.ok) {
      const apiData = await apiRes.json();
      if (apiData.ok && Array.isArray(apiData.items) && apiData.items.length > 0) {
        const invRows = apiData.items;
        // Trash is gone: every stored row is a normal inventory item. A legacy
        // is_trash row loads as an ordinary item rather than disappearing into a
        // bin the app no longer has any way to open.
        const items = invRows.map(mapRowToItem);
        const trash: InventoryItem[] = [];
        const expenses: Expense[] = (apiData.expenses || []).map((r: any) => ({
          id: String(r.id),
          description: String(r.description),
          amount: Number(r.amount),
          date: String(r.date),
          category: String(r.category),
          recurringExpenseId: r.recurring_expense_id ? String(r.recurring_expense_id) : undefined,
          attachmentUrl: r.attachment_url ? String(r.attachment_url) : undefined,
          attachmentName: r.attachment_name ? String(r.attachment_name) : undefined,
        }));
        const recurringExpenses: RecurringExpense[] = (apiData.recurringExpenses || []).map((r: any) => ({
          id: String(r.id),
          description: String(r.description),
          monthlyAmount: Number(r.monthly_amount),
          startDate: String(r.start_date),
          category: String(r.category),
          lastGeneratedDate: r.last_generated_date ? String(r.last_generated_date) : undefined,
        }));
        const prof = apiData.profile || {};
        const businessSettings: BusinessSettings = {
          companyName: prof.company_name || '',
          ownerName: prof.owner_name || '',
          address: prof.address || '',
          phone: prof.phone || '',
          taxId: prof.tax_id || '',
          vatId: prof.vat_id || undefined,
          iban: prof.iban || '',
          bic: prof.bic || '',
          bankName: prof.bank_name || '',
          taxMode: prof.tax_mode || 'SmallBusiness',
          ebayPostalCode: prof.ebay_postal_code || undefined,
          ebayPaypalEmail: prof.ebay_paypal_email || undefined,
          ebayDispatchTime: prof.ebay_dispatch_time ?? 1,
          ebayReturnPolicy: prof.ebay_return_policy || 'ReturnsAccepted',
          ebaySellerUsername: prof.ebay_seller_username || undefined,
        };
        const actionHistory: ActionHistoryEntry[] = (apiData.actionHistory || []).map((r: any) => ({
          id: String(r.id),
          timestamp: String(r.timestamp),
          description: String(r.description),
          item: r.details?.item || ({} as any),
          previousState: r.details?.previousState,
          bulkItems: r.details?.bulkItems,
        }));
        const bulkImports: BulkImportSummary[] = (apiData.bulkImports || []).map((r: any) => ({
          id: String(r.id),
          importedAt: String(r.imported_at),
          sourceTotalBuy: Number(r.source_total_buy || 0),
          allocatedTotalBuy: Number(r.allocated_total_buy || 0),
          sourceTotalSellTarget: Number(r.source_total_sell_target || 0),
          itemCount: Number(r.item_count || 0),
          vendor: r.vendor ? String(r.vendor) : undefined,
          defaultPlatformBought: r.default_platform_bought ? String(r.default_platform_bought) : undefined,
          defaultCategory: r.default_category ? String(r.default_category) : undefined,
          defaultBuyPaymentType: r.default_buy_payment_type ? String(r.default_buy_payment_type) : undefined,
          importTitle: r.import_title ? String(r.import_title) : undefined,
          sourceFeeAmount: Number(r.source_fee_amount || 0),
          sourceShippingCost: Number(r.source_shipping_cost || 0),
          isSplitLot: Boolean(r.is_split_lot),
          hasPhotos: Boolean(r.has_photos),
        }));

        return {
          items,
          trash,
          expenses,
          recurringExpenses,
          categories: (prof.custom_categories as CategoryConfig[]) || [],
          categoryFields: (prof.custom_category_fields as Record<string, CategoryFieldDef[]>) || {},
          businessSettings,
          monthlyGoal: Number(prof.monthly_goal || 0),
          dashboardPrefs: (prof.dashboard_prefs as DashboardPreferences) || {},
          actionHistory,
          bulkImports,
        };
      }
    }
  } catch (apiErr) {
    console.warn('[supabase] /api/supabase-sync not available, falling back to direct client:', apiErr);
  }

  const sb = getSupabase();
  if (!sb) return null;

  const [invRows, expRows, recExpRows, profRes, ordersRows, reportsRows, actRes, bulkRes] = await Promise.all([
    fetchPaginatedTable('inventory_items', effectiveId),
    fetchPaginatedTable('expenses', effectiveId, 'date'),
    fetchPaginatedTable('recurring_expenses', effectiveId),
    sb.from('user_profiles').select('*').eq('id', effectiveId).maybeSingle().then(async (res) => {
      if (!res.data) {
        const p2 = await sb.from('user_profiles').select('*').limit(1).maybeSingle();
        return p2;
      }
      return res;
    }),
    fetchPaginatedTable('ebay_orders', effectiveId),
    fetchPaginatedTable('ebay_tx_reports', effectiveId),
    fetchPaginatedTable('action_history', effectiveId, 'timestamp'),
    fetchPaginatedTable('bulk_imports', effectiveId, 'imported_at'),
  ]);

  // Trash is gone: every stored row is a normal inventory item (see above).
  const items = invRows.map(mapRowToItem);
  const trash: InventoryItem[] = [];

  const expenses: Expense[] = expRows.map((r: any) => ({
    id: String(r.id),
    description: String(r.description),
    amount: Number(r.amount),
    date: String(r.date),
    category: String(r.category),
    recurringExpenseId: r.recurring_expense_id ? String(r.recurring_expense_id) : undefined,
    attachmentUrl: r.attachment_url ? String(r.attachment_url) : undefined,
    attachmentName: r.attachment_name ? String(r.attachment_name) : undefined,
  }));

  const recurringExpenses: RecurringExpense[] = recExpRows.map((r: any) => ({
    id: String(r.id),
    description: String(r.description),
    monthlyAmount: Number(r.monthly_amount),
    startDate: String(r.start_date),
    category: String(r.category),
    lastGeneratedDate: r.last_generated_date ? String(r.last_generated_date) : undefined,
  }));

  const prof = profRes.data || {};
  const businessSettings: BusinessSettings = {
    companyName: prof.company_name || '',
    ownerName: prof.owner_name || '',
    address: prof.address || '',
    phone: prof.phone || '',
    taxId: prof.tax_id || '',
    vatId: prof.vat_id || undefined,
    iban: prof.iban || '',
    bic: prof.bic || '',
    bankName: prof.bank_name || '',
    taxMode: prof.tax_mode || 'SmallBusiness',
    ebayPostalCode: prof.ebay_postal_code || undefined,
    ebayPaypalEmail: prof.ebay_paypal_email || undefined,
    ebayDispatchTime: prof.ebay_dispatch_time ?? 1,
    ebayReturnPolicy: prof.ebay_return_policy || 'ReturnsAccepted',
    ebaySellerUsername: prof.ebay_seller_username || undefined,
    ebayOAuthToken: prof.ebay_oauth_token || undefined,
    ebayOAuthRefreshToken: prof.ebay_oauth_refresh_token || undefined,
    ebayOAuthExpiresAt: prof.ebay_oauth_expires_at ?? undefined,
    ebayOAuthRefreshExpiresAt: prof.ebay_oauth_refresh_expires_at ?? undefined,
    kleinanzeigenProfileUrl: prof.kleinanzeigen_profile_url || undefined,
  };

  const categories = (prof.categories as Record<string, string[]>) || {};
  const categoryFields = (prof.category_fields as Record<string, string[]>) || {};
  const monthlyGoal = Number(prof.monthly_goal) || 0;
  const dashboardPrefs = (prof.dashboard_prefs as DashboardPreferences) || undefined;

  // These four come from fetchPaginatedTable, which returns a plain array — not a
  // PostgREST { data } response. Reading `.data` off them yields undefined, and the
  // two that were also misnamed (ordersRes / reportsRes) threw ReferenceError and
  // aborted the whole snapshot fetch, so the panel loaded completely empty.
  const ebayOrders: EbayOrderRecord[] = (ordersRows || []).map((r: any) => r.order_data as EbayOrderRecord);
  const ebayTxReports: EbayTxReport[] = (reportsRows || []).map((r: any) => r.report_data as EbayTxReport);

  const actionHistory: ActionHistoryEntry[] = (actRes || []).map((r: any) => ({
    id: String(r.id),
    action: String(r.action),
    timestamp: String(r.timestamp),
    itemId: r.item_id ? String(r.item_id) : undefined,
    itemName: r.item_name ? String(r.item_name) : undefined,
    details: r.details ? String(r.details) : undefined,
  }));

  const bulkImports: BulkImportRecord[] = (bulkRes || []).map((r: any) => r.import_data as BulkImportRecord);

  const canonical = canonicalizeInventoryItems(items, businessSettings.taxMode);
  const finalItems = canonical.items;

  return {
    items: finalItems,
    trash,
    expenses,
    recurringExpenses,
    categories,
    categoryFields,
    businessSettings,
    monthlyGoal,
    dashboardPrefs,
    actionHistory,
    bulkImports,
    ebayOrders,
    ebayTxReports,
  };
}

export async function fetchFullAppStateFromSupabase(): Promise<SupabaseSyncSnapshot | null> {
  const sb = getSupabase();
  if (!sb) return null;

  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;

  const [invRows, expRows, recExpRows, profRes, ordersRows, reportsRows, actRes, bulkRes] = await Promise.all([
    fetchPaginatedTable('inventory_items', user.id),
    fetchPaginatedTable('expenses', user.id, 'date'),
    fetchPaginatedTable('recurring_expenses', user.id),
    sb.from('user_profiles').select('*').eq('id', user.id).maybeSingle(),
    fetchPaginatedTable('ebay_orders', user.id),
    fetchPaginatedTable('ebay_tx_reports', user.id),
    fetchPaginatedTable('action_history', user.id, 'timestamp'),
    fetchPaginatedTable('bulk_imports', user.id, 'imported_at'),
  ]);

  // Trash is gone: every stored row is a normal inventory item (see above).
  const items = invRows.map(mapRowToItem);
  const trash: InventoryItem[] = [];

  const expenses: Expense[] = expRows.map((r: any) => ({
    id: String(r.id),
    description: String(r.description),
    amount: Number(r.amount),
    date: String(r.date),
    category: String(r.category),
    recurringExpenseId: r.recurring_expense_id ? String(r.recurring_expense_id) : undefined,
    attachmentUrl: r.attachment_url ? String(r.attachment_url) : undefined,
    attachmentName: r.attachment_name ? String(r.attachment_name) : undefined,
  }));

  const recurringExpenses: RecurringExpense[] = (recExpRes.data || []).map((r) => ({
    id: String(r.id),
    description: String(r.description),
    monthlyAmount: Number(r.monthly_amount),
    startDate: String(r.start_date),
    category: String(r.category),
    lastGeneratedDate: r.last_generated_date ? String(r.last_generated_date) : undefined,
  }));

  const prof = profRes.data || {};
  const businessSettings: BusinessSettings = {
    companyName: prof.company_name || '',
    ownerName: prof.owner_name || '',
    address: prof.address || '',
    phone: prof.phone || '',
    taxId: prof.tax_id || '',
    vatId: prof.vat_id || undefined,
    iban: prof.iban || '',
    bic: prof.bic || '',
    bankName: prof.bank_name || '',
    taxMode: prof.tax_mode || 'SmallBusiness',
    ebayPostalCode: prof.ebay_postal_code || undefined,
    ebayPaypalEmail: prof.ebay_paypal_email || undefined,
    ebayDispatchTime: prof.ebay_dispatch_time ?? 1,
    ebayReturnPolicy: prof.ebay_return_policy || 'ReturnsAccepted',
    ebaySellerUsername: prof.ebay_seller_username || undefined,
    ebayOAuthToken: prof.ebay_oauth_token || undefined,
    ebayOAuthRefreshToken: prof.ebay_oauth_refresh_token || undefined,
    ebayOAuthExpiresAt: prof.ebay_oauth_expires_at ?? undefined,
    ebayOAuthRefreshExpiresAt: prof.ebay_oauth_refresh_expires_at ?? undefined,
    kleinanzeigenProfileUrl: prof.kleinanzeigen_profile_url || undefined,
  };

  const categories = (prof.categories as Record<string, string[]>) || {};
  const categoryFields = (prof.category_fields as Record<string, string[]>) || {};
  const monthlyGoal = Number(prof.monthly_goal) || 0;
  const dashboardPrefs = (prof.dashboard_prefs as DashboardPreferences) || undefined;

  // These four come from fetchPaginatedTable, which returns a plain array — not a
  // PostgREST { data } response. Reading `.data` off them yields undefined, and the
  // two that were also misnamed (ordersRes / reportsRes) threw ReferenceError and
  // aborted the whole snapshot fetch, so the panel loaded completely empty.
  const ebayOrders: EbayOrderRecord[] = (ordersRows || []).map((r: any) => r.order_data as EbayOrderRecord);
  const ebayTxReports: EbayTxReport[] = (reportsRows || []).map((r: any) => r.report_data as EbayTxReport);

  const actionHistory: ActionHistoryEntry[] = (actRes || []).map((r: any) => ({
    id: String(r.id),
    action: String(r.action),
    timestamp: String(r.timestamp),
    itemId: r.item_id ? String(r.item_id) : undefined,
    itemName: r.item_name ? String(r.item_name) : undefined,
    details: r.details ? String(r.details) : undefined,
  }));

  const bulkImports: BulkImportRecord[] = (bulkRes || []).map((r: any) => r.import_data as BulkImportRecord);

  return {
    items,
    trash,
    expenses,
    recurringExpenses,
    categories,
    categoryFields,
    businessSettings,
    monthlyGoal,
    dashboardPrefs,
    actionHistory,
    bulkImports,
    ebayOrders,
    ebayTxReports,
  };
}

// ------------------------------------------------------------------------------
// 6. INCREMENTAL / SINGLE-ITEM UPDATE (Fine-grained PostgreSQL sync)
// ------------------------------------------------------------------------------

export const saveItemChangesToSupabase = writeItemBatchToSupabase;

export async function writeItemBatchToSupabase(
  updatedItems?: InventoryItem[],
  deleteIds?: string[]
): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;

  const user = await getCurrentSupabaseUser();
  const userId = user?.id || PRIMARY_OWNER_UID;

  if (updatedItems && updatedItems.length > 0) {
    const rows = updatedItems.map(it => mapItemToRow(it, userId, false));
    const { error } = await sb.from('inventory_items').upsert(rows, { onConflict: 'id' });
    if (error) {
      console.error('[supabase] Single/Batch item update error:', error);
      throw error;
    }
  }

  if (deleteIds && deleteIds.length > 0) {
    const { error } = await sb
      .from('inventory_items')
      .delete()
      .in('id', deleteIds)
      .eq('user_id', userId);
    if (error) {
      console.error('[supabase] Item delete error:', error);
      throw error;
    }
  }
}

export async function deleteInventoryItemsPermanentlyFromSupabase(
  ids: string[]
): Promise<void> {
  const sb = getSupabase();
  if (!sb || !ids.length) return;

  const user = await getCurrentSupabaseUser();
  const userId = user?.id || PRIMARY_OWNER_UID;

  const { error } = await sb
    .from('inventory_items')
    .delete()
    .in('id', ids)
    .eq('user_id', userId);

  if (error) {
    console.error('[supabase] Permanent delete error:', error);
    throw error;
  }
}

// ------------------------------------------------------------------------------
// 7. WRITE FULL STATE TO SUPABASE (Upsert with Batching)
// ------------------------------------------------------------------------------

export async function writeFullAppStateToSupabase(
  snapshot: SupabaseSyncSnapshot,
  options?: { allowEmptyOverwrite?: boolean }
): Promise<void> {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase is not configured');

  const user = await getCurrentSupabaseUser();
  const userId = user?.id || PRIMARY_OWNER_UID;

  const incomingTotal = snapshot.items.length + snapshot.trash.length;
  if (incomingTotal === 0 && !options?.allowEmptyOverwrite) {
    const { count } = await sb.from('inventory_items').select('*', { count: 'exact', head: true }).eq('user_id', userId);
    if ((count || 0) > 0) {
      throw new Error('Refusing to overwrite non-empty Supabase inventory with an empty local dataset.');
    }
  }

  // 1. Profile & Settings
  await sb.from('user_profiles').upsert({
    id: userId,
    email: user?.email,
    company_name: snapshot.businessSettings.companyName || '',
    owner_name: snapshot.businessSettings.ownerName || '',
    address: snapshot.businessSettings.address || '',
    phone: snapshot.businessSettings.phone || '',
    tax_id: snapshot.businessSettings.taxId || '',
    vat_id: snapshot.businessSettings.vatId || null,
    iban: snapshot.businessSettings.iban || '',
    bic: snapshot.businessSettings.bic || '',
    bank_name: snapshot.businessSettings.bankName || '',
    tax_mode: snapshot.businessSettings.taxMode || 'SmallBusiness',
    ebay_postal_code: snapshot.businessSettings.ebayPostalCode || null,
    ebay_paypal_email: snapshot.businessSettings.ebayPaypalEmail || null,
    ebay_dispatch_time: snapshot.businessSettings.ebayDispatchTime ?? 1,
    ebay_return_policy: snapshot.businessSettings.ebayReturnPolicy || 'ReturnsAccepted',
    ebay_seller_username: snapshot.businessSettings.ebaySellerUsername || null,
    ebay_oauth_token: snapshot.businessSettings.ebayOAuthToken || null,
    ebay_oauth_refresh_token: snapshot.businessSettings.ebayOAuthRefreshToken || null,
    ebay_oauth_expires_at: snapshot.businessSettings.ebayOAuthExpiresAt ?? null,
    ebay_oauth_refresh_expires_at: snapshot.businessSettings.ebayOAuthRefreshExpiresAt ?? null,
    kleinanzeigen_profile_url: snapshot.businessSettings.kleinanzeigenProfileUrl || null,
    monthly_goal: snapshot.monthlyGoal ?? 0,
    categories: snapshot.categories || {},
    category_fields: snapshot.categoryFields || {},
    dashboard_prefs: snapshot.dashboardPrefs || {},
  });

  // 2. Inventory items in chunks of 200.
  // Trash was removed as a concept — deleting is permanent. Nothing may be written
  // back with is_trash = true: a client still holding a stale trash array would
  // otherwise silently re-trash rows that were deliberately restored.
  const allRows = snapshot.items.map((it) => mapItemToRow(it, user.id, false));

  const BATCH_SIZE = 200;
  for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
    const chunk = allRows.slice(i, i + BATCH_SIZE);
    const { error } = await sb.from('inventory_items').upsert(chunk, { onConflict: 'id' });
    if (error) throw error;
  }

  // 3. Expenses
  if (snapshot.expenses?.length) {
    const expRows = snapshot.expenses.map((e) => ({
      id: e.id,
      user_id: user.id,
      description: e.description,
      amount: e.amount,
      date: e.date,
      category: e.category,
      recurring_expense_id: e.recurringExpenseId || null,
      attachment_url: e.attachmentUrl || null,
      attachment_name: e.attachmentName || null,
    }));
    for (let i = 0; i < expRows.length; i += BATCH_SIZE) {
      const chunk = expRows.slice(i, i + BATCH_SIZE);
      const { error } = await sb.from('expenses').upsert(chunk, { onConflict: 'id' });
      if (error) throw error;
    }
  }

  // 4. Recurring Expenses
  if (snapshot.recurringExpenses?.length) {
    const recRows = snapshot.recurringExpenses.map((r) => ({
      id: r.id,
      user_id: user.id,
      description: r.description,
      monthly_amount: r.monthlyAmount,
      start_date: r.startDate,
      category: r.category,
      last_generated_date: r.lastGeneratedDate || null,
    }));
    const { error } = await sb.from('recurring_expenses').upsert(recRows, { onConflict: 'id' });
    if (error) throw error;
  }
}

// ------------------------------------------------------------------------------
// 7. REALTIME SUBSCRIPTION
// ------------------------------------------------------------------------------

export type RealtimeItemUpsert = {
  item: InventoryItem;
  /** is_trash is a column, not a field on InventoryItem — the caller needs it to
   *  route the row into the active list or the trash list. */
  isTrash: boolean;
};

export type RealtimeItemDelta = {
  /** Rows inserted or updated remotely, already mapped to InventoryItem. */
  upserts: RealtimeItemUpsert[];
  /** Ids hard-deleted remotely. */
  deletedIds: string[];
  /** True when user_profiles changed and settings should be re-pulled. */
  profileChanged: boolean;
};

/**
 * Realtime inventory sync — row deltas, never full refetches.
 *
 * The previous implementation subscribed to every change on inventory_items,
 * threw the payload away, and had the caller re-download the entire snapshot.
 * With ~2000 items that is several MB per event, so a single bulk write (a CSV
 * import writing 963 rows, or a 600-row bulk edit) turned into hundreds of full
 * downloads on every connected device — gigabytes of egress against a 5 GB/month
 * free tier, from one action.
 *
 * This version carries the changed row in the event itself, so cost per change is
 * one small message rather than one whole database. It also filters server-side
 * by user_id, so other tenants' writes never reach this client at all.
 *
 * Events are coalesced over a short window: a bulk write arrives as one batch
 * instead of hundreds of individual state updates.
 */
export function subscribeToSupabaseRealtime(
  userId: string,
  onDelta: (delta: RealtimeItemDelta) => void,
  options?: { coalesceMs?: number }
): () => void {
  const sb = getSupabase();
  if (!sb || !userId) return () => {};

  const coalesceMs = options?.coalesceMs ?? 400;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingUpserts = new Map<string, RealtimeItemUpsert>();
  let pendingDeletes = new Set<string>();
  let pendingProfile = false;

  const flush = () => {
    timer = null;
    if (!pendingUpserts.size && !pendingDeletes.size && !pendingProfile) return;
    const delta: RealtimeItemDelta = {
      upserts: [...pendingUpserts.values()],
      deletedIds: [...pendingDeletes],
      profileChanged: pendingProfile,
    };
    pendingUpserts = new Map();
    pendingDeletes = new Set();
    pendingProfile = false;
    try {
      onDelta(delta);
    } catch (e) {
      console.warn('[supabase] realtime delta handler failed:', e);
    }
  };

  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, coalesceMs);
  };

  const channel = sb
    .channel(`inventory_rt_${userId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'inventory_items', filter: `user_id=eq.${userId}` },
      (payload: any) => {
        const row = payload.new ?? payload.old;
        const id = row?.id ? String(row.id) : '';
        if (!id) return;
        if (payload.eventType === 'DELETE') {
          pendingUpserts.delete(id);
          pendingDeletes.add(id);
        } else {
          pendingDeletes.delete(id);
          try {
            pendingUpserts.set(id, {
              item: mapRowToItem(payload.new),
              isTrash: Boolean((payload.new as Record<string, unknown>).is_trash),
            });
          } catch (e) {
            console.warn('[supabase] realtime row map failed:', e);
            return;
          }
        }
        schedule();
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'user_profiles', filter: `id=eq.${userId}` },
      () => {
        pendingProfile = true;
        schedule();
      }
    )
    .subscribe();

  return () => {
    if (timer) clearTimeout(timer);
    void sb.removeChannel(channel);
  };
}

// ------------------------------------------------------------------------------
// 8. STORAGE (Images & Attachments)
// ------------------------------------------------------------------------------

export async function uploadItemPhotoToSupabase(
  itemId: string,
  blob: Blob,
  fileName?: string
): Promise<string> {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase is not configured');

  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error('Not authenticated');

  const ext = fileName?.split('.').pop() || 'jpg';
  const path = `${user.id}/${itemId}/${Date.now()}.${ext}`;

  const { error: uploadError } = await sb.storage
    .from('inventory-images')
    .upload(path, blob, {
      upsert: true,
      contentType: blob.type || 'image/jpeg',
    });

  if (uploadError) throw uploadError;

  const { data: { publicUrl } } = sb.storage
    .from('inventory-images')
    .getPublicUrl(path);

  return publicUrl;
}


export const CLOUD_OMITTED_PLACEHOLDER = '__CLOUD_OMITTED__';

export function isCloudEnabled(): boolean {
  return isSupabaseConfigured();
}

export async function getCurrentUser(): Promise<User | null> {
  return getCurrentSupabaseUser();
}

export async function signInWithGoogle(optsOrRedirectTo?: string | { returnPath?: string }): Promise<{ error: Error | null }> {
  let targetUrl = typeof window !== 'undefined' ? `${window.location.origin}/panel/dashboard` : '';
  if (typeof optsOrRedirectTo === 'string' && optsOrRedirectTo.trim()) {
    targetUrl = optsOrRedirectTo.trim();
  } else if (optsOrRedirectTo && typeof optsOrRedirectTo === 'object' && optsOrRedirectTo.returnPath) {
    targetUrl = `${window.location.origin}${optsOrRedirectTo.returnPath}`;
  }
  return signInWithGoogleOAuth(targetUrl);
}

export async function signInWithEmail(email: string): Promise<{ error: Error | null }> {
  return signInWithEmailOtp(email);
}

export async function logOut(): Promise<{ error: Error | null }> {
  return logOutSupabase();
}

export function onAuthChange(callback: (user: User | null, session: Session | null) => void): () => void {
  return onSupabaseAuthChange(callback);
}

export function getAuthErrorMessage(err: any): string {
  const msg = err?.message || err?.msg || String(err || 'Authentication failed');
  if (msg.includes('provider is not enabled') || msg.includes('Unsupported provider')) {
    return 'Google login is not enabled yet in your Supabase Dashboard (Auth > Providers > Google). Use Dev Access or Email OTP to enter.';
  }
  return msg;
}

export function getSyncErrorMessage(err: any): string {
  return err?.message || String(err || 'Sync failed');
}

export function setLocalDataOnlyMode(_mode: boolean): void {}
export function prewarmGoogleSignIn(): void {}
export async function completeGoogleRedirectSignIn(): Promise<any> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data: { session } } = await sb.auth.getSession();
  return session?.user || null;
}
export function consumeAuthReturnPath(): string | null { return null; }
export function consumeRedirectPending(): boolean { return false; }
export function isUsingFirebaseEmulator(): boolean { return false; }
export function signInEmulatorWithEmail(): Promise<any> {
  const user = signInWithDevAdmin();
  return Promise.resolve({ user, error: null });
}
export function prefersRedirectSignIn(): boolean { return false; }

export async function uploadExpenseAttachment(
  file: File,
  expenseId: string,
  onProgress?: (percent: number) => void
): Promise<string> {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase is not configured');

  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error('Not signed in to Supabase');

  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_');
  const path = `${user.id}/expenses/${expenseId || 'generic'}/${Date.now()}-${safeName}`;

  if (onProgress) onProgress(20);
  const { error } = await sb.storage.from('inventory-images').upload(path, file, {
    upsert: true,
    contentType: file.type || 'application/octet-stream',
  });
  if (error) throw error;
  if (onProgress) onProgress(90);

  const { data: { publicUrl } } = sb.storage.from('inventory-images').getPublicUrl(path);
  if (onProgress) onProgress(100);
  return publicUrl;
}

export async function uploadProofAttachment(
  file: Blob,
  recordId: string,
  fileName: string
): Promise<string> {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase is not configured');

  const { data: { user } } = await sb.auth.getUser();
  if (!user) throw new Error('Not signed in to Supabase');

  const safeName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, '_') || 'proof.jpg';
  const safeId = recordId.replace(/[^a-zA-Z0-9.\-_]/g, '_') || 'generic';
  const path = `${user.id}/proof/${safeId}/${Date.now()}-${safeName}`;

  const { error } = await sb.storage.from('inventory-images').upload(path, file, {
    upsert: true,
    contentType: file.type || 'image/jpeg',
  });
  if (error) throw error;

  const { data: { publicUrl } } = sb.storage.from('inventory-images').getPublicUrl(path);
  return publicUrl;
}

export async function uploadItemImageBlob(
  blob: Blob,
  folder: string,
  fileName?: string
): Promise<string> {
  return uploadItemPhotoToSupabase(folder, blob, fileName);
}

export async function getCachedProductPhoto(ean: string): Promise<string | null> {
  const sb = getSupabase();
  if (!sb || !ean) return null;
  try {
    const { data } = await sb.from('product_photo_cache').select('image_url').eq('ean', ean.trim()).maybeSingle();
    return data?.image_url || null;
  } catch {
    return null;
  }
}

export async function setCachedProductPhoto(ean: string, imageUrl: string): Promise<void> {
  const sb = getSupabase();
  if (!sb || !ean || !imageUrl) return;
  try {
    await sb.from('product_photo_cache').upsert({
      ean: ean.trim(),
      image_url: imageUrl.trim(),
      updated_at: new Date().toISOString(),
    });
  } catch {
    // non-fatal
  }
}

export async function fetchStoreCatalog(userId?: string): Promise<any | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    let query = sb.from('storefront_catalog').select('*');
    if (userId) query = query.eq('user_id', userId);
    const { data } = await query.order('updated_at', { ascending: false }).limit(1).maybeSingle();
    return data?.catalog_data || null;
  } catch {
    return null;
  }
}

export async function writeStoreCatalog(payload: any): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;
  try {
    await sb.from('storefront_catalog').upsert({
      user_id: user.id,
      catalog_data: payload,
      updated_at: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('[supabase] writeStoreCatalog failed:', err);
  }
}

export function subscribeToStoreInquiries(
  userId: string,
  callback: (inquiries: StoreInquiry[]) => void
): () => void {
  const sb = getSupabase();
  if (!sb) {
    callback([]);
    return () => {};
  }

  const load = async () => {
    const { data } = await sb.from('store_inquiries').select('*').eq('user_id', userId).order('created_at', { ascending: false });
    callback((data || []).map((r: any) => ({
      id: r.id,
      itemId: r.item_id,
      itemName: r.item_name,
      customerName: r.customer_name,
      customerEmail: r.customer_email,
      customerPhone: r.customer_phone,
      message: r.message,
      status: r.status,
      createdAt: r.created_at,
      read: !!r.read,
    })));
  };

  void load();

  const channel = sb
    .channel(`public:store_inquiries:${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'store_inquiries', filter: `user_id=eq.${userId}` }, () => {
      void load();
    })
    .subscribe();

  return () => {
    void sb.removeChannel(channel);
  };
}

export async function markStoreInquiryRead(inquiryId: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from('store_inquiries').update({ read: true }).eq('id', inquiryId);
}

export async function updateStoreInquiryStatus(inquiryId: string, status: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from('store_inquiries').update({ status }).eq('id', inquiryId);
}

export async function fetchPendingTransactionsFromCloud(): Promise<Record<string, unknown>[] | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data } = await sb.from('pending_transactions').select('*').eq('user_id', user.id);
  return data ? data.map((r: any) => r.tx_data || r) : [];
}

export async function writePendingTransactionsToCloud(rows: (Record<string, unknown> & { id: string })[]): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;
  const dbRows = rows.map((r) => ({
    id: r.id,
    user_id: user.id,
    tx_data: r,
    updated_at: new Date().toISOString(),
  }));
  await sb.from('pending_transactions').upsert(dbRows, { onConflict: 'id' });
}

export async function deletePendingTransactionsFromCloud(ids: string[]): Promise<void> {
  const sb = getSupabase();
  if (!sb || !ids.length) return;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;
  await sb.from('pending_transactions').delete().in('id', ids).eq('user_id', user.id);
}

export async function fetchProductCardGalleryEntries(itemId?: string): Promise<any[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return [];
  let q = sb.from('product_card_gallery').select('*').eq('user_id', user.id);
  if (itemId) q = q.eq('item_id', itemId);
  const { data } = await q.order('created_at', { ascending: false });
  return (data || []).map((r: any) => r.card_data || r);
}

export async function writeProductCardGalleryEntry(entry: any): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;
  await sb.from('product_card_gallery').upsert({
    id: entry.id,
    user_id: user.id,
    item_id: entry.itemId || null,
    card_data: entry,
    created_at: entry.createdAt || new Date().toISOString(),
  });
}

export async function deleteProductCardGalleryEntry(id: string): Promise<void> {
  const sb = getSupabase();
  if (!sb || !id) return;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;
  await sb.from('product_card_gallery').delete().eq('id', id).eq('user_id', user.id);
}

export async function uploadBackupSnapshot(fileName: string, blob: Blob): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const user = await getCurrentSupabaseUser();
  const userId = user?.id || PRIMARY_OWNER_UID;
  const path = `${userId}/backups/${fileName}`;
  await sb.storage.from('inventory-images').upload(path, blob, { upsert: true });
}

export async function listBackupSnapshotNames(): Promise<string[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const user = await getCurrentSupabaseUser();
  const userId = user?.id || PRIMARY_OWNER_UID;
  const { data } = await sb.storage.from('inventory-images').list(`${userId}/backups`);
  return (data || []).map((i) => i.name).sort();
}

export async function deleteBackupSnapshot(fileName: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const user = await getCurrentSupabaseUser();
  const userId = user?.id || PRIMARY_OWNER_UID;
  await sb.storage.from('inventory-images').remove([`${userId}/backups/${fileName}`]);
}

export async function getBackupSnapshotUrl(fileName: string): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const user = await getCurrentSupabaseUser();
  const userId = user?.id || PRIMARY_OWNER_UID;
  const { data: { publicUrl } } = sb.storage.from('inventory-images').getPublicUrl(`${userId}/backups/${fileName}`);
  return publicUrl;
}


export interface EbayOrderCloudMeta {
  updatedAt?: string;
  count?: number;
  lastSyncedAt?: string;
}

export interface EbayActiveListingsCloudMeta {
  updatedAt?: string;
  count?: number;
  lastFetchedAt?: string;
  sellerUsername?: string;
}

export interface EbayPurchaseCloudMeta {
  updatedAt?: string;
  count?: number;
  lastFetchedAt?: string;
}

export interface EbayTxCloudState {
  reports: any[];
  meta: any;
}

export async function waitForAuthReady(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { data: { session } } = await sb.auth.getSession();
  if (session) return;
}

export async function fetchEbayOrdersFromCloud(): Promise<{ orders: any[]; meta: any } | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const user = await getCurrentSupabaseUser();
  const userId = user?.id || PRIMARY_OWNER_UID;
  try {
    const { data, error } = await sb.from('ebay_orders').select('order_data').eq('user_id', userId);
    if (error) return null;
    return {
      orders: (data || []).map((r: any) => r.order_data),
      meta: { count: data?.length || 0, updatedAt: new Date().toISOString() },
    };
  } catch {
    return null;
  }
}

export async function writeEbayOrdersToCloud(orders: any[], metaPatch?: any): Promise<void> {
  const sb = getSupabase();
  if (!sb || !orders.length) return;
  const user = await getCurrentSupabaseUser();
  const userId = user?.id || PRIMARY_OWNER_UID;
  const rows = orders.map((o) => ({
    id: o.orderId || o.id,
    user_id: userId,
    order_data: o,
    updated_at: new Date().toISOString(),
  }));
  const BATCH_SIZE = 200;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    await sb.from('ebay_orders').upsert(chunk, { onConflict: 'id' });
  }
}

export async function clearEbayOrdersCloud(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const user = await getCurrentSupabaseUser();
  const userId = user?.id || PRIMARY_OWNER_UID;
  await sb.from('ebay_orders').delete().eq('user_id', userId);
}

export async function fetchEbayActiveListingsFromCloud(): Promise<{ listings: any[]; meta: EbayActiveListingsCloudMeta | null } | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  try {
    const { data, error } = await sb.from('ebay_listings').select('listing_data').eq('user_id', user.id);
    if (error) return null;
    return {
      listings: (data || []).map((r: any) => r.listing_data),
      meta: { count: data?.length || 0, updatedAt: new Date().toISOString() },
    };
  } catch {
    return null;
  }
}

export async function writeEbayActiveListingsToCloud(listings: any[], metaPatch?: any): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;
  const rows = listings.map((l) => ({
    id: String(l.listingId || l.id),
    user_id: user.id,
    listing_data: l,
    updated_at: new Date().toISOString(),
  }));
  const BATCH_SIZE = 200;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    await sb.from('ebay_listings').upsert(chunk, { onConflict: 'id' });
  }
}

export async function clearEbayActiveListingsCloud(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;
  await sb.from('ebay_listings').delete().eq('user_id', user.id);
}

export async function fetchEbayPurchasesFromCloud(): Promise<{ purchases: any[]; meta: EbayPurchaseCloudMeta | null } | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  try {
    const { data, error } = await sb.from('ebay_purchases').select('purchase_data').eq('user_id', user.id);
    if (error) return null;
    return {
      purchases: (data || []).map((r: any) => r.purchase_data),
      meta: { count: data?.length || 0, updatedAt: new Date().toISOString() },
    };
  } catch {
    return null;
  }
}

export async function writeEbayPurchasesToCloud(purchases: any[], metaPatch?: any): Promise<void> {
  const sb = getSupabase();
  if (!sb || !purchases.length) return;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;
  const rows = purchases.map((p) => ({
    id: String(p.orderId || p.id),
    user_id: user.id,
    purchase_data: p,
    updated_at: new Date().toISOString(),
  }));
  const BATCH_SIZE = 200;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    await sb.from('ebay_purchases').upsert(chunk, { onConflict: 'id' });
  }
}

export async function clearEbayPurchasesCloud(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;
  await sb.from('ebay_purchases').delete().eq('user_id', user.id);
}

export async function fetchEbayTxReportsFromCloud(): Promise<{ reports: any[]; meta: any } | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const user = await getCurrentSupabaseUser();
  const userId = user?.id || PRIMARY_OWNER_UID;
  try {
    const { data, error } = await sb.from('ebay_tx_reports').select('id, report_name, report_data').eq('user_id', userId);
    if (error) return null;
    if (data && data.length > 0) {
      return {
        reports: data.map((r: any) => r.report_data),
        meta: { count: data.length },
      };
    }
    // Zero rows with no error is ambiguous: it means either "genuinely empty" or
    // "RLS filtered everything out because this session has no JWT". Local
    // dev-access mode is exactly the second case — and it cannot be detected by
    // checking for a user, because getCurrentSupabaseUser() synthesises a truthy
    // owner object there while no actual auth token exists. So always retry a
    // zero-row result through the local read-through (localhost-only; see
    // api/supabase-sync.js) before concluding the library is empty. Concluding
    // that wrongly is destructive now that Supabase is the source of truth:
    // syncEbayTxReportsWithCloud() clears the local cache on an empty cloud.
    // In production this fetch simply 404s and we fall through.
    try {
      const res = await fetch(`/api/supabase-sync?userId=${encodeURIComponent(userId)}`);
      if (res.ok) {
        const payload = await res.json();
        const rows = Array.isArray(payload?.ebayTxReports) ? payload.ebayTxReports : [];
        if (rows.length > 0) {
          return {
            reports: rows.map((r: any) => r.report_data),
            meta: { count: rows.length, via: 'local-dev-proxy' },
          };
        }
      }
    } catch {
      /* proxy unavailable (normal in production) — fall through */
    }
    return { reports: [], meta: { count: 0 } };
  } catch {
    return null;
  }
}

export async function fetchEbayTxReportRowsFromCloud(): Promise<any[] | null> {
  const res = await fetchEbayTxReportsFromCloud();
  return res?.reports || null;
}

export async function writeEbayTxReportsToCloud(payload: any, metaPatch?: any): Promise<void> {
  const sb = getSupabase();
  if (!sb || !payload) return;
  const user = await getCurrentSupabaseUser();
  const userId = user?.id || PRIMARY_OWNER_UID;

  const rawList: any[] = Array.isArray(payload) ? payload : (Array.isArray(payload.reports) ? payload.reports : []);
  if (!rawList.length) return;

  const rows = rawList.map((r, idx) => {
    const id = String(r?.meta?.id || r?.id || r?.reportId || `report-${idx}`);
    const name = String(r?.meta?.fileName || r?.report_name || id);
    return {
      id,
      user_id: userId,
      report_name: name,
      report_data: r,
      updated_at: new Date().toISOString(),
    };
  });

  const BATCH_SIZE = 50;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const chunk = rows.slice(i, i + BATCH_SIZE);
    await sb.from('ebay_tx_reports').upsert(chunk, { onConflict: 'id' });
  }
}

export async function writeEbayTxReportRowsToCloud(reports: any[]): Promise<void> {
  return writeEbayTxReportsToCloud(reports);
}

export async function clearEbayTxReportsCloud(): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const user = await getCurrentSupabaseUser();
  const userId = user?.id || PRIMARY_OWNER_UID;
  await sb.from('ebay_tx_reports').delete().eq('user_id', userId);
  await sb.from('ebay_orders').delete().eq('user_id', userId);
}

export const upsertEbayOrdersToCloud = writeEbayOrdersToCloud;


export type StorefrontBlockId = 'hero' | 'categoryGrid' | 'promoAds' | 'bestSellers' | 'trustRow';

export interface StorefrontPromoAd {
  id: string;
  title: string;
  subtitle?: string;
  badge?: string;
  imageUrl?: string;
  linkUrl?: string;
  price?: number;
  active?: boolean;
}

export interface StorefrontTrustItem {
  id: string;
  title: string;
  description?: string;
  iconName?: string;
  active?: boolean;
}

export interface StorefrontBlock {
  id: StorefrontBlockId;
  order: number;
  visible: boolean;
}

/** Per-section copy overrides. Every field is optional — the UI falls back to its
 *  own default text — but the section objects themselves must always exist, since
 *  the storefront reads `config.hero.subtitle` and friends directly. */
export interface StorefrontHeroText {
  subtitle?: string;
  ctaLabel?: string;
  ctaSaleLabel?: string;
}
export interface StorefrontSectionText {
  heading?: string;
  subheading?: string;
}

export interface StorefrontConfig {
  storeName?: string;
  heroHeadline?: string;
  heroTagline?: string;
  heroCtaText?: string;
  heroBackgroundUrl?: string;
  hero?: StorefrontHeroText;
  categoryGrid?: StorefrontSectionText;
  bestSellers?: StorefrontSectionText;
  /**
   * Per-block order AND visibility. The storefront and its configurator both need
   * a `visible` flag, which the older `blocksOrder` (a bare list of ids) cannot
   * express — so this is the field they read. `blocksOrder` is kept for configs
   * saved before this existed; normalizeStorefrontConfig derives `blocks` from it.
   */
  blocks?: StorefrontBlock[];
  /** @deprecated superseded by `blocks`; still read when migrating an old config. */
  blocksOrder?: StorefrontBlockId[];
  promoAds?: StorefrontPromoAd[];
  trustItems?: StorefrontTrustItem[];
  themeColor?: string;
}

export const DEFAULT_STOREFRONT_BLOCK_ORDER: StorefrontBlockId[] = [
  'hero',
  'categoryGrid',
  'promoAds',
  'bestSellers',
  'trustRow',
];

function blocksFromOrder(order: StorefrontBlockId[]): StorefrontBlock[] {
  return order.map((id, index) => ({ id, order: index, visible: true }));
}

/**
 * Guarantee the shape the storefront components rely on.
 *
 * Without this, `config.blocks` is undefined for every config saved before the
 * field existed (and for the default itself), and the storefront's
 * `[...config.blocks]` spread throws "is not iterable" — taking down the entire
 * public shop with an error boundary, not just the block list.
 */
export function normalizeStorefrontConfig(raw: StorefrontConfig | null | undefined): StorefrontConfig {
  const cfg: StorefrontConfig = { ...DEFAULT_STOREFRONT_CONFIG, ...(raw || {}) };

  if (!Array.isArray(cfg.blocks) || cfg.blocks.length === 0) {
    const order =
      Array.isArray(cfg.blocksOrder) && cfg.blocksOrder.length
        ? cfg.blocksOrder
        : DEFAULT_STOREFRONT_BLOCK_ORDER;
    cfg.blocks = blocksFromOrder(order);
  } else {
    // Repair partial rows rather than letting a bad `order`/`visible` break sorting.
    cfg.blocks = cfg.blocks
      .filter((b) => b && b.id)
      .map((b, index) => ({
        id: b.id,
        order: Number.isFinite(b.order) ? Number(b.order) : index,
        visible: b.visible !== false,
      }));
    // Append any block the stored config predates, so new sections still render.
    for (const id of DEFAULT_STOREFRONT_BLOCK_ORDER) {
      if (!cfg.blocks.some((b) => b.id === id)) {
        cfg.blocks.push({ id, order: cfg.blocks.length, visible: true });
      }
    }
  }

  if (!Array.isArray(cfg.promoAds)) cfg.promoAds = [];
  if (!Array.isArray(cfg.trustItems)) cfg.trustItems = [];

  // The storefront reads these as `config.hero.subtitle`, `config.categoryGrid.heading`
  // and so on. A config saved before these sections existed has them undefined, and
  // reading through them throws — which takes down the whole public page, not just
  // the heading. Guarantee the objects; the fields inside stay optional.
  if (!cfg.hero || typeof cfg.hero !== 'object') cfg.hero = {};
  if (!cfg.categoryGrid || typeof cfg.categoryGrid !== 'object') cfg.categoryGrid = {};
  if (!cfg.bestSellers || typeof cfg.bestSellers !== 'object') cfg.bestSellers = {};

  return cfg;
}

export interface StoreCatalogPayload {
  items: any[];
  categories: Record<string, string[]>;
  updatedAt?: string;
}

export const DEFAULT_STOREFRONT_CONFIG: StorefrontConfig = {
  storeName: 'ArmikTech Store',
  heroHeadline: 'Premium Hardware & Custom Gaming PCs',
  heroTagline: 'Hand-tested components, custom builds, fast delivery.',
  heroCtaText: 'Shop Inventory',
  hero: {},
  categoryGrid: {},
  bestSellers: {},
  blocksOrder: ['hero', 'categoryGrid', 'promoAds', 'bestSellers', 'trustRow'],
  blocks: [
    { id: 'hero', order: 0, visible: true },
    { id: 'categoryGrid', order: 1, visible: true },
    { id: 'promoAds', order: 2, visible: true },
    { id: 'bestSellers', order: 3, visible: true },
    { id: 'trustRow', order: 4, visible: true },
  ],
  promoAds: [],
  trustItems: [],
  themeColor: '#0a84ff',
};

export function subscribeToStoreCatalog(
  callback: (catalog: StoreCatalogPayload | null) => void
): () => void {
  const sb = getSupabase();
  if (!sb) {
    callback(null);
    return () => {};
  }

  const load = async () => {
    try {
      const { data } = await sb.from('storefront_catalog').select('*').order('updated_at', { ascending: false }).limit(1).maybeSingle();
      callback(data?.catalog_data || null);
    } catch {
      callback(null);
    }
  };

  void load();

  const channel = sb
    .channel('public:storefront_catalog_sub')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'storefront_catalog' }, () => {
      void load();
    })
    .subscribe();

  return () => {
    void sb.removeChannel(channel);
  };
}

export function subscribeToStorefrontConfig(
  callback: (config: StorefrontConfig) => void
): () => void {
  const sb = getSupabase();
  if (!sb) {
    callback(normalizeStorefrontConfig(null));
    return () => {};
  }

  // Normalize here so every consumer receives a config that already satisfies the
  // shape they read; the public storefront must never be able to crash on a
  // partial or older stored config.
  const load = async () => {
    try {
      const { data } = await sb.from('storefront_config').select('config_data').limit(1).maybeSingle();
      callback(normalizeStorefrontConfig(data?.config_data || null));
    } catch {
      callback(normalizeStorefrontConfig(null));
    }
  };

  void load();

  const channel = sb
    .channel('public:storefront_config_sub')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'storefront_config' }, () => {
      void load();
    })
    .subscribe();

  return () => {
    void sb.removeChannel(channel);
  };
}

export async function writeStorefrontConfig(config: StorefrontConfig): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;
  await sb.from('storefront_config').upsert({
    user_id: user.id,
    config_data: config,
    updated_at: new Date().toISOString(),
  });
}

export async function uploadStorefrontAsset(file: File): Promise<string> {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase is not configured');
  const ext = file.name.split('.').pop() || 'jpg';
  const path = `storefront-assets/${Date.now()}.${ext}`;
  const { error } = await sb.storage.from('inventory-images').upload(path, file, { upsert: true });
  if (error) throw error;
  const { data: { publicUrl } } = sb.storage.from('inventory-images').getPublicUrl(path);
  return publicUrl;
}

export async function createStoreInquiry(inquiry: any): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from('store_inquiries').insert({
    id: `inq-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    item_id: inquiry.itemId || null,
    item_name: inquiry.itemName || null,
    customer_name: inquiry.customerName || '',
    customer_email: inquiry.customerEmail || '',
    customer_phone: inquiry.customerPhone || null,
    message: inquiry.message || '',
    status: 'new',
    created_at: new Date().toISOString(),
    read: false,
  });
}


export async function uploadProductCardBlob(
  blob: Blob,
  itemId: string,
  fileName?: string
): Promise<string> {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase is not configured');
  const user = await getCurrentUser();
  if (!user) throw new Error('Not signed in');
  const ext = fileName?.split('.').pop() || 'png';
  const path = `${user.id}/${itemId || 'gallery'}/product-cards/${Date.now()}-${fileName || 'card'}.${ext}`;
  const { error } = await sb.storage.from('inventory-images').upload(path, blob, {
    upsert: true,
    contentType: blob.type || 'image/png',
  });
  if (error) throw error;
  const { data: { publicUrl } } = sb.storage.from('inventory-images').getPublicUrl(path);
  return publicUrl;
}
