
import React, { useCallback, useEffect, useState } from 'react';
import { X, Euro, CheckCircle2, ChevronDown, Upload, ImagePlus, Loader2, Truck } from 'lucide-react';
import { parseEbayOrderFromImageInput } from '../services/ebayOrderScreenshotAI';
import { mapKleinanzeigenPaymentMethod, parseKleinanzeigenChatFromImageInput } from '../services/kleinanzeigenChatScreenshotAI';
import { fetchEbayOrder } from '../services/ebayService';
import { findEbayOrderById } from '../services/ebayOrderIndex';
import { customerFromEbayOrder } from '../utils/ebayOrderBuyerData';
import { persistSaleProofImage, urlNeedsPhotoArchive } from '../services/inventoryImageStorage';
import { InventoryItem, ItemStatus, PaymentType, CustomerInfo, Platform, TaxMode } from '../types';
import { SALE_PLATFORM_OPTIONS } from '../utils/salePlatform';
import { formatEUR, parseLocaleNumber } from '../utils/formatMoney';

interface Props {
  item: InventoryItem;
  taxMode?: TaxMode;
  /** sell = mark in-stock item sold; editBuyer = update buyer/sale metadata on already-sold item */
  mode?: 'sell' | 'editBuyer';
  onSave: (updatedItem: InventoryItem, splitOffItem?: InventoryItem) => void | Promise<void>;
  onClose: () => void;
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

const SaleModal: React.FC<Props> = ({ item, taxMode = 'SmallBusiness', mode = 'sell', onSave, onClose }) => {
  const isEditBuyer = mode === 'editBuyer';
  const [salePrice, setSalePrice] = useState<string>(item.sellPrice != null ? String(item.sellPrice) : '');
  const [saleDate, setSaleDate] = useState(item.sellDate || new Date().toISOString().split('T')[0]);
  const [paymentType, setPaymentType] = useState<PaymentType>(item.paymentType || 'ebay.de');
  const [platformSold, setPlatformSold] = useState<Platform>(item.platformSold || 'ebay.de');
  const [hasFee, setHasFee] = useState(item.hasFee || false);
  const [feeAmount, setFeeAmount] = useState(item.feeAmount || 0);
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
  const [kleinanzeigenChatUrl, setKleinanzeigenChatUrl] = useState(item.kleinanzeigenChatUrl || '');
  const [kleinanzeigenChatImage, setKleinanzeigenChatImage] = useState(item.kleinanzeigenChatImage || '');

  const [customer, setCustomer] = useState<CustomerInfo>({
    name: item.customer?.name || '',
    address: item.customer?.address || ''
  });

  const [orderScreenshotSource, setOrderScreenshotSource] = useState('');
  const [orderScreenshotParsing, setOrderScreenshotParsing] = useState(false);
  const [orderScreenshotError, setOrderScreenshotError] = useState<string | null>(null);
  const [ebayScreenshotDragOver, setEbayScreenshotDragOver] = useState(false);
  const [kaChatParsing, setKaChatParsing] = useState(false);
  const [kaChatParseError, setKaChatParseError] = useState<string | null>(null);
  const [orderIdLookupLoading, setOrderIdLookupLoading] = useState(false);
  const [orderIdLookupMessage, setOrderIdLookupMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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
          setPlatformSold('ebay.de');
          setPaymentType('ebay.de');
          setOrderIdLookupMessage('Buyer filled from order cache.');
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
        setPlatformSold('ebay.de');
        setPaymentType('ebay.de');
        setOrderIdLookupMessage('Buyer filled from eBay API.');
      } catch (err: unknown) {
        if (!opts?.silent) {
          setOrderIdLookupMessage(err instanceof Error ? err.message : 'Order not found in cache or API.');
        }
      } finally {
        setOrderIdLookupLoading(false);
      }
    },
    [applyEbayOrderBuyerFields]
  );

  useEffect(() => {
    if (!isEditBuyer || !ebayOrderId.trim()) return;
    if (customer.name?.trim() || customer.address?.trim()) return;
    void fillFromOrderId(ebayOrderId, { silent: true });
  }, [isEditBuyer, ebayOrderId, customer.name, customer.address, fillFromOrderId]);

  useEffect(() => {
    if (platformSold !== 'ebay.de') setEbayScreenshotDragOver(false);
  }, [platformSold]);

  const handleChatImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) return alert("Image too large. Max 2MB.");
      const reader = new FileReader();
      reader.onloadend = () => {
        setKleinanzeigenChatImage(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
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

  const isEbayScreenshotDropActive = platformSold === 'ebay.de';

  const handleEbayScreenshotDragOverCapture = (e: React.DragEvent) => {
    if (!isEbayScreenshotDropActive) return;
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleEbayScreenshotDragEnterCapture = (e: React.DragEvent) => {
    if (!isEbayScreenshotDropActive) return;
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    setEbayScreenshotDragOver(true);
  };

  const handleEbayScreenshotDragLeaveCapture = (e: React.DragEvent) => {
    if (!isEbayScreenshotDropActive) return;
    const rel = e.relatedTarget as Node | null;
    if (rel && (e.currentTarget as HTMLElement).contains(rel)) return;
    setEbayScreenshotDragOver(false);
  };

  const handleEbayScreenshotDropCapture = (e: React.DragEvent) => {
    if (!isEbayScreenshotDropActive) return;
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    e.stopPropagation();
    setEbayScreenshotDragOver(false);
    const file = [...e.dataTransfer.files].find((f) => f.type.startsWith('image/'));
    if (file) loadOrderScreenshotFile(file);
    else if (e.dataTransfer.files.length > 0) {
      setOrderScreenshotError('Please drop an image file (PNG, JPG, WebP, …).');
    }
  };

  const handleParseOrderScreenshot = async () => {
    const src = orderScreenshotSource.trim();
    if (!src) {
      setOrderScreenshotError('Paste an Imgur/direct image URL or upload a screenshot.');
      return;
    }
    setOrderScreenshotError(null);
    setOrderScreenshotParsing(true);
    try {
      const data = await parseEbayOrderFromImageInput(src);
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
      if (data.amountReceivedNetEur != null && Number.isFinite(data.amountReceivedNetEur)) {
        const fmtPrice = formatEUR(data.amountReceivedNetEur);
        setSalePrice(fmtPrice);
        setUnitPrice(fmtPrice);
        setHasFee(false);
        setFeeAmount(0);
      }
      if (data.saleDate) setSaleDate(data.saleDate);
    } catch (err: unknown) {
      setOrderScreenshotError(err instanceof Error ? err.message : 'Parse failed');
    } finally {
      setOrderScreenshotParsing(false);
    }
  };

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

  const calculateProfit = (sell: number, buy: number, fee: number) => {
    if (taxMode === 'RegularVAT') {
      const netSell = sell / 1.19;
      return netSell - buy - fee;
    }
    if (taxMode === 'DifferentialVAT') {
      const margin = sell - buy;
      if (margin <= 0) return margin - fee;
      const tax = margin - (margin / 1.19);
      return margin - tax - fee;
    }
    return sell - buy - fee;
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
    const profit =
      revenueForProfit != null ? calculateProfit(revenueForProfit, totalBuyPrice, finalFee) : item.profit;

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
        comment2: comment,
        customer,
        ebayUsername,
        ebayOrderId,
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
          kleinanzeigenChatUrl,
          kleinanzeigenChatImage: archivedKaImage || undefined,
          ebayOrderScreenshotUrl,
          storeVisible: false,
        };

        await onSave(updatedOriginal, splitOffSold);
      } else {
        await onSave({
          ...item,
          buyPrice: isBatchItem ? totalBuyPrice : item.buyPrice,
          sellPrice: totalSellPrice,
          sellDate: saleDate,
          paymentType,
          platformSold,
          hasFee,
          feeAmount: finalFee,
          comment2: comment,
          customer,
          status: ItemStatus.SOLD,
          storeVisible: false,
          profit: profit != null ? parseFloat(profit.toFixed(2)) : undefined,
          ebayUsername,
          ebayOrderId,
          kleinanzeigenChatUrl,
          kleinanzeigenChatImage: archivedKaImage || undefined,
          ebayOrderScreenshotUrl,
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
  const previewRevenue =
    previewReceived != null ? Math.max(0, previewReceived - previewShipping) : null;
  const previewBuy =
    item.quantity != null && item.quantity > 1 ? item.buyPrice * previewQty : item.buyPrice;
  const previewFee = hasFee ? feeAmount : 0;
  const previewProfit =
    previewRevenue != null ? calculateProfit(previewRevenue, previewBuy, previewFee) : null;

  const isBatchItem = !isEditBuyer && item.quantity != null && item.quantity > 1;
  const quickPlatforms = SALE_PLATFORM_OPTIONS.filter((p) =>
    ['ebay.de', 'kleinanzeigen.de', 'In Person'].includes(p.value)
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 p-0 sm:p-4 pb-safe"
      onDragEnterCapture={handleEbayScreenshotDragEnterCapture}
      onDragLeaveCapture={handleEbayScreenshotDragLeaveCapture}
      onDragOverCapture={handleEbayScreenshotDragOverCapture}
      onDropCapture={handleEbayScreenshotDropCapture}
    >
      <div
        className={`bg-white w-full max-w-[520px] rounded-t-2xl sm:rounded-2xl shadow-2xl border overflow-hidden flex flex-col max-h-[92dvh] sm:max-h-[88vh] transition-shadow duration-150 ${
          ebayScreenshotDragOver && isEbayScreenshotDropActive
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

        <div className="px-4 py-3 space-y-2 overflow-y-auto scrollbar-hide flex-1">
          {/* Bento 2×2 — price, date, profit, shipping */}
          <div className="grid grid-cols-2 gap-2">
            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 min-h-[72px]">
              <label className="text-[8px] font-black uppercase tracking-wider text-slate-400">
                {isBatchItem ? 'Unit price' : 'Price €'}
              </label>
              {isBatchItem ? (
                <div className="mt-1 flex gap-1.5 items-center">
                  <input
                    type="number"
                    min={1}
                    max={item.quantity}
                    aria-label="Quantity to sell"
                    className="w-10 px-1 py-1 bg-white border border-slate-200 rounded-lg font-bold text-xs text-center tabular-nums"
                    value={quantityToSell}
                    onChange={(e) =>
                      setQuantityToSell(
                        Math.max(1, Math.min(item.quantity || 1, parseInt(e.target.value, 10) || 1))
                      )
                    }
                  />
                  <div className="relative flex-1 min-w-0">
                    <Euro className="absolute left-1.5 top-1/2 -translate-y-1/2 text-slate-300" size={11} />
                    <input
                      type="text"
                      inputMode="decimal"
                      placeholder="0.00"
                      className="w-full pl-5 pr-1 py-1 bg-white border border-slate-200 rounded-lg font-bold text-sm tabular-nums"
                      value={unitPrice}
                      onChange={(e) => setUnitPrice(e.target.value)}
                    />
                  </div>
                </div>
              ) : (
                <div className="relative mt-0.5">
                  <Euro className="absolute left-0 top-1/2 -translate-y-1/2 text-slate-300" size={13} />
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    className="w-full pl-4 pr-0 py-0.5 bg-transparent font-bold text-lg tabular-nums text-slate-900 outline-none"
                    value={salePrice}
                    onChange={(e) => setSalePrice(e.target.value)}
                  />
                </div>
              )}
              {isBatchItem && (
                <p className="text-[8px] text-slate-400 font-bold mt-0.5 tabular-nums">
                  ×{quantityToSell} = €{((quantityToSell * (parseFloat(unitPrice) || 0)).toFixed(2))}
                </p>
              )}
            </div>

            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 min-h-[72px]">
              <label htmlFor="sale-date" className="text-[8px] font-black uppercase tracking-wider text-slate-400">
                Date
              </label>
              <input
                id="sale-date"
                type="date"
                className="mt-1 w-full bg-transparent font-bold text-sm text-slate-900 outline-none"
                value={saleDate}
                onChange={(e) => setSaleDate(e.target.value)}
              />
            </div>

            {!isEditBuyer && (
              <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-100 min-h-[72px]">
                <p className="text-[8px] font-black uppercase tracking-wider text-emerald-700">Profit est.</p>
                <p
                  className={`text-lg font-black tabular-nums mt-0.5 ${
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

            <label
              className={`p-2.5 rounded-xl border min-h-[72px] cursor-pointer transition-colors block ${
                sellerPaidShipping
                  ? 'bg-sky-50 border-sky-200'
                  : 'bg-slate-50 border-slate-100 hover:border-sky-200'
              } ${isEditBuyer ? 'col-span-2' : ''}`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={sellerPaidShipping}
                onChange={(e) => setSellerPaidShipping(e.target.checked)}
              />
              <span className="text-[8px] font-black uppercase tracking-wider text-sky-700 flex items-center gap-1">
                <Truck size={10} />
                Shipping paid
              </span>
              {sellerPaidShipping ? (
                <div className="relative mt-1">
                  <Euro className="absolute left-0 top-1/2 -translate-y-1/2 text-sky-400" size={12} />
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0.00"
                    className="w-full pl-4 pr-0 py-0.5 bg-transparent font-bold text-sm tabular-nums text-sky-900 outline-none"
                    value={sellerShippingAmount}
                    onChange={(e) => setSellerShippingAmount(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </div>
              ) : (
                <p className="text-xs font-bold text-slate-400 mt-1">Tap to add</p>
              )}
            </label>
          </div>

          {/* Platform block */}
          <div className="p-2.5 rounded-xl border border-slate-200 space-y-2">
            <div className="flex justify-between items-center gap-2">
              <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 shrink-0">Platform</span>
              <div className="flex flex-wrap gap-1 justify-end">
                {quickPlatforms.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => {
                      setPlatformSold(p.value);
                      if (p.value === 'In Person' && paymentType === 'ebay.de') setPaymentType('Cash');
                    }}
                    className={`px-2 py-0.5 rounded-md text-[8px] font-black uppercase transition-all ${
                      platformSold === p.value
                        ? 'bg-slate-900 text-white'
                        : 'border border-slate-200 text-slate-500 hover:bg-slate-50'
                    }`}
                  >
                    {p.value === 'ebay.de' ? 'eBay' : p.value === 'kleinanzeigen.de' ? 'KA' : 'In person'}
                  </button>
                ))}
              </div>
            </div>
            <select
              className="w-full px-2 py-1.5 bg-slate-50 border border-slate-200 rounded-lg font-bold text-[10px] outline-none"
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
              <p className="text-[10px] text-violet-800 bg-violet-50 rounded-lg px-2 py-1 border border-violet-100">
                Local pickup — cash or bank transfer typical.
              </p>
            )}

            {platformSold === 'kleinanzeigen.de' && (
              <div className="space-y-1.5 pt-0.5">
                <input
                  type="text"
                  placeholder="Chat link (optional)"
                  className="w-full px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-[10px] font-bold outline-none focus:border-blue-500"
                  value={kleinanzeigenChatUrl}
                  onChange={(e) => setKleinanzeigenChatUrl(e.target.value)}
                />
                <div className="flex gap-1">
                  <div className="relative flex-1 min-w-0">
                    <input
                      type="text"
                      placeholder="Chat screenshot URL"
                      className="w-full px-2 py-1.5 pr-7 bg-white border border-slate-200 rounded-lg text-[10px] font-bold outline-none focus:border-blue-500"
                      value={kleinanzeigenChatImage}
                      onChange={(e) => {
                        setKleinanzeigenChatImage(e.target.value);
                        setKaChatParseError(null);
                      }}
                    />
                    <label className="absolute right-1 top-1/2 -translate-y-1/2 p-0.5 cursor-pointer text-slate-400 hover:text-blue-500">
                      <Upload size={11} />
                      <input type="file" accept="image/*" className="hidden" onChange={handleChatImageUpload} />
                    </label>
                  </div>
                  {kleinanzeigenChatImage && (
                    <a
                      href={kleinanzeigenChatImage}
                      target="_blank"
                      rel="noreferrer"
                      className="w-7 h-7 rounded-lg overflow-hidden border border-slate-200 shrink-0"
                    >
                      <img src={kleinanzeigenChatImage} className="w-full h-full object-cover" alt="" />
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={handleParseKleinanzeigenChat}
                    disabled={kaChatParsing || !kleinanzeigenChatImage.trim()}
                    className="shrink-0 px-2 py-1.5 bg-emerald-600 text-white rounded-lg text-[8px] font-black uppercase hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {kaChatParsing ? '…' : 'Parse'}
                  </button>
                </div>
                {kaChatParseError && <p className="text-[9px] text-red-600 font-bold">{kaChatParseError}</p>}
              </div>
            )}

            {platformSold === 'ebay.de' && (
              <div className="space-y-1.5 pt-0.5">
                <div
                  className={`flex items-center gap-2 rounded-lg border border-dashed px-2 py-1.5 pointer-events-none select-none ${
                    ebayScreenshotDragOver ? 'border-indigo-500 bg-indigo-50/80' : 'border-slate-200 bg-white/80'
                  }`}
                >
                  <ImagePlus
                    className={`shrink-0 ${ebayScreenshotDragOver ? 'text-indigo-600' : 'text-slate-400'}`}
                    size={14}
                  />
                  <span className="text-[9px] font-bold text-slate-500">Drop screenshot or paste URL below</span>
                </div>
                <div className="flex flex-wrap gap-1">
                  <input
                    type="text"
                    placeholder="Screenshot URL"
                    className="flex-1 min-w-[8rem] px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-[10px] font-bold outline-none focus:border-blue-500"
                    value={orderScreenshotSource.startsWith('data:') ? '' : orderScreenshotSource}
                    onChange={(e) => {
                      setOrderScreenshotSource(e.target.value);
                      setOrderScreenshotError(null);
                    }}
                  />
                  <label className="flex items-center gap-1 px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-[8px] font-black uppercase cursor-pointer hover:bg-slate-50 text-slate-600 shrink-0">
                    <Upload size={10} />
                    Upload
                    <input type="file" accept="image/*" className="hidden" onChange={handleOrderScreenshotUpload} />
                  </label>
                  <button
                    type="button"
                    onClick={handleParseOrderScreenshot}
                    disabled={orderScreenshotParsing}
                    className="px-2 py-1.5 bg-indigo-600 text-white rounded-lg text-[8px] font-black uppercase hover:bg-indigo-700 disabled:opacity-50 shrink-0"
                  >
                    {orderScreenshotParsing ? '…' : 'Parse'}
                  </button>
                </div>
                {orderScreenshotSource.startsWith('data:') && (
                  <div className="flex items-center gap-2">
                    <p className="text-[9px] text-slate-500">Image loaded.</p>
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
                <div className="grid grid-cols-2 gap-1">
                  <input
                    type="text"
                    placeholder="eBay user"
                    className="px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-[10px] font-bold outline-none focus:border-blue-500"
                    value={ebayUsername}
                    onChange={(e) => setEbayUsername(e.target.value)}
                  />
                  <div className="flex gap-1 min-w-0">
                    <input
                      type="text"
                      placeholder="Order ID"
                      className="flex-1 min-w-0 px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-[10px] font-bold outline-none focus:border-blue-500"
                      value={ebayOrderId}
                      onChange={(e) => {
                        setEbayOrderId(e.target.value);
                        setOrderIdLookupMessage(null);
                      }}
                      onBlur={() => {
                        if (ebayOrderId.trim()) void fillFromOrderId(ebayOrderId, { silent: true });
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => void fillFromOrderId(ebayOrderId)}
                      disabled={orderIdLookupLoading || !ebayOrderId.trim()}
                      className="shrink-0 px-1.5 py-1.5 bg-slate-800 text-white rounded-lg text-[8px] font-black uppercase hover:bg-slate-900 disabled:opacity-50"
                      title="Fill buyer from order cache or eBay API"
                    >
                      {orderIdLookupLoading ? <Loader2 size={10} className="animate-spin" /> : 'Load'}
                    </button>
                  </div>
                </div>
                {orderIdLookupMessage && (
                  <p
                    className={`text-[9px] font-bold ${
                      orderIdLookupMessage.includes('filled') || orderIdLookupMessage.includes('Filled')
                        ? 'text-emerald-600'
                        : 'text-slate-500'
                    }`}
                  >
                    {orderIdLookupMessage}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Buyer row */}
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              placeholder="Buyer name"
              className="px-2 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold outline-none focus:border-violet-300"
              value={customer.name}
              onChange={(e) => setCustomer({ ...customer, name: e.target.value })}
            />
            <div className="relative">
              <select
                className="w-full h-full px-2 py-2 bg-slate-50 border border-slate-200 rounded-lg font-bold text-xs outline-none appearance-none cursor-pointer pr-7"
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
              <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
          </div>
          <textarea
            placeholder="Shipping address"
            rows={2}
            className="w-full px-2 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold resize-none outline-none focus:border-violet-300"
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

        <footer className="px-4 py-3 border-t border-slate-100 shrink-0 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-3 py-2 text-[10px] font-bold uppercase text-slate-500 hover:text-slate-700 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="px-5 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-xl font-black text-[10px] uppercase tracking-wide shadow-md flex items-center gap-1.5 disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            {saving ? 'Saving…' : isEditBuyer ? 'Save' : 'Mark sold'}
          </button>
        </footer>
      </div>
    </div>
  );
};

export default SaleModal;
