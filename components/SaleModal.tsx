
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Euro, CheckCircle2, ChevronDown, Upload, ImagePlus, Loader2, Truck, Receipt, ExternalLink, Search } from 'lucide-react';
import { parseEbayOrderFromImageInput } from '../services/ebayOrderScreenshotAI';
import { mapKleinanzeigenPaymentMethod, parseKleinanzeigenChatFromImageInput } from '../services/kleinanzeigenChatScreenshotAI';
import { fetchEbayOrder, hasEbayToken } from '../services/ebayService';
import { findEbayOrderById, loadEbayOrderIndex } from '../services/ebayOrderIndex';
import { refreshRecentEbayOrders } from '../services/ebayOrderBackfill';
import { customerFromEbayOrder } from '../utils/ebayOrderBuyerData';
import { ebayScreenshotSaleFields } from '../utils/ebayScreenshotSaleFields';
import { isStrongEbayOrderMatch, listEbayOrdersForItemSale, type EbayOrderMatch } from '../utils/ebayOrderMatch';
import { buildClaimedLineKeys } from '../utils/ebayOrderLinkAnalysis';
import { bindEbayOrderExact } from '../utils/bindEbayOrderExact';
import { getLinePayout, estimateEbayMarketplaceFee } from '../utils/ebayOrderPayout';
import { persistSaleProofImage, urlNeedsPhotoArchive } from '../services/inventoryImageStorage';
import { InventoryItem, ItemStatus, PaymentType, CustomerInfo, Platform, TaxMode, SaleProceedsBreakdown } from '../types';
import { SALE_PLATFORM_OPTIONS } from '../utils/salePlatform';
import { formatEUR, parseLocaleNumber } from '../utils/formatMoney';
import { saleProceedsFromOrder, saleProceedsFromScreenshot, resolveSaleProceeds, saleProceedsHasDetail } from '../utils/saleProceeds';
import { computeItemProfitBeforeOverhead, roundMoney } from '../services/financialAggregation';
import {
  EBAY_SELLER_HUB_ORDERS_URL,
  parseEbaySellerHubPayoutText,
  payoutLooksComplete,
  saleFieldsFromHubPayout,
} from '../utils/ebaySellerHubSaleFields';
import type { EbaySellerHubPayout } from '../lib/ebaySellerHubPayout';
import { fetchEbaySellerHubPayout, type SellerHubFetchCandidate } from '../services/ebaySellerHubFetch';
import { buildEbayOrderUrl } from '../utils/sourceLinks';
import { SaleProceedsDialog } from './SaleProceedsPopover';

interface Props {
  item: InventoryItem;
  /** Full inventory — used to hide orders already bound to another row. */
  inventoryItems?: InventoryItem[];
  taxMode?: TaxMode;
  /** sell = mark in-stock item sold; editBuyer = update buyer/sale metadata on already-sold item */
  mode?: 'sell' | 'editBuyer';
  onSave: (updatedItem: InventoryItem, splitOffItem?: InventoryItem) => void | Promise<void>;
  onClose: () => void;
}

async function readClipboardImageFile(): Promise<File | null> {
  if (!navigator.clipboard || !('read' in navigator.clipboard)) return null;
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (!type) continue;
      const blob = await item.getType(type);
      return new File([blob], 'seller-hub.png', { type });
    }
  } catch {
    /* permission or empty clipboard */
  }
  return null;
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
  'Other'
];

const SaleModal: React.FC<Props> = ({
  item,
  inventoryItems,
  taxMode = 'SmallBusiness',
  mode = 'sell',
  onSave,
  onClose,
}) => {
  const isEditBuyer = mode === 'editBuyer';
  const [salePrice, setSalePrice] = useState<string>(item.sellPrice != null ? String(item.sellPrice) : '');
  const [saleDate, setSaleDate] = useState(item.sellDate || new Date().toISOString().split('T')[0]);
  const [paymentType, setPaymentType] = useState<PaymentType>(item.paymentType || 'ebay.de');
  const [platformSold, setPlatformSold] = useState<Platform>(item.platformSold || 'ebay.de');
  const [hasFee, setHasFee] = useState(item.hasFee || false);
  const [feeAmount, setFeeAmount] = useState(item.feeAmount || 0);
  /** Last screenshot fee breakdown (display only; totals live in feeAmount). */
  const [ebayFeeNote, setEbayFeeNote] = useState<{
    ebayFeeEur: number | null;
    adFeeEur: number | null;
    amountReceivedNetEur: number | null;
    buyerShippingEur: number | null;
  } | null>(null);
  const [saleProceedsDraft, setSaleProceedsDraft] = useState<SaleProceedsBreakdown | null>(
    item.saleProceeds || null
  );
  const [proceedsOpen, setProceedsOpen] = useState(false);
  const [sellerPaidShipping, setSellerPaidShipping] = useState(item.sellerPaidShipping || false);
  const [sellerShippingAmount, setSellerShippingAmount] = useState(
    item.sellerShippingAmount != null ? String(item.sellerShippingAmount) : ''
  );
  const [comment, setComment] = useState(item.comment2 || '');

  const [quantityToSell, setQuantityToSell] = useState<number>(item.quantity || 1);
  const [unitPrice, setUnitPrice] = useState<string>(
    item.sellPrice != null
      ? String(item.quantity && item.quantity > 0 ? Math.round((item.sellPrice / item.quantity) * 100) / 100 : item.sellPrice)
      : ''
  );

  const [ebayUsername, setEbayUsername] = useState(item.ebayUsername || '');
  const [ebayOrderId, setEbayOrderId] = useState(item.ebayOrderId || '');
  const [ebaySku, setEbaySku] = useState(item.ebaySku || '');
  const [ebayListingId, setEbayListingId] = useState(item.ebayListingId || '');
  const [kleinanzeigenChatUrl, setKleinanzeigenChatUrl] = useState(item.kleinanzeigenChatUrl || '');
  const [kleinanzeigenChatImage, setKleinanzeigenChatImage] = useState(item.kleinanzeigenChatImage || '');
  const [pickedOrderKey, setPickedOrderKey] = useState<string | null>(null);

  const [customer, setCustomer] = useState<CustomerInfo>({
    name: item.customer?.name || '',
    address: item.customer?.address || ''
  });

  const [orderScreenshotSource, setOrderScreenshotSource] = useState('');
  const [orderScreenshotParsing, setOrderScreenshotParsing] = useState(false);
  const [orderScreenshotError, setOrderScreenshotError] = useState<string | null>(null);
  const [ebayScreenshotDragOver, setScreenshotDragOver] = useState(false);
  const [kaChatParsing, setKaChatParsing] = useState(false);
  const [kaChatParseError, setKaChatParseError] = useState<string | null>(null);
  const [orderIdLookupLoading, setOrderIdLookupLoading] = useState(false);
  const [orderIdLookupMessage, setOrderIdLookupMessage] = useState<string | null>(null);
  const [orderMatchSuggestions, setOrderMatchSuggestions] = useState<EbayOrderMatch[]>([]);
  const [orderFilter, setOrderFilter] = useState('');
  const [orderRefreshLoading, setOrderRefreshLoading] = useState(false);
  const [hubFetching, setHubFetching] = useState(false);
  const [hubPaste, setHubPaste] = useState('');
  const [hubMessage, setHubMessage] = useState<string | null>(null);
  const [hubCandidates, setHubCandidates] = useState<SellerHubFetchCandidate[]>([]);
  const [hubWaitingForPaste, setHubWaitingForPaste] = useState(false);
  const [hubClipboardReading, setHubClipboardReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const didLiveOrderFetchRef = useRef(false);

  const rematchOrderSuggestions = useCallback((): EbayOrderMatch[] => {
    try {
      const { orders } = loadEbayOrderIndex();
      if (!orders.length) {
        setOrderMatchSuggestions([]);
        return [];
      }
      const claimed = new Set<string>();
      if (inventoryItems?.length) {
        for (const key of buildClaimedLineKeys(inventoryItems, orders)) claimed.add(key);
        for (const other of inventoryItems) {
          if (other.id === item.id) continue;
          const lineKey = other.ebayOrderLineKey?.trim();
          if (lineKey) claimed.add(lineKey.toLowerCase());
        }
      }
      const matches = listEbayOrdersForItemSale(item, orders, {
        days: 90,
        limit: 12,
        claimedKeys: claimed,
      });
      setOrderMatchSuggestions(matches);
      return matches;
    } catch {
      setOrderMatchSuggestions([]);
      return [];
    }
  }, [item, inventoryItems]);

  const applySuggestedOrder = useCallback((match: EbayOrderMatch) => {
    const payout = getLinePayout(match.order, match.lineItem);
    const key = `${match.order.orderId}:${match.lineItem.sku || match.lineItem.title}`;
    setPickedOrderKey(key);
    setEbayOrderId(match.order.orderId);
    setEbayUsername(match.order.buyer.username || '');
    setEbaySku(match.lineItem.sku || item.ebaySku || '');
    setEbayListingId(match.lineItem.listingId || item.ebayListingId || '');
    setCustomer(customerFromEbayOrder(match.order));
    if (match.order.creationDate) setSaleDate(match.order.creationDate);
    if (payout.sellPrice > 0) {
      const fmt = formatEUR(payout.sellPrice);
      setSalePrice(fmt);
      setUnitPrice(fmt);
    }
    setSaleProceedsDraft(saleProceedsFromOrder(match.order, match.lineItem));
    if (payout.netKnown) {
      setHasFee(false);
      setFeeAmount(0);
      setEbayFeeNote(null);
    } else if (payout.fee > 0) {
      setHasFee(true);
      setFeeAmount(Math.round(payout.fee * 100) / 100);
      setEbayFeeNote({
        ebayFeeEur: payout.feeEstimated ? null : payout.fee,
        adFeeEur: null,
        amountReceivedNetEur: payout.gross != null ? Math.round((payout.gross - payout.fee) * 100) / 100 : null,
        buyerShippingEur: null,
      });
    } else {
      setHasFee(false);
      setFeeAmount(0);
      setEbayFeeNote(null);
    }
    setPlatformSold('ebay.de');
    setPaymentType('ebay.de');
    const feeHint = payout.feeEstimated
      ? ` · fees ~€${formatEUR(payout.fee)} (Flip Coach % — adjust if needed)`
      : payout.netKnown
        ? ' · net payout'
        : payout.fee > 0
          ? ` · fees €${formatEUR(payout.fee)}`
          : '';
    setOrderIdLookupMessage(
      match.matchKind === 'recent'
        ? `Filled from recent order${feeHint}`
        : `Filled from order history · ${match.matchKind === 'title' ? `name hint ${Math.round(match.matchScore)}` : match.matchKind}${feeHint}`
    );
  }, [item.ebaySku, item.ebayListingId]);

  const bindMatchAsSold = useCallback(
    async (match: EbayOrderMatch) => {
      if (saving || hubFetching) return;
      setSaving(true);
      setHubFetching(true);
      setSaveError(null);
      setHubMessage('Reading Seller Hub — price breakdown, username, order, shipping address…');
      setOrderIdLookupMessage('Reading Seller Hub…');
      try {
        const result = await bindEbayOrderExact(item, match, taxMode);
        if (!result.ok) {
          setHubMessage(result.hint);
          setSaveError(result.hint);
          setHubCandidates(result.candidates || []);
          setEbayOrderId(match.order.orderId);
          setOrderIdLookupMessage(result.hint);
          return;
        }
        await onSave(isEditBuyer ? result.item : { ...result.item, storeVisible: false });
        onClose();
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Could not bind eBay order');
      } finally {
        setSaving(false);
        setHubFetching(false);
      }
    },
    [item, taxMode, onSave, onClose, saving, hubFetching, isEditBuyer]
  );

  const visibleOrderSuggestions = useMemo(() => {
    const q = orderFilter.trim().toLowerCase();
    if (!q) return orderMatchSuggestions;
    return orderMatchSuggestions.filter((match) => {
      const hay = [
        match.lineItem.title,
        match.lineItem.sku,
        match.order.orderId,
        match.order.buyer.username,
        match.order.buyer.fullName,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [orderFilter, orderMatchSuggestions]);

  const bestOrderMatch = visibleOrderSuggestions.find((m) => isStrongEbayOrderMatch(m)) ?? null;

  // Cache recent orders immediately; once per modal, live-fetch then refresh the newest-first list.
  useEffect(() => {
    if (platformSold !== 'ebay.de') {
      setOrderMatchSuggestions([]);
      return;
    }

    rematchOrderSuggestions();

    if (didLiveOrderFetchRef.current || !hasEbayToken()) return;
    didLiveOrderFetchRef.current = true;

    let cancelled = false;
    (async () => {
      setOrderRefreshLoading(true);
      try {
        const result = await refreshRecentEbayOrders(21);
        if (cancelled) return;
        const matches = rematchOrderSuggestions();
        if (result.error) {
          setOrderIdLookupMessage(result.error);
          return;
        }
        if (result.ordersFetched > 0 || matches.length > 0) {
          const ranked = matches.filter((m) => isStrongEbayOrderMatch(m)).length;
          setOrderIdLookupMessage(
            ranked > 0
              ? `Updated from eBay · ${matches.length} listed · ${ranked} name match${ranked === 1 ? '' : 'es'} — Bind · sold or tap to fill`
              : `Updated from eBay · ${result.ordersFetched} recent · ${matches.length} listed — search or tap to fill`
          );
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setOrderIdLookupMessage((e as Error)?.message || 'Could not refresh recent eBay orders.');
        }
      } finally {
        if (!cancelled) setOrderRefreshLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [platformSold, rematchOrderSuggestions]);

  const applyEbayOrderBuyerFields = useCallback(
    (fields: {
      orderId?: string;
      username?: string;
      customer?: CustomerInfo;
      sellDate?: string;
      sellPrice?: number;
    }) => {
      if (fields.orderId) setEbayOrderId(fields.orderId);
      if (fields.username) setEbayUsername(fields.username);
      if (fields.customer) {
        setCustomer((prev) => ({
          ...prev,
          ...fields.customer,
        }));
      }
      if (!isEditBuyer && fields.sellDate) setSaleDate(fields.sellDate);
      if (!isEditBuyer && fields.sellPrice != null && Number.isFinite(fields.sellPrice)) {
        const fmtPrice = formatEUR(fields.sellPrice);
        setSalePrice(fmtPrice);
        setUnitPrice(fmtPrice);
      }
    },
    [isEditBuyer]
  );

  const fillFromOrderId = useCallback(
    async (rawOrderId: string, opts?: { silent?: boolean }) => {
      const orderId = rawOrderId.trim();
      if (!orderId) return;
      setOrderIdLookupLoading(true);
      if (!opts?.silent) setOrderIdLookupMessage(null);
      try {
        const cached = findEbayOrderById(orderId);
        if (cached) {
          applyEbayOrderBuyerFields({
            orderId: cached.orderId,
            username: cached.buyer.username,
            customer: customerFromEbayOrder(cached),
            sellDate: cached.creationDate || undefined,
          });
          const line = cached.lineItems[0];
          if (line && !isEditBuyer) {
            const payout = getLinePayout(cached, line);
            if (payout.sellPrice > 0) {
              const fmt = formatEUR(payout.sellPrice);
              setSalePrice(fmt);
              setUnitPrice(fmt);
            }
            if (payout.netKnown) {
              setHasFee(false);
              setFeeAmount(0);
              setEbayFeeNote(null);
            } else if (payout.fee > 0) {
              setHasFee(true);
              setFeeAmount(Math.round(payout.fee * 100) / 100);
              setEbayFeeNote({
                ebayFeeEur: payout.feeEstimated ? null : payout.fee,
                adFeeEur: null,
                amountReceivedNetEur:
                  payout.gross != null ? Math.round((payout.gross - payout.fee) * 100) / 100 : null,
                buyerShippingEur: null,
              });
            }
            if (line.sku) setEbaySku(line.sku);
            if (line.listingId) setEbayListingId(line.listingId);
            setSaleProceedsDraft(saleProceedsFromOrder(cached, line));
          }
          setPlatformSold('ebay.de');
          setPaymentType('ebay.de');
          setOrderIdLookupMessage('Filled from order cache (fees estimated if API-only).');
          return;
        }
        const live = await fetchEbayOrder(orderId);
        applyEbayOrderBuyerFields({
          orderId: live.ebayOrderId,
          username: live.ebayUsername,
          customer: live.customer,
          sellDate: live.sellDate,
          sellPrice: live.sellPrice,
        });
        if (!isEditBuyer && live.sellPrice != null && live.sellPrice > 0) {
          const fee = estimateEbayMarketplaceFee(live.sellPrice);
          if (fee > 0) {
            setHasFee(true);
            setFeeAmount(fee);
            setEbayFeeNote({
              ebayFeeEur: null,
              adFeeEur: null,
              amountReceivedNetEur: Math.round((live.sellPrice - fee) * 100) / 100,
              buyerShippingEur: null,
            });
          }
        }
        setPlatformSold('ebay.de');
        setPaymentType('ebay.de');
        setOrderIdLookupMessage(
          live.sellPrice != null && live.sellPrice > 0
            ? `Filled from eBay API · fees ~€${formatEUR(estimateEbayMarketplaceFee(live.sellPrice))} (Flip Coach %)`
            : 'Buyer filled from eBay API.'
        );
      } catch (err: unknown) {
        if (!opts?.silent) {
          setOrderIdLookupMessage(err instanceof Error ? err.message : 'Order not found in cache or API.');
        }
      } finally {
        setOrderIdLookupLoading(false);
      }
    },
    [applyEbayOrderBuyerFields, isEditBuyer]
  );

  useEffect(() => {
    if (!isEditBuyer || !ebayOrderId.trim()) return;
    if (customer.name?.trim() || customer.address?.trim()) return;
    void fillFromOrderId(ebayOrderId, { silent: true });
  }, [isEditBuyer, ebayOrderId, customer.name, customer.address, fillFromOrderId]);

  useEffect(() => {
    if (platformSold !== 'ebay.de' && platformSold !== 'kleinanzeigen.de') setScreenshotDragOver(false);
  }, [platformSold]);

  const disableSellerShipping = () => {
    setSellerPaidShipping(false);
    setSellerShippingAmount('');
  };

  const handleChatImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) loadKleinanzeigenChatFile(file);
    e.target.value = '';
  };

  const loadKleinanzeigenChatFile = (file: File) => {
    if (file.size > 6 * 1024 * 1024) {
      setKaChatParseError('Screenshot too large. Max 6MB.');
      return;
    }
    if (!file.type.startsWith('image/')) {
      setKaChatParseError('Please choose an image file (PNG, JPG, WebP, …).');
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      setKleinanzeigenChatImage(reader.result as string);
      setKaChatParseError(null);
    };
    reader.readAsDataURL(file);
  };

  const loadOrderScreenshotFile = (file: File) => {
    if (file.size > 6 * 1024 * 1024) {
      setOrderScreenshotError('Screenshot too large. Max 6MB.');
      return;
    }
    if (!file.type.startsWith('image/')) {
      setOrderScreenshotError('Please drop an image file (PNG, JPG, WebP, …).');
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      setOrderScreenshotSource(reader.result as string);
      setOrderScreenshotError(null);
    };
    reader.readAsDataURL(file);
  };

  const handleOrderScreenshotUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    loadOrderScreenshotFile(file);
    e.target.value = '';
  };

  const isScreenshotDropActive = platformSold === 'ebay.de' || platformSold === 'kleinanzeigen.de';

  const handleScreenshotDragOverCapture = (e: React.DragEvent) => {
    if (!isScreenshotDropActive) return;
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleScreenshotDragEnterCapture = (e: React.DragEvent) => {
    if (!isScreenshotDropActive) return;
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    setScreenshotDragOver(true);
  };

  const handleScreenshotDragLeaveCapture = (e: React.DragEvent) => {
    if (!isScreenshotDropActive) return;
    const rel = e.relatedTarget as Node | null;
    if (rel && (e.currentTarget as HTMLElement).contains(rel)) return;
    setScreenshotDragOver(false);
  };

  const handleScreenshotDropCapture = (e: React.DragEvent) => {
    if (!isScreenshotDropActive) return;
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    setScreenshotDragOver(false);
    const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'));
    if (!file) {
      if (e.dataTransfer.files.length > 0) {
        const msg = 'Please drop an image file (PNG, JPG, WebP, …).';
        if (platformSold === 'ebay.de') setOrderScreenshotError(msg);
        else setKaChatParseError(msg);
      }
      return;
    }
    if (platformSold === 'ebay.de') loadOrderScreenshotFile(file);
    else loadKleinanzeigenChatFile(file);
  };

  const applyScreenshotParse = useCallback(async (src: string) => {
    const trimmed = src.trim();
    if (!trimmed) {
      setOrderScreenshotError('Paste a screenshot or upload a photo of the Seller Hub payout.');
      return false;
    }
    setOrderScreenshotError(null);
    setOrderScreenshotParsing(true);
    try {
      const data = await parseEbayOrderFromImageInput(trimmed);
      setPlatformSold('ebay.de');
      setPaymentType('ebay.de');
      if (data.ebayOrderId) setEbayOrderId(data.ebayOrderId);
      if (data.ebayUsername) setEbayUsername(data.ebayUsername);
      setCustomer((prev) => ({
        ...prev,
        ...(data.buyerFullName && { name: data.buyerFullName }),
        ...(data.shippingAddress && { address: data.shippingAddress }),
        ...(data.phone && { phone: data.phone }),
      }));
      const money = ebayScreenshotSaleFields(data);
      const proceeds = saleProceedsFromScreenshot(money, money.shippingLabelEur);
      const sellEur = proceeds.buyerTotalEur ?? money.soldPriceExShippingEur;
      if (sellEur != null) {
        const fmtPrice = formatEUR(sellEur);
        setSalePrice(fmtPrice);
        setUnitPrice(fmtPrice);
      }
      const feeAmount = roundMoney(
        (money.ebayFeeEur ?? 0) + (money.adFeeEur ?? 0) + (money.shippingLabelEur ?? 0)
      );
      setHasFee(feeAmount >= 0.01);
      setFeeAmount(feeAmount);
      setEbayFeeNote({
        ebayFeeEur: money.ebayFeeEur,
        adFeeEur: money.adFeeEur,
        amountReceivedNetEur: money.amountReceivedNetEur,
        buyerShippingEur: money.buyerShippingEur,
      });
      setSaleProceedsDraft(proceeds);
      if (data.saleDate) setSaleDate(data.saleDate);
      setHubWaitingForPaste(false);
      setHubMessage(
        `Filled from screenshot: buyer €${formatEUR(proceeds.buyerTotalEur ?? sellEur ?? 0)} − eBay €${formatEUR(money.ebayFeeEur ?? 0)} − ads €${formatEUR(money.adFeeEur ?? 0)} − label €${formatEUR(money.shippingLabelEur ?? 0)} = net €${formatEUR(proceeds.netPayoutEur ?? 0)}`
      );
      return true;
    } catch (err: unknown) {
      setOrderScreenshotError(err instanceof Error ? err.message : 'Parse failed');
      return false;
    } finally {
      setOrderScreenshotParsing(false);
    }
  }, []);

  const handleParseOrderScreenshot = async () => {
    await applyScreenshotParse(orderScreenshotSource);
  };

  const applyHubPayout = useCallback((payout: EbaySellerHubPayout, sourceLabel: string) => {
    const fields = saleFieldsFromHubPayout(payout);
    if (fields.sellPrice != null) {
      const fmt = formatEUR(fields.sellPrice);
      setSalePrice(fmt);
      setUnitPrice(fmt);
    }
    setHasFee(fields.hasFee);
    setFeeAmount(fields.feeAmount);
    if (fields.sellerPaidShipping) {
      setSellerPaidShipping(true);
      setSellerShippingAmount(formatEUR(fields.sellerShippingAmount));
    }
    setEbayFeeNote({
      ebayFeeEur: payout.transactionFeeEur,
      adFeeEur: payout.adFeeEur,
      amountReceivedNetEur: payout.netPayoutEur,
      buyerShippingEur: payout.buyerShippingEur,
    });
    setSaleProceedsDraft(fields.saleProceeds);
    if (fields.ebayOrderId) setEbayOrderId(fields.ebayOrderId);
    if (payout.username) setEbayUsername(payout.username);
    if (payout.fullName || payout.address) {
      setCustomer((prev) => ({
        ...prev,
        name: payout.fullName || prev.name,
        address: payout.address || prev.address,
      }));
    }
    setPlatformSold('ebay.de');
    setPaymentType('ebay.de');
    const net = payout.netPayoutEur != null ? formatEUR(payout.netPayoutEur) : '—';
    const gross = fields.sellPrice != null ? formatEUR(fields.sellPrice) : '—';
    const who = payout.username ? ` · @${payout.username}` : '';
    setHubMessage(
      `Filled ${sourceLabel}${who}: buyer €${gross} − eBay €${formatEUR(payout.transactionFeeEur ?? 0)} − ads €${formatEUR(payout.adFeeEur ?? 0)} − label €${formatEUR(payout.shippingLabelEur ?? 0)} = net €${net}`
    );
    setHubCandidates([]);
    setHubWaitingForPaste(false);
  }, []);

  const tryFillFromHubText = useCallback(
    (raw: string): boolean => {
      const text = raw.trim();
      if (!text) return false;
      const payout = parseEbaySellerHubPayoutText(text);
      if (!payoutLooksComplete(payout)) return false;
      applyHubPayout(payout, 'from pasted payout');
      setHubPaste(text);
      return true;
    },
    [applyHubPayout]
  );

  const handleFillFromClipboard = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    if (!silent) {
      setHubClipboardReading(true);
      setHubMessage(null);
    }
    try {
      const image = await readClipboardImageFile();
      if (image) {
        if (!silent) setHubMessage('Screenshot on clipboard — parsing with AI…');
        const src = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(new Error('Could not read screenshot'));
          reader.readAsDataURL(image);
        });
        setOrderScreenshotSource(src);
        const ok = await applyScreenshotParse(src);
        if (ok) return;
      }
      let text = '';
      try {
        text = (await navigator.clipboard.readText()).trim();
      } catch {
        text = '';
      }
      if (tryFillFromHubText(text || hubPaste)) return;
      if (silent) return;
      if (text) {
        setHubPaste(text);
        setHubMessage(
          'Clipboard text is not a full payout yet. Copy from “Vom Käufer bezahlt” through “Bestelleinnahmen”, then paste again.'
        );
        return;
      }
      setHubMessage(
        'Clipboard is empty. In Seller Hub copy the payout, or screenshot it, then click this button again (or press Ctrl+V here).'
      );
    } catch (err: unknown) {
      if (!silent) {
        setHubMessage(err instanceof Error ? err.message : 'Could not read clipboard.');
      }
    } finally {
      if (!silent) setHubClipboardReading(false);
    }
  }, [applyScreenshotParse, hubPaste, tryFillFromHubText]);

  const handleFetchSellerHub = async (orderIdOverride?: string) => {
    setHubFetching(true);
    setHubMessage(null);
    try {
      const result = await fetchEbaySellerHubPayout({
        orderId: (orderIdOverride || ebayOrderId).trim(),
        title: item.name,
        sku: (ebaySku || item.ebaySku || '').trim(),
        listingId: (ebayListingId || item.ebayListingId || '').trim(),
        query: item.name,
      });
      if (result.ok) {
        applyHubPayout(result.payout, result.source === 'paste' ? 'from paste' : 'from Seller Hub');
        return;
      }
      setHubCandidates(result.candidates || []);
      setHubMessage(
        result.code === 'local_only' || result.code === 'cdp_unavailable'
          ? 'Start once with npm run dev:ebay, log into eBay.de in that Chrome, then click Bind again.'
          : result.hint || result.error || `Seller Hub: ${result.code}`
      );
    } catch {
      setHubMessage(
        'Could not read Seller Hub. Keep the eBay Chrome window logged in and click Bind again.'
      );
    } finally {
      setHubFetching(false);
    }
  };

  useEffect(() => {
    if (platformSold !== 'ebay.de') return;

    const onPaste = (event: ClipboardEvent) => {
      const image = [...(event.clipboardData?.items || [])].find((entry) =>
        entry.type.startsWith('image/')
      );
      if (image) {
        const file = image.getAsFile();
        if (file) {
          event.preventDefault();
          setHubMessage('Screenshot pasted — parsing with AI…');
          const reader = new FileReader();
          reader.onloadend = () => {
            const src = String(reader.result || '');
            setOrderScreenshotSource(src);
            void applyScreenshotParse(src);
          };
          reader.readAsDataURL(file);
        }
        return;
      }
      const text = event.clipboardData?.getData('text/plain') || '';
      if (tryFillFromHubText(text)) {
        event.preventDefault();
      }
    };

    const onFocus = () => {
      if (!hubWaitingForPaste) return;
      void handleFillFromClipboard({ silent: true });
    };

    window.addEventListener('paste', onPaste);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('focus', onFocus);
    };
  }, [applyScreenshotParse, handleFillFromClipboard, hubWaitingForPaste, platformSold, tryFillFromHubText]);

  const handleParseKleinanzeigenChat = async () => {
    const src = kleinanzeigenChatImage.trim();
    if (!src) {
      setKaChatParseError('Upload a chat screenshot or paste an image URL first.');
      return;
    }
    setKaChatParseError(null);
    setKaChatParsing(true);
    try {
      const data = await parseKleinanzeigenChatFromImageInput(src);
      setPlatformSold('kleinanzeigen.de');
      setPaymentType(mapKleinanzeigenPaymentMethod(data.paymentMethod));
      if (data.buyerName) {
        setCustomer((prev) => ({ ...prev, name: data.buyerName! }));
      }
      if (data.agreedPriceEur != null && Number.isFinite(data.agreedPriceEur)) {
        const fmtPrice = formatEUR(data.agreedPriceEur);
        setSalePrice(fmtPrice);
        setUnitPrice(fmtPrice);
        setHasFee(false);
        setFeeAmount(0);
      }
      if (data.saleDate) setSaleDate(data.saleDate);
      if (data.chatUrl) setKleinanzeigenChatUrl(data.chatUrl);
    } catch (err: unknown) {
      setKaChatParseError(err instanceof Error ? err.message : 'Parse failed');
    } finally {
      setKaChatParsing(false);
    }
  };

  const handleSave = async () => {
    if (saving) return;
    const finalFee = hasFee ? feeAmount : 0;
    const parsedShipping = parseLocaleNumber(sellerShippingAmount);
    const finalShipping =
      sellerPaidShipping && sellerShippingAmount.trim() !== '' && Number.isFinite(parsedShipping)
        ? Math.max(0, parsedShipping)
        : 0;
    
    const isBatchItem = !isEditBuyer && item.quantity != null && item.quantity > 1;
    const qtySold = isBatchItem ? quantityToSell : 1;
    
    const rawPriceText = isBatchItem ? unitPrice : salePrice;
    const parsedUnitPrice = parseLocaleNumber(rawPriceText);
    const unitPriceNum = rawPriceText.trim() === '' || !Number.isFinite(parsedUnitPrice) ? undefined : parsedUnitPrice;
    
    const totalSellPrice = unitPriceNum != null ? unitPriceNum * qtySold : item.sellPrice;
    const totalBuyPrice = isBatchItem ? item.buyPrice * qtySold : item.buyPrice;
    const revenueForProfit =
      totalSellPrice != null ? Math.max(0, totalSellPrice - finalShipping) : undefined;
    const profitDraft: InventoryItem = {
      ...item,
      sellPrice: totalSellPrice,
      buyPrice: isBatchItem ? totalBuyPrice : item.buyPrice,
      hasFee,
      feeAmount: finalFee,
      sellerPaidShipping: finalShipping > 0,
      sellerShippingAmount: finalShipping > 0 ? finalShipping : undefined,
      saleProceeds: saleProceedsDraft
        ? {
            ...saleProceedsDraft,
            shippingLabelEur: finalShipping > 0 ? finalShipping : saleProceedsDraft.shippingLabelEur,
          }
        : item.saleProceeds,
    };
    const profit =
      revenueForProfit != null
        ? roundMoney(computeItemProfitBeforeOverhead(profitDraft, taxMode))
        : item.profit;

    const splitSoldId =
      isBatchItem && qtySold < item.quantity! ? `${item.id}-sold-${Date.now()}` : item.id;
    const archiveItemId = isEditBuyer ? item.id : splitSoldId;

    setSaving(true);
    setSaveError(null);
    try {
      let archivedKaImage = kleinanzeigenChatImage.trim();
      if (archivedKaImage && urlNeedsPhotoArchive(archivedKaImage)) {
        archivedKaImage = await persistSaleProofImage(archivedKaImage, archiveItemId);
      }

      let ebayOrderScreenshotUrl = item.ebayOrderScreenshotUrl;
      const screenshotSrc = orderScreenshotSource.trim();
      if (screenshotSrc) {
        ebayOrderScreenshotUrl = await persistSaleProofImage(screenshotSrc, archiveItemId);
      }

      const buyerFields = {
        paymentType,
        platformSold,
        hasFee,
        feeAmount: finalFee,
        sellerPaidShipping: finalShipping > 0,
        sellerShippingAmount: finalShipping > 0 ? finalShipping : undefined,
        saleProceeds: saleProceedsDraft
          ? {
              ...saleProceedsDraft,
              shippingLabelEur:
                finalShipping > 0 ? finalShipping : saleProceedsDraft.shippingLabelEur,
            }
          : item.saleProceeds,
        comment2: comment,
        customer,
        ebayUsername,
        ebayOrderId,
        ebaySku: ebaySku || undefined,
        ebayListingId: ebayListingId || undefined,
        kleinanzeigenChatUrl,
        kleinanzeigenChatImage: archivedKaImage || undefined,
        ebayOrderScreenshotUrl,
      };

      if (isEditBuyer) {
        await onSave({
          ...item,
          ...buyerFields,
          sellPrice: totalSellPrice,
          sellDate: saleDate,
          profit: profit != null ? parseFloat(profit.toFixed(2)) : item.profit,
        });
        onClose();
        return;
      }

      if (isBatchItem && qtySold < item.quantity!) {
        const updatedOriginal: InventoryItem = {
          ...item,
          quantity: item.quantity! - qtySold,
        };

        const splitOffSold: InventoryItem = {
          ...item,
          id: splitSoldId,
          name: `${item.name} (Sold x${qtySold})`,
          status: ItemStatus.SOLD,
          quantity: qtySold,
          buyPrice: totalBuyPrice,
          sellPrice: totalSellPrice,
          sellDate: saleDate,
          paymentType,
          platformSold,
          hasFee,
          feeAmount: finalFee,
          comment2: comment,
          customer,
          profit: profit != null ? parseFloat(profit.toFixed(2)) : undefined,
          ebayUsername,
          ebayOrderId,
          ebaySku: ebaySku || undefined,
          ebayListingId: ebayListingId || undefined,
          kleinanzeigenChatUrl,
          kleinanzeigenChatImage: archivedKaImage || undefined,
          ebayOrderScreenshotUrl,
          storeVisible: false,
          ...buyerFields,
          saleProceeds: buyerFields.saleProceeds,
        };

        await onSave(updatedOriginal, splitOffSold);
      } else {
        await onSave({
          ...item,
          buyPrice: isBatchItem ? totalBuyPrice : item.buyPrice,
          sellPrice: totalSellPrice,
          sellDate: saleDate,
          ...buyerFields,
          status: ItemStatus.SOLD,
          storeVisible: false,
          profit: profit != null ? parseFloat(profit.toFixed(2)) : undefined,
          quantity: qtySold,
        });
      }
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save sale proof image');
    } finally {
      setSaving(false);
    }
  };

  const previewQty = item.quantity != null && item.quantity > 1 ? quantityToSell : 1;
  const previewRawPrice = item.quantity != null && item.quantity > 1 ? unitPrice : salePrice;
  const previewUnit = parseLocaleNumber(previewRawPrice);
  const previewReceived =
    previewRawPrice.trim() !== '' && Number.isFinite(previewUnit)
      ? previewUnit * previewQty
      : item.sellPrice;
  const previewShipping =
    sellerPaidShipping && sellerShippingAmount.trim() !== ''
      ? Math.max(0, parseLocaleNumber(sellerShippingAmount) || 0)
      : 0;
  const previewBuy =
    item.quantity != null && item.quantity > 1 ? item.buyPrice * previewQty : item.buyPrice;
  const previewFee = hasFee ? feeAmount : 0;
  const previewDraft: InventoryItem = {
    ...item,
    sellPrice: previewReceived ?? item.sellPrice,
    buyPrice: previewBuy,
    feeAmount: previewFee,
    hasFee: previewFee > 0,
    sellerPaidShipping: previewShipping > 0,
    sellerShippingAmount: previewShipping > 0 ? previewShipping : undefined,
    saleProceeds: saleProceedsDraft
      ? { ...saleProceedsDraft, shippingLabelEur: previewShipping || saleProceedsDraft.shippingLabelEur }
      : item.saleProceeds,
  };
  const previewProfit =
    previewReceived != null ? roundMoney(computeItemProfitBeforeOverhead(previewDraft, taxMode)) : null;
  const previewProceeds = resolveSaleProceeds(previewDraft);
  const canOpenProceeds = saleProceedsHasDetail(previewProceeds);

  const isBatchItem = !isEditBuyer && item.quantity != null && item.quantity > 1;
  const quickPlatforms = SALE_PLATFORM_OPTIONS.filter((p) =>
    ['ebay.de', 'kleinanzeigen.de', 'In Person'].includes(p.value)
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 p-0 sm:p-4 pb-safe"
      onDragEnterCapture={handleScreenshotDragEnterCapture}
      onDragLeaveCapture={handleScreenshotDragLeaveCapture}
      onDragOverCapture={handleScreenshotDragOverCapture}
      onDropCapture={handleScreenshotDropCapture}
    >
      <div
        className={`bg-white w-full max-w-[520px] rounded-t-2xl sm:rounded-2xl shadow-2xl border overflow-hidden flex flex-col max-h-[92dvh] sm:max-h-[88vh] transition-shadow duration-150 ${
          ebayScreenshotDragOver && isScreenshotDropActive
            ? 'border-indigo-400 ring-4 ring-indigo-300/40 shadow-indigo-100'
            : 'border-slate-100'
        }`}
      >
        <header className="px-4 py-3 border-b border-slate-100 flex justify-between items-start shrink-0">
          <div className="min-w-0 pr-2">
            <h2 className="font-bold text-sm text-slate-900">
              {isEditBuyer ? 'Buyer & sale details' : 'Mark as sold'}
            </h2>
            <p className="text-[10px] text-slate-400 truncate mt-0.5">{item.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors text-slate-400 shrink-0"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </header>

        <div className="px-4 py-3 space-y-2.5 overflow-y-auto scrollbar-hide flex-1">
          {/* Option E: top triad — Price(+date) · Profit · Shipping */}
          <div className={`grid gap-2 ${isEditBuyer ? 'grid-cols-2' : 'grid-cols-3'}`}>
            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 min-h-[72px]">
              <label className="text-[8px] font-black uppercase tracking-wider text-slate-400 flex items-center gap-1">
                {canOpenProceeds ? (
                  <button
                    type="button"
                    onClick={() => setProceedsOpen(true)}
                    className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 underline decoration-dotted underline-offset-2"
                    title="Show fees, shipping and payout"
                  >
                    {isBatchItem ? 'Unit price' : platformSold === 'ebay.de' ? 'Sold price' : 'Price'}
                    <Receipt size={10} />
                  </button>
                ) : (
                  <>{isBatchItem ? 'Unit price' : platformSold === 'ebay.de' ? 'Sold price' : 'Price'}</>
                )}
              </label>
              {isBatchItem ? (
                <div className="mt-1 flex gap-1 items-center">
                  <input
                    type="number"
                    min={1}
                    max={item.quantity}
                    aria-label="Quantity to sell"
                    className="w-9 px-0.5 py-0.5 bg-white border border-slate-200 rounded-md font-bold text-[10px] text-center tabular-nums"
                    value={quantityToSell}
                    onChange={(e) =>
                      setQuantityToSell(
                        Math.max(1, Math.min(item.quantity || 1, parseInt(e.target.value, 10) || 1))
                      )
                    }
                  />
                  <div className="relative flex-1 min-w-0">
                    <Euro className="absolute left-1 top-1/2 -translate-y-1/2 text-slate-300" size={10} />
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="0.00"
                      className="w-full pl-4 pr-0.5 py-0.5 bg-white border border-slate-200 rounded-md font-bold text-sm tabular-nums outline-none"
                      value={unitPrice}
                      onChange={(e) => setUnitPrice(e.target.value)}
                    />
                  </div>
                </div>
              ) : (
                <div className="relative mt-0.5">
                  <Euro className="absolute left-0 top-1/2 -translate-y-1/2 text-slate-300" size={12} />
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    className="w-full pl-4 pr-0 py-0 bg-transparent font-extrabold text-base tabular-nums text-slate-900 outline-none"
                    value={salePrice}
                    onChange={(e) => setSalePrice(e.target.value)}
                  />
                </div>
              )}
              <input
                id="sale-date"
                type="date"
                aria-label="Sale date"
                className="mt-1 w-full bg-transparent text-[8px] font-bold text-slate-400 outline-none"
                value={saleDate}
                onChange={(e) => setSaleDate(e.target.value)}
              />
            </div>

            {!isEditBuyer && (
              <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-100 min-h-[72px]">
                <p className="text-[8px] font-black uppercase tracking-wider text-emerald-700">Profit</p>
                <p
                  className={`text-base font-extrabold tabular-nums mt-0.5 ${
                    previewProfit == null
                      ? 'text-slate-300'
                      : previewProfit >= 0
                        ? 'text-emerald-700'
                        : 'text-red-500'
                  }`}
                >
                  {previewProfit != null
                    ? `${previewProfit >= 0 ? '+' : ''}€${formatEUR(previewProfit)}`
                    : '—'}
                </p>
              </div>
            )}

            <div
              role="button"
              tabIndex={0}
              onClick={() => {
                if (!sellerPaidShipping) setSellerPaidShipping(true);
              }}
              onKeyDown={(e) => {
                if (!sellerPaidShipping && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  setSellerPaidShipping(true);
                }
              }}
              className={`p-2.5 rounded-xl border min-h-[72px] transition-colors text-left ${
                sellerPaidShipping
                  ? 'bg-sky-50 border-sky-200 cursor-default'
                  : 'bg-slate-50 border-slate-100 hover:border-sky-200 cursor-pointer'
              }`}
            >
              <div className="flex items-start justify-between gap-0.5">
                <span className="text-[8px] font-black uppercase tracking-wider text-sky-700 flex items-center gap-0.5">
                  <Truck size={9} />
                  Shipping
                </span>
                {sellerPaidShipping && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      disableSellerShipping();
                    }}
                    className="text-[7px] font-black uppercase text-sky-600 hover:text-sky-900 shrink-0 px-1 py-0.5 rounded hover:bg-sky-100"
                  >
                    Off
                  </button>
                )}
              </div>
              {sellerPaidShipping ? (
                <div className="relative mt-1" onClick={(e) => e.stopPropagation()}>
                  <Euro className="absolute left-0 top-1/2 -translate-y-1/2 text-sky-400" size={11} />
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    aria-label="Shipping cost you paid"
                    className="w-full pl-3.5 pr-0 py-0 bg-transparent font-bold text-sm tabular-nums text-sky-900 outline-none"
                    value={sellerShippingAmount}
                    onChange={(e) => setSellerShippingAmount(e.target.value)}
                    autoFocus
                  />
                </div>
              ) : (
                <p className="text-[10px] font-bold text-slate-400 mt-1">Click to add</p>
              )}
            </div>
          </div>

          {/* Platform tiles */}
          <div className="grid grid-cols-3 gap-1.5">
            {quickPlatforms.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => {
                  setPlatformSold(p.value);
                  if (p.value === 'In Person' && paymentType === 'ebay.de') setPaymentType('Cash');
                }}
                className={`py-2.5 min-h-[44px] rounded-xl text-[8px] font-extrabold uppercase transition-colors ${
                  platformSold === p.value
                    ? 'bg-slate-900 text-white'
                    : 'border border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                {p.value === 'ebay.de' ? 'eBay' : p.value === 'kleinanzeigen.de' ? 'KA' : 'Person'}
              </button>
            ))}
          </div>
          <select
            className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-[10px] outline-none"
            value={platformSold}
            onChange={(e) => setPlatformSold(e.target.value as Platform)}
            aria-label="All platforms"
          >
            {SALE_PLATFORM_OPTIONS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>

          {platformSold === 'In Person' && (
            <p className="text-[10px] text-violet-800 bg-violet-50 rounded-xl px-2.5 py-1.5 border border-violet-100">
              Local pickup — cash or bank transfer typical.
            </p>
          )}

          {platformSold === 'kleinanzeigen.de' && (
            <div className="space-y-2">
              <input
                type="text"
                placeholder="Chat link (optional)"
                className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[10px] font-bold outline-none focus:border-emerald-400"
                value={kleinanzeigenChatUrl}
                onChange={(e) => setKleinanzeigenChatUrl(e.target.value)}
              />
              <div className="grid grid-cols-[1.4fr_1fr] gap-2">
                <div
                  className={`p-2 rounded-xl border-2 border-dashed min-h-[52px] flex flex-col justify-center ${
                    ebayScreenshotDragOver
                      ? 'border-emerald-500 bg-emerald-50/80'
                      : 'border-slate-200 bg-slate-50/50'
                  }`}
                >
                  <span className="text-[7px] font-bold uppercase text-slate-400 mb-0.5">Paste URL</span>
                  <input
                    type="text"
                    placeholder="https://i.imgur.com/…"
                    className="bg-transparent text-[10px] font-semibold text-slate-700 outline-none w-full"
                    value={kleinanzeigenChatImage.startsWith('data:') ? '' : kleinanzeigenChatImage}
                    onChange={(e) => {
                      setKleinanzeigenChatImage(e.target.value);
                      setKaChatParseError(null);
                    }}
                  />
                </div>
                <label className="p-2 rounded-xl border-2 border-dashed border-slate-200 text-[8px] font-bold uppercase text-slate-600 min-h-[52px] flex flex-col items-center justify-center gap-0.5 cursor-pointer hover:border-emerald-300 hover:bg-emerald-50/30 transition-colors">
                  <Upload size={14} className="text-slate-400" />
                  Choose photo
                  <input type="file" accept="image/*" className="hidden" onChange={handleChatImageUpload} />
                </label>
              </div>
              <button
                type="button"
                onClick={handleParseKleinanzeigenChat}
                disabled={kaChatParsing || !kleinanzeigenChatImage.trim()}
                className="w-full py-2.5 min-h-[44px] rounded-xl bg-emerald-600 text-white text-[9px] font-extrabold uppercase hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {kaChatParsing ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
                {kaChatParsing ? 'Parsing…' : 'Parse screenshot'}
              </button>
              {kleinanzeigenChatImage.startsWith('data:') && (
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-[9px] text-emerald-700 font-bold">Photo loaded — click Parse.</p>
                  <a
                    href={kleinanzeigenChatImage}
                    target="_blank"
                    rel="noreferrer"
                    className="w-7 h-7 rounded-lg overflow-hidden border border-slate-200 shrink-0"
                  >
                    <img src={kleinanzeigenChatImage} className="w-full h-full object-cover" alt="" />
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      setKleinanzeigenChatImage('');
                      setKaChatParseError(null);
                    }}
                    className="text-[9px] font-bold text-emerald-700 hover:underline"
                  >
                    Clear
                  </button>
                </div>
              )}
              {kaChatParseError && <p className="text-[9px] text-red-600 font-bold">{kaChatParseError}</p>}
            </div>
          )}

          {platformSold === 'ebay.de' && (
            <div className="space-y-2">
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-2.5 space-y-2">
                <div className="flex items-center gap-1.5">
                  <Receipt size={12} className="text-indigo-600 shrink-0" />
                  <p className="text-[9px] font-black uppercase tracking-wider text-indigo-800">
                    Match eBay order
                  </p>
                  {orderRefreshLoading && (
                    <span className="inline-flex items-center gap-1 text-[9px] font-bold text-indigo-600 ml-auto">
                      <Loader2 size={10} className="animate-spin" />
                      Fetching…
                    </span>
                  )}
                  {hubFetching && !orderRefreshLoading && (
                    <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-700 ml-auto">
                      <Loader2 size={10} className="animate-spin" />
                      Hub: payout · user · address
                    </span>
                  )}
                </div>
                {orderMatchSuggestions.length === 0 ? (
                  <p className="text-[10px] text-indigo-900/70 leading-snug">
                    {orderRefreshLoading
                      ? 'Fetching recent eBay orders…'
                      : 'No recent orders in cache yet. Wait for fetch, or paste an Order ID below and click Load. Order-first bind is also in eBay Orders.'}
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    <div className="relative">
                      <Search
                        size={12}
                        className="absolute left-2 top-1/2 -translate-y-1/2 text-indigo-400"
                      />
                      <input
                        value={orderFilter}
                        onChange={(e) => setOrderFilter(e.target.value)}
                        placeholder="Filter: Toshiba, 1TB, order id…"
                        className="w-full pl-7 pr-2 py-1.5 rounded-lg border border-indigo-100 bg-white text-[10px] font-semibold outline-none focus:border-indigo-400"
                      />
                    </div>
                    {visibleOrderSuggestions.length === 0 ? (
                      <p className="text-[10px] text-indigo-900/70">No cached orders match that filter.</p>
                    ) : (
                      <div className="space-y-1.5 max-h-60 overflow-y-auto pr-0.5">
                        {visibleOrderSuggestions.map((match) => {
                          const key = `${match.order.orderId}:${match.lineItem.sku || match.lineItem.title}`;
                          const payout = getLinePayout(match.order, match.lineItem);
                          const active = pickedOrderKey === key;
                          const strong = isStrongEbayOrderMatch(match);
                          const isBest = bestOrderMatch === match;
                          return (
                            <div
                              key={key}
                              className={`rounded-lg border px-2.5 py-2 ${
                                isBest
                                  ? 'border-emerald-400 bg-emerald-50/80 ring-1 ring-emerald-200'
                                  : active
                                    ? 'border-indigo-500 bg-white ring-1 ring-indigo-300'
                                    : 'border-indigo-100/80 bg-white/80'
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => applySuggestedOrder(match)}
                                className="w-full text-left"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <p className="text-[11px] font-bold text-slate-900 line-clamp-2 leading-snug">
                                    {match.lineItem.title}
                                  </p>
                                  <div className="flex flex-col items-end gap-0.5 shrink-0">
                                    <span className="text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-700">
                                      {match.orderAgeDays == null
                                        ? 'Recent'
                                        : match.orderAgeDays <= 0
                                          ? 'Today'
                                          : match.orderAgeDays === 1
                                            ? '1d ago'
                                            : `${match.orderAgeDays}d ago`}
                                    </span>
                                    {match.matchKind !== 'recent' && (
                                      <span
                                        className={`text-[8px] font-black uppercase px-1.5 py-0.5 rounded-full ${
                                          match.matchKind === 'listingId'
                                            ? 'bg-emerald-50 text-emerald-700'
                                            : match.matchKind === 'sku'
                                              ? 'bg-sky-50 text-sky-700'
                                              : 'bg-amber-50 text-amber-800'
                                        }`}
                                      >
                                        {match.matchKind === 'listingId'
                                          ? 'Listing'
                                          : match.matchKind === 'sku'
                                            ? 'SKU'
                                            : 'Name match'}
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <p className="text-[10px] text-slate-500 mt-0.5 tabular-nums">
                                  {match.order.orderId} · {match.order.creationDate || 'no date'} ·{' '}
                                  {match.order.buyer.username || match.order.buyer.fullName || 'buyer?'}
                                </p>
                                <p className="text-[10px] font-bold text-slate-700 mt-0.5 tabular-nums">
                                  {payout.buyerTotal != null ? `Käufer €${formatEUR(payout.buyerTotal)}` : ''}
                                  {payout.fee > 0
                                    ? `${payout.buyerTotal != null ? ' · ' : ''}${payout.feeEstimated ? '~' : ''}€${formatEUR(payout.fee)} Gebühren`
                                    : ''}
                                  {payout.netKnown && payout.net != null
                                    ? ` · Netto €${formatEUR(payout.net)}`
                                    : payout.feeEstimated
                                      ? ' · Netto geschätzt'
                                      : ''}
                                </p>
                              </button>
                              {strong ? (
                                <button
                                  type="button"
                                  disabled={saving || hubFetching}
                                  onClick={() => void bindMatchAsSold(match)}
                                  className="mt-1.5 w-full py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[9px] font-black uppercase tracking-wider disabled:opacity-50 inline-flex items-center justify-center gap-1"
                                >
                                  {saving || hubFetching ? (
                                    <Loader2 size={11} className="animate-spin" />
                                  ) : (
                                    <CheckCircle2 size={11} />
                                  )}
                                  {saving || hubFetching
                                    ? 'Binding — reading Hub…'
                                    : isEditBuyer
                                      ? 'Bind order'
                                      : 'Bind · sold'}
                                </button>
                              ) : (
                                <p className="text-[9px] font-black uppercase text-indigo-700 mt-1">
                                  {active ? 'Selected — review & confirm sale' : 'Tap to fill sale from this order'}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-amber-100 bg-amber-50/50 p-2.5 space-y-2">
                <div className="flex items-center gap-1.5">
                  <ExternalLink size={12} className="text-amber-700 shrink-0" />
                  <p className="text-[9px] font-black uppercase tracking-wider text-amber-900">
                    Seller Hub payout
                  </p>
                </div>
                <p className="text-[10px] text-amber-950/80 leading-snug">
                  <span className="font-bold">Bind · sold</span> is one click: it reads payout, username,
                  order id, and shipping address from Seller Hub (plus the eBay order API). Start once with{' '}
                  <span className="font-bold">npm run dev:ebay</span> and stay logged into eBay.de in that
                  Chrome window.
                </p>
                <div className="grid grid-cols-[1.4fr_1fr] gap-1.5">
                  <button
                    type="button"
                    onClick={() => void handleFetchSellerHub()}
                    disabled={hubFetching}
                    className="py-2.5 min-h-[44px] rounded-xl bg-amber-700 text-white text-[9px] font-extrabold uppercase hover:bg-amber-800 disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    {hubFetching ? <Loader2 size={14} className="animate-spin" /> : null}
                    {hubFetching ? 'Reading Hub…' : 'Read Hub now'}
                  </button>
                  <a
                    href={
                      (ebayOrderId.trim() && buildEbayOrderUrl(ebayOrderId.trim())) ||
                      EBAY_SELLER_HUB_ORDERS_URL
                    }
                    target="_blank"
                    rel="noreferrer"
                    className="py-2.5 min-h-[44px] rounded-xl border border-amber-200 bg-white text-amber-800 text-[9px] font-extrabold uppercase hover:bg-amber-50 flex items-center justify-center"
                  >
                    Open Hub
                  </a>
                </div>
                {hubCandidates.length > 0 && (
                  <div className="space-y-1">
                    {hubCandidates.map((c) => (
                      <button
                        key={c.orderId}
                        type="button"
                        onClick={() => void handleFetchSellerHub(c.orderId)}
                        className="w-full text-left rounded-lg border border-amber-100 bg-white px-2 py-1.5 hover:border-amber-300"
                      >
                        <p className="text-[10px] font-bold text-slate-800">{c.orderId}</p>
                        <p className="text-[9px] text-slate-500 line-clamp-2">{c.snippet}</p>
                      </button>
                    ))}
                  </div>
                )}
                {hubMessage && (
                  <p
                    className={`text-[9px] font-bold ${
                      hubMessage.startsWith('Filled') ? 'text-emerald-700' : 'text-amber-900'
                    }`}
                  >
                    {hubMessage}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-[1.4fr_1fr] gap-2">
                <div
                  className={`p-2 rounded-xl border-2 border-dashed min-h-[52px] flex flex-col justify-center ${
                    ebayScreenshotDragOver
                      ? 'border-indigo-500 bg-indigo-50/80'
                      : 'border-slate-200 bg-slate-50/50'
                  }`}
                >
                  <span className="text-[7px] font-bold uppercase text-slate-400 mb-0.5">Paste URL</span>
                  <input
                    type="text"
                    placeholder="https://i.imgur.com/…"
                    className="bg-transparent text-[10px] font-semibold text-slate-700 outline-none w-full"
                    value={orderScreenshotSource.startsWith('data:') ? '' : orderScreenshotSource}
                    onChange={(e) => {
                      setOrderScreenshotSource(e.target.value);
                      setOrderScreenshotError(null);
                    }}
                  />
                </div>
                <label className="p-2 rounded-xl border-2 border-dashed border-slate-200 text-[8px] font-bold uppercase text-slate-600 min-h-[52px] flex flex-col items-center justify-center gap-0.5 cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors">
                  <Upload size={14} className="text-slate-400" />
                  Choose photo
                  <input type="file" accept="image/*" className="hidden" onChange={handleOrderScreenshotUpload} />
                </label>
              </div>
              <button
                type="button"
                onClick={handleParseOrderScreenshot}
                disabled={orderScreenshotParsing}
                className="w-full py-2.5 min-h-[44px] rounded-xl bg-indigo-600 text-white text-[9px] font-extrabold uppercase hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                {orderScreenshotParsing ? <Loader2 size={14} className="animate-spin" /> : <ImagePlus size={14} />}
                {orderScreenshotParsing ? 'Parsing…' : 'Parse screenshot'}
              </button>
              {orderScreenshotSource.startsWith('data:') && (
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-[9px] text-indigo-700 font-bold">Photo loaded — click Parse.</p>
                  <button
                    type="button"
                    onClick={() => {
                      setOrderScreenshotSource('');
                      setOrderScreenshotError(null);
                    }}
                    className="text-[9px] font-bold text-indigo-600 hover:underline"
                  >
                    Clear
                  </button>
                </div>
              )}
              {orderScreenshotError && (
                <p className="text-[9px] text-red-600 font-medium">{orderScreenshotError}</p>
              )}
              {ebayFeeNote &&
                (ebayFeeNote.ebayFeeEur != null ||
                  ebayFeeNote.adFeeEur != null ||
                  ebayFeeNote.amountReceivedNetEur != null ||
                  ebayFeeNote.buyerShippingEur != null) && (
                  <button
                    type="button"
                    onClick={() => setProceedsOpen(true)}
                    className="w-full text-left rounded-xl border border-indigo-100 bg-indigo-50/60 px-2.5 py-2 space-y-1 hover:bg-indigo-50"
                  >
                    <p className="text-[8px] font-black uppercase tracking-wider text-indigo-500">
                      eBay payout · tap for full split
                    </p>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] font-bold text-slate-600">
                      {ebayFeeNote.ebayFeeEur != null && (
                        <span>Verkaufsgebühr €{formatEUR(ebayFeeNote.ebayFeeEur)}</span>
                      )}
                      {ebayFeeNote.adFeeEur != null && (
                        <span>Ads €{formatEUR(ebayFeeNote.adFeeEur)}</span>
                      )}
                      {feeAmount > 0 && (
                        <span className="text-slate-800">Fees total €{formatEUR(feeAmount)}</span>
                      )}
                      {ebayFeeNote.buyerShippingEur != null && (
                        <span className="text-slate-500">
                          Versand €{formatEUR(ebayFeeNote.buyerShippingEur)}
                        </span>
                      )}
                      {ebayFeeNote.amountReceivedNetEur != null && (
                        <span className="text-emerald-700">
                          Auszahlung €{formatEUR(ebayFeeNote.amountReceivedNetEur)}
                        </span>
                      )}
                    </div>
                  </button>
                )}
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="eBay user"
                  className="px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[10px] font-bold outline-none focus:border-indigo-400"
                  value={ebayUsername}
                  onChange={(e) => setEbayUsername(e.target.value)}
                />
                <div className="flex gap-1 min-w-0">
                  <input
                    type="text"
                    placeholder="Order ID"
                    className="flex-1 min-w-0 px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-[10px] font-bold outline-none focus:border-indigo-400"
                    value={ebayOrderId}
                    onChange={(e) => {
                      setEbayOrderId(e.target.value);
                      setOrderIdLookupMessage(null);
                      setPickedOrderKey(null);
                    }}
                    onBlur={() => {
                      if (ebayOrderId.trim()) void fillFromOrderId(ebayOrderId, { silent: true });
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => void fillFromOrderId(ebayOrderId)}
                    disabled={orderIdLookupLoading || !ebayOrderId.trim()}
                    className="shrink-0 px-2 py-2 bg-slate-800 text-white rounded-xl text-[8px] font-black uppercase hover:bg-slate-900 disabled:opacity-50"
                    title="Fill buyer from order cache or eBay API"
                  >
                    {orderIdLookupLoading ? <Loader2 size={10} className="animate-spin" /> : 'Load'}
                  </button>
                </div>
              </div>
              {orderIdLookupMessage && (
                <p
                  className={`text-[9px] font-bold ${
                    orderIdLookupMessage.includes('filled') ||
                    orderIdLookupMessage.includes('Filled') ||
                    orderIdLookupMessage.includes('order history')
                      ? 'text-emerald-600'
                      : 'text-slate-500'
                  }`}
                >
                  {orderIdLookupMessage}
                </p>
              )}
            </div>
          )}

          {/* Buyer — always visible */}
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              placeholder="Buyer name"
              className="px-2.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:border-violet-300"
              value={customer.name}
              onChange={(e) => setCustomer({ ...customer, name: e.target.value })}
            />
            <div className="relative">
              <select
                className="w-full h-full px-2.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-semibold text-[10px] outline-none appearance-none cursor-pointer pr-7"
                value={paymentType}
                onChange={(e) => setPaymentType(e.target.value as PaymentType)}
                aria-label="Payment method"
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={12}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
              />
            </div>
          </div>
          <textarea
            placeholder="Shipping address"
            rows={2}
            className="w-full px-2.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold resize-none outline-none focus:border-violet-300"
            value={customer.address}
            onChange={(e) => setCustomer({ ...customer, address: e.target.value })}
          />

          {item.ebayOrderScreenshotUrl && (
            <a
              href={item.ebayOrderScreenshotUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-block text-[9px] font-bold text-indigo-700 hover:underline"
            >
              View saved eBay screenshot
            </a>
          )}
          {saveError && (
            <p className="text-[10px] font-bold text-red-600 bg-red-50 border border-red-100 rounded-lg px-2 py-1.5">
              {saveError}
            </p>
          )}
        </div>

        <footer className="px-4 py-3 border-t border-slate-100 shrink-0">
          <div className="grid grid-cols-[1fr_1.5fr] gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="py-3 min-h-[48px] rounded-xl border border-slate-200 bg-white text-[10px] font-bold uppercase text-slate-500 hover:bg-slate-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
              className="py-3 min-h-[48px] rounded-xl bg-violet-600 hover:bg-violet-700 text-white font-extrabold text-[10px] uppercase tracking-wide shadow-md flex items-center justify-center gap-1.5 disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
              {saving ? 'Saving…' : isEditBuyer ? 'Save' : 'Mark sold'}
            </button>
          </div>
        </footer>
      </div>
      {proceedsOpen && previewProceeds ? (
        <SaleProceedsDialog breakdown={previewProceeds} onClose={() => setProceedsOpen(false)} />
      ) : null}
    </div>
  );
};

export default SaleModal;
