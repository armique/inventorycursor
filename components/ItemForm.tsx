
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { 
  ArrowLeft, Save, Trash2, Calendar, Globe, CreditCard,
  ShoppingBag, Calculator, Layers, Box, ChevronDown, 
  MessageCircle, Link as LinkIcon, Upload, Search, Database, 
  Cpu, Monitor, HardDrive, Zap, Wind, AlertCircle, CheckCircle2, Copy,
  Fan, Lightbulb, Keyboard, Mouse, Tv, MoreHorizontal, Cable, Laptop as LaptopIcon, Wrench,
  Wand2, Sliders, X, History
} from 'lucide-react';
import { InventoryItem, ItemStatus, Platform, PaymentType } from '../types';
import { SALE_PLATFORM_OPTIONS } from '../utils/salePlatform';
import { formatEUR, parseLocaleNumber } from '../utils/formatMoney';
import { CATEGORY_IMAGES, getSpecOptions } from '../services/hardwareDB';
import { generateItemSpecs, getSpecsAIProvider } from '../services/specsAI';
import { getCompatibleItemsForItem } from '../services/compatibility';
import { getEssentialSpecFieldKeys } from '../services/essentialSpecFields';
import { getCompatibilityWarnings } from '../utils/compatibilityWarnings';
import { recordCategoryCorrection, suggestCategoryFromCorrections } from '../services/categoryCorrections';
import { detectItemCategory, searchInventoryItemsForAdd } from '../utils/itemCategoryDetect';
import { filesToDataUrls, prepareInventoryImagesForStorage, getItemUserPhotoCount, isCategoryPlaceholderImage } from '../utils/imageImport';
import { searchProductPhotos, getImageSearchProviders, ImageSearchResult, ImageSearchProvider } from '../services/imageSearchService';
import { getCachedProductPhoto, setCachedProductPhoto } from '../services/firebaseService';
import { fetchMyEbayListings, getEbayUsername, ebayListingToPriceMatch, type EbayMyListing, type EbayListingPriceMatch } from '../services/ebayService';
import { matchEbayListingsForItem } from '../utils/ebayListingMatch';
import EbayListingPriceModal from './EbayListingPriceModal';

interface Props {
  items: InventoryItem[];
  onSave: (items: InventoryItem[]) => void;
  categories: Record<string, string[]>;
  onAddCategory: (category: string, subcategory?: string) => void;
  categoryFields: Record<string, string[]>;
  initialData?: InventoryItem;
  onClose?: () => void;
  isModal?: boolean;
}

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
  'Other'
];

function isRamItem(category: string | undefined, subCategory: string | undefined): boolean {
  return subCategory === 'RAM' || category === 'RAM';
}

/** True when "Memory" looks like capacity (e.g. 32 GB) rather than type (DDR4). */
function looksLikeRamCapacityMemoryField(value: string | undefined): boolean {
  const s = String(value ?? '').trim();
  if (!s || /DDR/i.test(s)) return false;
  return /^\d/.test(s) && /(GB|G|TB)\b/i.test(s);
}

/** Hide RAM Type / redundant Memory when Memory Type is the canonical field. */
function filterRamDuplicateSpecKeys(
  keys: string[],
  category: string | undefined,
  subCategory: string | undefined,
  specs: Record<string, string | number | undefined> | undefined
): string[] {
  if (!isRamItem(category, subCategory)) return keys;
  const set = new Set(keys);
  if (!set.has('Memory Type')) return Array.from(set);
  set.delete('RAM Type');
  if (set.has('Memory')) {
    const mem = String(specs?.['Memory'] ?? '').trim();
    const mt = String(specs?.['Memory Type'] ?? '').trim();
    if (!mem || mem.toLowerCase() === mt.toLowerCase()) {
      set.delete('Memory');
    } else if (!looksLikeRamCapacityMemoryField(mem)) {
      set.delete('Memory');
    }
  }
  return Array.from(set);
}

function normalizeRamSpecsForSave(specs: Record<string, string | number>): Record<string, string | number> {
  const out: Record<string, string | number> = { ...specs };
  const mt = String(out['Memory Type'] ?? '').trim();
  const rt = String(out['RAM Type'] ?? '').trim();
  if (rt && !mt) {
    out['Memory Type'] = out['RAM Type'];
  }
  if (String(out['Memory Type'] ?? '').trim()) {
    delete out['RAM Type'];
    const mem = String(out['Memory'] ?? '').trim();
    const mtv = String(out['Memory Type']).trim();
    if (!mem) delete out['Memory'];
    else if (mem.toLowerCase() === mtv.toLowerCase()) delete out['Memory'];
    else if (!looksLikeRamCapacityMemoryField(mem)) delete out['Memory'];
  }
  return out;
}

const ItemForm: React.FC<Props> = ({ onSave, items, initialData, categories, onAddCategory, categoryFields = {}, onClose, isModal = false }) => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isPcBuilderMode = searchParams.get('mode') === 'pc_builder';

  const [formData, setFormData] = useState<Partial<InventoryItem>>(initialData || {
    name: '',
    category: 'Components',
    subCategory: 'Graphics Cards',
    buyPrice: 0,
    buyDate: new Date().toISOString().split('T')[0],
    status: ItemStatus.IN_STOCK,
    buyPaymentType: 'Cash',
    platformBought: 'kleinanzeigen.de',
    specs: {},
    vendor: ''
  });

  // Mirrors formData so async callbacks (photo search) can read the truly-latest state after an
  // `await`, instead of the stale snapshot closed over when the callback started.
  const formDataRef = React.useRef(formData);
  useEffect(() => {
    formDataRef.current = formData;
  }, [formData]);

  const photoItemIdRef = React.useRef(initialData?.id || id || `item-draft-${Date.now()}`);
  const getPhotoItemId = () =>
    formDataRef.current.id || initialData?.id || id || photoItemIdRef.current;

  const [configStep, setConfigStep] = useState<'CATEGORY' | 'DETAILS' | 'DONE'>('CATEGORY');
  const [generatingSpecs, setGeneratingSpecs] = useState(false);
  const [showSpecs, setShowSpecs] = useState(true);
  const [nameSuggestionsOpen, setNameSuggestionsOpen] = useState(false);
  const [categorySearchOpen, setCategorySearchOpen] = useState(false);
  const [aiDetecting, setAiDetecting] = useState(false);
  const [aiDetectMessage, setAiDetectMessage] = useState<string | null>(null);
  const [aiDetectError, setAiDetectError] = useState<string | null>(null);
  const [quantityToCreate, setQuantityToCreate] = useState<number>(1);
  /** Spec fields the user explicitly switched from the AI-filled preset dropdown to manual typing. */
  const [customSpecKeys, setCustomSpecKeys] = useState<Set<string>>(new Set());

  const [photoSearchResults, setPhotoSearchResults] = useState<ImageSearchResult[] | null>(null);
  const [photoSearching, setPhotoSearching] = useState(false);
  const [photoSearchError, setPhotoSearchError] = useState<string | null>(null);
  const [ebayListingMatches, setEbayListingMatches] = useState<Array<EbayMyListing & { matchScore: number }> | null>(null);
  const [ebayListingLoading, setEbayListingLoading] = useState(false);
  const [ebayListingError, setEbayListingError] = useState<string | null>(null);
  const [ebayImportingId, setEbayImportingId] = useState<string | null>(null);
  const [expandedEbayListingId, setExpandedEbayListingId] = useState<string | null>(null);
  const [selectedEbayPhotosByListing, setSelectedEbayPhotosByListing] = useState<Record<string, string[]>>({});
  const [ebayPriceModalMatch, setEbayPriceModalMatch] = useState<EbayListingPriceMatch | null>(null);
  const [ebayPriceModalOpen, setEbayPriceModalOpen] = useState(false);
  const [ebayPriceModalError, setEbayPriceModalError] = useState<string | null>(null);
  const [previewPhoto, setPreviewPhoto] = useState<ImageSearchResult | null>(null);
  const [imageProviders, setImageProviders] = useState<ImageSearchProvider[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string>(''); // '' = auto (try all configured)

  useEffect(() => {
    getImageSearchProviders().then(setImageProviders);
  }, []);

  /** Controlled string so partial decimals like "17." work (parsing on each keystroke strips the dot). */
  const [buyPriceText, setBuyPriceText] = useState('');

  const compatWarnings = useMemo(() => {
    if (!formData.name) return [];
    return getCompatibilityWarnings(formData as InventoryItem, items);
  }, [formData, items]);

  useEffect(() => {
    // Priority: initialData (Modal/Prop) -> ID (URL) -> Default
    if (initialData) {
       setFormData(initialData);
       setConfigStep('DONE');
    } else if (id) {
      const existing = items.find(i => i.id === id);
      if (existing) {
        setFormData(existing);
        setConfigStep('DONE');
      }
    } else {
       // New item default
       setConfigStep('CATEGORY');
    }
  }, [id, items, initialData]);

  useEffect(() => {
    const bp = formData.buyPrice;
    setBuyPriceText(bp === undefined || bp === null ? '' : String(bp));
  }, [formData.buyPrice, formData.id]);

  useEffect(() => {
    setCustomSpecKeys(new Set());
  }, [id, initialData?.id]);

  useEffect(() => {
    if (!isRamItem(formData.category, formData.subCategory)) return;
    setFormData((prev) => {
      const sp = { ...(prev.specs || {}) } as Record<string, string | number | undefined>;
      let changed = false;
      if (String(sp['RAM Type'] ?? '').trim() && !String(sp['Memory Type'] ?? '').trim()) {
        sp['Memory Type'] = sp['RAM Type'] as string | number;
        delete sp['RAM Type'];
        changed = true;
      }
      const memStr = String(sp['Memory'] ?? '').trim();
      if (
        memStr &&
        /DDR/i.test(memStr) &&
        !String(sp['Memory Type'] ?? '').trim() &&
        !looksLikeRamCapacityMemoryField(memStr)
      ) {
        sp['Memory Type'] = sp['Memory'] as string | number;
        delete sp['Memory'];
        changed = true;
      }
      if (!changed) return prev;
      return { ...prev, specs: sp as Record<string, string | number> };
    });
  }, [formData.category, formData.subCategory, id, initialData?.id]);

  const compatibleGroups = useMemo(() => {
    const current = { ...formData, id: formData.id || 'temp' } as InventoryItem;
    return getCompatibleItemsForItem(current, items);
  }, [formData.category, formData.subCategory, formData.specs, formData.id, items]);

  const nameSuggestions = useMemo(() => {
    const q = (formData.name || '').trim().toLowerCase();
    if (q.length < 2) return [];
    return items
      .filter((i) => i.id !== formData.id && i.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [items, formData.name, formData.id]);

  const inventorySearchMatches = useMemo(
    () => searchInventoryItemsForAdd(items, formData.name || '', formData.id, 8),
    [items, formData.name, formData.id]
  );

  const learnedCategory = useMemo(
    () => (formData.name?.trim() ? suggestCategoryFromCorrections(formData.name) : null),
    [formData.name]
  );

  const applyItemFromHistory = useCallback((template: InventoryItem) => {
    setFormData((prev) => ({
      ...prev,
      name: template.name,
      category: template.category,
      subCategory: template.subCategory,
      specs: template.specs ? { ...template.specs } : {},
      specsAiSuggested: template.specsAiSuggested ? { ...template.specsAiSuggested } : undefined,
      vendor: template.vendor ?? prev.vendor,
      platformBought: template.platformBought ?? prev.platformBought,
      buyPaymentType: template.buyPaymentType ?? prev.buyPaymentType,
      comment1: template.comment1 ?? prev.comment1,
    }));
    setConfigStep('DONE');
    setNameSuggestionsOpen(false);
    setCategorySearchOpen(false);
    setAiDetectMessage(`Loaded from inventory: ${template.category} / ${template.subCategory || '—'}`);
    setAiDetectError(null);
  }, []);

  const handleAiDetectCategory = async () => {
    const name = (formData.name || '').trim();
    if (!name) {
      setAiDetectError('Type an item name in the search box first.');
      return;
    }
    setAiDetecting(true);
    setAiDetectError(null);
    setAiDetectMessage(null);
    try {
      const result = await detectItemCategory(name, categories);
      setFormData((prev) => ({
        ...prev,
        name: result.standardizedName || name,
        category: result.category,
        subCategory: result.subCategory,
      }));
      setConfigStep('DONE');
      const sourceLabel =
        result.source === 'ai' ? 'AI' : result.source === 'learned' ? 'learned from your past edits' : 'smart guess';
      setAiDetectMessage(`Detected (${sourceLabel}): ${result.category} / ${result.subCategory}`);
    } catch (e: unknown) {
      setAiDetectError((e as Error)?.message || 'Could not detect category.');
    } finally {
      setAiDetecting(false);
    }
  };

  const updateSpecField = useCallback((key: string, value: string) => {
    setFormData((prev) => {
      const nextSpecs = { ...(prev.specs || {}), [key]: value };
      const prevAi = prev.specsAiSuggested || {};
      const nextAi = { ...prevAi };
      if (Object.keys(nextAi).length && nextAi[key] !== undefined) {
        if (String(value).trim() !== String(nextAi[key]).trim()) {
          delete nextAi[key];
        }
      }
      return {
        ...prev,
        specs: nextSpecs,
        specsAiSuggested: Object.keys(nextAi).length ? nextAi : undefined,
      };
    });
  }, []);

  const handleAutoFillSpecs = async () => {
    if (!formData.name) return alert("Please enter an item name.");
    
    // Provide current category as context
    const categoryContext = formData.category || 'Unknown';
    setGeneratingSpecs(true);
    
    const activeKey = `${formData.category}:${formData.subCategory}`;
    const legacyFields = categoryFields[activeKey] || categoryFields[formData.category || ''] || [];
    const essential = getEssentialSpecFieldKeys(formData.category || '', formData.subCategory);
    const definedFields =
      essential.length > 0 ? [...essential] : legacyFields.slice(0, 12);

    try {
      const result = await generateItemSpecs(formData.name, categoryContext, definedFields);

      let newSpecs = { ...(formData.specs || {}) };
      const returnedSpecs = result.specs || {};
      const nextAi: Record<string, string | number> = { ...(formData.specsAiSuggested || {}) };

      // Loose match so AI phrasing variants (e.g. "CPU Socket" / "Base Clock Speed") still count
      // as the curated field rather than being rejected outright for not matching verbatim.
      const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
      const findCuratedMatch = (k: string) => {
        const nk = normKey(k);
        return (
          definedFields.find((df) => normKey(df) === nk) ||
          definedFields.find((df) => {
            const nd = normKey(df);
            return nk.includes(nd) || nd.includes(nk);
          })
        );
      };

      Object.entries(returnedSpecs).forEach(([k, v]) => {
        if (v === undefined || v === null || v === '') return;
        let keyToUse = definedFields.length > 0 ? findCuratedMatch(k) || k : k;
        if (formData.subCategory === 'RAM' && k.toLowerCase() === 'capacity' && !definedFields.some((df) => df.toLowerCase() === 'capacity')) {
          keyToUse = 'Kit Capacity';
        }
        if (formData.subCategory === 'Storage (SSD/HDD)' && k.toLowerCase() === 'type' && !definedFields.some((df) => df.toLowerCase() === 'type')) {
          keyToUse = 'Drive Type';
        }
        // Store whatever the AI returns (even fields beyond the curated list) so nothing is ever
        // silently lost to an imperfect name match — the compact editor only *displays* the
        // curated fields (see renderSpecsEditor), it doesn't need parsing itself to discard data.
        newSpecs[keyToUse] = v;
        nextAi[keyToUse] = v;
      });

      const updates: Partial<InventoryItem> = {
        specs: newSpecs as Record<string, string | number>,
        specsAiSuggested: Object.keys(nextAi).length ? nextAi : undefined,
      };

      // Parsing specs should never rename the item — the name you typed stays exactly as-is.
      if (result.vendor) {
         updates.vendor = result.vendor;
      }

      setFormData((prev) => ({ ...prev, ...updates }));
    } catch (e: any) {
      console.error(e);
      const msg = e?.message || 'Failed to look up specs.';
      alert(msg.includes('API key') ? `${msg}\n\nAdd the key in .env and restart the app.` : msg);
    } finally {
      setGeneratingSpecs(false);
    }
  };

  const normalizeImageList = (urls: (string | undefined | null)[]): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of urls) {
      const u = (raw || '').trim();
      if (!u || seen.has(u)) continue;
      seen.add(u);
      out.push(u);
    }
    return out;
  };

  // Excludes the category placeholder SVG (used as a fallback when an item has no real photo) —
  // it's not a real photo, and its data URI doesn't render as an <img>, showing a broken-image icon.
  const itemImageList = useMemo(
    () => normalizeImageList([formData.imageUrl, ...(formData.imageUrls || [])]).filter((u) => !isCategoryPlaceholderImage(u)),
    [formData.imageUrl, formData.imageUrls]
  );

  const addImageUrls = async (urls: string[]): Promise<string[]> => {
    const prepared = await prepareInventoryImagesForStorage(urls, { itemId: getPhotoItemId() });
    const merged = normalizeImageList([...itemImageList, ...prepared]);
    if (!merged.length) return [];
    setFormData((prev) => ({ ...prev, imageUrl: merged[0], imageUrls: merged }));
    return merged;
  };

  const setMainImage = (url: string) => {
    const merged = normalizeImageList([url, ...itemImageList.filter((u) => u !== url)]);
    setFormData((prev) => ({ ...prev, imageUrl: merged[0], imageUrls: merged }));
  };

  const removeImage = (url: string) => {
    const rest = itemImageList.filter((u) => u !== url);
    setFormData((prev) => ({
      ...prev,
      imageUrl: rest[0],
      imageUrls: rest.length ? rest : undefined,
    }));
  };

  const handleMultiImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    try {
      const urls = await filesToDataUrls(files, { itemId: getPhotoItemId() });
      await addImageUrls(urls);
    } catch {
      alert('Could not process one or more images.');
    } finally {
      e.target.value = '';
    }
  };

  /** True once the item has a real photo (not just the category SVG placeholder). */
  const hasUserPhotos = getItemUserPhotoCount(formData as InventoryItem) > 0;

  // Reuse a previously-found photo automatically: if this item has no real photo yet and another
  // item with the same product name already got a photo assigned, apply it here too — no re-search,
  // no re-clicking, until the user adds their own photos to the gallery.
  const cacheCheckedForNameRef = React.useRef<string | null>(null);
  useEffect(() => {
    const name = (formData.name || '').trim();
    if (!name || hasUserPhotos) return;
    if (cacheCheckedForNameRef.current === name) return;
    const timer = setTimeout(async () => {
      cacheCheckedForNameRef.current = name;
      const cached = await getCachedProductPhoto(name);
      if (!cached) return;
      // Re-check current state at resolve time — name or photos may have changed while awaiting.
      setFormData((prev) => {
        if ((prev.name || '').trim() !== name) return prev;
        if (getItemUserPhotoCount(prev as InventoryItem) > 0) return prev;
        const merged = normalizeImageList([cached, ...(prev.imageUrls || [])]);
        return { ...prev, imageUrl: merged[0], imageUrls: merged };
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [formData.name, hasUserPhotos]);

  const handleFindRealPhotos = async () => {
    if (!formData.name) return alert('Please enter an item name first.');
    setPhotoSearching(true);
    setPhotoSearchError(null);
    setPhotoSearchResults(null);
    try {
      const results = await searchProductPhotos(formData.name, 8, selectedProvider || undefined);
      if (results.length === 0) {
        setPhotoSearchError('No photos found for that name.');
        return;
      }
      // No real photo yet: auto-apply the top match as the default so it "just works" with one
      // click, while still showing the rest of the results in case you'd rather pick a different one.
      // Re-check freshly rather than trusting the `hasUserPhotos` captured when the button was
      // clicked — the cached-photo auto-fill effect can assign one while this search is in flight.
      const stillNoPhoto = getItemUserPhotoCount(formDataRef.current as InventoryItem) === 0;
      if (stillNoPhoto) {
        await handlePickSearchedPhoto(results[0], results.slice(1));
      } else {
        setPhotoSearchResults(results);
      }
    } catch (e: any) {
      setPhotoSearchError(e?.message || 'Photo search failed.');
    } finally {
      setPhotoSearching(false);
    }
  };

  const handleFromMyEbayListings = async () => {
    if (!formData.name) return alert('Please enter an item name first.');
    setEbayListingLoading(true);
    setEbayListingError(null);
    setEbayListingMatches(null);
    setExpandedEbayListingId(null);
    setSelectedEbayPhotosByListing({});
    setPhotoSearchResults(null);
    setPhotoSearchError(null);
    try {
      const all = await fetchMyEbayListings();
      if (!all.length) {
        setEbayListingError(`No active eBay listings found for seller ${getEbayUsername()}.`);
        return;
      }
      const matches = matchEbayListingsForItem(formData.name, all, formData.ebaySku);
      if (!matches.length) {
        setEbayListingError(
          `No listings matched "${formData.name}". You have ${all.length} active listing${all.length === 1 ? '' : 's'} — try a shorter search name.`
        );
        return;
      }
      setEbayListingMatches(matches);
    } catch (e: unknown) {
      setEbayListingError((e as Error)?.message || 'Failed to load your eBay listings.');
    } finally {
      setEbayListingLoading(false);
    }
  };

  const toggleEbayPhotoSelection = (listingId: string, url: string) => {
    setSelectedEbayPhotosByListing((prev) => {
      const current = new Set(prev[listingId] || []);
      if (current.has(url)) current.delete(url);
      else current.add(url);
      return { ...prev, [listingId]: Array.from(current) };
    });
  };

  const toggleEbayListingExpanded = (listingId: string) => {
    setExpandedEbayListingId((prev) => (prev === listingId ? null : listingId));
  };

  const selectAllEbayPhotos = (listing: EbayMyListing) => {
    setSelectedEbayPhotosByListing((prev) => ({
      ...prev,
      [listing.listingId]: [...listing.imageUrls],
    }));
  };

  const clearEbayPhotoSelection = (listingId: string) => {
    setSelectedEbayPhotosByListing((prev) => ({ ...prev, [listingId]: [] }));
  };

  const finalizeEbayListingImport = async (
    listing: EbayMyListing & { matchScore: number },
    urls: string[]
  ) => {
    if (!urls.length) return;
    setEbayImportingId(listing.listingId);
    try {
      const merged = await addImageUrls(urls);
      const priceMatch = ebayListingToPriceMatch(listing);
      setFormData((prev) => ({
        ...prev,
        listedOnEbay: true,
        ebayListingId: listing.listingId,
        ...(listing.sku ? { ebaySku: listing.sku } : {}),
        ...(listing.offerId ? { ebayOfferId: listing.offerId } : {}),
        ...(priceMatch ? { storePrice: priceMatch.roundedPrice } : {}),
      }));
      setEbayListingMatches(null);
      setExpandedEbayListingId(null);
      setSelectedEbayPhotosByListing({});
      if (formDataRef.current.name && merged[0]) {
        void setCachedProductPhoto(formDataRef.current.name, merged[0]);
      }
    } catch {
      alert('Could not import photos from this listing.');
    } finally {
      setEbayImportingId(null);
    }
  };

  const handleImportAllEbayListingPhotos = (listing: EbayMyListing & { matchScore: number }) => {
    void finalizeEbayListingImport(listing, listing.imageUrls);
  };

  const handleImportSelectedEbayPhotos = (listing: EbayMyListing & { matchScore: number }) => {
    const selected = selectedEbayPhotosByListing[listing.listingId] || [];
    if (!selected.length) {
      alert('Select at least one photo to import.');
      return;
    }
    void finalizeEbayListingImport(listing, selected);
  };

  const closeEbayPriceModal = () => {
    setEbayPriceModalOpen(false);
    setEbayPriceModalMatch(null);
    setEbayPriceModalError(null);
  };

  const handleFetchPriceFromEbayListing = (listing: EbayMyListing & { matchScore: number }) => {
    const match = ebayListingToPriceMatch(listing);
    if (!match) {
      setEbayPriceModalMatch(null);
      setEbayPriceModalError('This listing has no price on eBay.');
      setEbayPriceModalOpen(true);
      return;
    }
    setEbayPriceModalError(null);
    setEbayPriceModalMatch(match);
    setEbayPriceModalOpen(true);
  };

  const applyEbayListingPriceFromModal = (match: EbayListingPriceMatch) => {
    setFormData((prev) => ({
      ...prev,
      storePrice: match.roundedPrice,
      listedOnEbay: true,
      ebayListingId: match.listingId,
      ebaySku: prev.ebaySku || match.sku,
    }));
    closeEbayPriceModal();
  };

  const ebayFetchPriceButtonClass =
    'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-black uppercase tracking-widest hover:bg-amber-100 disabled:opacity-50';

  /** Picking a photo from search results replaces the current default entirely — search results
   * are alternatives for THE photo, not additions to a gallery, so ending up with the picked photo
   * plus whatever was there before (auto-picked, cached, or a prior search pick) would be wrong.
   * Use "Add images" separately if you want to keep multiple real photos. */
  const handlePickSearchedPhoto = async (result: ImageSearchResult, remaining?: ImageSearchResult[]) => {
    const prepared = await prepareInventoryImagesForStorage([result.url], { itemId: getPhotoItemId() });
    if (!prepared.length) return;
    const stored = prepared[0];
    setFormData((prev) => ({ ...prev, imageUrl: stored, imageUrls: [stored] }));
    setPhotoSearchResults(
      remaining !== undefined ? remaining : (prev) => (prev ? prev.filter((r) => r.url !== result.url) : prev)
    );
    if (formDataRef.current.name) {
      void setCachedProductPhoto(formDataRef.current.name, stored);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name) return;

    const isEditingExisting = Boolean(initialData || id);

    const buyParsed = parseLocaleNumber(buyPriceText);
    const buyPriceResolved = Number.isFinite(buyParsed) ? buyParsed : 0;

    const normalizedImages = normalizeImageList([formData.imageUrl, ...(formData.imageUrls || [])]);
    const fallbackImage = CATEGORY_IMAGES[formData.subCategory || formData.category || 'Components'];
    const saveItemId = formData.id || `item-${Date.now()}`;

    const specsOut =
      isRamItem(formData.category, formData.subCategory) && formData.specs
        ? normalizeRamSpecsForSave({ ...formData.specs })
        : formData.specs;

    const aiSuggested =
      formData.specsAiSuggested && Object.keys(formData.specsAiSuggested).length > 0
        ? formData.specsAiSuggested
        : undefined;

    let storedImages = normalizedImages;
    try {
      storedImages = await prepareInventoryImagesForStorage(normalizedImages, { itemId: saveItemId });
    } catch {
      storedImages = normalizedImages;
    }

    const base: InventoryItem = {
      ...formData as InventoryItem,
      buyPrice: buyPriceResolved,
      id: saveItemId,
      imageUrl: storedImages[0] || fallbackImage,
      imageUrls: storedImages.length ? storedImages : [fallbackImage],
      specs: specsOut ?? {},
      specsAiSuggested: aiSuggested,
    };

    let itemsToSave: InventoryItem[] = [];
    // If editing an existing item, or quantity is 1, just save one
    if (isEditingExisting || quantityToCreate <= 1) {
      itemsToSave = [base];
    } else {
      // Creating multiple new identical items
      const count = Math.max(1, Math.floor(quantityToCreate));
      itemsToSave = Array.from({ length: count }).map((_, index) => ({
        ...base,
        id: `item-${Date.now()}-${index}`,
      }));
    }

    onSave(itemsToSave);

    const prevCategory = initialData?.category;
    if (formData.category && prevCategory && formData.category !== prevCategory && formData.name) {
      recordCategoryCorrection(formData.name, formData.category);
    }
    
    // When creating multiple new items, stay on the form so the user can keep adding
    if (!isEditingExisting && quantityToCreate > 1) {
      // Keep the form open. Optionally, clear the quantity back to 1.
      setQuantityToCreate(1);
      return;
    }

    if (onClose) {
      onClose();
    } else {
      navigate(-1);
    }
  };

  const renderSpecsEditor = () => {
    const cat = formData.category || '';
    const sub = formData.subCategory || '';
    const legacyTemplate =
      categoryFields[`${cat}:${sub}`] || categoryFields[cat] || [];

    const essential = getEssentialSpecFieldKeys(cat, sub);
    // Fall back to whatever specs actually exist (parsed or manually entered) if this category has
    // neither a curated list nor a legacy template — otherwise real data could end up with nowhere
    // to render and look like parsing "did nothing" even though it succeeded.
    const basePrimary =
      essential.length > 0
        ? [...essential]
        : legacyTemplate.length > 0
          ? [...legacyTemplate.slice(0, 8)]
          : Object.keys(formData.specs || {});

    const primaryKeys = filterRamDuplicateSpecKeys(
      Array.from(new Set(basePrimary)),
      formData.category,
      formData.subCategory,
      formData.specs
    );

    const CUSTOM_OPTION = '__custom__';

    const renderSpecInputs = (keys: string[]) =>
      keys.map((key) => {
        const options = getSpecOptions(key).map(String);
        const hasPresets = options.length > 0;
        const rawVal = formData.specs?.[key];
        const value = rawVal === undefined || rawVal === null ? '' : String(rawVal);
        const aiRaw = formData.specsAiSuggested?.[key];
        const aiSuggested = aiRaw === undefined || aiRaw === null ? '' : String(aiRaw);
        // AI-filled fields get a visibly distinct blue-tinted input, not just a small badge,
        // so they're easy to scan at a glance rather than having to read every label.
        const isAiFilled = aiSuggested !== '' && String(value) === String(aiSuggested);
        const matchedOption = options.find((o) => o.toLowerCase() === value.toLowerCase());
        const manualMode = customSpecKeys.has(key) || !hasPresets;

        const toggleManual = (on: boolean) => {
          setCustomSpecKeys((prev) => {
            const next = new Set(prev);
            if (on) next.add(key);
            else next.delete(key);
            return next;
          });
        };

        return (
          <div key={key} className="space-y-1">
            <div className="flex items-center justify-between gap-2 min-h-[14px]">
              <label className="text-[10px] font-bold uppercase text-slate-400 truncate">{key}</label>
              {isAiFilled && (
                <span className="flex items-center gap-0.5 text-[9px] font-black uppercase text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded shrink-0">
                  <Wand2 size={9} /> AI
                </span>
              )}
            </div>

            {!manualMode ? (
              // Single control: AI already filled this in — pick a different option to override,
              // no separate "choose a preset" step needed.
              <select
                className={`w-full px-2.5 py-1.5 border rounded-lg text-xs font-bold outline-none focus:border-blue-500 ${isAiFilled ? 'bg-blue-50/70 border-blue-200' : 'bg-slate-50 border-slate-200'}`}
                value={matchedOption ?? (value ? CUSTOM_OPTION : '')}
                onChange={(e) => {
                  if (e.target.value === CUSTOM_OPTION) {
                    toggleManual(true);
                    return;
                  }
                  updateSpecField(key, e.target.value);
                }}
              >
                <option value="">— Select —</option>
                {value && !matchedOption && (
                  <option value={CUSTOM_OPTION}>{value} (current)</option>
                )}
                {options.map((opt) => {
                  const isAiPick = aiSuggested !== '' && String(aiSuggested) === String(opt);
                  return (
                    <option key={opt} value={opt}>
                      {isAiPick ? `✨ ${opt} (AI)` : opt}
                    </option>
                  );
                })}
                <option value={CUSTOM_OPTION}>Other (type manually)…</option>
              </select>
            ) : (
              <div className="flex gap-1">
                <input
                  autoFocus={hasPresets}
                  className={`w-full px-2.5 py-1.5 border rounded-lg text-xs font-bold outline-none focus:border-blue-500 ${isAiFilled ? 'bg-blue-50/70 border-blue-200 text-blue-900' : 'bg-white border-slate-200'}`}
                  value={value}
                  onChange={(e) => updateSpecField(key, e.target.value)}
                  placeholder="Enter value…"
                />
                {hasPresets && (
                  <button
                    type="button"
                    title="Back to preset list"
                    onClick={() => toggleManual(false)}
                    className="shrink-0 px-2 rounded-lg border border-slate-200 bg-slate-50 text-slate-400 hover:text-blue-600 hover:border-blue-300 text-xs"
                  >
                    <ChevronDown size={13} />
                  </button>
                )}
              </div>
            )}
          </div>
        );
      });

    return (
      <div className="space-y-2.5">
        <p className="text-[10px] font-bold text-slate-400">
          Blue = AI-filled · pick a different option to override, or "Other" to type a custom value
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-2.5">{renderSpecInputs(primaryKeys)}</div>
      </div>
    );
  };

  const renderCategorySelection = () => (
     <div className="space-y-6 animate-in slide-in-from-right-4">
        <div className="bg-white border border-slate-200 rounded-[2rem] p-5 md:p-6 shadow-sm space-y-3">
           <div>
              <h2 className="text-xl font-black text-slate-900">Find or name your item</h2>
              <p className="text-sm text-slate-500 mt-1">
                 Search items already in inventory, or type a new name and let AI pick category & subcategory.
              </p>
           </div>
           <div className="flex flex-col sm:flex-row gap-2 sm:items-stretch">
              <div className="relative flex-1 min-w-0">
                 <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                 <input
                    autoFocus={!id && !initialData}
                    className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-sm outline-none focus:border-violet-400 focus:bg-white transition-all"
                    placeholder="Search inventory or type new item name…"
                    value={formData.name || ''}
                    onChange={(e) => {
                      setFormData({ ...formData, name: e.target.value });
                      setCategorySearchOpen(true);
                      setAiDetectError(null);
                    }}
                    onFocus={() => setCategorySearchOpen(true)}
                    onBlur={() => setTimeout(() => setCategorySearchOpen(false), 200)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleAiDetectCategory();
                      }
                    }}
                 />
                 {categorySearchOpen && inventorySearchMatches.length > 0 && (
                    <ul className="absolute z-30 left-0 right-0 mt-1 py-2 bg-white border border-slate-200 rounded-2xl shadow-xl max-h-60 overflow-y-auto">
                       <li className="px-4 py-2 text-[10px] font-black uppercase text-slate-400 border-b border-slate-100">
                          Already in inventory — pick to copy details
                       </li>
                       {inventorySearchMatches.map((item) => (
                          <li
                             key={item.id}
                             className="px-4 py-3 hover:bg-slate-50 cursor-pointer border-b border-slate-50 last:border-0"
                             onMouseDown={(e) => {
                                e.preventDefault();
                                applyItemFromHistory(item as InventoryItem);
                             }}
                          >
                             <p className="font-bold text-slate-900 text-sm">{item.name}</p>
                             <p className="text-xs text-slate-500 mt-0.5">
                                {item.category} / {item.subCategory || '—'}
                                {item.vendor ? ` · ${item.vendor}` : ''}
                             </p>
                          </li>
                       ))}
                    </ul>
                 )}
              </div>
              <button
                 type="button"
                 onClick={() => void handleAiDetectCategory()}
                 disabled={aiDetecting || !(formData.name || '').trim()}
                 className="shrink-0 inline-flex items-center justify-center gap-2 px-5 py-3 rounded-full bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-[11px] font-black uppercase tracking-widest shadow-lg shadow-violet-500/25 hover:from-violet-700 hover:to-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                 <Wand2 size={14} className={aiDetecting ? 'animate-spin' : ''} />
                 {aiDetecting ? 'Detecting…' : 'AI Detect'}
              </button>
           </div>
           {aiDetectError && (
              <p className="text-xs font-bold text-red-700 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
                 {aiDetectError}
              </p>
           )}
           {aiDetectMessage && (
              <p className="text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                 {aiDetectMessage}
              </p>
           )}
           {learnedCategory && (
              <p className="text-[10px] font-bold text-indigo-700">
                 Tip: past edits suggest category <span className="font-black">{learnedCategory}</span> for similar names.
              </p>
           )}
        </div>

        <h2 className="text-2xl font-black text-slate-900">Or select category manually</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
           {Object.keys(categories).map(cat => (
              <button 
                 key={cat}
                 onClick={() => setFormData({ ...formData, category: cat })}
                 className={`p-6 rounded-[2rem] border-2 text-left transition-all group relative overflow-hidden ${formData.category === cat ? 'bg-blue-600 border-blue-600 text-white shadow-xl' : 'bg-white border-slate-100 hover:border-blue-200'}`}
              >
                 <span className="relative z-10 font-black text-lg">{cat}</span>
                 {formData.category === cat && <CheckCircle2 className="absolute top-4 right-4 text-white/20" size={40}/>}
              </button>
           ))}
        </div>
        
        {formData.category && (
           <div className="space-y-4 pt-6 border-t border-slate-100">
              <h3 className="text-sm font-bold text-slate-500 uppercase tracking-widest">Subcategory</h3>
              <div className="flex flex-wrap gap-2">
                 {categories[formData.category]?.map(sub => (
                    <button 
                       key={sub}
                       onClick={() => {
                          setFormData({ ...formData, subCategory: sub });
                          setConfigStep('DONE');
                       }}
                       className={`px-5 py-3 rounded-xl font-bold text-xs transition-all ${formData.subCategory === sub ? 'bg-slate-900 text-white shadow-lg' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                    >
                       {sub}
                    </button>
                 ))}
                 {!categories[formData.category] && (
                    <p className="text-xs text-red-400 font-bold">Category '{formData.category}' config not found.</p>
                 )}
              </div>
           </div>
        )}
     </div>
  );

  const containerClass = isModal ? "h-full flex flex-col" : "max-w-4xl mx-auto space-y-6 pb-16 animate-in fade-in duration-400";
  const isSold = formData.status === ItemStatus.SOLD || formData.status === ItemStatus.TRADED || formData.status === ItemStatus.GIFTED;

  return (
    <div className={containerClass}>
      {!isModal && (
        <header className="flex items-center justify-between gap-4 mb-2">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(-1)}
              className="p-2.5 bg-white border border-slate-200 rounded-2xl text-slate-400 hover:text-slate-900 transition-all"
            >
              <ArrowLeft size={22} />
            </button>
            <div>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                {id ? 'Edit Item' : 'New Asset'}
              </h1>
              <p className="text-xs text-slate-500 font-bold">
                Quick add for inventory: name, price, condition, marketplaces & specs.
              </p>
            </div>
          </div>
        </header>
      )}

      {compatWarnings.length > 0 && (
        <div className="space-y-1">
          {compatWarnings.map((w, i) => (
            <p key={i} className={`text-xs font-bold px-3 py-2 rounded-xl ${w.level === 'error' ? 'bg-red-50 text-red-700 border border-red-100' : 'bg-amber-50 text-amber-800 border border-amber-100'}`}>
              {w.message}
            </p>
          ))}
        </div>
      )}

      {isModal && configStep === 'DONE' && (
         <div className="mb-3 shrink-0">
            <h2 className="text-base font-black text-slate-900">Editing Asset</h2>
            <p
              className="text-xs text-slate-500 truncate"
              title={formData.name}
            >
              {formData.name}
            </p>
         </div>
      )}

      <div className={`flex-1 ${isModal ? 'overflow-y-auto scrollbar-hide -mx-4 px-4' : ''}`}>
        {configStep === 'CATEGORY' ? renderCategorySelection() : (
           <form onSubmit={handleSave} className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
              <div className="lg:col-span-7 space-y-4">
                 <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 space-y-4">
                    {/* Basic Info */}
                   <div className="space-y-3">
                      <div className="space-y-1.5">
                          <label className="text-[10px] font-black uppercase text-slate-400 ml-1 tracking-widest">Item Name</label>
                          <div className="flex gap-2 items-stretch">
                            <div className="relative flex-1">
                              <input
                                 autoFocus={!id && !initialData}
                                 className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-black text-base outline-none focus:border-blue-500 focus:bg-white transition-all"
                                 placeholder="e.g. MSI GeForce RTX 3060 Gaming X — type to suggest from history"
                                 value={formData.name}
                                 onChange={e => setFormData({ ...formData, name: e.target.value })}
                                 onFocus={() => setNameSuggestionsOpen(true)}
                                 onBlur={() => setTimeout(() => setNameSuggestionsOpen(false), 180)}
                              />
                              {nameSuggestionsOpen && nameSuggestions.length > 0 && (
                                <ul className="absolute z-20 left-0 right-0 mt-1 py-2 bg-white border border-slate-200 rounded-xl shadow-xl max-h-56 overflow-y-auto">
                                  <li className="px-4 py-2 text-[10px] font-black uppercase text-slate-400 border-b border-slate-100">
                                    Pick from history to copy category, specs & more
                                  </li>
                                  {nameSuggestions.map((item) => (
                                    <li
                                      key={item.id}
                                      className="px-4 py-3 hover:bg-slate-50 cursor-pointer border-b border-slate-50 last:border-0"
                                      onMouseDown={(e) => {
                                        e.preventDefault();
                                        applyItemFromHistory(item);
                                      }}
                                    >
                                      <p className="font-bold text-slate-900">{item.name}</p>
                                      <p className="text-xs text-slate-500 mt-0.5">
                                        {item.category} / {item.subCategory || '—'}
                                        {item.vendor ? ` · ${item.vendor}` : ''}
                                      </p>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                            {learnedCategory && learnedCategory !== formData.category && (
                              <button
                                type="button"
                                onClick={() => setFormData((prev) => ({ ...prev, category: learnedCategory }))}
                                className="shrink-0 text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-1 rounded-lg hover:bg-indigo-100 self-center"
                              >
                                Learned: {learnedCategory}
                              </button>
                            )}
                          </div>
                       </div>
                       <div className="grid grid-cols-3 gap-2.5">
                          <div className="space-y-1.5">
                             <label className="text-[10px] font-black uppercase text-slate-400 ml-1 tracking-widest">Buy Price (€)</label>
                             <input
                                type="text"
                                inputMode="decimal"
                                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-black text-base outline-none focus:border-blue-500 focus:bg-white transition-all"
                                value={buyPriceText}
                                onChange={(e) => setBuyPriceText(e.target.value)}
                                onBlur={() => {
                                  const n = parseLocaleNumber(buyPriceText);
                                  if (Number.isFinite(n)) {
                                    setFormData((prev) => ({ ...prev, buyPrice: n }));
                                    setBuyPriceText(String(n));
                                  } else if (buyPriceText.trim() === '') {
                                    setFormData((prev) => ({ ...prev, buyPrice: 0 }));
                                    setBuyPriceText('');
                                  } else {
                                    setBuyPriceText(
                                      String(formData.buyPrice !== undefined && formData.buyPrice !== null ? formData.buyPrice : 0)
                                    );
                                  }
                                }}
                             />
                          </div>
                          <div className="space-y-1.5">
                             <label className="text-[10px] font-black uppercase text-slate-400 ml-1 tracking-widest">Buy Date</label>
                             <input
                                type="date"
                                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:border-blue-500 focus:bg-white transition-all"
                                value={formData.buyDate}
                                onChange={e => setFormData({ ...formData, buyDate: e.target.value })}
                             />
                          </div>
                          {!initialData && !id && (
                            <div className="space-y-1.5">
                              <label className="text-[10px] font-black uppercase text-slate-400 ml-1 tracking-widest">Quantity</label>
                              <input
                                type="number"
                                min={1}
                                className="w-full px-3 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-black text-sm outline-none focus:border-blue-500 focus:bg-white transition-all"
                                value={quantityToCreate}
                                onChange={e => setQuantityToCreate(Number(e.target.value) || 1)}
                              />
                            </div>
                          )}
                       </div>
                    </div>

                    {/* Specs & AI */}
                    <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
                      <div className="flex justify-between items-center gap-2 flex-wrap">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setShowSpecs((v) => !v)}
                            className="w-6 h-6 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-500 hover:bg-slate-100 shrink-0"
                            title={showSpecs ? 'Hide specs' : 'Show specs'}
                          >
                            <ChevronDown
                              size={13}
                              className={`transition-transform ${showSpecs ? '' : '-rotate-90'}`}
                            />
                          </button>
                          <h3 className="text-sm font-black text-slate-900 flex items-center gap-1.5">
                            <Sliders size={15} /> Tech Specs
                          </h3>
                        </div>
                         <button
                            type="button"
                            onClick={handleAutoFillSpecs}
                            disabled={generatingSpecs || !formData.name}
                            title="Look up this product (e.g. i7-12700K) and fill in specs from the web — cores, threads, clock, TDP, etc. Adds new spec fields if needed."
                            className="text-[10px] font-black uppercase bg-blue-600 text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5 hover:bg-blue-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                         >
                            {generatingSpecs ? <Wand2 size={12} className="animate-spin"/> : <Wand2 size={12}/>}
                            {generatingSpecs ? 'Looking up specs…' : `Parse AI specs${getSpecsAIProvider() ? ` (${getSpecsAIProvider()})` : ''}`}
                         </button>
                      </div>
                      {showSpecs && renderSpecsEditor()}
                    </div>

                    {/* Compatible with (CPU / Motherboard / RAM) — beyond PC Builder */}
                    {compatibleGroups.length > 0 && (
                      <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 space-y-2.5">
                        <h3 className="text-sm font-black text-slate-900 flex items-center gap-1.5">
                          <LinkIcon size={15} className="text-blue-500" />
                          Compatible with
                        </h3>
                        <div className="space-y-2.5">
                          {compatibleGroups.map((group) => (
                            <div key={group.label}>
                              <p className="text-[10px] font-black uppercase text-slate-400 mb-1.5">{group.label}</p>
                              <ul className="flex flex-wrap gap-1.5">
                                {group.items.map((i) => (
                                  <li key={i.id}>
                                    <Link
                                      to={`/panel/edit/${i.id}`}
                                      className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-700 hover:border-blue-300 hover:text-blue-600 transition-all"
                                    >
                                      {i.name}
                                    </Link>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <label className="text-[10px] font-black uppercase text-slate-400 ml-1 tracking-widest">Item Photos</label>
                        {imageProviders.length > 0 && (
                          <div className="flex items-center gap-1 flex-wrap">
                            <button
                              type="button"
                              onClick={() => setSelectedProvider('')}
                              title="Try every configured provider until one returns results"
                              className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border transition-colors ${
                                selectedProvider === ''
                                  ? 'bg-slate-900 text-white border-slate-900'
                                  : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                              }`}
                            >
                              Auto
                            </button>
                            {imageProviders.map((p) => (
                              <button
                                key={p.name}
                                type="button"
                                disabled={!p.configured}
                                onClick={() => setSelectedProvider(p.name)}
                                title={p.configured ? `Only use ${p.label}` : `${p.label} is not set up (missing API key on Vercel)`}
                                className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                                  selectedProvider === p.name
                                    ? 'bg-blue-600 text-white border-blue-600'
                                    : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
                                }`}
                              >
                                {p.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex items-center justify-end gap-1.5 flex-wrap">
                        <button
                          type="button"
                          onClick={handleFindRealPhotos}
                          disabled={photoSearching || !formData.name}
                          title="Search real product photos for this item name and use one as the default photo"
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Search size={12} className={photoSearching ? 'animate-spin' : ''} />
                          {photoSearching ? 'Searching…' : 'Find real photos'}
                        </button>
                        <button
                          type="button"
                          onClick={handleFromMyEbayListings}
                          disabled={ebayListingLoading || !formData.name}
                          title={`Match this item name against your eBay seller store (${getEbayUsername()}) and import photos`}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-blue-200 text-blue-700 text-[10px] font-black uppercase tracking-widest hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <ShoppingBag size={12} className={ebayListingLoading ? 'animate-pulse' : ''} />
                          {ebayListingLoading ? 'Loading…' : 'My eBay photos'}
                        </button>
                        <label className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-[10px] font-black uppercase tracking-widest text-slate-600 cursor-pointer hover:bg-slate-50">
                          <Upload size={12} /> Add images
                          <input type="file" accept="image/*" multiple className="hidden" onChange={handleMultiImageUpload} />
                        </label>
                      </div>

                      {photoSearchError && (
                        <p className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                          {photoSearchError}
                        </p>
                      )}
                      {ebayListingError && (
                        <p className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                          {ebayListingError}
                        </p>
                      )}
                      {ebayListingMatches && ebayListingMatches.length > 0 && (
                        <div className="rounded-2xl border border-blue-200 bg-blue-50/40 p-3 space-y-2.5 shadow-sm">
                          <div className="flex items-center justify-between px-0.5 gap-2">
                            <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">
                              {ebayListingMatches.length} matching eBay listing{ebayListingMatches.length === 1 ? '' : 's'}
                            </p>
                            <button
                              type="button"
                              onClick={() => setEbayListingMatches(null)}
                              className="text-[10px] font-bold text-slate-400 hover:text-slate-700"
                            >
                              Dismiss
                            </button>
                          </div>
                          <div className="space-y-2">
                            {ebayListingMatches.map((listing) => {
                              const expanded = expandedEbayListingId === listing.listingId;
                              const selected = selectedEbayPhotosByListing[listing.listingId] || [];
                              const selectedSet = new Set(selected);
                              const importing = ebayImportingId === listing.listingId;

                              return (
                              <div
                                key={listing.listingId}
                                className="rounded-xl bg-white border border-slate-200 overflow-hidden"
                              >
                                <div className="flex items-start gap-3 p-2.5">
                                  {listing.thumbnail ? (
                                    <img
                                      src={listing.thumbnail}
                                      alt=""
                                      className="w-14 h-14 rounded-lg object-cover border border-slate-100 shrink-0"
                                    />
                                  ) : (
                                    <div className="w-14 h-14 rounded-lg bg-slate-100 border border-slate-200 shrink-0" />
                                  )}
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-bold text-slate-900 leading-snug line-clamp-2">{listing.title}</p>
                                    <p className="text-[10px] text-slate-500 mt-0.5">
                                      {listing.imageUrls.length} photo{listing.imageUrls.length === 1 ? '' : 's'}
                                      {listing.price != null && listing.price > 0 ? (
                                        <> · €{formatEUR(listing.price)} on eBay</>
                                      ) : null}
                                      {listing.listingUrl ? (
                                        <>
                                          {' · '}
                                          <a
                                            href={listing.listingUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-blue-600 hover:underline"
                                          >
                                            View on eBay
                                          </a>
                                        </>
                                      ) : null}
                                    </p>
                                    <div className="mt-2 flex flex-wrap gap-1.5">
                                      <button
                                        type="button"
                                        disabled={importing || listing.imageUrls.length === 0}
                                        onClick={() => handleImportAllEbayListingPhotos(listing)}
                                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-blue-700 disabled:opacity-50"
                                      >
                                        <Upload size={11} />
                                        {importing ? 'Importing…' : `Import all ${listing.imageUrls.length}`}
                                      </button>
                                      <button
                                        type="button"
                                        disabled={importing || listing.imageUrls.length === 0}
                                        onClick={() => toggleEbayListingExpanded(listing.listingId)}
                                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-blue-200 text-blue-700 text-[10px] font-black uppercase tracking-widest hover:bg-blue-50 disabled:opacity-50"
                                      >
                                        {expanded ? 'Hide photos' : 'Pick photos'}
                                      </button>
                                      <button
                                        type="button"
                                        disabled={importing}
                                        onClick={() => handleFetchPriceFromEbayListing(listing)}
                                        className={ebayFetchPriceButtonClass}
                                      >
                                        + Fetch price
                                      </button>
                                    </div>
                                  </div>
                                </div>

                                {expanded && listing.imageUrls.length > 0 && (
                                  <div className="px-2.5 pb-2.5 pt-0 border-t border-slate-100 space-y-2">
                                    <div className="flex items-center justify-between gap-2 pt-2">
                                      <p className="text-[10px] font-bold text-slate-500">
                                        Click photos to select · {selected.length} selected
                                      </p>
                                      <div className="flex gap-2">
                                        <button
                                          type="button"
                                          onClick={() => selectAllEbayPhotos(listing)}
                                          className="text-[10px] font-bold text-blue-600 hover:underline"
                                        >
                                          Select all
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => clearEbayPhotoSelection(listing.listingId)}
                                          className="text-[10px] font-bold text-slate-400 hover:text-slate-700"
                                        >
                                          Clear
                                        </button>
                                        <button
                                          type="button"
                                          disabled={importing}
                                          onClick={() => handleFetchPriceFromEbayListing(listing)}
                                          className="text-[10px] font-bold text-amber-700 hover:underline disabled:opacity-50"
                                        >
                                          + Fetch price
                                        </button>
                                      </div>
                                    </div>
                                    <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
                                      {listing.imageUrls.map((url) => {
                                        const isSelected = selectedSet.has(url);
                                        return (
                                          <button
                                            key={url}
                                            type="button"
                                            title={isSelected ? 'Deselect photo' : 'Select photo'}
                                            onClick={() => toggleEbayPhotoSelection(listing.listingId, url)}
                                            className={`relative aspect-square rounded-xl overflow-hidden bg-slate-100 ring-2 transition-all ${
                                              isSelected
                                                ? 'ring-blue-500 shadow-md'
                                                : 'ring-slate-200 hover:ring-blue-300'
                                            }`}
                                          >
                                            <img
                                              src={url}
                                              alt=""
                                              className="w-full h-full object-cover"
                                              onError={(e) => {
                                                (e.currentTarget as HTMLImageElement).style.display = 'none';
                                              }}
                                            />
                                            {isSelected && (
                                              <span className="absolute top-1.5 right-1.5 bg-blue-600 text-white rounded-full p-0.5 shadow">
                                                <CheckCircle2 size={12} />
                                              </span>
                                            )}
                                          </button>
                                        );
                                      })}
                                    </div>
                                    <button
                                      type="button"
                                      disabled={importing || selected.length === 0}
                                      onClick={() => handleImportSelectedEbayPhotos(listing)}
                                      className="w-full inline-flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-lg bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest hover:bg-slate-800 disabled:opacity-40"
                                    >
                                      <Upload size={11} />
                                      {importing
                                        ? 'Importing…'
                                        : `Import selected (${selected.length})`}
                                    </button>
                                  </div>
                                )}
                              </div>
                            );
                            })}
                          </div>
                        </div>
                      )}
                      {photoSearchResults && photoSearchResults.length > 0 && (
                        <div className="rounded-2xl border border-slate-200 bg-white p-3 space-y-2.5 shadow-sm">
                          <div className="flex items-center justify-between px-0.5">
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">
                              {photoSearchResults.length} photo{photoSearchResults.length === 1 ? '' : 's'} found
                            </p>
                            <button
                              type="button"
                              onClick={() => setPhotoSearchResults(null)}
                              className="text-[10px] font-bold text-slate-400 hover:text-slate-700"
                            >
                              Dismiss
                            </button>
                          </div>
                          <div className="grid grid-cols-3 md:grid-cols-5 gap-2.5">
                            {photoSearchResults.map((r) => (
                              <button
                                key={r.url}
                                type="button"
                                title={r.title}
                                onClick={() => setPreviewPhoto(r)}
                                className="group relative aspect-square rounded-xl overflow-hidden bg-slate-100 ring-1 ring-slate-200 hover:ring-2 hover:ring-blue-400 hover:shadow-md transition-all duration-150"
                              >
                                <img
                                  src={r.thumbnail}
                                  alt=""
                                  className="w-full h-full object-cover"
                                  onError={(e) => {
                                    (e.currentTarget as HTMLImageElement).style.display = 'none';
                                  }}
                                />
                                <span className="absolute inset-0 bg-slate-900/0 group-hover:bg-slate-900/30 transition-colors flex items-center justify-center">
                                  <span className="opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 rounded-full p-1.5 shadow">
                                    <Search size={13} className="text-slate-700" />
                                  </span>
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      <input
                        className="w-full px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-xs outline-none focus:border-blue-500 focus:bg-white transition-all"
                        placeholder="Paste image URL and press Enter"
                        onKeyDown={async (e) => {
                          if (e.key !== 'Enter') return;
                          e.preventDefault();
                          const el = e.currentTarget;
                          const value = el.value.trim();
                          if (!value) return;
                          await addImageUrls([value]);
                          el.value = '';
                        }}
                      />
                      {itemImageList.length > 0 && (
                        <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
                          {itemImageList.map((url) => {
                            const isMain = formData.imageUrl === url;
                            // A picked photo's external URL can go dead later (hotlink protection, source
                            // deleted it, etc.) — auto-drop it here rather than leaving a permanent broken tile.
                            // Only URLs that actually fail to load are removed; everything else stays untouched.
                            return (
                              <div key={url} className={`p-1.5 rounded-lg border ${isMain ? 'border-blue-300 bg-blue-50/60' : 'border-slate-200 bg-white'}`}>
                                <img
                                  src={url}
                                  alt=""
                                  className="w-full h-16 object-cover rounded-md border border-slate-200 bg-slate-100"
                                  onError={() => removeImage(url)}
                                />
                                <div className="flex items-center justify-between mt-1.5 gap-1">
                                  <button
                                    type="button"
                                    onClick={() => setMainImage(url)}
                                    className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded ${isMain ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                                  >
                                    {isMain ? 'Main' : 'Set'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => removeImage(url)}
                                    className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded bg-red-50 text-red-600 hover:bg-red-100"
                                  >
                                    Remove
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {/* Description / Notes */}
                      <div className="space-y-1.5">
                         <label className="text-[10px] font-black uppercase text-slate-400 ml-1 tracking-widest">Notes / Condition</label>
                         <textarea
                            className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium text-xs outline-none focus:border-blue-500 focus:bg-white transition-all h-20 resize-none"
                            placeholder="e.g. Minor scratches, box included..."
                            value={formData.comment1}
                            onChange={e => setFormData({ ...formData, comment1: e.target.value })}
                         />
                      </div>

                      {/* AI Listing Text (Kleinanzeigen / eBay, DE) */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] font-black uppercase text-slate-400 ml-1 tracking-widest">
                            AI Listing Text (DE)
                          </label>
                          {formData.marketDescription && (
                            <button
                              type="button"
                              onClick={async () => {
                                if (!formData.marketDescription) return;
                                try {
                                  await navigator.clipboard.writeText(formData.marketDescription);
                                  // lightweight inline feedback
                                  const el = document.createElement('div');
                                  el.textContent = 'Copied';
                                  el.className = 'ml-2 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200';
                                  const parent = (event?.currentTarget as HTMLElement)?.parentElement;
                                  if (parent) {
                                    parent.appendChild(el);
                                    setTimeout(() => parent.removeChild(el), 900);
                                  }
                                } catch (e) {
                                  console.error('Copy AI listing text failed', e);
                                  alert('Could not copy AI listing text.');
                                }
                              }}
                              className="mr-1 text-[10px] font-bold uppercase tracking-widest text-blue-600 hover:text-blue-800"
                            >
                              Copy
                            </button>
                          )}
                        </div>
                        <textarea
                          className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-medium text-xs outline-none focus:border-blue-500 focus:bg-white transition-all h-20 resize-y"
                          placeholder="AI generated Kleinanzeigen / eBay Beschreibung erscheint hier, nachdem du im Inventar auf die K/E-Icons geklickt hast..."
                          value={formData.marketDescription || ''}
                          onChange={e => setFormData({ ...formData, marketDescription: e.target.value })}
                        />
                      </div>
                    </div>
                 </div>
              </div>

              <div className="lg:col-span-5 space-y-4">
                 {/* Category / source / payment */}
                 <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 space-y-3">
                    <h3 className="font-black text-xs uppercase tracking-widest text-slate-400">Purchase Info</h3>

                    <div className="grid grid-cols-2 gap-2.5">
                      <div className="col-span-2 space-y-1">
                         <label className="text-[10px] font-bold text-slate-400">Category</label>
                         <button type="button" onClick={() => setConfigStep('CATEGORY')} className="w-full text-left px-3 py-2.5 bg-slate-50 rounded-xl font-bold text-sm flex justify-between items-center group hover:bg-slate-100">
                            <span className="truncate">{formData.category} / {formData.subCategory}</span>
                            <ChevronDown size={14} className="text-slate-400 group-hover:text-slate-600 shrink-0 ml-1"/>
                         </button>
                      </div>

                      <div className="space-y-1">
                         <label className="text-[10px] font-bold text-slate-400">Source Platform</label>
                         <select
                            className="w-full px-3 py-2.5 bg-slate-50 rounded-xl font-bold text-xs outline-none"
                            value={formData.platformBought}
                            onChange={e => setFormData({ ...formData, platformBought: e.target.value as Platform })}
                         >
                            <option value="kleinanzeigen.de">Kleinanzeigen</option>
                            <option value="ebay.de">eBay</option>
                            <option value="Amazon">Amazon</option>
                            <option value="Other">Other</option>
                         </select>
                      </div>

                      <div className="space-y-1">
                         <label className="text-[10px] font-bold text-slate-400">Payment Sent</label>
                         <select
                            className="w-full px-3 py-2.5 bg-slate-50 rounded-xl font-bold text-xs outline-none"
                            value={formData.buyPaymentType}
                            onChange={e => setFormData({ ...formData, buyPaymentType: e.target.value as PaymentType })}
                         >
                            {PAYMENT_METHODS.map(p => <option key={p} value={p}>{p}</option>)}
                         </select>
                      </div>
                    </div>
                 </div>

                 {/* Price & sale history */}
                 <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 space-y-2.5">
                    <h3 className="font-black text-xs uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                      <History size={13} /> Price & sale history
                    </h3>
                    <div className="space-y-2 text-xs">
                      <div className="flex items-center gap-2 text-slate-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                        <span className="font-bold">Acquired</span>
                        <span className="text-slate-500">{formData.buyDate ? new Date(formData.buyDate).toLocaleDateString() : '—'}</span>
                        <span className="font-black text-slate-900">€{formatEUR(Number(formData.buyPrice || 0))}</span>
                      </div>
                      {(formData.priceHistory || []).slice().sort((a, b) => a.date.localeCompare(b.date)).map((entry, i) => (
                        <div key={`${entry.date}-${entry.type}-${i}`} className="flex items-center gap-2 text-slate-600 pl-3.5 border-l-2 border-slate-200 ml-0.5">
                          <span className="font-medium">{entry.type === 'buy' ? 'Cost' : entry.type === 'storePrice' ? 'Storefront price' : 'Sell price'} updated</span>
                          <span className="text-slate-400">{new Date(entry.date).toLocaleDateString()}</span>
                          {entry.previousPrice != null && (
                            <span className="text-slate-400">€{formatEUR(entry.previousPrice)} →</span>
                          )}
                          <span className="font-bold text-slate-800">€{formatEUR(entry.price)}</span>
                        </div>
                      ))}
                      {(formData.status === ItemStatus.SOLD || formData.status === ItemStatus.TRADED || formData.status === ItemStatus.GIFTED) && formData.sellDate && (
                        <div className="flex items-center gap-2 text-emerald-700 font-bold pt-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                          <span>Sold</span>
                          <span className="text-slate-500 font-medium">{new Date(formData.sellDate).toLocaleDateString()}</span>
                          <span>€{formatEUR(formData.sellPrice ?? 0)}</span>
                        </div>
                      )}
                      {!(formData.priceHistory && formData.priceHistory.length > 0) && formData.status !== ItemStatus.SOLD && formData.status !== ItemStatus.TRADED && formData.status !== ItemStatus.GIFTED && (
                        <p className="text-slate-400 text-[10px]">Price changes will appear here when you edit buy or sell price.</p>
                      )}
                    </div>
                 </div>

                 {/* OVP & IO Blende – used by AI description generator */}
                 <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 space-y-2.5">
                    <h3 className="font-black text-xs uppercase tracking-widest text-slate-400">AI Description Hints</h3>
                    <div className="flex flex-col gap-2">
                       <label className="flex items-center gap-2 cursor-pointer">
                          <input
                             type="checkbox"
                             checked={!!formData.hasOVP}
                             onChange={e => setFormData({ ...formData, hasOVP: e.target.checked })}
                             className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="text-xs font-bold text-slate-700">OVP (Original Packaging)</span>
                       </label>
                       {(formData.isBundle || formData.subCategory === 'Motherboards' || formData.category === 'Motherboards') && (
                          <label className="flex items-center gap-2 cursor-pointer">
                             <input
                                type="checkbox"
                                checked={!!formData.hasIOShield}
                                onChange={e => setFormData({ ...formData, hasIOShield: e.target.checked })}
                                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                             />
                             <span className="text-xs font-bold text-slate-700">IO Blende</span>
                          </label>
                       )}
                       <label className="flex items-center gap-2 cursor-pointer">
                          <input
                             type="checkbox"
                             checked={!!formData.usesDifferentialVat}
                             onChange={e => setFormData({ ...formData, usesDifferentialVat: e.target.checked })}
                             className="w-4 h-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                          />
                          <span className="text-xs font-bold text-slate-700">§25a Differenzbesteuerung (Gebrauchtware)</span>
                       </label>
                    </div>
                 </div>

                 {isSold && (
                    <div className="bg-emerald-50/60 p-4 rounded-2xl border border-emerald-100 space-y-2.5 animate-in slide-in-from-bottom-2 fade-in">
                       <h3 className="font-black text-xs uppercase tracking-widest text-emerald-600">Sales Info</h3>

                       <div className="grid grid-cols-2 gap-2.5">
                         <div className="space-y-1">
                            <label className="text-[10px] font-bold text-emerald-700/70">Sold On</label>
                            <select
                               className="w-full px-3 py-2.5 bg-white text-emerald-900 border border-emerald-200 rounded-xl font-bold text-xs outline-none"
                               value={formData.platformSold || ''}
                               onChange={e => setFormData({ ...formData, platformSold: (e.target.value || undefined) as Platform | undefined })}
                            >
                               <option value="">— Select platform —</option>
                               {SALE_PLATFORM_OPTIONS.map((p) => (
                                 <option key={p.value} value={p.value}>{p.label}</option>
                               ))}
                            </select>
                         </div>

                         <div className="space-y-1">
                            <label className="text-[10px] font-bold text-emerald-700/70">Payment Received</label>
                            <select
                               className="w-full px-3 py-2.5 bg-white text-emerald-900 border border-emerald-200 rounded-xl font-bold text-xs outline-none"
                               value={formData.paymentType}
                               onChange={e => setFormData({ ...formData, paymentType: e.target.value as PaymentType })}
                            >
                               {PAYMENT_METHODS.map(p => <option key={p} value={p}>{p}</option>)}
                            </select>
                         </div>
                       </div>
                    </div>
                 )}
              </div>

              {/* Sticky action bar — always visible, no scrolling needed to Save/Cancel */}
              <div className="lg:col-span-12 sticky bottom-0 -mx-4 px-4 pt-3 pb-1 mt-1 bg-gradient-to-t from-slate-50 via-slate-50/95 to-transparent flex gap-2.5">
                 {isModal && (
                    <button type="button" onClick={onClose} className="px-6 py-3 bg-white border border-slate-200 text-slate-500 rounded-xl font-black uppercase text-xs tracking-widest hover:bg-slate-100 transition-all">
                       Cancel
                    </button>
                 )}
                 <button type="submit" className="flex-1 py-3 bg-slate-900 text-white rounded-xl font-black uppercase text-xs tracking-widest shadow-lg hover:bg-black transition-all flex items-center justify-center gap-2">
                    <Save size={16}/> Save Asset
                 </button>
              </div>
           </form>
        )}
      </div>

      {previewPhoto && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/80 backdrop-blur-sm p-6 animate-in fade-in"
          onClick={() => setPreviewPhoto(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex-1 min-h-0 bg-slate-100 flex items-center justify-center">
              <img
                src={previewPhoto.url}
                alt={previewPhoto.title}
                className="max-w-full max-h-[60vh] object-contain"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).src = previewPhoto.thumbnail;
                }}
              />
            </div>
            <div className="p-4 space-y-3 shrink-0">
              {previewPhoto.title && <p className="text-xs font-bold text-slate-600 truncate">{previewPhoto.title}</p>}
              <div className="flex gap-2.5">
                <button
                  type="button"
                  onClick={() => setPreviewPhoto(null)}
                  className="px-5 py-2.5 bg-slate-100 text-slate-600 rounded-xl font-black uppercase text-xs tracking-widest hover:bg-slate-200 transition-all"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={() => {
                    handlePickSearchedPhoto(previewPhoto);
                    setPreviewPhoto(null);
                  }}
                  className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl font-black uppercase text-xs tracking-widest hover:bg-blue-700 transition-all"
                >
                  Use this photo
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <EbayListingPriceModal
        open={ebayPriceModalOpen}
        itemName={formData.name || 'Item'}
        currentStorePrice={formData.storePrice}
        error={ebayPriceModalError}
        match={ebayPriceModalMatch}
        onClose={closeEbayPriceModal}
        onApply={applyEbayListingPriceFromModal}
      />
    </div>
  );
};

export default ItemForm;
