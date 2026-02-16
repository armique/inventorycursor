
export enum ItemStatus {
  IN_STOCK = 'In Stock',
  SOLD = 'Sold',
  ORDERED = 'Ordered',
  IN_COMPOSITION = 'In Composition',
  TRADED = 'Traded'
}

export type Platform = 'ebay.de' | 'kleinanzeigen.de' | 'Amazon' | 'Other';

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
  type: 'buy' | 'sell';
  price: number;
  previousPrice?: number;
}

export interface InventoryItem {
  id: string;
  name: string;
  buyPrice: number;
  sellPrice?: number;
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
  vendor?: string;
  
  // Platform & Payment Tracking
  platformBought?: Platform;
  platformSold?: Platform;
  buyPaymentType?: PaymentType; // How I paid
  paymentType?: PaymentType;    // How customer paid (Sold items)
  
  // Platform Specific Sales Data
  kleinanzeigenChatUrl?: string;
  kleinanzeigenChatImage?: string; // Base64 or URL
  ebayUsername?: string;
  ebayOrderId?: string;
  
  // eBay API Tracking
  ebaySku?: string;
  ebayOfferId?: string;

  // Platform Specific Buy Data
  kleinanzeigenBuyChatUrl?: string;
  kleinanzeigenBuyChatImage?: string; // Base64 or URL
  
  hasFee?: boolean;
  feeAmount?: number;
  
  // Receipt / Proof of Purchase
  hasReceipt?: boolean;
  receiptUrl?: string; // Base64 data of image or PDF
  
  // Structured Technical Specs
  specs?: Record<string, string | number>;
  
  // Invoice related
  invoiceNumber?: string;
  customer?: CustomerInfo;
  
  isBundle?: boolean;
  isPC?: boolean;
  isDraft?: boolean; // New flag for saved drafts
  isDefective?: boolean; // Flag for broken/defective items
  componentIds?: string[];
  parentContainerId?: string;

  // Trade related
  tradedForIds?: string[]; // IDs of items received in exchange
  tradedFromId?: string;   // ID of the item this was traded from
  cashOnTop?: number;      // Cash received during trade

  // AI Market Data
  marketTitle?: string;
  marketDescription?: string;

  // Workflow Pipeline
  workflowStage?: WorkflowStage;

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
  imageUrl?: string;
  storeGalleryUrls?: string[];
  storeDescription?: string;
  specs?: Record<string, string | number>;
  categoryFields?: string[]; // field names for this category for display order
}

export interface Competitor {
  id: string;
  name: string;
  platform: Platform;
  lastCheck?: string;
  notes?: string;
  aiAnalysis?: string;
  observedItems?: { title: string; price: string }[];
}

export interface BackupEntry {
  id: string;
  date: string;
  itemCount: number;
  data: string;
}

export type ExpenseCategory = 'Shipping' | 'Packaging' | 'Fees' | 'Tools' | 'Cleaning' | 'Office' | 'Marketing' | 'Other';

export interface Expense {
  id: string;
  description: string;
  amount: number;
  date: string;
  category: ExpenseCategory;
}
