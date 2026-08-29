
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

export type SaleProceedsSource = 'ebay_screenshot' | 'ebay_seller_hub' | 'ebay_order' | 'inferred';

/** Snapshot of where a sold price went after eBay fees / shipping. */
export interface SaleProceedsBreakdown {
  capturedAt: string;
  source: SaleProceedsSource;
  itemGrossEur?: number | null;
  buyerShippingEur?: number | null;
  buyerTotalEur?: number | null;
  transactionFeeEur?: number | null;
  adFeeEur?: number | null;
  shippingLabelEur?: number | null;
  otherFeeEur?: number | null;
  refundEur?: number | null;
  netPayoutEur?: number | null;
  /**
   * True when marketplace fees were filled from Flip Coach % (not Seller Hub / CSV).
   * Do not treat those fee figures as Finanzamt-grade.
   */
  feesEstimated?: boolean;
}

export type WorkflowStage = 'Draft' | 'Testing' | 'Ready' | 'Listed' | 'Sold' | 'Shipped';

/** 3D print production queue (separate from listing workflowStage). */
export type PrintStage = 'queued' | 'printing' | 'ready' | 'sold';

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
  /** Public eBay seller username — cloud-synced for mobile/desktop. */
  ebaySellerUsername?: string;
  /** eBay OAuth user access token — cloud-synced (auto-refreshed via refresh token). */
  ebayOAuthToken?: string;
  /** eBay OAuth refresh token (~18 months) — cloud-synced so phone/desktop stay connected. */
  ebayOAuthRefreshToken?: string;
  /** Access token expiry (epoch ms). */
  ebayOAuthExpiresAt?: number;
  /** Refresh token expiry (epoch ms). */
  ebayOAuthRefreshExpiresAt?: number;
  /** Kleinanzeigen Bestandsliste / profile URL — cloud-synced. */
  kleinanzeigenProfileUrl?: string;
}

export interface CustomerInfo {
  name: string;
  address: string;
  phone?: string;
  email?: string;
}

/** Why a buy-price row was written (restock fees, manual edit, etc.). */
export type BuyPriceChangeReason =
  | 'manual'
  | 'restock_loss'
  | 'hub_erstattet'
  | 'refund_capitalize'
  | 'container_resplit'
  /** Lot SMART/EQUAL allocation during bulk import — not a real EK edit. */
  | 'bulk_lot_split'
  | 'other';

/** Single entry in an item's price / sale history. */
export interface PriceHistoryEntry {
  date: string;       // ISO date or datetime
  type: 'buy' | 'sell' | 'storePrice';
  price: number;
  previousPrice?: number;
  /** Signed change (price − previousPrice). Stored so UI does not recompute. */
  delta?: number;
  /** Structured cause — especially restock / Erstattet capitalization into EK. */
  reason?: BuyPriceChangeReason;
  /** Human label, e.g. "Erstattet — fees/shipping +€6.19 EK". */
  reasonLabel?: string;
  /** eBay / Hub order id when the change came from a refund restock. */
  orderId?: string;
}

export type ItemHistoryActionType =
  | 'created'
  | 'buy_price_changed'
  | 'sell_price_changed'
  | 'status_changed'
  | 'bundle_created'
  | 'bundle_split'
  | 'added_to_bundle'
  | 'removed_from_bundle'
  | 'ebay_linked'
  | 'ebay_unlinked'
  | 'customer_set'
  | 'condition_changed'
  | 'photos_updated'
  | 'general_edit';

export interface ItemFieldDiff {
  field: string;
  from: any;
  to: any;
  label?: string;
}

export interface ItemHistoryEntry {
  id: string;
  timestamp: string;
  action: ItemHistoryActionType;
  title: string;
  details?: string;
  actor?: 'manual' | 'ai' | 'system';
  diffs?: ItemFieldDiff[];
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

/** Standalone ↔ bundle/PC membership change — see InventoryItem.movementHistory. */
export type MovementEventType = 'added_to_bundle' | 'removed_from_bundle';

export interface MovementEvent {
  id: string;
  /** ISO datetime this membership change was recorded. */
  date: string;
  type: MovementEventType;
  /** The bundle/PC's id at the time of the change. */
  bundleId?: string;
  /** The bundle/PC's name at the time — kept even if the bundle is later renamed/deleted. */
  bundleName?: string;
}

/** Why a completed eBay/sale cycle was closed so the item could return to stock. */
export type ItemSaleCycleReason = 'erstattet' | 'return' | 'cancelled' | 'manual_unsold';

/**
 * Frozen snapshot of one completed sale (buyer, order, proceeds) before restock.
 * Live ebayOrderId / customer always describe the CURRENT sale only, so a later
 * eBay sale can fetch the new buyer without wiping Finanzamt history.
 */
export interface ItemSaleCycle {
  id: string;
  closedAt: string;
  reason: ItemSaleCycleReason;
  reasonLabel: string;
  sellDate?: string;
  sellPrice?: number;
  originalSellPrice?: number;
  profit?: number;
  platformSold?: Platform;
  paymentType?: PaymentType;
  ebayOrderId?: string;
  ebayOrderLineKey?: string;
  ebayUsername?: string;
  ebayListingId?: string;
  ebaySku?: string;
  customer?: CustomerInfo;
  saleProceeds?: SaleProceedsBreakdown;
  ebaySaleAdjustments?: EbaySaleAdjustment[];
  feeAmount?: number;
  hasFee?: boolean;
  sellerPaidShipping?: boolean;
  sellerShippingAmount?: number;
  invoiceNumber?: string;
  buyPriceAtClose: number;
  leftoverLossEur?: number;
  refundEur?: number;
  refundKind?: 'full' | 'partial';
}

/** Who last touched a record: the user by hand, or the AI assistant (browser automation). */
export type RecordActor = 'manual' | 'ai';

/**
 * Review state of the AI's touch on a record.
 * Absent/undefined = the AI never touched this record.
 */
export type AiReviewStatus = 'unreviewed' | 'approved' | 'reverted';

/**
 * Direct links back to where a deal actually happened.
 *
 * The point is one click from a row to the Kleinanzeigen chat or eBay order, so status
 * ("did I actually receive this?") can be checked without hunting — and so the Finanzamt
 * paper trail points at a real source.
 *
 * Older rows keep using the platform-specific fields (`kleinanzeigenChatUrl`,
 * `ebayOrderId`, …); `utils/sourceLinks.ts` resolves both shapes into the same three links.
 */
export interface SourceLinks {
  /** Conversation this deal was agreed in (KA `m-nachrichten.html?conversationId=…`). */
  sourceChatUrl?: string;
  /** The order or the listing itself. */
  sourceOrderUrl?: string;
  /** Seller/buyer profile page. */
  counterpartyProfileUrl?: string;
  /** eBay order number (#01-14946-82253) or Kleinanzeigen conversation id. */
  externalOrderId?: string;
}

/** What a proof file documents. */
export type ProofAttachmentType =
  | 'chat_screenshot'
  | 'payment_confirmation'
  | 'shipping_label'
  | 'receipt'
  | 'other';

/**
 * Evidence for the Finanzamt, kept independently of the chat it came from — chats get
 * deleted, platforms expire links, screenshots don't.
 *
 * `fileUrl` is always a Firebase Storage URL, never base64: these live inside the item
 * document, and inlined images would blow past Firestore's 1 MB limit.
 */
export interface ProofAttachment {
  id: string;
  type: ProofAttachmentType;
  fileUrl: string;
  /** Original file name, for display and export. */
  fileName?: string;
  /** ISO datetime */
  uploadedAt: string;
  uploadedBy: RecordActor;
  note?: string;
}

/** Attribution fields shared by items, bundles and pending inbox transactions. */
export interface AiAttribution {
  /** Who originally created the record. */
  source?: RecordActor;
  /** Who performed the most recent write. */
  lastModifiedBy?: RecordActor;
  /** Set only once the AI has touched the record; null-ish while untouched. */
  aiReviewStatus?: AiReviewStatus;
  /** Screenshots / receipts proving the deal (Storage URLs only). */
  proofAttachments?: ProofAttachment[];
}

/** How an inventory row first entered the stock list. */
export type CostOriginKind =
  | 'single_add'
  | 'bulk_import'
  | 'compose_pc'
  | 'compose_bundle'
  | 'compose_mixed'
  | 'split_identical'
  | 'split_parts'
  | 'trade_in'
  | 'ebay_purchase'
  | 'inbox_purchase'
  | 'ebay_listing_import'
  | 'csv_import'
  | 'print_3d'
  | 'reinvest_prefill'
  | 'quick_bundle_add';

export type CostAllocationMethod =
  | 'manual'
  | 'equal'
  | 'smart'
  | 'weighted'
  | 'sum_parts'
  | 'trade_equal'
  | 'trade_smart'
  | 'calculator_3d'
  | 'import_zero'
  | 'unknown';

/** One other part in the same purchase / split at the moment this row was created. */
export interface CostOriginSibling {
  id?: string;
  name: string;
  allocatedEur: number;
  weight?: number;
  locked?: boolean;
}

/**
 * Immutable cost provenance. Explains why buyPrice was set when the item was added.
 * Later buy-price edits go to priceHistory — they must not rewrite this snapshot.
 */
export interface ItemCostOrigin {
  kind: CostOriginKind;
  capturedAt: string;
  /** Short UI line, e.g. "Bulk entry · SMART · €300 ÷ 8 → €42". */
  label: string;
  addedAs: string;
  bundleName?: string;
  bundleId?: string;
  sourceItemId?: string;
  sourceItemName?: string;
  bulkImportId?: string;
  partCount: number;
  lotTotalEur: number;
  allocatedEur: number;
  allocationMethod: CostAllocationMethod;
  allocationMode?: 'EQUAL' | 'SMART' | 'WEIGHTED' | 'MANUAL';
  weight?: number;
  weightSharePct?: number;
  manualLocked?: boolean;
  siblings?: CostOriginSibling[];
  notes?: string;
}

export interface InventoryItem extends AiAttribution, SourceLinks {
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
  /** Line claim key (`orderId::sku|title`) set when this row is bound to an eBay order line. */
  ebayOrderLineKey?: string;
  /**
   * First recorded net/gross of the CURRENT sale only. Prior sales are frozen in
   * ebaySaleCycles so a restock → resale can store a new original without losing history.
   */
  originalSellPrice?: number;
  /** Documented post-sale payout changes (returns, refunds, cancellations). */
  ebaySaleAdjustments?: EbaySaleAdjustment[];
  /**
   * Order IDs whose refund/cancellation fee this item has manually absorbed into its buy
   * price (see utils/refundFeeAbsorption.ts) but hasn't yet been resold against. While this
   * is non-empty and status is In Stock, the item is a "candidate" — still available, shown
   * with a distinct color in the matcher — waiting for you to link it to the order that
   * actually sold it.
   */
  pendingRefundFeeOrderIds?: string[];
  /**
   * Standalone ↔ bundle/PC membership history — recorded automatically (App.tsx handleUpdate)
   * whenever parentContainerId changes. Audit trail so a bundle losing a child link is
   * diagnosable/reversible after the fact. See utils/itemMovementHistory.ts.
   */
  movementHistory?: MovementEvent[];
  /**
   * Closed prior sales (refund / return / unsold). Live ebayOrderId is the current
   * sale only — so a resale can bind a new buyer while this array keeps history.
   */
  ebaySaleCycles?: ItemSaleCycle[];
  
  // eBay API Tracking
  ebaySku?: string;
  ebayOfferId?: string;
  /** Active eBay listing ID last synced via Store Pull (avoids re-matching sold/relisted duplicates). */
  ebayListingId?: string;
  /**
   * eBay listing condition — drives the numeric conditionId sent to the Inventory API.
   * 'forParts' requires aiDescriptionNote to be non-empty (eBay mandates a fault
   * description for "For parts or not working" listings).
   */
  ebayCondition?: 'new' | 'newOther' | 'used' | 'forParts';
  /** Shipping weight in kg, used to pick the DHL rate tier at publish time. */
  shippingWeightKg?: number;
  /** Opt-in only — untracked DHL Warensendung instead of tracked Paket/Päckchen.
   *  Defaults to tracked when unset; never auto-selected. */
  ebayShippingMethod?: 'tracked' | 'warensendung';
  /** Override the subCategory → eBay categoryId mapping for this one item, when needed. */
  ebayCategoryIdOverride?: string;
  /**
   * Short sequential human-readable tag (e.g. "AT-0421"), generated once per item.
   * Embedded at the end of the eBay listing title so a buyer/return references the exact
   * physical unit when you have 2+ similar or identical items in stock.
   */
  assetTag?: string;
  /**
   * Category-aware condition detail toggles (e.g. 'tested_working', 'signs_of_use') — feed
   * the AI listing description so it states exactly what's true of THIS unit. Distinct from
   * ebayCondition (eBay's required New/Used/For-parts enum) and hasOVP/hasIOShield (which
   * stay their own dedicated fields). See utils/itemConditionToggles.ts for the catalog.
   */
  conditionToggles?: string[];
  /**
   * EAN/GTIN barcode. Left unset for most used/no-box parts — the eBay publish payload then
   * sends "Does not apply" (eBay's own designation for used items with no retail barcode).
   * Only set when AI or you have identified a real manufacturer EAN for a retail-boxed part.
   */
  ean?: string;

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
  /** Parsed eBay payout split (fees, Versand, Auszahlung) — shown when clicking sell price. */
  saleProceeds?: SaleProceedsBreakdown;
  
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
  /** Container was created by splitting one item into parts — distinguishes it from a
   *  user-built Bundle/Mixed Bundle/PC in the UI (badge, styling). */
  splitOrigin?: 'parts' | 'identical';
  /** Inside a split container, this part IS the original item (whatever wasn't carved
   *  out into other parts) — highlighted in the parts list so it isn't mistaken for one
   *  of the extracted parts. */
  isSplitRemainder?: boolean;

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
  /**
   * Listing vanished from your profile while item is still In Stock —
   * suggest marking sold (you may have forgotten).
   */
  maybeSoldHint?: 'ebay' | 'kleinanzeigen' | 'both';
  /** When the listing first disappeared during sync. */
  listingDisappearedAt?: string;
  /** User dismissed the maybe-sold nudge. */
  maybeSoldDismissedAt?: string;

  // Trade related
  tradedForIds?: string[]; // IDs of items received in exchange
  tradedFromId?: string;   // ID of the item this was traded from
  cashOnTop?: number;      // Cash received during trade

  /** Privatentnahme / gift — recipient label (e.g. daughter, friend). */
  giftRecipient?: string;
  /** Optional relation for your records (German gift-tax context). */
  giftRelation?: 'family' | 'friend' | 'other';

  // AI Dealwatch Data
  marketTitle?: string;
  marketDescription?: string;

  // Workflow Pipeline
  workflowStage?: WorkflowStage;

  /** 3D print queue: Job → printing → ready → sold. */
  printStage?: PrintStage;
  /** Held / reserved — skip on the sell-today list. */
  reserved?: boolean;
  /** Seller marked photos ready (quick row status, no card open). */
  photosReady?: boolean;

  /**
   * Physical inventory check status.
   * - undefined = not checked / unknown
   * - 'present' = physically confirmed in stock
   * - 'lost' = currently missing / not found
   */
  presence?: 'present' | 'lost';

  /** Price and sale history: changes to buy/sell price over time. */
  priceHistory?: PriceHistoryEntry[];

  /** Complete chronological audit log of all changes to this specific item. */
  history?: ItemHistoryEntry[];

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

  /** Original packaging (OVP) — tri-state: true present, false missing, undefined not set. Feeds AI listing + cards. */
  hasOVP?: boolean;
  /** IO Shield — same tri-state; only relevant for motherboards / bundles with a motherboard. */
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

  /**
   * Frozen snapshot of how this row entered inventory and how its first buy price
   * was derived (bundle split, bulk import, trade, etc.). Never overwrite after first save.
   */
  costOrigin?: ItemCostOrigin;
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

/** What the AI did, in machine-readable form (drives the "Done by AI" feed wording). */
export type AiActionType =
  | 'item_created'
  | 'item_updated'
  | 'marked_sold'
  | 'marked_received'
  | 'buyer_info_filled'
  | 'field_changed'
  | 'inbox_created'
  | 'inbox_updated'
  | 'item_deleted';

/** What kind of record an AI action points at. */
export type AiActionTargetKind = 'item' | 'inbox';

/** One field-level before/after pair. Values are JSON-safe scalars or short arrays/objects. */
export interface AiActionDiffEntry {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

/**
 * One recorded AI action. Written to localStorage (`ai_actions_v1`) and mirrored to
 * Firestore at users/{uid}/aiActions. Retained independently of ActionHistoryEntry so
 * revert data outlives the (much shorter) action-history window.
 */
export interface AiAction {
  id: string;
  /** ISO datetime */
  timestamp: string;
  actor: 'ai';
  actionType: AiActionType;
  targetKind: AiActionTargetKind;
  /** Item id, or pending-inbox entry key when targetKind === 'inbox'. */
  itemId: string;
  /** Name snapshot at action time — keeps the feed readable after renames/deletes. */
  itemName?: string;
  /** Full before/after snapshot of the changed fields. */
  diff: AiActionDiffEntry[];
  reviewStatus: AiReviewStatus;
  /** false for actions that cannot be undone (e.g. an email already went out). */
  reversible: boolean;
  /** Short human note on where the data came from, e.g. "Kleinanzeigen chat with Felix M., 23.07.2026". */
  sourceContext?: string;
  /** Session id from aiSession — groups actions made in one automation run. */
  sessionId?: string;
  /** Set when the user approves/reverts, for audit purposes. */
  reviewedAt?: string;
  /** Note attached on revert (e.g. which fields were skipped due to conflicts). */
  reviewNote?: string;
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
  /** Skip stamping sold PC/bundle sale meta onto parts (e.g. Abrechnung unlink). */
  skipContainerSaleMetaSync?: boolean;
  /**
   * Skip one-parent / componentIds membership repair. Default runs on every save so
   * a part cannot stay listed on two PC/bundles.
   */
  skipMembershipSync?: boolean;
  /** Push to cloud on the fast path (~0.4s) instead of the default debounce. */
  flushCloud?: boolean;
  /**
   * Skip AI attribution/diff logging even inside an open AI session.
   * Used by Revert (which is a manual action) and by internal cascades.
   */
  skipAiLog?: boolean;
  /**
   * The payload is a complete item, not a partial form submit — don't re-fill missing
   * fields from the stored copy. Required by Revert, which clears fields on purpose and
   * would otherwise see them restored by the preserve step.
   */
  skipFieldPreserve?: boolean;
  /**
   * Don't auto-append buy/sell/store priceHistory when this update changes prices.
   * Used for bulk-lot SMART resplits so allocation isn't shown as an EK "change".
   */
  skipPriceHistory?: boolean;
  /**
   * Replace the generic "Item updated" action-history row.
   * `detailsByItemId` is used when several items are saved in one call.
   */
  actionNote?: { action: string; details?: string; detailsByItemId?: Record<string, string> };
};
