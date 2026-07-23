
export enum ItemStatus {
  IN_STOCK = 'In Stock',
  SOLD = 'Sold',
  ORDERED = 'Ordered',
  IN_COMPOSITION = 'In Composition',
  TRADED = 'Traded',
  GIFTED = 'Gifted'
}

export type Platform = 'ebay.de' | 'kleinanzeigen.de' | 'In Person' | 'Amazon' | 'Other';

export type PaymentType = 
  'Cash' 
  | 'Bank Transfer' 
  | 'ebay.de' 
  | 'Kleinanzeigen (Cash)' 
  | 'Kleinanzeigen (Direkt Kaufen)' 
  | 'Kleinanzeigen (Paypal)' 
  | 'Kleinanzeigen (Wire Transfer)'
  | 'Paypal' 
  | 'Trade'
  | 'Gift'
  | 'Other';

export type TaxMode = 'SmallBusiness' | 'RegularVAT' | 'DifferentialVAT';

export type WorkflowStage = 'Draft' | 'Testing' | 'Ready' | 'Listed' | 'Sold' | 'Shipped';

export interface BusinessSettings {
  companyName: string;
  ownerName: string;
  address: string;
  phone: string;
  taxId: string;
  vatId?: string;
  iban: string;
  bic: string;
  bankName: string;
  taxMode: TaxMode;
  // eBay Defaults
  ebayPostalCode?: string;
  ebayPaypalEmail?: string;
  ebayDispatchTime?: number; // Days to ship
  ebayReturnPolicy?: 'ReturnsAccepted' | 'ReturnsNotAccepted';
}

export interface CustomerInfo {
  name: string;
  address: string;
  phone?: string;
  email?: string;
}

/** Single entry in an item's price / sale history. */
export interface PriceHistoryEntry {
  date: string;       // ISO date or datetime
  type: 'buy' | 'sell' | 'storePrice';
  price: number;
  previousPrice?: number;
}

/** Documented eBay post-sale change (return, refund, cancellation) — Finanzamt-auditable. */
export type EbaySaleAdjustmentKind =
  | 'refund'
  | 'return'
  | 'cancellation'
  | 'fee_adjustment'
  | 'payout_correction'
  /** Full refund — item returns to stock; order loss capitalized into buy price. */
  | 'restock_after_refund';

export interface EbaySaleAdjustment {
  id: string;
  /** Links back to cached order financial event — prevents double-apply. */
  eventId?: string;
  /** YYYY-MM-DD */
  date: string;
  kind: EbaySaleAdjustmentKind;
  /** Signed EUR change to effective revenue (negative = clawback). */
  amount: number;
  orderId: string;
  reason: string;
  source: 'ebay_csv' | 'ebay_api' | 'ebay_sync';
  importedAt: string;
  sellPriceBefore: number;
  sellPriceAfter: number;
  feeBefore?: number;
  feeAfter?: number;
  /** When set, apply moves item back to In Stock and adds buyPriceDelta to buy price. */
  revertToStock?: boolean;
  buyPriceBefore?: number;
  buyPriceAfter?: number;
  /** Positive EUR added to buy price (DHL label, cancellation fees, etc.). */
  buyPriceDelta?: number;
}

export interface InventoryItem {
  id: string;
  name: string;
  buyPrice: number;
  sellPrice?: number;
  /** Public asking price shown on the storefront — separate from sellPrice, which is your
   * internal target/realized sale price used for profit, tax, and dashboard calculations.
   * Editing the storefront listing price never touches sellPrice. */
  storePrice?: number;
  profit?: number;
  buyDate: string;
  sellDate?: string;
  /**
   * When this item is part of a PC / bundle, this stores the date when the
   * container (PC / bundle) was sold. Used to measure 'days in stock' for
   * individual components inside builds.
   */
  containerSoldDate?: string;
  category: string;
  subCategory?: string;
  status: ItemStatus;
  comment1: string;
  comment2: string;
  imageUrl?: string;
  /** Additional inventory photos; first one can be set as main imageUrl. */
  imageUrls?: string[];
  vendor?: string;
  
  // Platform & Payment Tracking
  platformBought?: Platform;
  platformSold?: Platform;
  buyPaymentType?: PaymentType; // How I paid
  paymentType?: PaymentType;    // How customer paid (Sold items)
  
  // Platform Specific Sales Data
  kleinanzeigenChatUrl?: string;
  kleinanzeigenChatImage?: string; // Base64 or URL — archived to Firebase on save when signed in
  /** eBay order screenshot used to parse sale details (Firebase Storage URL after save). */
  ebayOrderScreenshotUrl?: string;
  ebayUsername?: string;
  ebayOrderId?: string;
  /** First recorded net/gross sell price when linked via eBay sync — never overwritten (Finanzamt audit). */
  originalSellPrice?: number;
  /** Documented post-sale payout changes (returns, refunds, cancellations). */
  ebaySaleAdjustments?: EbaySaleAdjustment[];
  
  // eBay API Tracking
  ebaySku?: string;
  ebayOfferId?: string;
  /** Active eBay listing ID last synced via Store Pull (avoids re-matching sold/relisted duplicates). */
  ebayListingId?: string;

  // Platform Specific Buy Data
  kleinanzeigenBuyChatUrl?: string;
  kleinanzeigenBuyChatImage?: string; // Base64 or URL
  /** Seller’s public profile / shop page (e.g. Kleinanzeigen Bestandsliste). */
  kleinanzeigenSellerProfileUrl?: string;
  
  hasFee?: boolean;
  feeAmount?: number;
  /** Buyer paid this gross amount; when sellerPaidShipping, shipping is deducted for profit only. */
  sellerPaidShipping?: boolean;
  sellerShippingAmount?: number;
  
  // Receipt / Proof of Purchase (Rechnung flag also feeds AI listing as a buyer-facing hint)
  hasReceipt?: boolean;
  receiptUrl?: string; // Base64 data of image or PDF
  
  // Structured Technical Specs
  specs?: Record<string, string | number>;
  /** Last AI fill values per key; used to highlight preset options until the user overrides. */
  specsAiSuggested?: Record<string, string | number>;
  
  // Invoice related
  invoiceNumber?: string;
  customer?: CustomerInfo;
  
  isBundle?: boolean;
  isPC?: boolean;
  isDraft?: boolean; // New flag for saved drafts
  isDefective?: boolean; // Flag for broken/defective items
  /** Item subject to §25a differential VAT (used goods margin scheme). */
  usesDifferentialVat?: boolean;
  componentIds?: string[];
  parentContainerId?: string;

  // Listing status on external marketplaces
  listedOnKleinanzeigen?: boolean;
  listedOnEbay?: boolean;
  /**
   * Opt-in: item is prepared for sale (photos/specs done). Listing presence + live
   * price sync only watch these (+ already-linked listings). Skips defective/junk.
   */
  saleReady?: boolean;
  /** True when listing presence comes from a matched parent kit listing. */
  listedViaParent?: boolean;
  /** Last time listing presence was synced for this row. */
  listingPresenceSyncedAt?: string;
  /** Matched Kleinanzeigen ad URL (optional). */
  kleinanzeigenListingUrl?: string;
  /** Live ask price scraped/synced from your eBay listing. */
  liveEbayListPrice?: number;
  /** Live ask price scraped/synced from your Kleinanzeigen ad. */
  liveKleinListPrice?: number;
  /** When live marketplace prices were last written. */
  liveListingPriceSyncedAt?: string;

  // Trade related
  tradedForIds?: string[]; // IDs of items received in exchange
  tradedFromId?: string;   // ID of the item this was traded from
  cashOnTop?: number;      // Cash received during trade

  /** Privatentnahme / gift — recipient label (e.g. daughter, friend). */
  giftRecipient?: string;
  /** Optional relation for your records (German gift-tax context). */
  giftRelation?: 'family' | 'friend' | 'other';

  // AI Market Data
  marketTitle?: string;
  marketDescription?: string;

  // Workflow Pipeline
  workflowStage?: WorkflowStage;

  /**
   * Physical inventory check status.
   * - undefined = not checked / unknown
   * - 'present' = physically confirmed in stock
   * - 'lost' = currently missing / not found
   */
  presence?: 'present' | 'lost';

  /** Price and sale history: changes to buy/sell price over time. */
  priceHistory?: PriceHistoryEntry[];

  // Storefront
  /** If false, item is hidden from the public store. Default true when unset. */
  storeVisible?: boolean;
  /** Item is shown in Sale tab and displays discount. */
  storeOnSale?: boolean;
  /** Sale price (when on sale). If set, shown instead of sellPrice on store. */
  storeSalePrice?: number;
  /** Extra image URLs for store gallery (main image is imageUrl). */
  storeGalleryUrls?: string[];
  /** Optional short description for the store listing (overrides or supplements comment). */
  storeDescription?: string;
  /** Store badge: 'auto' = derive from data, 'New' | 'Price reduced' = show this, 'none' = never show. */
  storeBadge?: 'auto' | 'New' | 'Price reduced' | 'none';
  /** Optional SEO/sharing: meta title for this item (defaults to name). */
  storeMetaTitle?: string;
  /** Optional SEO/sharing: meta description for this item. */
  storeMetaDescription?: string;
  /** Optional English store description (when multi-language is used). */
  storeDescriptionEn?: string;
  /** Stock quantity for store (undefined = 1). When 0, show "Out of stock" on store. */
  quantity?: number;

  /** Original packaging (OVP) – feeds AI listing description as a buyer-facing condition hint. */
  hasOVP?: boolean;
  /** IO Shield included (for motherboards/bundles) – feeds AI listing description as a buyer-facing hint. */
  hasIOShield?: boolean;
  /**
   * Short seller note for AI listing generation only (not shown publicly as-is).
   * Example: "wifi antennas aren't original" → AI mentions third-party antennas.
   */
  aiDescriptionNote?: string;

  /**
   * Shared id for items created in one Bulk Entry confirm (including AI text parse).
   * Used for the bulk-import icon and dedicated batch filter view.
   */
  bulkImportId?: string;

  /**
   * Snapshot of suggested marketplace list prices (Flip Coach / sold comps).
   * Used for inventory chips and later sale-vs-suggestion accuracy.
   */
  suggestedEbayListPrice?: number;
  suggestedKleinListPrice?: number;
  suggestedPocketTarget?: number;
  /** Total eBay fee % assumed when the suggestion was computed (e.g. 30). */
  suggestedFeePct?: number;
  suggestedCompCount?: number;
  suggestedPriceSource?: 'flip_coach' | 'inventory_sold_comps' | 'cost_fallback' | 'manual';
  suggestedPriceUpdatedAt?: string;
}

/** Saved AI-generated product card (gallery history — paid generations kept for reuse). */
export interface GeneratedProductCardEntry {
  id: string;
  itemId: string;
  itemName: string;
  /**
   * Durable image reference:
   * - https://… Firebase Storage URL
   * - idb:{id} IndexedDB blob (local guaranteed copy)
   * - data:… legacy fallback
   */
  imageUrl: string;
  createdAt: string;
  provider?: string;
  model?: string;
  styleId?: string;
  styleName?: string;
  /** Suggested download / Storage file name */
  fileName?: string;
  /** true when stored in Firebase Storage (not only local) */
  cloudStored?: boolean;
}

/** Inquiry from a visitor about a store item (stored in Firebase). */
export interface StoreInquiry {
  id: string;
  itemId: string;
  itemName: string;
  message: string;
  contactEmail?: string;
  contactPhone?: string;
  contactName?: string;
  createdAt: string; // ISO
  read?: boolean;
}

/** Public store catalog item (subset of InventoryItem, written to Firestore for storefront). */
export interface StoreCatalogItem {
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
  categoryFields?: string[]; // field names for this category for display order
  /** Badge shown on store: 'New' (e.g. new this week), 'Price reduced' (from price history). */
  badge?: 'New' | 'Price reduced';
  storeMetaTitle?: string;
  storeMetaDescription?: string;
  storeDescriptionEn?: string;
  /** Quantity on hand (undefined = 1). Sent to store for "Only 1 left" / "Out of stock". */
  quantity?: number;
}

export interface BackupEntry {
  id: string;
  date: string;
  itemCount: number;
  data: string;
}

// Core built-in expense categories used in the UI.
export type CoreExpenseCategory = 'Shipping' | 'Packaging' | 'Fees' | 'Tools' | 'Cleaning' | 'Office' | 'Marketing' | 'Other';

// Allow custom categories as free text in addition to the built-in ones.
export type ExpenseCategory = CoreExpenseCategory | string;

export interface Expense {
  id: string;
  description: string;
  amount: number;
  date: string;
  category: ExpenseCategory;
  /**
   * If this expense was generated from a recurring expense, this field contains
   * the ID of the recurring expense. Used to prevent duplicate generation.
   */
  recurringExpenseId?: string;
  /**
   * Optional URL to an attached invoice/receipt (image or PDF) stored in Firebase Storage.
   */
  attachmentUrl?: string;
  /**
   * Original file name of the attached invoice/receipt (for display).
   */
  attachmentName?: string;
}

export interface RecurringExpense {
  id: string;
  description: string;
  monthlyAmount: number;
  startDate: string; // ISO date string (YYYY-MM-DD)
  category: ExpenseCategory;
  /**
   * Last date for which expenses were generated. Used to track progress
   * and only generate new months going forward.
   */
  lastGeneratedDate?: string;
}

/** Reseller tasks widget + widget layout (synced to Firebase). */
export interface DashboardTask {
  id: string;
  text: string;
  completed: boolean;
}

export interface DashboardPreferences {
  widgets: string[];
  tasks: DashboardTask[];
  timeFilter: string;
  customStart: string;
  customEnd: string;
}

export interface ActionHistoryEntry {
  id: string;
  timestamp: string; // ISO datetime
  action: string;
  itemId?: string;
  itemName?: string;
  details?: string;
  /** For "Trade completed" rows: ids of items received in that trade (used to revert). */
  tradeReceivedIds?: string[];
}

/** How a Bulk Entry session was primarily built before Confirm. */
export type BulkImportSource = 'manual' | 'paste_as_is' | 'paste_ai' | 'hardware_db' | 'barcode' | 'mixed';

/** Durable history row for one Bulk Entry confirm (including AI text parse). */
export interface BulkImportRecord {
  id: string;
  createdAt: string;
  buyDate: string;
  itemIds: string[];
  itemCount: number;
  source: BulkImportSource;
  totalCost: number;
  platformBought?: Platform;
  /** Short summary (first item names). */
  label: string;
  /** Parent bundle id when “add as bundle” was used. */
  bundleId?: string;
  /** Purchase chat link (e.g. Kleinanzeigen) when provided at confirm. */
  kleinanzeigenBuyChatUrl?: string;
  /**
   * Durable chat screenshot — prefer a Firebase Storage URL so the proof
   * survives Imgur / host deletion and Firestore size trimming.
   */
  kleinanzeigenBuyChatImage?: string;
  /** Seller profile / shop URL captured with the purchase proof. */
  kleinanzeigenSellerProfileUrl?: string;
}

/** Lightweight metadata edits (e.g. platform tag) can skip heavy undo/action/sync work. */
export type ItemUpdateOptions = {
  skipUndo?: boolean;
  skipActionLog?: boolean;
  skipContainerSync?: boolean;
  /** Push to cloud on the fast path (~0.4s) instead of the default debounce. */
  flushCloud?: boolean;
};
