import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  Plus,
  Smartphone,
  Sparkles,
  Star,
  Trash2,
  Upload,
  X,
  Download,
  Search,
  ShoppingBag,
} from 'lucide-react';
import { prefersNativePhotoCapture } from '../utils/deviceUi';
import type { GeneratedProductCardEntry, InventoryItem, PaymentType, Platform } from '../types';
import { ItemStatus } from '../types';
import { generateMarketplaceListing } from '../services/marketplaceListingAI';
import { generateItemSpecs } from '../services/specsAI';
import { mergeAiSpecsIntoEssential, resolveEssentialSpecKeys } from '../services/essentialSpecFields';
import { pickSpecsAiNameVendorUpdates } from '../utils/applySpecsAiResult';
import { getProductCardSpecs } from '../utils/productCardContent';
import {
  enqueueProductCardBackgroundJob,
  isItemProductCardJobActive,
  resolveProductCardBatchCount,
  subscribeProductCardBackgroundJobs,
} from '../services/productCardBackgroundQueue';
import {
  defaultBuyPaymentForPlatform,
  normalizeBuyPaymentForPlatform,
  paymentAfterPlatformChange,
} from '../utils/purchaseSource';
import { SALE_PLATFORM_OPTIONS } from '../utils/salePlatform';
import {
  filesToDataUrls,
  getItemUserPhotoUrls,
  normalizeImageList,
  prepareInventoryImagesForStorage,
} from '../utils/imageImport';
import ReorderablePhotoThumbs from './ReorderablePhotoThumbs';
import ItemAccessoryToggles from './ItemAccessoryToggles';
import { listingAccessoriesReady } from '../utils/itemAccessoryToggles';
import {
  fetchProductCardProviders,
  type ProductCardProviderId,
  type ProductCardProviderInfo,
} from '../services/productCardGemini';
import {
  DEFAULT_PRODUCT_CARD_STYLE_ID,
  PRODUCT_CARD_STYLES,
  type ProductCardStyleId,
} from '../services/productCardStyles';
import {
  downloadProductCardEntry,
  productCardSaveActionLabel,
  listProductCardGalleryForItemIds,
  removeProductCardFromGallery,
  resolveProductCardImageUrl,
} from '../services/productCardGallery';
import { resolveUrlForInventoryMainPhoto } from '../utils/applyProductCardAsMainPhoto';
import { productCardGalleryItemIds } from '../utils/productCardParentMatch';
import { getChildren } from '../services/financialAggregation';
import { getInventorySoldPriceBand } from '../utils/inventorySoldComps';
import { formatEUR, parseLocaleNumber } from '../utils/formatMoney';
import { HIERARCHY_CATEGORIES } from '../services/constants';
import PhoneUploadQrPanel from './PhoneUploadQrPanel';
import LocalPhotoFolderPanel from './LocalPhotoFolderPanel';
import KleinanzeigenBuyChatProofFields from './KleinanzeigenBuyChatProofFields';
import SourceLinkIcons from './SourceLinkIcons';
import ProofAttachmentsPanel from './ProofAttachmentsPanel';
import CostOriginPanel from './CostOriginPanel';
import { resolveItemSourceLinks } from '../utils/sourceLinks';
import { ADD_FLOW_INPUT, ADD_FLOW_LABEL, ADD_FLOW_PANEL } from './addFlowShared';
import { searchProductPhotos, type ImageSearchResult } from '../services/imageSearchService';
import { getEbayUsername, type EbayMyListing } from '../services/ebayService';
import { ensureEbayListings } from '../services/ebayListingIndex';
import { matchEbayListingsForItem } from '../utils/ebayListingMatch';

const BUY_PLATFORMS: Platform[] = [
  'kleinanzeigen.de',
  'ebay.de',
  'Amazon',
  'In Person',
  'Other',
];

const PAYMENT_METHODS: PaymentType[] = [
  'ebay.de',
  'Kleinanzeigen (Cash)',
  'Kleinanzeigen (Direkt Kaufen)',
  'Kleinanzeigen (Paypal)',
  'Kleinanzeigen (Wire Transfer)',
  'Paypal',
  'Cash',
  'Bank Transfer',
  'Trade',
  'Gift',
  'Other',
];

const PLATFORM_OPTION_LABEL: Record<Platform, string> = {
  'kleinanzeigen.de': 'Kleinanzeigen',
  'ebay.de': 'eBay',
  Amazon: 'Amazon',
  'In Person': 'In Person',
  Other: 'Other',
};
interface Props {
  item: InventoryItem;
  allItems?: InventoryItem[] | null;
  categories?: Record<string, string[]>;
  categoryFields?: Record<string, string[]>;
  onClose: () => void;
  onUpdateItem: (patch: Partial<InventoryItem>) => void | Promise<void>;
  /** Optional controls in the studio header (e.g. membership badges). */
  headerExtra?: React.ReactNode;
}

function resolveCardBatchCount(photoCount: number): number {
  return resolveProductCardBatchCount(photoCount);
}

const ListingStudioModal: React.FC<Props> = ({
  item,
  allItems,
  categories = HIERARCHY_CATEGORIES,
  categoryFields = {},
  onClose,
  onUpdateItem,
  headerExtra,
}) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const nativePhoto = prefersNativePhotoCapture();
  /** Chat / order / profile links, derived from legacy fields when not stored explicitly. */
  const itemSourceLinks = useMemo(() => resolveItemSourceLinks(item), [item]);

  const [name, setName] = useState(item.name || '');
  const [specs, setSpecs] = useState<Record<string, string | number>>({ ...(item.specs || {}) });
  const [title, setTitle] = useState(item.marketTitle?.trim() || item.name || '');
  const [description, setDescription] = useState(item.marketDescription || '');
  const [aiDescriptionNote, setAiDescriptionNote] = useState(item.aiDescriptionNote || '');
  const studioScrollRef = useRef<HTMLDivElement>(null);

  const [vendor, setVendor] = useState(item.vendor || '');
  const [platformBought, setPlatformBought] = useState<Platform>(
    (item.platformBought as Platform) || 'kleinanzeigen.de'
  );
  const [buyPaymentType, setBuyPaymentType] = useState<PaymentType>(
    normalizeBuyPaymentForPlatform(
      item.platformBought,
      item.buyPaymentType
    ) || defaultBuyPaymentForPlatform((item.platformBought as Platform) || 'kleinanzeigen.de')
  );
  const [platformSold, setPlatformSold] = useState<Platform | ''>(item.platformSold || '');
  const [paymentType, setPaymentType] = useState<PaymentType | ''>(item.paymentType || '');
  const [buyerName, setBuyerName] = useState(item.customer?.name || '');
  const [buyerAddress, setBuyerAddress] = useState(item.customer?.address || '');
  const [buyChatUrl, setBuyChatUrl] = useState(item.kleinanzeigenBuyChatUrl || '');
  const [buyChatImage, setBuyChatImage] = useState(item.kleinanzeigenBuyChatImage || '');
  const [sellerProfileUrl, setSellerProfileUrl] = useState(item.kleinanzeigenSellerProfileUrl || '');

  const [status, setStatus] = useState<ItemStatus>(item.status);
  const [category, setCategory] = useState(item.category || 'Components');
  const [subCategory, setSubCategory] = useState(item.subCategory || '');
  const [buyPriceText, setBuyPriceText] = useState(
    item.buyPrice != null && item.buyPrice !== 0 ? String(item.buyPrice) : ''
  );
  const [sellPriceText, setSellPriceText] = useState(
    item.sellPrice != null ? String(item.sellPrice) : ''
  );
  const [storePriceText, setStorePriceText] = useState(
    item.storePrice != null ? String(item.storePrice) : ''
  );
  const [buyDate, setBuyDate] = useState(item.buyDate || '');
  const [sellDate, setSellDate] = useState(item.sellDate || '');
  const [quantityText, setQuantityText] = useState(
    item.quantity != null ? String(item.quantity) : ''
  );
  const [notes, setNotes] = useState(item.comment1 || '');
  const [usesDifferentialVat, setUsesDifferentialVat] = useState(!!item.usesDifferentialVat);
  const [isDefective, setIsDefective] = useState(!!item.isDefective);
  const [parentContainerId, setParentContainerId] = useState(item.parentContainerId || '');
  const [receiptUrl, setReceiptUrl] = useState(item.receiptUrl || '');
  const [hasReceipt, setHasReceipt] = useState(!!item.hasReceipt);

  const [parsingSpecs, setParsingSpecs] = useState(false);
  const [generatingTitle, setGeneratingTitle] = useState(false);
  const [genListing, setGenListing] = useState(false);
  const [genCards, setGenCards] = useState(false);
  const [cardProgress, setCardProgress] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [photoUpload, setPhotoUpload] = useState<{
    done: number;
    total: number;
    fileName?: string;
    phase?: 'start' | 'done' | 'error';
  } | null>(null);

  const [gallery, setGallery] = useState<GeneratedProductCardEntry[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  /** Card gallery entry id → durable URL currently on the item photos. */
  const [selectedOnItem, setSelectedOnItem] = useState<Record<string, string>>({});
  const [busyCardId, setBusyCardId] = useState<string | null>(null);

  const [provider, setProvider] = useState<ProductCardProviderId>('openai');
  const [providers, setProviders] = useState<ProductCardProviderInfo[]>([]);
  const [styleId, setStyleId] = useState<ProductCardStyleId>(DEFAULT_PRODUCT_CARD_STYLE_ID);
  const [photoSource, setPhotoSource] = useState<'none' | 'iphone' | 'folder'>('none');
  const [photoSearching, setPhotoSearching] = useState(false);
  const [photoSearchError, setPhotoSearchError] = useState<string | null>(null);
  const [photoSearchResults, setPhotoSearchResults] = useState<ImageSearchResult[] | null>(null);
  const [ebayPhotoLoading, setEbayPhotoLoading] = useState(false);
  const [ebayPhotoError, setEbayPhotoError] = useState<string | null>(null);
  const [ebayPhotoMatches, setEbayPhotoMatches] = useState<
    Array<EbayMyListing & { matchScore: number }> | null
  >(null);
  const [ebayImportingId, setEbayImportingId] = useState<string | null>(null);
  /** Card provider/style panel — collapsed by default on narrow screens. */
  const [previewPhotoIndex, setPreviewPhotoIndex] = useState<number | null>(null);
  type StudioQuad = 'item' | 'photos' | 'specs' | 'listing';
  const [mobileQuad, setMobileQuad] = useState<StudioQuad>('item');
  const [dealOpen, setDealOpen] = useState(false);

  const workingItem = useMemo(
    () => ({
      ...item,
      name,
      specs,
      category,
      subCategory: subCategory || undefined,
      status,
      buyDate: buyDate || item.buyDate,
      sellDate: sellDate || undefined,
      isDefective: isDefective || undefined,
      usesDifferentialVat: usesDifferentialVat || undefined,
      parentContainerId: parentContainerId || undefined,
      hasReceipt,
      receiptUrl: receiptUrl || undefined,
      comment1: notes.trim() || undefined,
      marketTitle: title,
      marketDescription: description,
      aiDescriptionNote: aiDescriptionNote.trim() || undefined,
    }),
    [
      item,
      name,
      specs,
      category,
      subCategory,
      status,
      buyDate,
      sellDate,
      isDefective,
      usesDifferentialVat,
      parentContainerId,
      hasReceipt,
      receiptUrl,
      notes,
      title,
      description,
      aiDescriptionNote,
    ]
  );

  const photos = useMemo(() => getItemUserPhotoUrls(workingItem), [workingItem]);

  useEffect(() => {
    if (previewPhotoIndex === null) return;
    if (!photos.length) {
      setPreviewPhotoIndex(null);
      return;
    }
    if (previewPhotoIndex >= photos.length) {
      setPreviewPhotoIndex(photos.length - 1);
    }
  }, [photos, previewPhotoIndex]);

  const cardFields =
    categoryFields[`${category}:${subCategory}`] ||
    categoryFields[category] ||
    [];

  const cardSpecChips = useMemo(
    () => getProductCardSpecs(workingItem, cardFields, 8),
    [workingItem, cardFields]
  );

  const soldPriceBand = useMemo(
    () =>
      getInventorySoldPriceBand(allItems || [], name.trim() || item.name || '', {
        category: category || item.category,
        subCategory: subCategory || item.subCategory,
      }),
    [allItems, name, item.name, category, item.category, subCategory, item.subCategory]
  );

  const openContainers = useMemo(
    () =>
      (allItems || []).filter(
        (i) =>
          i.id !== item.id &&
          (i.isPC || i.isBundle) &&
          (i.status === ItemStatus.IN_STOCK ||
            i.status === ItemStatus.IN_COMPOSITION ||
            i.status === ItemStatus.ORDERED) &&
          !i.isDraft
      ),
    [allItems, item.id]
  );

  const categoryOptions = Object.keys(categories);
  const subCategoryOptions = categories[category] || [];

  const containerChildren = useMemo(
    () => (allItems?.length ? getChildren(item, allItems) : []),
    [allItems, item]
  );

  /** Optional receipt roll-up; OVP/IO stay tri-state on the working item. */
  const listingAccessories = useMemo(() => {
    let hasReceipt = item.hasReceipt === true;
    for (const child of containerChildren) {
      if (child.hasReceipt === true) hasReceipt = true;
    }
    return {
      hasOVP: workingItem.hasOVP,
      hasIOShield: workingItem.hasIOShield,
      hasReceipt,
    };
  }, [item.hasReceipt, containerChildren, workingItem.hasOVP, workingItem.hasIOShield]);

  const allItemsRef = useRef(allItems);
  allItemsRef.current = allItems;
  const itemRef = useRef(item);
  itemRef.current = item;
  const galleryHasRowsRef = useRef(false);

  const reloadGallery = useCallback(async (opts?: { silent?: boolean }) => {
    const current = itemRef.current;
    const silent = Boolean(opts?.silent) || galleryHasRowsRef.current;
    if (!silent) setGalleryLoading(true);
    try {
      const ids = productCardGalleryItemIds(allItemsRef.current || [], current);
      const list = await listProductCardGalleryForItemIds(ids);
      galleryHasRowsRef.current = list.length > 0;
      setGallery(list);
      const nextThumbs: Record<string, string> = {};
      await Promise.all(
        list.slice(0, 48).map(async (e) => {
          try {
            nextThumbs[e.id] = await resolveProductCardImageUrl(e);
          } catch {
            /* skip */
          }
        })
      );
      setThumbs(nextThumbs);
      const onItem = new Set(
        [current.imageUrl, ...(current.imageUrls || [])].filter(
          (u): u is string => typeof u === 'string' && u.trim().length > 0
        )
      );
      const selected: Record<string, string> = {};
      for (const e of list) {
        const candidates = [e.imageUrl, nextThumbs[e.id]].filter(Boolean) as string[];
        const hit = candidates.find((u) => onItem.has(u));
        if (hit) selected[e.id] = hit;
      }
      setSelectedOnItem(selected);
      setSelectedCardId((prev) => {
        if (prev && list.some((e) => e.id === prev)) return prev;
        return list[0]?.id || null;
      });
    } catch (e) {
      console.warn(e);
    } finally {
      if (!silent) setGalleryLoading(false);
    }
  }, []);

  // Hydrate local studio fields only when switching items.
  // Re-running this on every vendor/spec/photo patch was wiping unsaved Generate listing text
  // before Apply — so Apply looked broken (saved empty / old description).
  useEffect(() => {
    setName(item.name || '');
    setSpecs({ ...(item.specs || {}) });
    setTitle(item.marketTitle?.trim() || item.name || '');
    setDescription(item.marketDescription || '');
    setAiDescriptionNote(item.aiDescriptionNote || '');
    setVendor(item.vendor || '');
    setPlatformBought((item.platformBought as Platform) || 'kleinanzeigen.de');
    setBuyPaymentType(
      normalizeBuyPaymentForPlatform(item.platformBought, item.buyPaymentType) ||
        defaultBuyPaymentForPlatform((item.platformBought as Platform) || 'kleinanzeigen.de')
    );
    setPlatformSold(item.platformSold || '');
    setPaymentType(item.paymentType || '');
    setBuyerName(item.customer?.name || '');
    setBuyerAddress(item.customer?.address || '');
    setBuyChatUrl(item.kleinanzeigenBuyChatUrl || '');
    setBuyChatImage(item.kleinanzeigenBuyChatImage || '');
    setSellerProfileUrl(item.kleinanzeigenSellerProfileUrl || '');
    setStatus(item.status);
    setCategory(item.category || 'Components');
    setSubCategory(item.subCategory || '');
    setBuyPriceText(item.buyPrice != null && item.buyPrice !== 0 ? String(item.buyPrice) : '');
    setSellPriceText(item.sellPrice != null ? String(item.sellPrice) : '');
    setStorePriceText(item.storePrice != null ? String(item.storePrice) : '');
    setBuyDate(item.buyDate || '');
    setSellDate(item.sellDate || '');
    setQuantityText(item.quantity != null ? String(item.quantity) : '');
    setNotes(item.comment1 || '');
    setUsesDifferentialVat(!!item.usesDifferentialVat);
    setIsDefective(!!item.isDefective);
    setParentContainerId(item.parentContainerId || '');
    setReceiptUrl(item.receiptUrl || '');
    setHasReceipt(!!item.hasReceipt);
    setPreviewPhotoIndex(null);
    setError(null);
    setMobileQuad('item');
    setDealOpen(false);
    setPhotoSearchResults(null);
    setPhotoSearchError(null);
    setEbayPhotoMatches(null);
    setEbayPhotoError(null);
    // intentionally only item.id — local draft fields are source of truth while studio is open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  useEffect(() => {
    void fetchProductCardProviders().then((list) => {
      setProviders(list);
      const preferred =
        list.find((p) => p.id === 'openai' && p.available) ||
        list.find((p) => p.available) ||
        list[0];
      if (preferred?.id) setProvider(preferred.id);
    });
  }, []);

  useEffect(() => {
    galleryHasRowsRef.current = false;
    void reloadGallery();
  }, [item.id, reloadGallery]);

  useEffect(() => {
    if (!gallery.length) return;
    const onItem = new Set(photos);
    const selected: Record<string, string> = {};
    for (const e of gallery) {
      const candidates = [e.imageUrl, thumbs[e.id]].filter(
        (u): u is string => typeof u === 'string' && u.trim().length > 0
      );
      const hit = candidates.find((u) => onItem.has(u));
      if (hit) selected[e.id] = hit;
    }
    setSelectedOnItem(selected);
  }, [photos, gallery, thumbs]);

  const flashCopied = (key: string) => {
    setCopied(key);
    setTimeout(() => setCopied((c) => (c === key ? null : c)), 1400);
  };

  const copyText = async (key: string, text: string) => {
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      flashCopied(key);
    } catch {
      setError('Copy failed');
    }
  };

  const persistPatch = async (patch: Partial<InventoryItem>) => {
    await onUpdateItem(patch);
  };

  const flushPendingName = useCallback(async () => {
    const nextName = name.trim() || item.name;
    if (nextName === (item.name || '')) return;
    setName(nextName);
    await onUpdateItem({ name: nextName });
  }, [name, item.name, onUpdateItem]);

  const handleClose = useCallback(() => {
    void (async () => {
      try {
        await flushPendingName();
      } finally {
        onClose();
      }
    })();
  }, [flushPendingName, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (previewPhotoIndex !== null) {
        if (e.key === 'Escape') {
          setPreviewPhotoIndex(null);
          return;
        }
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          setPreviewPhotoIndex((i) => (i === null ? i : Math.max(0, i - 1)));
          return;
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          setPreviewPhotoIndex((i) =>
            i === null ? i : Math.min(photos.length - 1, i + 1)
          );
          return;
        }
        return;
      }
      if (e.key !== 'Escape') return;
      if (dealOpen) {
        setDealOpen(false);
        return;
      }
      handleClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleClose, previewPhotoIndex, dealOpen, photos.length]);

  const commitMoneyField = (
    raw: string,
    field: 'buyPrice' | 'sellPrice' | 'storePrice',
    setText: (v: string) => void
  ) => {
    if (raw.trim() === '') {
      if (field === 'buyPrice') {
        setText('');
        void persistPatch({ buyPrice: 0 });
        return;
      }
      setText('');
      void persistPatch({ [field]: undefined });
      return;
    }
    const n = parseLocaleNumber(raw);
    if (!Number.isFinite(n)) return;
    setText(String(n));
    void persistPatch({ [field]: n });
  };

  const handleReceiptUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('read failed'));
        reader.readAsDataURL(file);
      });
      if (!dataUrl) throw new Error('empty');
      setHasReceipt(true);
      setReceiptUrl(dataUrl);
      await persistPatch({ hasReceipt: true, receiptUrl: dataUrl });
    } catch {
      setError('Could not attach receipt.');
    } finally {
      e.target.value = '';
    }
  };

  const handleGenerateItemTitle = async () => {
    if (!name.trim()) {
      setError('Enter an item name first.');
      return;
    }
    setGeneratingTitle(true);
    setError(null);
    try {
      const categoryContext = `${category || 'Unknown'}${subCategory ? ` / ${subCategory}` : ''}`;
      const knownKeys = resolveEssentialSpecKeys(category || '', subCategory, categoryFields);
      const result = await generateItemSpecs(name.trim(), categoryContext, knownKeys);
      const nv = pickSpecsAiNameVendorUpdates(result, { applyStandardizedName: true });
      if (!nv.name) {
        setError('AI did not return a cleaned title. Try a clearer part number or model name.');
        return;
      }
      setName(nv.name);
      const patch: Partial<InventoryItem> = { name: nv.name };
      if (nv.vendor) {
        setVendor(nv.vendor);
        patch.vendor = nv.vendor;
      }
      await persistPatch(patch);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Title generation failed');
    } finally {
      setGeneratingTitle(false);
    }
  };

  const handleParseSpecs = async () => {
    if (!name.trim()) {
      setError('Enter an item name first.');
      return;
    }
    setParsingSpecs(true);
    setError(null);
    try {
      const categoryContext = `${category || 'Unknown'}${subCategory ? ` / ${subCategory}` : ''}`;
      const knownKeys = resolveEssentialSpecKeys(category || '', subCategory, categoryFields);
      const result = await generateItemSpecs(name.trim(), categoryContext, knownKeys);
      const newSpecs = mergeAiSpecsIntoEssential(
        specs,
        result.specs,
        category || '',
        subCategory,
        categoryFields
      );
      setSpecs(newSpecs);
      // Specs parse must not rename — only the Item name "AI title" button may.
      const nv = pickSpecsAiNameVendorUpdates(result);
      const patch: Partial<InventoryItem> = {
        specs: newSpecs,
        specsAiSuggested: Object.keys(newSpecs).length ? { ...newSpecs } : undefined,
        ...nv,
      };
      if (nv.vendor) setVendor(nv.vendor);
      await persistPatch(patch);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Spec parse failed');
    } finally {
      setParsingSpecs(false);
    }
  };

  const handleGenerateListing = async () => {
    setGenListing(true);
    setError(null);
    try {
      const gate = listingAccessoriesReady(workingItem, containerChildren);
      if (!gate.ok) {
        throw new Error(gate.reason || 'Confirm OVP / IO Blende first.');
      }
      const result = await generateMarketplaceListing(workingItem, {
        hasOVP: listingAccessories.hasOVP,
        hasIOShield: listingAccessories.hasIOShield,
        hasReceipt: listingAccessories.hasReceipt || undefined,
        aiDescriptionNote: aiDescriptionNote.trim() || undefined,
        children: containerChildren,
      });
      setTitle(result.ebayTitle);
      setDescription(result.listingText);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Listing generation failed');
    } finally {
      setGenListing(false);
    }
  };

  const handleApplyListing = async () => {
    setSaving(true);
    setError(null);
    const marketTitle = title.trim().slice(0, 80);
    const marketDescription = description.trim();
    if (!marketDescription && !marketTitle) {
      setError('Generate a listing (or paste title/description) before applying.');
      setSaving(false);
      return;
    }
    try {
      await persistPatch({
        name: name.trim() || item.name,
        specs,
        ...(marketTitle ? { marketTitle } : {}),
        ...(marketDescription ? { marketDescription, storeDescription: marketDescription } : {}),
        aiDescriptionNote: aiDescriptionNote.trim(),
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleRemovePhoto = async (url: string) => {
    const next = normalizeImageList(photos.filter((u) => u !== url));
    setError(null);
    try {
      await persistPatch({
        imageUrl: next[0] || '',
        imageUrls: next,
      });
      setPreviewPhotoIndex((idx) => {
        if (idx === null) return null;
        if (!next.length) return null;
        const wasUrl = photos[idx];
        const moved = next.indexOf(wasUrl);
        if (moved >= 0) return moved;
        return Math.min(idx, next.length - 1);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove photo');
    }
  };

  const handleSetPhotoMain = async (url: string) => {
    const next = normalizeImageList([url, ...photos.filter((u) => u !== url)]);
    setError(null);
    try {
      await persistPatch({
        imageUrl: next[0] || '',
        imageUrls: next,
      });
      setPreviewPhotoIndex(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not set main photo');
    }
  };

  const handleReorderPhotos = async (nextUrls: string[]) => {
    const next = normalizeImageList(nextUrls);
    setError(null);
    try {
      await persistPatch({
        imageUrl: next[0] || '',
        imageUrls: next,
      });
      setPreviewPhotoIndex((idx) => {
        if (idx == null || !photos[idx]) return idx;
        const moved = next.indexOf(photos[idx]!);
        return moved >= 0 ? moved : Math.min(idx, Math.max(0, next.length - 1));
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reorder photos');
    }
  };

  const handleGenerateCards = (count: 1 | 2 | 3) => {
    const n = Math.max(1, Math.min(3, Math.floor(count))) as 1 | 2 | 3;
    if (isItemProductCardJobActive(item.id)) {
      setError('Cards already generating for this item. Keep this browser tab open until done.');
      return;
    }
    setError(null);
    setGenCards(true);
    setCardProgress(`GEN${n} · queued…`);
    enqueueProductCardBackgroundJob(
      { ...workingItem, name: name.trim() || item.name },
      {
        categoryFields: cardFields,
        styleId,
        provider,
        photos: photos.slice(0, 3),
        count: n,
        inventoryItems: allItems || [],
      }
    );
  };

  // Studio GEN runs in a module-level queue so closing/switching Asset details
  // doesn't kill the loop. iOS may still pause the tab if you leave Safari.
  useEffect(() => {
    let sawActive = false;
    return subscribeProductCardBackgroundJobs((list) => {
      const active = list.find(
        (j) => j.itemId === item.id && (j.status === 'queued' || j.status === 'running')
      );
      if (active) {
        sawActive = true;
        setGenCards(true);
        setCardProgress(active.progress || 'Generating…');
        return;
      }
      if (!sawActive) {
        // Don't clear UI on first subscribe when nothing is running.
        if (isItemProductCardJobActive(item.id)) return;
        return;
      }
      const finished = list.find(
        (j) => j.itemId === item.id && (j.status === 'done' || j.status === 'error')
      );
      setGenCards(false);
      setCardProgress(null);
      if (finished) {
        void reloadGallery();
        if (finished.error) {
          setError(
            finished.cardsSaved > 0
              ? `Saved ${finished.cardsSaved}/${finished.plannedCards}. ${finished.error}`
              : finished.error
          );
        }
      }
    });
  }, [item.id, reloadGallery]);

  const handleRemoveCard = async (id: string) => {
    if (!window.confirm('Remove this generated card from the gallery?')) return;
    await removeProductCardFromGallery(id);
    setGallery((prev) => prev.filter((e) => e.id !== id));
    setThumbs((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (selectedCardId === id) setSelectedCardId(null);
  };

  const handleSetMainPhoto = async (entry: GeneratedProductCardEntry) => {
    setSaving(true);
    setError(null);
    try {
      const url = thumbs[entry.id] || (await resolveProductCardImageUrl(entry));
      const prepared = await resolveUrlForInventoryMainPhoto(url, item.id, entry);
      const merged = normalizeImageList([prepared, ...getItemUserPhotoUrls(item)]);
      await persistPatch({ imageUrl: merged[0] || prepared, imageUrls: merged });
      setSelectedOnItem((prev) => ({ ...prev, [entry.id]: prepared }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not set main photo');
    } finally {
      setSaving(false);
    }
  };

  /** Toggle: selected cards are used on the item; others stay only in the card gallery. */
  const toggleCardOnItem = async (entry: GeneratedProductCardEntry) => {
    setBusyCardId(entry.id);
    setError(null);
    setSelectedCardId(entry.id);
    try {
      const already = selectedOnItem[entry.id];
      if (already) {
        const next = normalizeImageList(photos.filter((u) => u !== already));
        await persistPatch({ imageUrl: next[0] || '', imageUrls: next });
        setSelectedOnItem((prev) => {
          const n = { ...prev };
          delete n[entry.id];
          return n;
        });
        return;
      }
      const url = thumbs[entry.id] || (await resolveProductCardImageUrl(entry));
      const prepared = await resolveUrlForInventoryMainPhoto(url, item.id, entry);
      const merged = normalizeImageList([...getItemUserPhotoUrls(item), prepared]);
      await persistPatch({ imageUrl: merged[0] || '', imageUrls: merged });
      setSelectedOnItem((prev) => ({ ...prev, [entry.id]: prepared }));
      if (!thumbs[entry.id]) setThumbs((prev) => ({ ...prev, [entry.id]: url }));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update item photos');
    } finally {
      setBusyCardId(null);
    }
  };

  const runPhotoImport = async (files: File[], emptyMessage: string) => {
    if (!files.length) return;
    const list = files.slice(0, 6);
    const fileErrors: string[] = [];
    setError(null);
    setPhotoUpload({
      done: 0,
      total: list.length,
      fileName: list[0]?.name,
      phase: 'start',
    });
    try {
      const urls = await filesToDataUrls(list, {
        itemId: item.id,
        onProgress: (done, total, info) => {
          setPhotoUpload({
            done,
            total,
            fileName: info?.fileName,
            phase: info?.phase,
          });
        },
        onFileError: (fileName, message) => {
          fileErrors.push(`${fileName}: ${message}`);
        },
      });
      const merged = normalizeImageList([...photos, ...urls]);
      await persistPatch({ imageUrl: merged[0] || '', imageUrls: merged });
      if (fileErrors.length) {
        setError(
          `Uploaded ${urls.length} of ${list.length}. Failed:\n${fileErrors.join('\n')}`
        );
      }
    } catch (e) {
      const { localImageReadErrorMessage } = await import('../utils/localImageFile');
      setError(localImageReadErrorMessage(e, emptyMessage));
    } finally {
      setPhotoUpload(null);
      if (fileRef.current) fileRef.current.value = '';
      if (cameraRef.current) cameraRef.current.value = '';
    }
  };

  const handleAddPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    await runPhotoImport(Array.from(files), 'Photo import failed');
  };

  const mergeRemotePhotoUrls = useCallback(
    async (urls: string[]) => {
      if (!urls.length) return;
      const list = urls.slice(0, 12);
      setError(null);
      setPhotoUpload({ done: 0, total: list.length, fileName: 'iPhone photo', phase: 'start' });
      try {
        const prepared = await prepareInventoryImagesForStorage(list, {
          itemId: item.id,
          onProgress: (done, total) => {
            setPhotoUpload({
              done,
              total,
              fileName: `Photo ${Math.min(done + 1, total)}`,
              phase: done >= total ? 'done' : 'start',
            });
          },
        });
        const merged = normalizeImageList([...photos, ...prepared]);
        await persistPatch({ imageUrl: merged[0] || '', imageUrls: merged });
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not attach iPhone photos');
        return false;
      } finally {
        setPhotoUpload(null);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [item.id, photos, onUpdateItem]
  );

  const handleFolderFiles = async (files: File[]) => {
    if (!files.length) return;
    await runPhotoImport(files, 'Folder photo import failed');
  };

  const handleFindWebPhotos = async () => {
    const q = (name || item.name || '').trim();
    if (!q) {
      setPhotoSearchError('Enter an item name first.');
      return;
    }
    setPhotoSearching(true);
    setPhotoSearchError(null);
    setPhotoSearchResults(null);
    setEbayPhotoMatches(null);
    setEbayPhotoError(null);
    try {
      const results = await searchProductPhotos(q, 8);
      if (!results.length) {
        setPhotoSearchError('No stock photos found for that name.');
        return;
      }
      setPhotoSearchResults(results);
    } catch (e) {
      setPhotoSearchError(e instanceof Error ? e.message : 'Photo search failed.');
    } finally {
      setPhotoSearching(false);
    }
  };

  const handleFindEbayPhotos = async () => {
    const q = (name || item.name || '').trim();
    if (!q) {
      setEbayPhotoError('Enter an item name first.');
      return;
    }
    setEbayPhotoLoading(true);
    setEbayPhotoError(null);
    setEbayPhotoMatches(null);
    setPhotoSearchResults(null);
    setPhotoSearchError(null);
    try {
      const { listings: all } = await ensureEbayListings();
      if (!all.length) {
        setEbayPhotoError(`No active eBay listings for ${getEbayUsername()}.`);
        return;
      }
      const matches = matchEbayListingsForItem(q, all, item.ebaySku);
      if (!matches.length) {
        setEbayPhotoError(`No listings matched “${q}” (${all.length} active).`);
        return;
      }
      setEbayPhotoMatches(matches);
    } catch (e) {
      setEbayPhotoError(e instanceof Error ? e.message : 'Failed to load eBay listings.');
    } finally {
      setEbayPhotoLoading(false);
    }
  };

  const importEbayListingPhotos = async (listing: EbayMyListing & { matchScore: number }) => {
    if (!listing.imageUrls.length) return;
    setEbayImportingId(listing.listingId);
    try {
      await mergeRemotePhotoUrls(listing.imageUrls);
      await persistPatch({
        listedOnEbay: true,
        ebayListingId: listing.listingId,
        ...(listing.sku ? { ebaySku: listing.sku } : {}),
      });
      setEbayPhotoMatches(null);
    } catch (e) {
      setEbayPhotoError(e instanceof Error ? e.message : 'Could not import eBay photos.');
    } finally {
      setEbayImportingId(null);
    }
  };

  const updateSpecValue = (key: string, value: string) => {
    setSpecs((prev) => ({ ...prev, [key]: value }));
  };

  const commitSpecValue = (key: string, value: string) => {
    setSpecs((prev) => {
      const next = { ...prev, [key]: value };
      void persistPatch({ specs: next });
      return next;
    });
  };

  const renameSpecKey = (oldKey: string, rawNewKey: string) => {
    const newKey = rawNewKey.trim();
    if (!newKey || newKey === oldKey) return;
    setSpecs((prev) => {
      if (Object.prototype.hasOwnProperty.call(prev, newKey)) {
        // Keep both values — don't overwrite an existing key silently.
        return prev;
      }
      const next: Record<string, string | number> = {};
      for (const [k, v] of Object.entries(prev)) {
        next[k === oldKey ? newKey : k] = v;
      }
      void persistPatch({ specs: next });
      return next;
    });
  };

  const removeSpecKey = (key: string) => {
    setSpecs((prev) => {
      const next = { ...prev };
      delete next[key];
      void persistPatch({ specs: next });
      return next;
    });
  };

  const addSpecRow = () => {
    setSpecs((prev) => {
      let n = 1;
      let key = 'Custom spec';
      while (Object.prototype.hasOwnProperty.call(prev, key)) {
        n += 1;
        key = `Custom spec ${n}`;
      }
      const next = { ...prev, [key]: '' };
      void persistPatch({ specs: next });
      return next;
    });
  };

  const titleLen = [...title].length;
  const plannedCards = resolveCardBatchCount(photos.length);

  const providerList =
    providers.length > 0
      ? providers
      : [
          { id: 'openai' as const, name: 'OpenAI', available: true, blurb: 'GPT Image' },
          { id: 'gemini' as const, name: 'Gemini', available: true, blurb: 'Flash Image' },
        ];

  return createPortal(
    <div
      className="fixed inset-0 z-[230] flex items-stretch sm:items-center justify-center bg-slate-900/55 backdrop-blur-sm sm:p-3"
      onClick={handleClose}
    >
      <div
        className="relative bg-white w-full sm:max-w-[1360px] h-[100dvh] sm:h-[min(96vh,860px)] sm:rounded-2xl shadow-2xl border-0 sm:border border-slate-200 overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-3 py-2 border-b border-slate-100 flex items-center justify-between gap-2 bg-white shrink-0 pt-[max(0.5rem,env(safe-area-inset-top))]">
          <div className="min-w-0">
            <h3 className="text-sm font-black text-slate-900 flex items-center gap-1.5">
              <Sparkles size={14} className="text-slate-700" /> Listing Studio
            </h3>
            <p className="hidden sm:block text-[11px] text-slate-500 font-medium truncate">
              Item · Photos · Specs · Listing
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {headerExtra}
            <button
              type="button"
              onClick={handleClose}
              className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        </header>

        <div className="hidden lg:flex shrink-0 flex-wrap items-center gap-1.5 px-3 py-2 border-b border-slate-100 bg-white">
          <button
            type="button"
            disabled={parsingSpecs}
            onClick={() => void handleParseSpecs()}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-800 text-[9px] font-black uppercase disabled:opacity-50"
          >
            {parsingSpecs ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
            Parse AI
          </button>
          <button
            type="button"
            disabled={generatingTitle || parsingSpecs}
            onClick={() => void handleGenerateItemTitle()}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-[9px] font-black uppercase disabled:opacity-50"
          >
            {generatingTitle ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
            AI title
          </button>
          {genCards ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-[9px] font-black uppercase">
              <Loader2 size={11} className="animate-spin" />
              {cardProgress || '…'}
            </span>
          ) : (
            ([1, 2, 3] as const).map((n) => (
              <button
                key={n}
                type="button"
                disabled={genCards}
                onClick={() => handleGenerateCards(n)}
                className={`inline-flex items-center justify-center min-w-[2.4rem] px-2 py-1.5 rounded-lg text-[9px] font-black uppercase disabled:opacity-50 ${
                  n === plannedCards
                    ? 'bg-slate-900 text-white'
                    : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
                }`}
              >
                GEN{n}
              </button>
            ))
          )}
          <button
            type="button"
            disabled={genListing || saving}
            onClick={() => void handleGenerateListing()}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-[9px] font-black uppercase disabled:opacity-50"
          >
            {genListing ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
            Generate listing
          </button>
          <button
            type="button"
            disabled={saving || genListing}
            onClick={() => void handleApplyListing()}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-800 text-[9px] font-black uppercase disabled:opacity-50"
          >
            {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
            Apply
          </button>
          <button
            type="button"
            onClick={() => setDealOpen(true)}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[9px] font-black uppercase ${
              dealOpen
                ? 'bg-slate-900 text-white'
                : 'border border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            Deal / proof
          </button>
        </div>

        <nav className="lg:hidden shrink-0 flex border-b border-slate-200 bg-white">
          {(
            [
              { id: 'item' as const, label: 'Item' },
              { id: 'photos' as const, label: 'Photos' },
              { id: 'specs' as const, label: 'Specs' },
              { id: 'listing' as const, label: 'Listing' },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setMobileQuad(tab.id)}
              className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest ${
                mobileQuad === tab.id
                  ? 'text-slate-900 bg-slate-50'
                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div
          ref={studioScrollRef}
          className="flex-1 min-h-0 overflow-y-auto bg-slate-50/50 lg:grid lg:grid-cols-2 lg:items-start"
        >
          <div className="lg:border-r lg:border-slate-100">
          {/* ITEM */}
          <aside
            id="studio-item"
            className={`flex-col border-b border-slate-100 p-2.5 ${
              mobileQuad === 'item' ? 'flex' : 'hidden'
            } lg:flex`}
          >
            {/* Where this deal came from — one click to the chat / order / profile. */}
            {itemSourceLinks.list.length > 0 && (
              <section className="flex flex-wrap items-center gap-1.5">
                <h4 className={ADD_FLOW_LABEL}>Source</h4>
                <SourceLinkIcons links={itemSourceLinks} />
                {itemSourceLinks.externalOrderId && (
                  <span className="text-[10px] font-bold text-slate-400">
                    #{itemSourceLinks.externalOrderId}
                  </span>
                )}
              </section>
            )}

            <section className={`${ADD_FLOW_PANEL} p-2.5 space-y-2 shrink-0`}>
              <div className="flex items-center justify-between mb-0.5 gap-2">
                <h4 className={ADD_FLOW_LABEL}>Item</h4>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    disabled={!name.trim()}
                    onClick={() => void copyText('name', name)}
                    className="inline-flex items-center justify-center p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40"
                    title="Copy item name"
                    aria-label="Copy item name"
                  >
                    {copied === 'name' ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                  <button
                    type="button"
                    className="lg:hidden inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-900 text-white text-[9px] font-black uppercase disabled:opacity-50"
                    disabled={generatingTitle || parsingSpecs}
                    onClick={() => void handleGenerateItemTitle()}
                  >
                    {generatingTitle ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                    AI title
                  </button>
                </div>
              </div>
              <input
                className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:border-slate-400 focus:bg-white"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={(e) => {
                  const nextName = e.currentTarget.value.trim() || item.name;
                  setName(nextName);
                  void persistPatch({ name: nextName });
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    (e.target as HTMLInputElement).blur();
                  }
                }}
              />
              <div className="flex items-center gap-1.5">
                <ItemAccessoryToggles
                  item={workingItem}
                  children={containerChildren}
                  mini
                  onPatch={(patch) => void persistPatch(patch)}
                />
              </div>
            </section>

            <div className={`${ADD_FLOW_PANEL} p-2.5 space-y-1.5`}>
              <div className="grid grid-cols-3 gap-1.5 text-[11px]">
                <label className="block space-y-0.5">
                  <span className="text-[9px] font-black uppercase text-slate-400">Buy €</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="w-full px-2 py-1.5 rounded-lg bg-white border border-slate-200 font-bold text-slate-900 outline-none focus:border-rose-400"
                    value={buyPriceText}
                    placeholder="0"
                    onChange={(e) => setBuyPriceText(e.target.value)}
                    onBlur={() => commitMoneyField(buyPriceText, 'buyPrice', setBuyPriceText)}
                  />
                </label>
                <label className="block space-y-0.5">
                  <span className="text-[9px] font-black uppercase text-slate-400">Sold €</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="w-full px-2 py-1.5 rounded-lg bg-white border border-slate-200 font-bold text-slate-900 outline-none focus:border-rose-400"
                    value={sellPriceText}
                    placeholder="—"
                    onChange={(e) => setSellPriceText(e.target.value)}
                    onBlur={() => commitMoneyField(sellPriceText, 'sellPrice', setSellPriceText)}
                  />
                </label>
                <label className="block space-y-0.5">
                  <span className="text-[9px] font-black uppercase text-slate-400">Store €</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="w-full px-2 py-1.5 rounded-lg bg-white border border-slate-200 font-bold text-slate-900 outline-none focus:border-rose-400"
                    value={storePriceText}
                    placeholder="—"
                    onChange={(e) => setStorePriceText(e.target.value)}
                    onBlur={() => commitMoneyField(storePriceText, 'storePrice', setStorePriceText)}
                  />
                </label>
              </div>
              <div className="grid grid-cols-3 gap-1.5 text-[11px]">
                <label className="block space-y-0.5">
                  <span className="text-[9px] font-black uppercase text-slate-400">Buy date</span>
                  <input
                    type="date"
                    className="w-full px-2 py-1.5 rounded-lg bg-white border border-slate-200 font-semibold text-slate-900 outline-none"
                    value={buyDate}
                    onChange={(e) => {
                      setBuyDate(e.target.value);
                      void persistPatch({ buyDate: e.target.value });
                    }}
                  />
                </label>
                <label className="block space-y-0.5">
                  <span className="text-[9px] font-black uppercase text-slate-400">Sell date</span>
                  <input
                    type="date"
                    className="w-full px-2 py-1.5 rounded-lg bg-white border border-slate-200 font-semibold text-slate-900 outline-none"
                    value={sellDate}
                    onChange={(e) => {
                      setSellDate(e.target.value);
                      void persistPatch({ sellDate: e.target.value || undefined });
                    }}
                  />
                </label>
                <label className="block space-y-0.5">
                  <span className="text-[9px] font-black uppercase text-slate-400">Qty</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    className="w-full px-2 py-1.5 rounded-lg bg-white border border-slate-200 font-bold text-slate-900 outline-none focus:border-rose-400"
                    value={quantityText}
                    placeholder="1"
                    onChange={(e) => setQuantityText(e.target.value)}
                    onBlur={() => {
                      if (quantityText.trim() === '') {
                        setQuantityText('');
                        void persistPatch({ quantity: undefined });
                        return;
                      }
                      const n = Math.max(1, Math.floor(Number(quantityText)));
                      if (!Number.isFinite(n)) return;
                      setQuantityText(String(n));
                      void persistPatch({ quantity: n });
                    }}
                  />
                </label>
              </div>
              <CostOriginPanel item={item} allItems={allItems} />
              <div className="flex flex-wrap items-center gap-3 pt-0.5">
                <label className="inline-flex items-center gap-1.5 text-[10px] font-bold text-slate-600">
                  <input
                    type="checkbox"
                    checked={isDefective}
                    onChange={(e) => {
                      setIsDefective(e.target.checked);
                      void persistPatch({ isDefective: e.target.checked || undefined });
                    }}
                    className="rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                  />
                  Defective
                </label>
                <label className="inline-flex items-center gap-1.5 text-[10px] font-bold text-slate-600">
                  <input
                    type="checkbox"
                    checked={usesDifferentialVat}
                    onChange={(e) => {
                      setUsesDifferentialVat(e.target.checked);
                      void persistPatch({ usesDifferentialVat: e.target.checked || undefined });
                    }}
                    className="rounded border-slate-300 text-rose-600 focus:ring-rose-500"
                  />
                  Diff. VAT
                </label>
                <button
                  type="button"
                  onClick={() => setDealOpen(true)}
                  className="ml-auto text-[9px] font-black uppercase tracking-wider text-slate-600 hover:text-slate-900"
                >
                  Deal / proof
                </button>
              </div>
            </div>
          </aside>

          <section
            id="studio-specs"
            className={`flex-col p-2.5 ${
              mobileQuad === 'specs' ? 'flex' : 'hidden'
            } lg:flex`}
          >
            <div className={`${ADD_FLOW_PANEL} p-2.5 space-y-1.5`}>
            <section className="shrink-0">
              <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">
                Specs
              </h4>
              <div className="flex flex-wrap gap-1 mb-2">
                {cardSpecChips.length ? (
                  cardSpecChips.map((s) => (
                    <span
                      key={s.label}
                      className="px-1.5 py-0.5 rounded-md bg-teal-50 text-teal-900 border border-teal-100 text-[10px] font-bold"
                    >
                      {s.label}: {s.value}
                    </span>
                  ))
                ) : (
                  <span className="text-[10px] text-slate-400">Parse specs to fill card callouts</span>
                )}
              </div>
            </section>

            <section>
              <div className="flex items-center justify-between mb-1 gap-2 shrink-0">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Tech specs
                </h4>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={addSpecRow}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 bg-white text-slate-700 text-[9px] font-black uppercase hover:bg-slate-50"
                    title="Add a custom spec row"
                  >
                    <Plus size={11} />
                    Add
                  </button>
                  <button
                    type="button"
                    disabled={parsingSpecs}
                    onClick={() => void handleParseSpecs()}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 bg-slate-50 text-slate-800 text-[9px] font-black uppercase disabled:opacity-50"
                    title="Fill tech specs only — does not change the item title"
                  >
                    {parsingSpecs ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                    Parse AI
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1 content-start pr-0.5">
                {Object.keys(specs).length === 0 && (
                  <p className="col-span-2 text-[10px] text-slate-400 font-medium py-2">
                    No specs yet — run Parse AI or add your own.
                  </p>
                )}
                {Object.entries(specs).map(([key, value]) => (
                  <div
                    key={key}
                    className="min-w-0 flex items-center gap-1 rounded-lg bg-white border border-slate-200 px-1.5 py-1"
                  >
                    <input
                      className="w-[42%] min-w-0 text-[10px] font-bold text-slate-500 outline-none bg-transparent truncate"
                      defaultValue={key}
                      title="Spec name (editable)"
                      onBlur={(e) => renameSpecKey(key, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.currentTarget.blur();
                        }
                      }}
                    />
                    <input
                      className="flex-1 min-w-0 text-[11px] font-semibold text-slate-900 outline-none bg-transparent"
                      value={String(value ?? '')}
                      title="Spec value (editable)"
                      onChange={(e) => updateSpecValue(key, e.target.value)}
                      onBlur={(e) => commitSpecValue(key, e.target.value)}
                    />
                    <button
                      type="button"
                      className="p-0.5 text-slate-300 hover:text-rose-500 shrink-0"
                      onClick={() => removeSpecKey(key)}
                      title="Remove spec"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">
                Details
              </h4>
              <div className="space-y-1.5 text-[11px]">
                <div className="grid grid-cols-2 gap-1.5">
                  <label className="block space-y-0.5">
                    <span className="text-[9px] font-black uppercase text-slate-400">Category</span>
                    <select
                      className="w-full px-2 py-1.5 rounded-lg bg-white border border-slate-200 font-semibold text-slate-900 outline-none"
                      value={category}
                      onChange={(e) => {
                        const next = e.target.value;
                        const nextSubs = categories[next] || [];
                        const nextSub = nextSubs.includes(subCategory) ? subCategory : nextSubs[0] || '';
                        setCategory(next);
                        setSubCategory(nextSub);
                        void persistPatch({
                          category: next,
                          subCategory: nextSub || undefined,
                        });
                      }}
                    >
                      {categoryOptions.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block space-y-0.5">
                    <span className="text-[9px] font-black uppercase text-slate-400">Subcategory</span>
                    <select
                      className="w-full px-2 py-1.5 rounded-lg bg-white border border-slate-200 font-semibold text-slate-900 outline-none disabled:opacity-50"
                      value={subCategory}
                      disabled={!subCategoryOptions.length}
                      onChange={(e) => {
                        const next = e.target.value;
                        setSubCategory(next);
                        void persistPatch({ subCategory: next || undefined });
                      }}
                    >
                      {!subCategoryOptions.length && <option value="">—</option>}
                      {subCategoryOptions.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="block space-y-0.5">
                  <span className="text-[9px] font-black uppercase text-slate-400">Notes / condition</span>
                  <textarea
                    className="w-full px-2 py-1.5 rounded-lg bg-white border border-slate-200 font-semibold text-slate-900 outline-none focus:border-rose-400 min-h-[40px] resize-none"
                    value={notes}
                    placeholder="Condition, defects, accessories…"
                    onChange={(e) => setNotes(e.target.value)}
                    onBlur={() => void persistPatch({ comment1: notes.trim() || undefined })}
                  />
                </label>
              </div>
            </section>
            </div>
          </section>
          </div>

          {dealOpen && (
            <div
              className="absolute inset-0 z-[15] flex items-end sm:items-center justify-center bg-slate-900/40 p-3"
              onClick={() => setDealOpen(false)}
            >
              <div
                className="bg-white w-full sm:max-w-xl max-h-[85%] overflow-y-auto rounded-2xl border border-slate-200 p-3 space-y-3"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-sm font-black text-slate-900">Deal / proof</h4>
                  <button
                    type="button"
                    onClick={() => setDealOpen(false)}
                    className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"
                    aria-label="Close deal"
                  >
                    <X size={16} />
                  </button>
                </div>
                <CostOriginPanel item={item} allItems={allItems} />
                <ProofAttachmentsPanel
                  recordId={item.id}
                  attachments={item.proofAttachments}
                  record={item as unknown as Record<string, unknown>}
                  onChange={(next) => void onUpdateItem({ proofAttachments: next })}
                />
                <div className="grid grid-cols-1 gap-1.5 pt-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[9px] font-black uppercase text-slate-400">Receipt</span>
                    <label className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white border border-slate-200 text-[9px] font-black uppercase text-slate-600 cursor-pointer hover:bg-slate-50">
                      <Upload size={11} />
                      {hasReceipt ? 'Replace' : 'Attach'}
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        className="hidden"
                        onChange={(e) => void handleReceiptUpload(e)}
                      />
                    </label>
                    {hasReceipt && (
                      <>
                        {receiptUrl && (
                          <a
                            href={receiptUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[9px] font-bold text-sky-700 hover:underline"
                          >
                            Open
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setHasReceipt(false);
                            setReceiptUrl('');
                            void persistPatch({ hasReceipt: false, receiptUrl: undefined });
                          }}
                          className="text-[9px] font-bold text-rose-600 hover:underline"
                        >
                          Remove
                        </button>
                      </>
                    )}
                  </div>
                  <label className="block space-y-0.5">
                    <span className="text-[9px] font-black uppercase text-slate-400">
                      Add into PC / Bundle
                    </span>
                    <select
                      className="w-full px-2 py-1.5 rounded-lg bg-white border border-slate-200 font-semibold text-slate-900 outline-none"
                      value={parentContainerId}
                      onChange={(e) => {
                        const v = e.target.value;
                        setParentContainerId(v);
                        if (v) {
                          setStatus(ItemStatus.IN_COMPOSITION);
                          void persistPatch({
                            parentContainerId: v,
                            status: ItemStatus.IN_COMPOSITION,
                          });
                        } else {
                          const nextStatus =
                            status === ItemStatus.IN_COMPOSITION ? ItemStatus.IN_STOCK : status;
                          setStatus(nextStatus);
                          void persistPatch({
                            parentContainerId: undefined,
                            status: nextStatus,
                          });
                        }
                      }}
                    >
                      <option value="">— Not linked —</option>
                      {openContainers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.isPC ? 'PC' : 'Bundle'}: {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

            <section>
              <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">
                Buyer / seller
              </h4>
              <div className="space-y-1.5 text-[11px]">
                <label className="block space-y-0.5">
                  <span className="text-[9px] font-black uppercase text-slate-400">Vendor / seller</span>
                  <input
                    className="w-full px-2 py-1.5 rounded-lg bg-white border border-slate-200 font-semibold text-slate-900 outline-none focus:border-rose-400"
                    value={vendor}
                    placeholder="Shop or username you bought from"
                    onChange={(e) => setVendor(e.target.value)}
                    onBlur={() => void persistPatch({ vendor: vendor.trim() || undefined })}
                  />
                </label>

                <div className="grid grid-cols-2 gap-1.5">
                  <label className="block space-y-0.5">
                    <span className="text-[9px] font-black uppercase text-slate-400">Bought on</span>
                    <select
                      className="w-full px-2 py-1.5 rounded-lg bg-white border border-slate-200 font-semibold text-slate-900 outline-none"
                      value={platformBought}
                      onChange={(e) => {
                        const next = e.target.value as Platform;
                        const nextPay = paymentAfterPlatformChange(next, buyPaymentType);
                        setPlatformBought(next);
                        setBuyPaymentType(nextPay || defaultBuyPaymentForPlatform(next));
                        void persistPatch({
                          platformBought: next,
                          buyPaymentType: nextPay || defaultBuyPaymentForPlatform(next),
                        });
                      }}
                    >
                      {BUY_PLATFORMS.map((p) => (
                        <option key={p} value={p}>
                          {PLATFORM_OPTION_LABEL[p]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block space-y-0.5">
                    <span className="text-[9px] font-black uppercase text-slate-400">Buy payment</span>
                    <select
                      className="w-full px-2 py-1.5 rounded-lg bg-white border border-slate-200 font-semibold text-slate-900 outline-none"
                      value={buyPaymentType}
                      onChange={(e) => {
                        const next = normalizeBuyPaymentForPlatform(
                          platformBought,
                          e.target.value as PaymentType
                        ) as PaymentType;
                        setBuyPaymentType(next);
                        void persistPatch({ buyPaymentType: next });
                      }}
                    >
                      {PAYMENT_METHODS.map((p) => (
                        <option key={p} value={p}>
                          {p}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="pt-1 border-t border-slate-200/80">
                  <KleinanzeigenBuyChatProofFields
                    compact
                    itemId={item.id}
                    chatUrl={buyChatUrl}
                    chatImage={buyChatImage}
                    sellerProfileUrl={sellerProfileUrl}
                    onChatUrlChange={setBuyChatUrl}
                    onChatImageChange={setBuyChatImage}
                    onSellerProfileUrlChange={setSellerProfileUrl}
                    onPersist={async (patch) => {
                      await persistPatch(patch);
                    }}
                  />
                </div>

                <div className="pt-1 border-t border-slate-200/80 space-y-1.5">
                  <p className="text-[9px] font-black uppercase text-slate-400">Sale / buyer</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    <label className="block space-y-0.5">
                      <span className="text-[9px] font-black uppercase text-slate-400">Sold on</span>
                      <select
                        className="w-full px-2 py-1.5 rounded-lg bg-white border border-slate-200 font-semibold text-slate-900 outline-none"
                        value={platformSold}
                        onChange={(e) => {
                          const next = e.target.value as Platform | '';
                          setPlatformSold(next);
                          void persistPatch({
                            platformSold: next || undefined,
                          });
                        }}
                      >
                        <option value="">— not sold</option>
                        {SALE_PLATFORM_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block space-y-0.5">
                      <span className="text-[9px] font-black uppercase text-slate-400">Sale payment</span>
                      <select
                        className="w-full px-2 py-1.5 rounded-lg bg-white border border-slate-200 font-semibold text-slate-900 outline-none"
                        value={paymentType}
                        onChange={(e) => {
                          const next = e.target.value as PaymentType | '';
                          setPaymentType(next);
                          void persistPatch({
                            paymentType: next || undefined,
                          });
                        }}
                      >
                        <option value="">—</option>
                        {PAYMENT_METHODS.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label className="block space-y-0.5">
                    <span className="text-[9px] font-black uppercase text-slate-400">Buyer name</span>
                    <input
                      className="w-full px-2 py-1.5 rounded-lg bg-white border border-slate-200 font-semibold text-slate-900 outline-none focus:border-rose-400"
                      value={buyerName}
                      placeholder="Customer / buyer"
                      onChange={(e) => setBuyerName(e.target.value)}
                      onBlur={() =>
                        void persistPatch({
                          customer: {
                            name: buyerName.trim(),
                            address: buyerAddress.trim(),
                          },
                        })
                      }
                    />
                  </label>
                  <label className="block space-y-0.5">
                    <span className="text-[9px] font-black uppercase text-slate-400">Buyer address</span>
                    <textarea
                      className="w-full px-2 py-1.5 rounded-lg bg-white border border-slate-200 font-semibold text-slate-900 outline-none focus:border-rose-400 min-h-[52px] resize-y"
                      value={buyerAddress}
                      placeholder="Optional shipping / pickup address"
                      onChange={(e) => setBuyerAddress(e.target.value)}
                      onBlur={() =>
                        void persistPatch({
                          customer: {
                            name: buyerName.trim(),
                            address: buyerAddress.trim(),
                          },
                        })
                      }
                    />
                  </label>
                </div>
              </div>
            </section>
              </div>
            </div>
          )}

          <div>
          {/* PHOTOS + CARDS */}
          <section
            id="studio-photos"
            className={`flex-col border-b border-slate-100 p-2.5 space-y-2 ${
              mobileQuad === 'photos' ? 'flex' : 'hidden'
            } lg:flex`}
          >
            {/* 1. Product photos */}
            <div className={`${ADD_FLOW_PANEL} p-2.5 space-y-2 shrink-0`}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <h4 className={ADD_FLOW_LABEL}>Product photos</h4>
                  <p className="text-[10px] text-slate-400 font-semibold mt-0.5">
                    {photos.length === 0
                      ? 'Add photos first — used for GEN'
                      : `${photos.length} photo${photos.length === 1 ? '' : 's'} · hold + drag · first 3 feed cards`}
                  </p>
                </div>
                <div className="flex items-center gap-1 flex-wrap justify-end shrink-0">
                  {nativePhoto ? (
                    <>
                      <button
                        type="button"
                        onClick={() => cameraRef.current?.click()}
                        className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-slate-700 hover:text-slate-900"
                      >
                        <Camera size={11} /> Camera
                      </button>
                      <button
                        type="button"
                        onClick={() => fileRef.current?.click()}
                        className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-slate-600 hover:text-slate-900"
                      >
                        <Upload size={11} /> Library
                      </button>
                      <button
                        type="button"
                        onClick={() => setPhotoSource((s) => (s === 'iphone' ? 'none' : 'iphone'))}
                        className={`inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider ${
                          photoSource === 'iphone' ? 'text-slate-900' : 'text-slate-500 hover:text-slate-800'
                        }`}
                      >
                        <Smartphone size={11} /> Phone
                      </button>
                      <button
                        type="button"
                        disabled={photoSearching || !!photoUpload}
                        onClick={() => void handleFindWebPhotos()}
                        className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-slate-600 hover:text-slate-900 disabled:opacity-50"
                      >
                        {photoSearching ? <Loader2 size={11} className="animate-spin" /> : <Search size={11} />}
                        Web
                      </button>
                      <button
                        type="button"
                        disabled={ebayPhotoLoading || !!photoUpload}
                        onClick={() => void handleFindEbayPhotos()}
                        className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-slate-600 hover:text-slate-900 disabled:opacity-50"
                      >
                        {ebayPhotoLoading ? <Loader2 size={11} className="animate-spin" /> : <ShoppingBag size={11} />}
                        eBay
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setPhotoSource((s) => (s === 'iphone' ? 'none' : 'iphone'))}
                        className={`inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider ${
                          photoSource === 'iphone' ? 'text-slate-900' : 'text-slate-500 hover:text-slate-800'
                        }`}
                      >
                        <Smartphone size={11} /> iPhone
                      </button>
                      <button
                        type="button"
                        onClick={() => setPhotoSource((s) => (s === 'folder' ? 'none' : 'folder'))}
                        className={`inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider ${
                          photoSource === 'folder' ? 'text-slate-900' : 'text-slate-500 hover:text-slate-800'
                        }`}
                      >
                        <FolderOpen size={11} /> Folder
                      </button>
                      <button
                        type="button"
                        disabled={!!photoUpload}
                        onClick={() => fileRef.current?.click()}
                        className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-slate-600 hover:text-slate-900 disabled:opacity-50"
                      >
                        {photoUpload ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
                        {photoUpload ? '…' : 'Add'}
                      </button>
                      <button
                        type="button"
                        disabled={photoSearching || !!photoUpload}
                        onClick={() => void handleFindWebPhotos()}
                        className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-slate-600 hover:text-slate-900 disabled:opacity-50"
                      >
                        {photoSearching ? <Loader2 size={11} className="animate-spin" /> : <Search size={11} />}
                        Web
                      </button>
                      <button
                        type="button"
                        disabled={ebayPhotoLoading || !!photoUpload}
                        onClick={() => void handleFindEbayPhotos()}
                        className="inline-flex items-center gap-1 text-[9px] font-black uppercase tracking-wider text-slate-600 hover:text-slate-900 disabled:opacity-50"
                      >
                        {ebayPhotoLoading ? <Loader2 size={11} className="animate-spin" /> : <ShoppingBag size={11} />}
                        eBay
                      </button>
                    </>
                  )}
                </div>
                <input
                  ref={cameraRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => void handleAddPhotos(e.target.files)}
                />
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => void handleAddPhotos(e.target.files)}
                />
              </div>

              {(photoSearchError || ebayPhotoError) && (
                <p className="text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                  {photoSearchError || ebayPhotoError}
                </p>
              )}

              {photoSearchResults && photoSearchResults.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                      Web · tap to add
                    </p>
                    <button
                      type="button"
                      onClick={() => setPhotoSearchResults(null)}
                      className="text-[9px] font-bold text-slate-400 hover:text-slate-700"
                    >
                      Dismiss
                    </button>
                  </div>
                  <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                    {photoSearchResults.map((r) => (
                      <button
                        key={r.url}
                        type="button"
                        title={r.title}
                        disabled={!!photoUpload}
                        onClick={() => {
                          void mergeRemotePhotoUrls([r.url]).then((ok) => {
                            if (!ok) return;
                            setPhotoSearchResults((prev) =>
                              prev ? prev.filter((x) => x.url !== r.url) : null
                            );
                          });
                        }}
                        className="shrink-0 w-14 h-14 rounded-lg overflow-hidden border border-slate-200 bg-slate-50 hover:border-slate-400 disabled:opacity-50"
                      >
                        <img src={r.thumbnail || r.url} alt="" className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {ebayPhotoMatches && ebayPhotoMatches.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
                      eBay listings
                    </p>
                    <button
                      type="button"
                      onClick={() => setEbayPhotoMatches(null)}
                      className="text-[9px] font-bold text-slate-400 hover:text-slate-700"
                    >
                      Dismiss
                    </button>
                  </div>
                  <div className="space-y-1 max-h-28 overflow-y-auto pr-0.5">
                    {ebayPhotoMatches.map((listing) => (
                      <div
                        key={listing.listingId}
                        className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-1.5 py-1"
                      >
                        {listing.thumbnail ? (
                          <img
                            src={listing.thumbnail}
                            alt=""
                            className="w-9 h-9 rounded-md object-cover shrink-0"
                          />
                        ) : (
                          <div className="w-9 h-9 rounded-md bg-slate-100 shrink-0" />
                        )}
                        <p className="flex-1 min-w-0 text-[10px] font-semibold text-slate-800 truncate">
                          {listing.title}
                        </p>
                        <button
                          type="button"
                          disabled={ebayImportingId === listing.listingId || !listing.imageUrls.length}
                          onClick={() => void importEbayListingPhotos(listing)}
                          className="shrink-0 text-[9px] font-black uppercase text-slate-700 hover:text-slate-900 disabled:opacity-40"
                        >
                          {ebayImportingId === listing.listingId ? '…' : 'Add'}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {photoUpload && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-black uppercase tracking-wide text-slate-700 flex items-center gap-1.5">
                      <Loader2 size={13} className="animate-spin shrink-0" />
                      Uploading {photoUpload.done}/{photoUpload.total}
                    </p>
                    <span className="text-[10px] font-bold text-slate-500 tabular-nums">
                      {photoUpload.total
                        ? Math.round((photoUpload.done / photoUpload.total) * 100)
                        : 0}
                      %
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-slate-800 transition-[width] duration-300 ease-out"
                      style={{
                        width: `${
                          photoUpload.total
                            ? Math.min(
                                100,
                                Math.round(
                                  ((photoUpload.phase === 'start'
                                    ? photoUpload.done + 0.35
                                    : photoUpload.done) /
                                    photoUpload.total) *
                                    100
                                )
                              )
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                </div>
              )}

              {nativePhoto && photos.length === 0 && photoSource === 'none' && (
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => cameraRef.current?.click()}
                    className="flex flex-col items-center justify-center gap-1 h-20 rounded-xl border border-dashed border-slate-300 bg-slate-50 text-slate-700"
                  >
                    <Camera size={18} />
                    <span className="text-[10px] font-black uppercase">Camera</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="flex flex-col items-center justify-center gap-1 h-20 rounded-xl border border-dashed border-slate-300 bg-slate-50 text-slate-600"
                  >
                    <Upload size={18} />
                    <span className="text-[10px] font-black uppercase">Library</span>
                  </button>
                </div>
              )}

              {photoSource === 'iphone' && (
                <PhoneUploadQrPanel
                  itemId={item.id}
                  itemName={name || item.name}
                  onUrls={mergeRemotePhotoUrls}
                  onClose={() => setPhotoSource('none')}
                />
              )}
              {photoSource === 'folder' && !nativePhoto && (
                <LocalPhotoFolderPanel
                  maxSelect={6}
                  onPickFiles={handleFolderFiles}
                  onClose={() => setPhotoSource('none')}
                />
              )}

              {photos.length === 0 && !(nativePhoto && photoSource === 'none') ? (
                <div className="h-16 rounded-xl border border-dashed border-slate-200 flex items-center justify-center text-[10px] font-bold text-slate-400">
                  No photos yet
                </div>
              ) : photos.length === 0 ? null : (
                <ReorderablePhotoThumbs
                  urls={photos}
                  layout="row"
                  onReorder={(next) => void handleReorderPhotos(next)}
                  onOpen={(index) => setPreviewPhotoIndex(index)}
                  trailing={
                    <button
                      type="button"
                      disabled={!!photoUpload}
                      onClick={() => fileRef.current?.click()}
                      className="shrink-0 w-[4.5rem] h-[4.5rem] sm:w-20 sm:h-20 rounded-xl border border-dashed border-slate-300 text-slate-400 font-black hover:border-slate-500 hover:text-slate-700 flex items-center justify-center snap-start disabled:opacity-50"
                      title="Add photos"
                    >
                      {photoUpload ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
                    </button>
                  }
                />
              )}
            </div>

            {/* 2. Card gallery — always mounted so GEN / photos don't shove this block around */}
            <div className={`${ADD_FLOW_PANEL} p-2.5 space-y-2 shrink-0`}>
                <div>
                  <h4 className={ADD_FLOW_LABEL}>Card gallery</h4>
                  <p className="text-[10px] text-slate-400 font-semibold mt-0.5">
                    Tap to use on item photos · unselected stay stored here
                  </p>
                </div>

                {galleryLoading && gallery.length === 0 ? (
                  <div className="h-[4.75rem] flex items-center justify-center text-slate-400">
                    <Loader2 size={18} className="animate-spin" />
                  </div>
                ) : gallery.length === 0 ? (
                  <div className="h-[4.75rem] rounded-xl border border-dashed border-slate-200 flex items-center justify-center text-[11px] text-slate-400 font-medium">
                    Cards land here after generate
                  </div>
                ) : (
                  <div className="flex gap-2 overflow-x-auto pb-0.5">
                    {gallery.map((entry) => {
                      const onItem = Boolean(selectedOnItem[entry.id]);
                      const previewing = entry.id === selectedCardId;
                      const busy = busyCardId === entry.id;
                      return (
                        <div key={entry.id} className="relative shrink-0 w-[4.75rem] space-y-1">
                          <button
                            type="button"
                            disabled={busy || saving}
                            onClick={() => void toggleCardOnItem(entry)}
                            title={
                              onItem
                                ? 'On item — click to remove from photos (keeps gallery)'
                                : 'Click to add this card to item photos'
                            }
                            className={`relative w-[4.75rem] h-[4.75rem] rounded-xl border-2 overflow-hidden bg-slate-50 transition-all ${
                              onItem
                                ? 'border-teal-500 ring-2 ring-teal-200/80'
                                : previewing
                                  ? 'border-slate-400'
                                  : 'border-slate-200 opacity-75 hover:opacity-100'
                            }`}
                          >
                            {thumbs[entry.id] ? (
                              <img src={thumbs[entry.id]} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <span className="absolute inset-0 flex items-center justify-center text-slate-300">
                                <ImageIcon size={16} />
                              </span>
                            )}
                            {onItem && (
                              <span className="absolute top-0.5 right-0.5 w-4 h-4 rounded bg-teal-500 text-white inline-flex items-center justify-center">
                                <Check size={10} strokeWidth={3} />
                              </span>
                            )}
                            {busy && (
                              <span className="absolute inset-0 bg-white/60 flex items-center justify-center">
                                <Loader2 size={12} className="animate-spin" />
                              </span>
                            )}
                          </button>
                          <div className="flex gap-0.5 justify-center">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedCardId(entry.id);
                                void handleSetMainPhoto(entry);
                              }}
                              className="p-1 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50"
                              title="Set as main photo"
                            >
                              <Star size={10} />
                            </button>
                            <button
                              type="button"
                              onClick={() => void downloadProductCardEntry(entry)}
                              className="p-1 rounded-md border border-slate-200 text-slate-500"
                              title={productCardSaveActionLabel()}
                            >
                              <Download size={10} />
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleRemoveCard(entry.id)}
                              className="p-1 rounded-md border border-slate-200 text-slate-500 hover:text-rose-600 hover:border-rose-200"
                              title="Remove from gallery"
                            >
                              <Trash2 size={10} />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
            </div>

            {/* 3. Card generator */}
            <div className={`${ADD_FLOW_PANEL} p-2.5 space-y-1.5 shrink-0`}>
              <div className="flex items-center justify-between gap-2">
                <h4 className={`${ADD_FLOW_LABEL} flex items-center gap-1.5`}>
                  <Sparkles size={11} /> Cards
                </h4>
                <div className="flex items-center gap-1 shrink-0 lg:hidden">
                  {genCards ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-900 text-white text-[9px] font-black uppercase">
                      <Loader2 size={11} className="animate-spin" />
                      {cardProgress || '…'}
                    </span>
                  ) : (
                    ([1, 2, 3] as const).map((n) => (
                      <button
                        key={n}
                        type="button"
                        disabled={genCards}
                        onClick={() => handleGenerateCards(n)}
                        className={`inline-flex items-center justify-center min-w-[2.6rem] px-2 py-1.5 rounded-xl text-[9px] font-black uppercase tracking-wide disabled:opacity-50 ${
                          n === plannedCards
                            ? 'bg-slate-900 text-white'
                            : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
                        }`}
                        title={`Generate ${n} card${n === 1 ? '' : 's'}`}
                      >
                        GEN{n}
                      </button>
                    ))
                  )}
                </div>
              </div>

              {genCards && (
                <p className="text-[10px] font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5">
                  Keep this tab open until cards finish.
                </p>
              )}

              <div className="flex flex-wrap gap-1.5">
                  {providerList.map((p) => {
                    const active = provider === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        disabled={!p.available || genCards}
                        onClick={() => setProvider(p.id)}
                        className={`rounded-lg border px-2 py-1 text-[10px] font-black ${
                          active
                            ? 'border-teal-400 bg-teal-50 text-teal-950'
                            : 'border-slate-200 bg-white text-slate-800 hover:border-slate-300'
                        } ${!p.available || genCards ? 'opacity-40 cursor-not-allowed' : ''}`}
                      >
                        {p.name}
                      </button>
                    );
                  })}
              </div>

              <div className="space-y-1">
                <p className={ADD_FLOW_LABEL}>Style</p>
                <div className="flex flex-wrap gap-1">
                  {PRODUCT_CARD_STYLES.map((s) => {
                    const active = styleId === s.id;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        disabled={genCards}
                        title={s.name}
                        onClick={() => setStyleId(s.id)}
                        className={`px-2 py-1 rounded-md border text-[10px] font-black leading-none ${
                          active
                            ? 'border-teal-400 bg-teal-50 text-teal-950'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                        } ${genCards ? 'opacity-40 cursor-not-allowed' : ''}`}
                      >
                        {s.shortName || s.name}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>

          {/* RIGHT — title + description */}
          <section
            id="studio-listing"
            className={`p-2.5 space-y-2 bg-transparent flex-col ${
              mobileQuad === 'listing' ? 'flex' : 'hidden'
            } lg:flex`}
          >
            {soldPriceBand && (
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/70 px-2.5 py-1.5 shrink-0 flex flex-wrap items-center gap-2">
                <p className="text-[10px] font-black uppercase tracking-widest text-emerald-700">
                  Sold {soldPriceBand.count}
                </p>
                <p className="text-[11px] text-slate-700 font-bold">
                  €{formatEUR(soldPriceBand.low)}–{formatEUR(soldPriceBand.high)}
                  <span className="text-slate-400 font-medium"> · med </span>
                  €{formatEUR(soldPriceBand.median)}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    const m = soldPriceBand.median;
                    setSellPriceText(String(m));
                    setStorePriceText(String(m));
                    void persistPatch({
                      sellPrice: m,
                      storePrice: m,
                    });
                  }}
                  className="px-2 py-1 rounded-md bg-emerald-600 text-white text-[10px] font-bold"
                  title="Set target sell + store price to your median sold price"
                >
                  Use median
                </button>
              </div>
            )}

            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shrink-0">
              <div className="px-2.5 py-1.5 border-b border-slate-100 bg-slate-50 flex justify-between items-center gap-2">
                <div className="min-w-0 flex items-baseline gap-2">
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                    AI Titel
                  </h4>
                  <span className={`text-[9px] font-bold ${titleLen > 78 ? 'text-amber-600' : 'text-emerald-700'}`}>
                    {titleLen}/80
                  </span>
                </div>
                <button
                  type="button"
                  disabled={!title.trim()}
                  onClick={() => void copyText('title', title)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-200 text-[9px] font-black uppercase text-slate-600 hover:bg-white disabled:opacity-40 shrink-0"
                  title="Copy title"
                  aria-label="Copy title"
                >
                  {copied === 'title' ? <Check size={12} /> : <Copy size={12} />}
                </button>
              </div>
              <input
                type="text"
                maxLength={80}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-2.5 py-2 text-sm font-semibold outline-none"
              />
            </div>

            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden min-h-[140px] flex flex-col">
              <div className="px-2.5 py-1.5 border-b border-slate-100 bg-slate-50 flex justify-between items-center shrink-0">
                <div>
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                    AI Beschreibung
                  </h4>
                  <p className="hidden sm:block text-[9px] text-slate-400">eBay.de / Kleinanzeigen</p>
                </div>
                <button
                  type="button"
                  onClick={() => void copyText('desc', description)}
                  className="inline-flex items-center gap-1 px-1.5 py-1 rounded-md border border-slate-200 text-[9px] font-black uppercase text-slate-600"
                >
                  {copied === 'desc' ? <Check size={11} /> : <Copy size={11} />}
                </button>
              </div>
              <label className="block px-2.5 pt-1.5 pb-1 border-b border-slate-100 shrink-0">
                <span className="text-[9px] font-black uppercase tracking-widest text-violet-600/80">
                  AI note
                </span>
                <input
                  type="text"
                  className="mt-0.5 w-full px-2 py-1 rounded-md bg-violet-50/60 border border-violet-100 text-[11px] font-semibold text-slate-800 outline-none focus:border-violet-400 focus:bg-white"
                  placeholder="e.g. wifi antennas aren't original"
                  value={aiDescriptionNote}
                  maxLength={200}
                  onChange={(e) => setAiDescriptionNote(e.target.value)}
                  onBlur={() =>
                    void persistPatch({
                      aiDescriptionNote: aiDescriptionNote.trim(),
                    })
                  }
                />
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full flex-1 min-h-[80px] lg:min-h-0 px-2.5 py-2 text-xs text-slate-800 outline-none resize-none leading-relaxed"
                placeholder="Generate German listing…"
              />
            </div>

            {error && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] font-bold text-amber-900 whitespace-pre-wrap shrink-0">
                {error}
              </div>
            )}

            <div className="lg:hidden flex flex-wrap gap-1.5 pt-1 shrink-0">
              <button
                type="button"
                disabled={genListing || saving}
                onClick={() => void handleGenerateListing()}
                className="inline-flex items-center gap-1 px-2.5 py-2 rounded-xl bg-slate-900 text-white text-[9px] font-black uppercase tracking-wider disabled:opacity-50"
              >
                {genListing ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                Generate listing
              </button>
              <button
                type="button"
                disabled={saving || genListing}
                onClick={() => void handleApplyListing()}
                className="inline-flex items-center gap-1 px-2.5 py-2 rounded-xl bg-slate-900 text-white text-[9px] font-black uppercase disabled:opacity-50 ml-auto"
              >
                {saving ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                Apply to item
              </button>
            </div>
          </section>
          </div>
        </div>

        <footer className="lg:hidden shrink-0 border-t border-slate-200 bg-white px-2.5 py-2 flex gap-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={() => setDealOpen(true)}
            className="inline-flex items-center justify-center px-3 py-2.5 rounded-xl border border-slate-200 text-slate-800 text-[10px] font-black uppercase"
          >
            Deal
          </button>
          <button
            type="button"
            disabled={genListing || saving}
            onClick={() => void handleGenerateListing()}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-900 text-white text-[10px] font-black uppercase tracking-wider disabled:opacity-50"
          >
            {genListing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            Generate
          </button>
          <button
            type="button"
            disabled={saving || genListing}
            onClick={() => void handleApplyListing()}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-slate-900 text-white text-[10px] font-black uppercase disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Apply & close
          </button>
        </footer>
      </div>

      {previewPhotoIndex !== null && photos[previewPhotoIndex] && (
        <div
          className="absolute inset-0 z-[20] flex items-center justify-center p-3 sm:p-5 bg-slate-900/50 backdrop-blur-[3px]"
          onClick={() => setPreviewPhotoIndex(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Photo preview"
        >
          <div
            className="w-full max-w-[440px] bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-100">
              <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                Photo {previewPhotoIndex + 1} / {photos.length}
              </p>
              {previewPhotoIndex === 0 && (
                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-teal-50 text-teal-700 text-[9px] font-black uppercase tracking-wider">
                  <Star size={9} className="fill-teal-500 text-teal-600" />
                  Main
                </span>
              )}
              <div className="ml-auto flex items-center gap-1">
                <a
                  href={photos[previewPhotoIndex]}
                  target="_blank"
                  rel="noreferrer"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-800 hover:bg-slate-100"
                  title="Open original"
                  aria-label="Open original"
                >
                  <Download size={14} />
                </a>
                <button
                  type="button"
                  onClick={() => setPreviewPhotoIndex(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-800 hover:bg-slate-100"
                  aria-label="Close preview"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            <div className="relative bg-slate-950">
              <img
                src={photos[previewPhotoIndex]}
                alt=""
                className="w-full max-h-[min(52vh,360px)] object-contain bg-slate-950"
                draggable={false}
              />
              {photos.length > 1 && (
                <>
                  <button
                    type="button"
                    disabled={previewPhotoIndex <= 0}
                    onClick={() => setPreviewPhotoIndex((i) => (i === null ? i : Math.max(0, i - 1)))}
                    className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-white/90 text-slate-800 shadow-md hover:bg-white disabled:opacity-25"
                    aria-label="Previous photo"
                  >
                    <ChevronLeft size={16} />
                  </button>
                  <button
                    type="button"
                    disabled={previewPhotoIndex >= photos.length - 1}
                    onClick={() =>
                      setPreviewPhotoIndex((i) =>
                        i === null ? i : Math.min(photos.length - 1, i + 1)
                      )
                    }
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full bg-white/90 text-slate-800 shadow-md hover:bg-white disabled:opacity-25"
                    aria-label="Next photo"
                  >
                    <ChevronRight size={16} />
                  </button>
                </>
              )}
            </div>

            {photos.length > 1 && (
              <div className="flex gap-1.5 overflow-x-auto px-3 pt-2.5">
                {photos.map((url, i) => (
                  <button
                    key={url}
                    type="button"
                    onClick={() => setPreviewPhotoIndex(i)}
                    className={`shrink-0 w-10 h-10 rounded-lg overflow-hidden border-2 ${
                      i === previewPhotoIndex
                        ? 'border-slate-900'
                        : 'border-transparent opacity-70 hover:opacity-100'
                    }`}
                    aria-label={`Photo ${i + 1}`}
                  >
                    <img src={url} alt="" className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}

            <div className="p-3 flex gap-2">
              <button
                type="button"
                disabled={previewPhotoIndex === 0 || saving}
                onClick={() => void handleSetPhotoMain(photos[previewPhotoIndex])}
                className={`flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider disabled:opacity-45 ${
                  previewPhotoIndex === 0
                    ? 'bg-teal-50 text-teal-800 border border-teal-200'
                    : 'bg-slate-900 text-white hover:bg-slate-800'
                }`}
              >
                <Star
                  size={13}
                  className={previewPhotoIndex === 0 ? 'fill-teal-500 text-teal-600' : ''}
                />
                {previewPhotoIndex === 0 ? 'Main photo' : 'Make main'}
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleRemovePhoto(photos[previewPhotoIndex])}
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-black uppercase tracking-wider hover:bg-rose-100 disabled:opacity-50"
              >
                <Trash2 size={13} />
                Remove
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
};

export default ListingStudioModal;

