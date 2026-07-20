import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
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
} from 'lucide-react';
import type { GeneratedProductCardEntry, InventoryItem, PaymentType, Platform } from '../types';
import {
  formatOwnerListingHints,
  generateMarketplaceListing,
} from '../services/marketplaceListingAI';
import { generateItemSpecs } from '../services/specsAI';
import { mergeAiSpecsIntoEssential, resolveEssentialSpecKeys } from '../services/essentialSpecFields';
import { pickSpecsAiNameVendorUpdates } from '../utils/applySpecsAiResult';
import { getProductCardSpecs } from '../utils/productCardContent';
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
import {
  fetchProductCardProviders,
  generateProductCard,
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
  listProductCardGallery,
  removeProductCardFromGallery,
  resolveProductCardImageUrl,
  saveGeneratedProductCard,
} from '../services/productCardGallery';
import { resolveUrlForInventoryMainPhoto } from '../utils/applyProductCardAsMainPhoto';
import { getChildren } from '../services/financialAggregation';
import PhoneUploadQrPanel from './PhoneUploadQrPanel';
import LocalPhotoFolderPanel from './LocalPhotoFolderPanel';
import KleinanzeigenBuyChatProofFields from './KleinanzeigenBuyChatProofFields';

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
  categoryFields?: Record<string, string[]>;
  onClose: () => void;
  onUpdateItem: (patch: Partial<InventoryItem>) => void | Promise<void>;
  /** Optional controls in the studio header (e.g. Asset details). */
  headerExtra?: React.ReactNode;
}

function resolveCardBatchCount(photoCount: number): number {
  const n = Math.max(0, Math.floor(photoCount || 0));
  if (n <= 0) return 1;
  return Math.min(3, n);
}

const ListingStudioModal: React.FC<Props> = ({
  item,
  allItems,
  categoryFields = {},
  onClose,
  onUpdateItem,
  headerExtra,
}) => {
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(item.name || '');
  const [specs, setSpecs] = useState<Record<string, string | number>>({ ...(item.specs || {}) });
  const [title, setTitle] = useState(item.marketTitle?.trim() || item.name || '');
  const [description, setDescription] = useState(item.marketDescription || '');
  const [ownerHints, setOwnerHints] = useState<string | null>(null);
  const [aiDescriptionNote, setAiDescriptionNote] = useState(item.aiDescriptionNote || '');

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

  const [parsingSpecs, setParsingSpecs] = useState(false);
  const [generatingTitle, setGeneratingTitle] = useState(false);
  const [genListing, setGenListing] = useState(false);
  const [genCards, setGenCards] = useState(false);
  const [cardProgress, setCardProgress] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const [gallery, setGallery] = useState<GeneratedProductCardEntry[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);

  const [provider, setProvider] = useState<ProductCardProviderId>('openai');
  const [providers, setProviders] = useState<ProductCardProviderInfo[]>([]);
  const [styleId, setStyleId] = useState<ProductCardStyleId>(DEFAULT_PRODUCT_CARD_STYLE_ID);
  const [photoSource, setPhotoSource] = useState<'none' | 'iphone' | 'folder'>('none');
  /** Card provider/style panel — collapsed by default on narrow screens. */
  const [cardOptionsOpen, setCardOptionsOpen] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(min-width: 1024px)').matches : false
  );
  const [previewPhotoIndex, setPreviewPhotoIndex] = useState<number | null>(null);

  const workingItem = useMemo(
    () => ({
      ...item,
      name,
      specs,
      marketTitle: title,
      marketDescription: description,
      aiDescriptionNote: aiDescriptionNote.trim() || undefined,
    }),
    [item, name, specs, title, description, aiDescriptionNote]
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
    categoryFields[`${item.category}:${item.subCategory}`] ||
    categoryFields[item.category] ||
    [];

  const cardSpecChips = useMemo(
    () => getProductCardSpecs(workingItem, cardFields, 8),
    [workingItem, cardFields]
  );

  const accessories = useMemo(() => {
    let hasOVP = item.hasOVP === true;
    let hasIOShield = item.hasIOShield === true;
    const isContainer =
      item.isPC ||
      item.isBundle ||
      item.category === 'PC' ||
      item.category === 'Bundle' ||
      item.category === 'Mixed Bundle' ||
      (item.componentIds?.length ?? 0) > 0;
    if (isContainer && allItems?.length) {
      for (const child of getChildren(item, allItems)) {
        if (child.hasOVP === true) hasOVP = true;
        if (child.hasIOShield === true) hasIOShield = true;
      }
    }
    return { hasOVP, hasIOShield };
  }, [item, allItems]);

  const reloadGallery = useCallback(async () => {
    setGalleryLoading(true);
    try {
      const list = await listProductCardGallery(item.id);
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
      setSelectedCardId((prev) => {
        if (prev && list.some((e) => e.id === prev)) return prev;
        return list[0]?.id || null;
      });
    } catch (e) {
      console.warn(e);
    } finally {
      setGalleryLoading(false);
    }
  }, [item.id]);

  // Hydrate local studio fields only when switching items.
  // Re-running this on every vendor/spec/photo patch was wiping unsaved Generate listing text
  // before Apply — so Apply looked broken (saved empty / old description).
  useEffect(() => {
    setName(item.name || '');
    setSpecs({ ...(item.specs || {}) });
    setTitle(item.marketTitle?.trim() || item.name || '');
    setDescription(item.marketDescription || '');
    setAiDescriptionNote(item.aiDescriptionNote || '');
    setOwnerHints(null);
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
    setPreviewPhotoIndex(null);
    setError(null);
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
    void reloadGallery();
  }, [reloadGallery]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (previewPhotoIndex !== null) {
        setPreviewPhotoIndex(null);
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, previewPhotoIndex]);

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

  const handleGenerateItemTitle = async () => {
    if (!name.trim()) {
      setError('Enter an item name first.');
      return;
    }
    setGeneratingTitle(true);
    setError(null);
    try {
      const categoryContext = `${item.category || 'Unknown'}${item.subCategory ? ` / ${item.subCategory}` : ''}`;
      const knownKeys = resolveEssentialSpecKeys(item.category || '', item.subCategory, categoryFields);
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
      const categoryContext = `${item.category || 'Unknown'}${item.subCategory ? ` / ${item.subCategory}` : ''}`;
      const knownKeys = resolveEssentialSpecKeys(item.category || '', item.subCategory, categoryFields);
      const result = await generateItemSpecs(name.trim(), categoryContext, knownKeys);
      const newSpecs = mergeAiSpecsIntoEssential(
        specs,
        result.specs,
        item.category || '',
        item.subCategory,
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
      const result = await generateMarketplaceListing(
        { ...workingItem, hasOVP: accessories.hasOVP, hasIOShield: accessories.hasIOShield },
        {
          ...accessories,
          aiDescriptionNote: aiDescriptionNote.trim() || undefined,
        }
      );
      setTitle(result.ebayTitle);
      setDescription(result.listingText);
      setOwnerHints(formatOwnerListingHints(result));
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

  const handleGenerateCards = async () => {
    setGenCards(true);
    setError(null);
    const sourcePhotos = photos.slice(0, 3);
    const count = resolveCardBatchCount(sourcePhotos.length);
    const errors: string[] = [];
    try {
      for (let i = 0; i < count; i++) {
        setCardProgress(`Generating card ${i + 1} / ${count}…`);
        const jobPhotos = sourcePhotos.length ? [sourcePhotos[i % sourcePhotos.length]] : [];
        try {
          const result = await generateProductCard(workingItem, cardFields, {
            styleId,
            provider,
            photos: jobPhotos,
            editFromPhoto: jobPhotos.length > 0,
          });
          await saveGeneratedProductCard({
            itemId: item.id,
            itemName: name || item.name,
            dataUrl: result.dataUrl,
            provider: result.provider,
            model: result.model,
            styleId: (result.styleId as ProductCardStyleId) || styleId,
            styleName: result.styleName,
          });
        } catch (e) {
          errors.push(`Card ${i + 1}: ${e instanceof Error ? e.message : 'failed'}`);
        }
      }
      await reloadGallery();
      if (errors.length) setError(errors.join('\n'));
    } finally {
      setGenCards(false);
      setCardProgress(null);
    }
  };

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
      const merged = normalizeImageList([prepared, item.imageUrl, ...(item.imageUrls || [])]);
      await persistPatch({ imageUrl: merged[0], imageUrls: merged });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not set main photo');
    } finally {
      setSaving(false);
    }
  };

  const handleAddPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const urls = await filesToDataUrls(Array.from(files).slice(0, 6), { itemId: item.id });
      const merged = normalizeImageList([...photos, ...urls]);
      await persistPatch({ imageUrl: merged[0] || '', imageUrls: merged });
    } catch (e) {
      const { localImageReadErrorMessage } = await import('../utils/localImageFile');
      setError(localImageReadErrorMessage(e, 'Photo import failed'));
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const mergeRemotePhotoUrls = useCallback(
    async (urls: string[]) => {
      if (!urls.length) return;
      try {
        const prepared = await prepareInventoryImagesForStorage(urls, { itemId: item.id });
        const existing = getItemUserPhotoUrls(item);
        const merged = normalizeImageList([...existing, ...prepared]);
        await persistPatch({ imageUrl: merged[0] || '', imageUrls: merged });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not attach iPhone photos');
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [item.id, item.imageUrl, item.imageUrls, onUpdateItem]
  );

  const handleFolderFiles = async (files: File[]) => {
    if (!files.length) return;
    try {
      const urls = await filesToDataUrls(files.slice(0, 6), { itemId: item.id });
      const merged = normalizeImageList([...photos, ...urls]);
      await persistPatch({ imageUrl: merged[0] || '', imageUrls: merged });
    } catch (e) {
      const { localImageReadErrorMessage } = await import('../utils/localImageFile');
      setError(localImageReadErrorMessage(e, 'Folder photo import failed'));
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

  const selectedEntry = gallery.find((e) => e.id === selectedCardId) || null;
  const selectedThumb = selectedEntry ? thumbs[selectedEntry.id] : null;
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
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:max-w-[1280px] h-[100dvh] sm:h-[min(94vh,920px)] sm:rounded-2xl shadow-2xl border-0 sm:border border-slate-200 overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="px-3 py-2.5 border-b border-slate-100 flex items-start justify-between gap-2 bg-slate-50/90 shrink-0 pt-[max(0.625rem,env(safe-area-inset-top))]">
          <div className="min-w-0">
            <h3 className="text-sm font-black text-slate-900 flex items-center gap-1.5">
              <Sparkles size={14} className="text-rose-600" /> Listing Studio
            </h3>
            <p className="text-[11px] text-slate-500 font-medium truncate">
              Specs · Photos · Title & description
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {headerExtra}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        </header>

        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(240px,0.92fr)_minmax(280px,1.05fr)_minmax(280px,1.05fr)] overflow-y-auto lg:overflow-hidden">
          {/* LEFT — item / specs / trade */}
          <aside className="border-r border-slate-100 overflow-y-auto p-3 space-y-3 bg-slate-50/40">
            <section>
              <div className="flex items-center justify-between mb-1">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Item name
                </h4>
                <button
                  type="button"
                  disabled={generatingTitle || parsingSpecs}
                  onClick={() => void handleGenerateItemTitle()}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-600 text-white text-[9px] font-black uppercase disabled:opacity-50"
                  title="Generate a cleaned item title only (does not change specs)"
                >
                  {generatingTitle ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                  AI title
                </button>
              </div>
              <input
                className="w-full px-2.5 py-2 rounded-xl border border-slate-200 text-sm font-bold text-slate-900 outline-none focus:border-rose-400"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => void persistPatch({ name: name.trim() || item.name })}
              />
            </section>

            <section>
              <div className="flex items-center justify-between mb-1 gap-2">
                <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Photos for card
                </h4>
                <div className="flex items-center gap-1 flex-wrap justify-end">
                  <button
                    type="button"
                    onClick={() => setPhotoSource((s) => (s === 'iphone' ? 'none' : 'iphone'))}
                    className={`inline-flex items-center gap-1 text-[9px] font-black uppercase ${
                      photoSource === 'iphone' ? 'text-sky-700' : 'text-slate-600 hover:text-sky-700'
                    }`}
                    title="Scan QR on iPhone — pick from full Photos library"
                  >
                    <Smartphone size={11} /> iPhone
                  </button>
                  <button
                    type="button"
                    onClick={() => setPhotoSource((s) => (s === 'folder' ? 'none' : 'folder'))}
                    className={`inline-flex items-center gap-1 text-[9px] font-black uppercase ${
                      photoSource === 'folder'
                        ? 'text-violet-700'
                        : 'text-slate-600 hover:text-violet-700'
                    }`}
                    title="Browse synced iCloud / Photos folder on this PC"
                  >
                    <FolderOpen size={11} /> Folder
                  </button>
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="inline-flex items-center gap-1 text-[9px] font-black uppercase text-slate-600 hover:text-rose-700"
                  >
                    <Upload size={11} /> Add
                  </button>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => void handleAddPhotos(e.target.files)}
                />
              </div>

              {photoSource === 'iphone' && (
                <div className="mb-2">
                  <PhoneUploadQrPanel
                    itemId={item.id}
                    itemName={name || item.name}
                    onUrls={mergeRemotePhotoUrls}
                    onClose={() => setPhotoSource('none')}
                  />
                </div>
              )}
              {photoSource === 'folder' && (
                <div className="mb-2">
                  <LocalPhotoFolderPanel
                    maxSelect={6}
                    onPickFiles={handleFolderFiles}
                    onClose={() => setPhotoSource('none')}
                  />
                </div>
              )}

              {photos.length === 0 ? (
                <div className="h-20 rounded-xl border border-dashed border-slate-300 flex items-center justify-center text-[10px] font-bold text-slate-400">
                  No photos yet
                </div>
              ) : (
                <div className="flex gap-2 overflow-x-auto pb-1 -mx-0.5 px-0.5 snap-x snap-mandatory overscroll-x-contain">
                  {photos.map((url, index) => (
                    <button
                      key={`${index}:${url.slice(0, 48)}`}
                      type="button"
                      onClick={() => setPreviewPhotoIndex(index)}
                      className={`relative shrink-0 w-[4.5rem] h-[4.5rem] sm:w-20 sm:h-20 snap-start rounded-xl overflow-hidden border-2 bg-slate-100 ${
                        index === 0
                          ? 'border-rose-500 ring-2 ring-rose-200'
                          : 'border-slate-200'
                      }`}
                      title="Open photo"
                    >
                      <img
                        src={url}
                        alt=""
                        className="w-full h-full object-cover"
                        draggable={false}
                      />
                      {index === 0 && (
                        <span className="absolute bottom-0.5 left-0.5 px-1 py-px rounded bg-rose-600 text-white text-[8px] font-black uppercase leading-none">
                          Main
                        </span>
                      )}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="shrink-0 w-[4.5rem] h-[4.5rem] sm:w-20 sm:h-20 rounded-xl border border-dashed border-slate-300 text-slate-400 font-black hover:border-rose-400 hover:text-rose-600 flex items-center justify-center snap-start"
                    title="Add photos"
                  >
                    <Plus size={18} />
                  </button>
                </div>
              )}
              <p className="text-[10px] text-slate-400 mt-1 font-medium">
                {photos.length === 0
                  ? 'Generate will create 1 card from name/specs'
                  : `${photos.length} photo${photos.length === 1 ? '' : 's'} → ${plannedCards} card${plannedCards === 1 ? '' : 's'} · tap to enlarge`}
              </p>
            </section>

            <section>
              <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">
                Specs on the card
              </h4>
              <div className="flex flex-wrap gap-1 mb-2">
                {cardSpecChips.length ? (
                  cardSpecChips.map((s) => (
                    <span
                      key={s.label}
                      className="px-1.5 py-0.5 rounded-md bg-rose-50 text-rose-800 border border-rose-100 text-[10px] font-bold"
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
              <div className="flex items-center justify-between mb-1 gap-2">
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
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-rose-200 bg-rose-50 text-rose-800 text-[9px] font-black uppercase disabled:opacity-50"
                    title="Fill tech specs only — does not change the item title"
                  >
                    {parsingSpecs ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                    Parse AI
                  </button>
                </div>
              </div>
              <p className="text-[10px] text-slate-400 font-medium mb-1.5">
                Edit any AI value or rename the field if you disagree.
              </p>
              <div className="space-y-1 max-h-56 overflow-y-auto pr-0.5">
                {Object.keys(specs).length === 0 && (
                  <p className="text-[10px] text-slate-400 font-medium py-2">
                    No specs yet — run Parse AI or add your own.
                  </p>
                )}
                {Object.entries(specs).map(([key, value]) => (
                  <div
                    key={key}
                    className="flex items-center gap-1 rounded-lg bg-white border border-slate-200 px-1.5 py-1"
                  >
                    <input
                      className="w-[38%] min-w-0 text-[10px] font-bold text-slate-500 outline-none bg-transparent truncate"
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
                      className="p-0.5 text-slate-300 hover:text-rose-500"
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
          </aside>

          {/* MIDDLE — card gallery */}
          <section className="border-r border-slate-100 overflow-y-auto p-3 space-y-2.5 bg-white">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                  Card gallery
                </h4>
                <p className="text-[10px] text-slate-400 font-medium">
                  Saved for this item · edit / remove anytime
                </p>
              </div>
              <button
                type="button"
                disabled={genCards}
                onClick={() => void handleGenerateCards()}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-900 text-white text-[9px] font-black uppercase disabled:opacity-50"
              >
                {genCards ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                {genCards ? cardProgress || '…' : `Generate ${plannedCards}`}
              </button>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50/80 overflow-hidden">
              <button
                type="button"
                onClick={() => setCardOptionsOpen((o) => !o)}
                className="w-full flex items-center justify-between gap-2 px-2.5 py-2 text-left"
                aria-expanded={cardOptionsOpen}
              >
                <div className="min-w-0">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                    Card style
                  </p>
                  <p className="text-[10px] text-slate-500 font-medium truncate">
                    {providerList.find((p) => p.id === provider)?.name || provider}
                    {' · '}
                    {PRODUCT_CARD_STYLES.find((s) => s.id === styleId)?.name || styleId}
                  </p>
                </div>
                <span className="inline-flex items-center gap-1 shrink-0 px-2 py-1 rounded-lg border border-slate-200 bg-white text-[9px] font-black uppercase text-slate-600">
                  {cardOptionsOpen ? (
                    <>
                      Close <ChevronUp size={12} />
                    </>
                  ) : (
                    <>
                      Expand <ChevronDown size={12} />
                    </>
                  )}
                </span>
              </button>
              {cardOptionsOpen && (
                <div className="px-2.5 pb-2.5 space-y-2 border-t border-slate-200/80 pt-2">
                  <div className="flex flex-wrap gap-1.5">
                    {providerList.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        disabled={!p.available || genCards}
                        onClick={() => setProvider(p.id)}
                        className={`px-2 py-1 rounded-lg border text-[9px] font-black uppercase ${
                          provider === p.id
                            ? 'border-rose-400 bg-rose-50 text-rose-800'
                            : 'border-slate-200 text-slate-500 bg-white'
                        }`}
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-1">
                    {PRODUCT_CARD_STYLES.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        disabled={genCards}
                        onClick={() => setStyleId(s.id)}
                        className={`text-left px-2 py-1.5 rounded-lg border ${
                          styleId === s.id
                            ? 'border-rose-400 bg-rose-50'
                            : 'border-slate-200 bg-white hover:bg-slate-50'
                        }`}
                      >
                        <span className="block text-[10px] font-black text-slate-800">{s.name}</span>
                        <span className="block text-[9px] text-slate-400 leading-snug">{s.blurb}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {selectedThumb && (
              <img
                src={selectedThumb}
                alt="Selected card"
                className="hidden sm:block w-full aspect-square max-h-56 object-contain rounded-xl border border-slate-200 bg-slate-50"
              />
            )}

            {galleryLoading ? (
              <div className="flex justify-center py-8 text-slate-400">
                <Loader2 size={20} className="animate-spin" />
              </div>
            ) : gallery.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 p-6 text-center text-[11px] text-slate-400 font-medium">
                No cards yet for this item. Generate from the left photos.
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {gallery.map((entry) => {
                  const active = entry.id === selectedCardId;
                  return (
                    <div
                      key={entry.id}
                      className={`rounded-xl border overflow-hidden bg-slate-50 ${
                        active ? 'border-rose-500 ring-2 ring-rose-200' : 'border-slate-200'
                      }`}
                    >
                      <button
                        type="button"
                        className="block w-full"
                        onClick={() => setSelectedCardId(entry.id)}
                      >
                        {thumbs[entry.id] ? (
                          <img
                            src={thumbs[entry.id]}
                            alt=""
                            className="w-full aspect-square object-cover"
                          />
                        ) : (
                          <div className="aspect-square flex items-center justify-center text-slate-300">
                            <ImageIcon size={16} />
                          </div>
                        )}
                      </button>
                      <div className="px-1.5 py-1 flex gap-0.5">
                        <button
                          type="button"
                          onClick={() => void handleSetMainPhoto(entry)}
                          className="flex-1 py-1 rounded-md bg-slate-900 text-white text-[8px] font-black uppercase"
                        >
                          Main
                        </button>
                        <button
                          type="button"
                          onClick={() => void downloadProductCardEntry(entry)}
                          className="p-1 rounded-md border border-slate-200 text-slate-500"
                          title="Download"
                        >
                          <Download size={11} />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleRemoveCard(entry.id)}
                          className="p-1 rounded-md border border-slate-200 text-rose-500 hover:bg-rose-50"
                          title="Remove from gallery"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* RIGHT — title + description */}
          <section className="overflow-y-auto p-3 space-y-2.5 bg-slate-50/30 flex flex-col">
            {ownerHints && (
              <div className="rounded-xl border border-dashed border-emerald-300 bg-emerald-50/80 px-2.5 py-2 shrink-0">
                <div className="flex justify-between gap-2 mb-1">
                  <p className="text-[9px] font-black uppercase tracking-widest text-emerald-800">
                    Für dich (nicht Anzeige)
                  </p>
                  <button
                    type="button"
                    onClick={() => void copyText('owner', ownerHints)}
                    className="text-[9px] font-bold uppercase text-emerald-700"
                  >
                    {copied === 'owner' ? <Check size={11} /> : <Copy size={11} />}
                  </button>
                </div>
                <pre className="text-[10px] text-emerald-900/90 whitespace-pre-wrap font-sans m-0 leading-relaxed">
                  {ownerHints}
                </pre>
              </div>
            )}

            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shrink-0">
              <div className="px-2.5 py-1.5 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                <div>
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                    AI Titel
                  </h4>
                  <p className="text-[9px] text-slate-400">eBay · max 80</p>
                </div>
                <button
                  type="button"
                  onClick={() => void copyText('title', title)}
                  className="inline-flex items-center gap-1 px-1.5 py-1 rounded-md border border-slate-200 text-[9px] font-black uppercase text-slate-600"
                >
                  {copied === 'title' ? <Check size={11} /> : <Copy size={11} />}
                </button>
              </div>
              <input
                type="text"
                maxLength={80}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-2.5 py-2 text-sm font-semibold outline-none"
              />
              <div className="px-2.5 py-1 border-t border-slate-100 text-[9px] font-bold text-slate-400 flex justify-between">
                <span>Marktplatz-Titel</span>
                <span className={titleLen > 78 ? 'text-amber-600' : 'text-emerald-700'}>
                  {titleLen}/80
                </span>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden flex-1 min-h-[200px] flex flex-col">
              <div className="px-2.5 py-1.5 border-b border-slate-100 bg-slate-50 flex justify-between items-center shrink-0">
                <div>
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                    AI Beschreibung
                  </h4>
                  <p className="text-[9px] text-slate-400">eBay.de / Kleinanzeigen</p>
                </div>
                <button
                  type="button"
                  onClick={() => void copyText('desc', description)}
                  className="inline-flex items-center gap-1 px-1.5 py-1 rounded-md border border-slate-200 text-[9px] font-black uppercase text-slate-600"
                >
                  {copied === 'desc' ? <Check size={11} /> : <Copy size={11} />}
                </button>
              </div>
              <label className="block px-2.5 pt-2 pb-1 border-b border-slate-100 shrink-0">
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
                className="w-full flex-1 min-h-[180px] px-2.5 py-2 text-xs text-slate-800 outline-none resize-none leading-relaxed"
                placeholder="Generate German listing…"
              />
            </div>

            {error && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] font-bold text-amber-900 whitespace-pre-wrap shrink-0">
                {error}
              </div>
            )}

            <div className="hidden lg:flex flex-wrap gap-1.5 pt-1 shrink-0">
              <button
                type="button"
                disabled={genListing || saving}
                onClick={() => void handleGenerateListing()}
                className="inline-flex items-center gap-1 px-2.5 py-2 rounded-xl bg-rose-600 text-white text-[9px] font-black uppercase disabled:opacity-50"
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

        <footer className="lg:hidden shrink-0 border-t border-slate-200 bg-white px-3 py-2.5 flex gap-2 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            disabled={genListing || saving}
            onClick={() => void handleGenerateListing()}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-3 rounded-xl bg-rose-600 text-white text-[10px] font-black uppercase disabled:opacity-50"
          >
            {genListing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            Generate
          </button>
          <button
            type="button"
            disabled={saving || genListing}
            onClick={() => void handleApplyListing()}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-3 rounded-xl bg-slate-900 text-white text-[10px] font-black uppercase disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Apply & close
          </button>
        </footer>
      </div>

      {previewPhotoIndex !== null && photos[previewPhotoIndex] && (
        <div
          className="absolute inset-0 z-[20] flex flex-col bg-slate-950/95"
          onClick={() => setPreviewPhotoIndex(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Photo preview"
        >
          <div
            className="flex items-center justify-between gap-2 px-3 py-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-xs font-black uppercase tracking-widest text-white/80">
              Photo {previewPhotoIndex + 1} / {photos.length}
              {previewPhotoIndex === 0 ? ' · Main' : ''}
            </p>
            <button
              type="button"
              onClick={() => setPreviewPhotoIndex(null)}
              className="p-2 rounded-xl bg-white/10 text-white hover:bg-white/20"
              aria-label="Close preview"
            >
              <X size={18} />
            </button>
          </div>

          <div
            className="flex-1 min-h-0 flex items-center justify-center px-3 py-2"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={photos[previewPhotoIndex]}
              alt=""
              className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
              draggable={false}
            />
          </div>

          <div
            className="shrink-0 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] flex gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              disabled={previewPhotoIndex === 0 || saving}
              onClick={() => void handleSetPhotoMain(photos[previewPhotoIndex])}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-3 rounded-xl bg-white text-slate-900 text-[10px] font-black uppercase disabled:opacity-40"
            >
              <Star size={14} className={previewPhotoIndex === 0 ? 'fill-rose-500 text-rose-500' : ''} />
              {previewPhotoIndex === 0 ? 'Main photo' : 'Make main'}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleRemovePhoto(photos[previewPhotoIndex])}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-3 rounded-xl bg-rose-600 text-white text-[10px] font-black uppercase disabled:opacity-50"
            >
              <Trash2 size={14} />
              Remove
            </button>
          </div>

          {photos.length > 1 && (
            <div
              className="absolute left-0 right-0 top-1/2 -translate-y-1/2 flex justify-between px-1 pointer-events-none"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                disabled={previewPhotoIndex <= 0}
                onClick={() => setPreviewPhotoIndex((i) => (i === null ? i : Math.max(0, i - 1)))}
                className="pointer-events-auto p-2.5 rounded-full bg-black/40 text-white disabled:opacity-20"
                aria-label="Previous photo"
              >
                <ChevronLeft size={20} />
              </button>
              <button
                type="button"
                disabled={previewPhotoIndex >= photos.length - 1}
                onClick={() =>
                  setPreviewPhotoIndex((i) =>
                    i === null ? i : Math.min(photos.length - 1, i + 1)
                  )
                }
                className="pointer-events-auto p-2.5 rounded-full bg-black/40 text-white disabled:opacity-20"
                aria-label="Next photo"
              >
                <ChevronRight size={20} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>,
    document.body
  );
};

export default ListingStudioModal;
