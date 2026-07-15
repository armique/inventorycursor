
import React, { useCallback, useEffect, useState } from 'react';
import { X, Euro, CheckCircle2, User, Globe, ChevronDown, Link as LinkIcon, MessageCircle, Hash, Upload, Sparkles, ImagePlus, Loader2, Database, Truck, Check } from 'lucide-react';
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 p-0 sm:p-4 pb-safe"
      onDragEnterCapture={handleEbayScreenshotDragEnterCapture}
      onDragLeaveCapture={handleEbayScreenshotDragLeaveCapture}
      onDragOverCapture={handleEbayScreenshotDragOverCapture}
      onDropCapture={handleEbayScreenshotDropCapture}
    >
      <div
        className={`bg-white w-full max-w-2xl rounded-t-2xl sm:rounded-2xl shadow-2xl border overflow-hidden flex flex-col max-h-[92dvh] sm:max-h-[88vh] transition-shadow duration-150 ${
          ebayScreenshotDragOver && isEbayScreenshotDropActive
            ? 'border-indigo-400 ring-4 ring-indigo-300/40 shadow-indigo-100'
            : 'border-slate-100'
        }`}
      >
        <header className="px-4 py-3 sm:px-5 sm:py-3.5 border-b border-slate-100 flex justify-between items-center bg-slate-50/40 shrink-0">
          <div className="min-w-0 pr-2">
            <h2 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight truncate">
              {isEditBuyer ? 'Buyer & sale details' : 'Mark as sold'}
            </h2>
            <p className="text-[9px] text-slate-400 font-bold uppercase tracking-widest mt-0.5 truncate">
              {item.name}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-white rounded-xl transition-all text-slate-400 shrink-0"><X size={20} /></button>
        </header>

        <div className="px-4 py-4 sm:px-5 sm:py-4 space-y-4 overflow-y-auto scrollbar-hide flex-1">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 lg:gap-5">
            <div className="space-y-3">
              {item.quantity != null && item.quantity > 1 ? (
                <>
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-0.5">Quantity & unit price</label>
                    <div className="flex gap-2">
                      <div className="w-20 shrink-0">
                        <input
                          type="number"
                          min="1"
                          max={item.quantity}
                          className="w-full px-2 py-2 bg-slate-50 border border-slate-200 rounded-xl font-black text-base text-center"
                          value={quantityToSell}
                          onChange={(e) => setQuantityToSell(Math.max(1, Math.min(item.quantity || 1, parseInt(e.target.value) || 1)))}
                        />
                        <span className="text-[8px] text-slate-400 font-bold block text-center mt-0.5">of {item.quantity}</span>
                      </div>
                      <div className="relative flex-1 min-w-0">
                        <Euro className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" size={14} />
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="0.00"
                          className="w-full pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-black text-base"
                          value={unitPrice}
                          onChange={(e) => setUnitPrice(e.target.value)}
                        />
                        <span className="text-[8px] text-slate-400 font-bold block mt-0.5 ml-0.5">
                          Total: €{((quantityToSell * (parseFloat(unitPrice) || 0))).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-0.5">Sale date</label>
                    <input type="date" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} />
                  </div>
                </>
              ) : (
                <div className="space-y-1">
                  <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-0.5">Price & date</label>
                  <div className="flex gap-2">
                    <div className="relative flex-1 min-w-0">
                      <Euro className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" size={14} />
                      <input type="text" inputMode="decimal" placeholder="0.00" className="w-full pl-8 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-black text-base" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} />
                    </div>
                    <input type="date" className="w-[9.5rem] shrink-0 px-2 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} />
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <label
                  className={`flex items-center gap-2.5 px-3 py-2 border rounded-xl cursor-pointer transition-all ${
                    sellerPaidShipping
                      ? 'border-sky-300 bg-sky-50/80'
                      : 'border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all ${
                      sellerPaidShipping
                        ? 'bg-sky-500 border-sky-500 text-white'
                        : 'border-slate-300 bg-white'
                    }`}
                  >
                    {sellerPaidShipping && <Check size={12} />}
                  </div>
                  <input
                    type="checkbox"
                    className="hidden"
                    checked={sellerPaidShipping}
                    onChange={(e) => setSellerPaidShipping(e.target.checked)}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                      <Truck size={12} className="text-sky-600 shrink-0" />
                      I paid for shipping
                    </p>
                    <p className="text-[9px] text-slate-500 leading-snug">
                      Deduct postage from lump-sum payment before profit.
                    </p>
                  </div>
                </label>

                {sellerPaidShipping && (
                  <div className="animate-in slide-in-from-top-2 fade-in">
                    <div className="relative">
                      <Euro className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" size={14} />
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="Shipping cost (€)"
                        className="w-full pl-8 pr-3 py-2 bg-white border border-sky-100 rounded-xl outline-none focus:border-sky-400 font-bold text-sm text-slate-900"
                        value={sellerShippingAmount}
                        onChange={(e) => setSellerShippingAmount(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-0.5 flex items-center gap-1.5"><Globe size={11}/> Sold on</label>
                <div className="flex flex-wrap gap-1.5">
                   {SALE_PLATFORM_OPTIONS.filter((p) => ['ebay.de', 'kleinanzeigen.de', 'In Person'].includes(p.value)).map((p) => (
                      <button
                        key={p.value}
                        type="button"
                        onClick={() => {
                          setPlatformSold(p.value);
                          if (p.value === 'In Person' && paymentType === 'ebay.de') setPaymentType('Cash');
                        }}
                        className={`px-3 py-1.5 rounded-lg border text-[9px] font-black uppercase transition-all ${platformSold === p.value ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                      >
                        {p.value === 'In Person' ? 'In person' : p.label}
                      </button>
                   ))}
                </div>
                <select
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs outline-none"
                  value={platformSold}
                  onChange={(e) => setPlatformSold(e.target.value as Platform)}
                >
                  {SALE_PLATFORM_OPTIONS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>

              {platformSold === 'In Person' && (
                 <div className="px-3 py-2 bg-violet-50 rounded-xl border border-violet-100 text-[10px] text-violet-900 leading-snug">
                    Local pickup — cash or bank transfer typical.
                 </div>
              )}

              {platformSold === 'kleinanzeigen.de' && (
                 <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                    <div className="space-y-1">
                       <label className="text-[8px] font-black uppercase text-slate-400 flex items-center gap-1"><LinkIcon size={9}/> Chat link</label>
                       <input
                          type="text"
                          placeholder="https://www.kleinanzeigen.de/..."
                          className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold outline-none focus:border-blue-500"
                          value={kleinanzeigenChatUrl}
                          onChange={e => setKleinanzeigenChatUrl(e.target.value)}
                       />
                    </div>
                    <div className="space-y-1">
                       <label className="text-[8px] font-black uppercase text-slate-400 flex items-center gap-1"><MessageCircle size={9}/> Screenshot</label>
                       <div className="flex gap-1.5">
                          <div className="relative flex-1 min-w-0">
                             <input
                                type="text"
                                placeholder="Upload or paste URL…"
                                className="w-full px-2.5 py-1.5 pr-8 bg-white border border-slate-200 rounded-lg text-xs font-bold outline-none focus:border-blue-500"
                                value={kleinanzeigenChatImage}
                                onChange={e => { setKleinanzeigenChatImage(e.target.value); setKaChatParseError(null); }}
                             />
                             <label className="absolute right-1 top-1/2 -translate-y-1/2 p-1 cursor-pointer text-slate-400 hover:text-blue-500 transition-colors">
                                <Upload size={11}/>
                                <input type="file" accept="image/*" className="hidden" onChange={handleChatImageUpload}/>
                             </label>
                          </div>
                          {kleinanzeigenChatImage && (
                             <a href={kleinanzeigenChatImage} target="_blank" rel="noreferrer" className="w-8 h-8 rounded-lg overflow-hidden border border-slate-200 shrink-0 bg-white">
                                <img src={kleinanzeigenChatImage} className="w-full h-full object-cover" alt="" />
                             </a>
                          )}
                          <button
                             type="button"
                             onClick={handleParseKleinanzeigenChat}
                             disabled={kaChatParsing || !kleinanzeigenChatImage.trim()}
                             className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 bg-emerald-600 text-white rounded-lg text-[9px] font-black uppercase hover:bg-emerald-700 disabled:opacity-50"
                          >
                             <Sparkles size={11} className={kaChatParsing ? 'animate-spin' : ''} />
                             {kaChatParsing ? '…' : 'Parse'}
                          </button>
                       </div>
                       {kaChatParseError && (
                          <p className="text-[9px] text-red-600 font-bold">{kaChatParseError}</p>
                       )}
                    </div>
                 </div>
              )}

              {platformSold === 'ebay.de' && (
                 <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-2">
                    <div className="space-y-1">
                       <label className="text-[8px] font-black uppercase text-slate-400 flex items-center gap-1"><Sparkles size={9}/> Order screenshot (AI)</label>
                       <div
                          className={`flex items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-2 text-center pointer-events-none select-none transition-colors ${
                             ebayScreenshotDragOver
                                ? 'border-indigo-500 bg-indigo-50/80'
                                : 'border-slate-200 bg-white/80'
                          }`}
                       >
                          <ImagePlus className={`shrink-0 ${ebayScreenshotDragOver ? 'text-indigo-600' : 'text-slate-400'}`} size={16} strokeWidth={1.75} />
                          <span className="text-[9px] font-bold text-slate-500">
                             Drop screenshot or use URL / upload below
                          </span>
                       </div>
                       <div className="flex flex-wrap gap-1.5">
                          <input
                             type="text"
                             placeholder="https://i.imgur.com/….jpg"
                             className="flex-1 min-w-[10rem] px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold outline-none focus:border-blue-500"
                             value={orderScreenshotSource.startsWith('data:') ? '' : orderScreenshotSource}
                             onChange={(e) => { setOrderScreenshotSource(e.target.value); setOrderScreenshotError(null); }}
                          />
                          <label className="flex items-center gap-1 px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-[9px] font-black uppercase cursor-pointer hover:bg-slate-50 text-slate-600 shrink-0">
                             <Upload size={11}/>
                             Upload
                             <input type="file" accept="image/*" className="hidden" onChange={handleOrderScreenshotUpload} />
                          </label>
                          <button
                             type="button"
                             onClick={handleParseOrderScreenshot}
                             disabled={orderScreenshotParsing}
                             className="flex items-center gap-1 px-2.5 py-1.5 bg-indigo-600 text-white rounded-lg text-[9px] font-black uppercase hover:bg-indigo-700 disabled:opacity-50 shrink-0"
                          >
                             <Sparkles size={11}/>
                             {orderScreenshotParsing ? 'Parsing…' : 'Parse'}
                          </button>
                       </div>
                       {orderScreenshotSource.startsWith('data:') && (
                          <div className="flex items-center gap-2 flex-wrap">
                             <p className="text-[9px] text-slate-500">Image loaded — click Parse.</p>
                             <button type="button" onClick={() => { setOrderScreenshotSource(''); setOrderScreenshotError(null); }} className="text-[9px] font-bold text-indigo-600 hover:underline">Clear</button>
                          </div>
                       )}
                       {orderScreenshotError && (
                          <p className="text-[10px] text-red-600 font-medium">{orderScreenshotError}</p>
                       )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                       <div className="space-y-1 min-w-0">
                          <label className="text-[8px] font-black uppercase text-slate-400 flex items-center gap-1"><User size={9}/> eBay user</label>
                          <input
                             type="text"
                             placeholder="buyer_123"
                             className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold outline-none focus:border-blue-500"
                             value={ebayUsername}
                             onChange={e => setEbayUsername(e.target.value)}
                          />
                       </div>
                       <div className="space-y-1 min-w-0">
                          <label className="text-[8px] font-black uppercase text-slate-400 flex items-center gap-1"><Hash size={9}/> Order ID</label>
                          <div className="flex gap-1">
                            <input
                               type="text"
                               placeholder="12-34567-89012"
                               className="flex-1 min-w-0 px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold outline-none focus:border-blue-500"
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
                              className="shrink-0 flex items-center gap-0.5 px-2 py-1.5 bg-slate-800 text-white rounded-lg text-[8px] font-black uppercase hover:bg-slate-900 disabled:opacity-50"
                              title="Fill buyer from order cache or eBay API"
                            >
                              {orderIdLookupLoading ? <Loader2 size={11} className="animate-spin" /> : <Database size={11} />}
                              Load
                            </button>
                          </div>
                          {orderIdLookupMessage && (
                            <p className={`text-[9px] font-bold ${orderIdLookupMessage.includes('filled') || orderIdLookupMessage.includes('Filled') ? 'text-emerald-600' : 'text-slate-500'}`}>
                              {orderIdLookupMessage}
                            </p>
                          )}
                       </div>
                    </div>
                 </div>
              )}

              <div className="space-y-1">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-0.5">Payment method</label>
                <div className="relative">
                   <select
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs outline-none appearance-none cursor-pointer"
                      value={paymentType}
                      onChange={(e) => setPaymentType(e.target.value as PaymentType)}
                   >
                      {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                   </select>
                   <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-0.5 flex items-center gap-1.5"><User size={11}/> Buyer (invoice)</label>
              <input type="text" placeholder="Buyer full name" className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold" value={customer.name} onChange={e => setCustomer({...customer, name: e.target.value})} />
              <textarea placeholder="Shipping address" rows={2} className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold resize-none" value={customer.address} onChange={e => setCustomer({...customer, address: e.target.value})} />
            </div>
          </div>
        </div>

        <footer className="px-4 py-3 sm:px-5 bg-slate-50/60 border-t border-slate-100 shrink-0 space-y-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {previewReceived != null && previewProfit != null && !isEditBuyer && (
              <>
                <span className="text-[10px] text-slate-600">
                  Received <strong className="text-slate-800">€{formatEUR(previewReceived)}</strong>
                </span>
                {previewShipping > 0 && (
                  <span className="text-[10px] text-sky-700">
                    Shipping −€{formatEUR(previewShipping)} → revenue €{formatEUR(previewRevenue ?? 0)}
                  </span>
                )}
                <span className={`text-[10px] font-black ${previewProfit >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                  Profit {previewProfit >= 0 ? '+' : ''}€{formatEUR(previewProfit)}
                </span>
              </>
            )}
            {(item.ebayOrderScreenshotUrl || (isEditBuyer && item.kleinanzeigenChatImage)) && item.ebayOrderScreenshotUrl && (
              <a
                href={item.ebayOrderScreenshotUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[9px] font-bold text-indigo-700 hover:underline"
              >
                View saved screenshot
              </a>
            )}
          </div>
          {saveError && (
            <p className="text-[10px] font-bold text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-1.5">{saveError}</p>
          )}
          <div className="flex items-center justify-end gap-2">
            <button onClick={onClose} disabled={saving} className="px-4 py-2 font-bold text-[10px] uppercase text-slate-500 hover:text-slate-700 disabled:opacity-50">Cancel</button>
            <button onClick={() => void handleSave()} disabled={saving} className="px-5 py-2 bg-slate-900 text-white rounded-xl font-black text-[10px] uppercase tracking-wide shadow-lg flex items-center gap-1.5 disabled:opacity-50">
              {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14}/>}
              {saving ? 'Saving…' : isEditBuyer ? 'Save' : 'Mark sold'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default SaleModal;
