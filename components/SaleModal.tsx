
import React, { useCallback, useEffect, useState } from 'react';
import { X, Euro, CheckCircle2, User, Globe, ChevronDown, Link as LinkIcon, MessageCircle, Hash, Upload, Sparkles, ImagePlus, Loader2, Database } from 'lucide-react';
import { parseEbayOrderFromImageInput } from '../services/ebayOrderScreenshotAI';
import { mapKleinanzeigenPaymentMethod, parseKleinanzeigenChatFromImageInput } from '../services/kleinanzeigenChatScreenshotAI';
import { fetchEbayOrder } from '../services/ebayService';
import { findEbayOrderById } from '../services/ebayOrderIndex';
import { customerFromEbayOrder } from '../utils/ebayOrderBuyerData';
import { InventoryItem, ItemStatus, PaymentType, CustomerInfo, Platform, TaxMode } from '../types';
import { SALE_PLATFORM_OPTIONS } from '../utils/salePlatform';
import { formatEUR, parseLocaleNumber } from '../utils/formatMoney';

interface Props {
  item: InventoryItem;
  taxMode?: TaxMode;
  /** sell = mark in-stock item sold; editBuyer = update buyer/sale metadata on already-sold item */
  mode?: 'sell' | 'editBuyer';
  onSave: (updatedItem: InventoryItem, splitOffItem?: InventoryItem) => void;
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

  const handleSave = () => {
    const finalFee = hasFee ? feeAmount : 0;
    
    const isBatchItem = !isEditBuyer && item.quantity != null && item.quantity > 1;
    const qtySold = isBatchItem ? quantityToSell : 1;
    
    const rawPriceText = isBatchItem ? unitPrice : salePrice;
    const parsedUnitPrice = parseLocaleNumber(rawPriceText);
    const unitPriceNum = rawPriceText.trim() === '' || !Number.isFinite(parsedUnitPrice) ? undefined : parsedUnitPrice;
    
    const totalSellPrice = unitPriceNum != null ? unitPriceNum * qtySold : item.sellPrice;
    const totalBuyPrice = isBatchItem ? item.buyPrice * qtySold : item.buyPrice;
    
    const profit = totalSellPrice != null ? calculateProfit(totalSellPrice, totalBuyPrice, finalFee) : item.profit;

    const buyerFields = {
      paymentType,
      platformSold,
      hasFee,
      feeAmount: finalFee,
      comment2: comment,
      customer,
      ebayUsername,
      ebayOrderId,
      kleinanzeigenChatUrl,
      kleinanzeigenChatImage,
    };

    if (isEditBuyer) {
      onSave({
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
      // Split: remaining stock stays in original item
      const updatedOriginal: InventoryItem = {
        ...item,
        quantity: item.quantity! - qtySold,
      };

      // Split off: sold part gets created as a new SOLD item
      const splitOffSold: InventoryItem = {
        ...item,
        id: `${item.id}-sold-${Date.now()}`,
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
        kleinanzeigenChatImage,
        storeVisible: false,
      };

      onSave(updatedOriginal, splitOffSold);
    } else {
      // Full sale of single item or entire batch
      onSave({
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
        kleinanzeigenChatImage,
        quantity: qtySold,
      });
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 p-0 sm:p-4 pb-safe"
      onDragEnterCapture={handleEbayScreenshotDragEnterCapture}
      onDragLeaveCapture={handleEbayScreenshotDragLeaveCapture}
      onDragOverCapture={handleEbayScreenshotDragOverCapture}
      onDropCapture={handleEbayScreenshotDropCapture}
    >
      <div
        className={`bg-white w-full max-w-2xl rounded-t-[2rem] sm:rounded-[3rem] shadow-2xl border overflow-hidden flex flex-col max-h-[92dvh] sm:max-h-[90vh] transition-shadow duration-150 ${
          ebayScreenshotDragOver && isEbayScreenshotDropActive
            ? 'border-indigo-400 ring-4 ring-indigo-300/40 shadow-indigo-100'
            : 'border-slate-100'
        }`}
      >
        <header className="p-8 border-b border-slate-50 flex justify-between items-center bg-slate-50/30 shrink-0">
          <div>
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">
              {isEditBuyer ? 'Buyer & sale details' : 'Finalize Transaction'}
            </h2>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">
              {isEditBuyer ? 'Update buyer data for invoice / records' : 'Invoice Generation Engine'}
            </p>
          </div>
          <button onClick={onClose} className="p-3 hover:bg-white rounded-2xl transition-all text-slate-400"><X size={24} /></button>
        </header>

        <div className="p-8 space-y-8 overflow-y-auto scrollbar-hide flex-1">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-6">
              {item.quantity != null && item.quantity > 1 ? (
                <>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Quantity & Unit Price</label>
                    <div className="flex gap-3">
                      <div className="w-28">
                        <input
                          type="number"
                          min="1"
                          max={item.quantity}
                          className="w-full px-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-black text-lg text-center"
                          value={quantityToSell}
                          onChange={(e) => setQuantityToSell(Math.max(1, Math.min(item.quantity || 1, parseInt(e.target.value) || 1)))}
                        />
                        <span className="text-[9px] text-slate-400 font-bold block text-center mt-1">of {item.quantity} in stock</span>
                      </div>
                      <div className="relative flex-1">
                        <Euro className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
                        <input
                          type="text"
                          inputMode="decimal"
                          placeholder="0.00"
                          className="w-full pl-10 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-black text-lg"
                          value={unitPrice}
                          onChange={(e) => setUnitPrice(e.target.value)}
                        />
                        <span className="text-[9px] text-slate-400 font-bold block mt-1 ml-1">
                          Total Revenue: €{((quantityToSell * (parseFloat(unitPrice) || 0))).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Sale Date</label>
                    <input type="date" className="w-full px-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-bold" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} />
                  </div>
                </>
              ) : (
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Price & Date</label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Euro className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" size={16} />
                      <input type="text" inputMode="decimal" placeholder="0.00" className="w-full pl-10 pr-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-black text-lg" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} />
                    </div>
                    <input type="date" className="flex-1 px-4 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-bold" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} />
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 flex items-center gap-2"><Globe size={12}/> Sold On</label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                   {SALE_PLATFORM_OPTIONS.filter((p) => ['ebay.de', 'kleinanzeigen.de', 'In Person'].includes(p.value)).map((p) => (
                      <button
                        key={p.value}
                        type="button"
                        onClick={() => {
                          setPlatformSold(p.value);
                          if (p.value === 'In Person' && paymentType === 'ebay.de') setPaymentType('Cash');
                        }}
                        className={`py-3 rounded-xl border text-[10px] font-black uppercase transition-all ${platformSold === p.value ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-100 text-slate-500 hover:bg-slate-50'}`}
                      >
                        {p.value === 'In Person' ? 'In person' : p.label}
                      </button>
                   ))}
                </div>
                <select
                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-bold text-xs outline-none"
                  value={platformSold}
                  onChange={(e) => setPlatformSold(e.target.value as Platform)}
                >
                  {SALE_PLATFORM_OPTIONS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
              </div>

              {platformSold === 'In Person' && (
                 <div className="p-4 bg-violet-50 rounded-2xl border border-violet-100 text-xs text-violet-900">
                    Local pickup / buyer came to your place. Cash or bank transfer is typical — buyer details below can go on the invoice.
                 </div>
              )}

              {platformSold === 'kleinanzeigen.de' && (
                 <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
                    <div className="space-y-1">
                       <label className="text-[9px] font-black uppercase text-slate-400 ml-1 flex items-center gap-1"><LinkIcon size={10}/> Chat Link</label>
                       <input
                          type="text"
                          placeholder="https://www.kleinanzeigen.de/..."
                          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-blue-500"
                          value={kleinanzeigenChatUrl}
                          onChange={e => setKleinanzeigenChatUrl(e.target.value)}
                       />
                    </div>
                    <div className="space-y-1">
                       <label className="text-[9px] font-black uppercase text-slate-400 ml-1 flex items-center gap-1"><MessageCircle size={10}/> Screenshot</label>
                       <div className="flex gap-2">
                          <div className="relative flex-1">
                             <input
                                type="text"
                                placeholder="Upload or paste URL..."
                                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-blue-500"
                                value={kleinanzeigenChatImage}
                                onChange={e => { setKleinanzeigenChatImage(e.target.value); setKaChatParseError(null); }}
                             />
                             <div className="absolute right-2 top-1/2 -translate-y-1/2">
                                <label className="p-1.5 cursor-pointer text-slate-400 hover:text-blue-500 transition-colors bg-slate-50 rounded-lg border border-slate-200">
                                   <Upload size={12}/>
                                   <input type="file" accept="image/*" className="hidden" onChange={handleChatImageUpload}/>
                                </label>
                             </div>
                          </div>
                          {kleinanzeigenChatImage && (
                             <a href={kleinanzeigenChatImage} target="_blank" rel="noreferrer" className="w-9 h-9 rounded-lg overflow-hidden border border-slate-200 shrink-0 bg-white">
                                <img src={kleinanzeigenChatImage} className="w-full h-full object-cover" alt="" />
                             </a>
                          )}
                       </div>
                       <button
                          type="button"
                          onClick={handleParseKleinanzeigenChat}
                          disabled={kaChatParsing || !kleinanzeigenChatImage.trim()}
                          className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-emerald-600 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-700 disabled:opacity-50"
                       >
                          <Sparkles size={12} className={kaChatParsing ? 'animate-spin' : ''} />
                          {kaChatParsing ? 'Parsing chat…' : 'Parse chat (AI)'}
                       </button>
                       {kaChatParseError && (
                          <p className="text-[10px] text-red-600 font-bold mt-1">{kaChatParseError}</p>
                       )}
                    </div>
                 </div>
              )}

              {platformSold === 'ebay.de' && (
                 <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3">
                    <div className="space-y-1">
                       <label className="text-[9px] font-black uppercase text-slate-400 ml-1 flex items-center gap-1"><Sparkles size={10}/> Order screenshot (AI)</label>
                       <div
                          className={`mt-2 flex flex-col items-center justify-center gap-1 rounded-2xl border-2 border-dashed px-4 py-5 text-center pointer-events-none select-none transition-colors ${
                             ebayScreenshotDragOver
                                ? 'border-indigo-500 bg-indigo-50/80'
                                : 'border-slate-200 bg-white/80'
                          }`}
                       >
                          <ImagePlus className={`shrink-0 ${ebayScreenshotDragOver ? 'text-indigo-600' : 'text-slate-400'}`} size={22} strokeWidth={1.75} />
                          <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">
                             Drop screenshot here
                          </span>
                          <span className="text-[9px] text-slate-400">or use URL / Upload below — max 6MB</span>
                       </div>
                       <div className="flex flex-col sm:flex-row gap-2 mt-2">
                          <input
                             type="text"
                             placeholder="https://i.imgur.com/....jpg"
                             className="flex-1 min-w-0 px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-blue-500"
                             value={orderScreenshotSource.startsWith('data:') ? '' : orderScreenshotSource}
                             onChange={(e) => { setOrderScreenshotSource(e.target.value); setOrderScreenshotError(null); }}
                          />
                          <div className="flex gap-2 shrink-0">
                             <label className="flex items-center justify-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-xl text-[10px] font-black uppercase cursor-pointer hover:bg-slate-50 text-slate-600">
                                <Upload size={12}/>
                                Upload
                                <input type="file" accept="image/*" className="hidden" onChange={handleOrderScreenshotUpload} />
                             </label>
                             <button
                                type="button"
                                onClick={handleParseOrderScreenshot}
                                disabled={orderScreenshotParsing}
                                className="flex items-center justify-center gap-1.5 px-3 py-2 bg-indigo-600 text-white rounded-xl text-[10px] font-black uppercase hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                             >
                                <Sparkles size={12}/>
                                {orderScreenshotParsing ? 'Parsing…' : 'Parse'}
                             </button>
                          </div>
                       </div>
                       {orderScreenshotSource.startsWith('data:') && (
                          <div className="flex items-center gap-2 ml-1 flex-wrap">
                             <p className="text-[10px] text-slate-500">Image loaded from device — click Parse.</p>
                             <button type="button" onClick={() => { setOrderScreenshotSource(''); setOrderScreenshotError(null); }} className="text-[10px] font-bold text-indigo-600 hover:underline">Clear</button>
                          </div>
                       )}
                       {orderScreenshotError && (
                          <p className="text-xs text-red-600 font-medium ml-1">{orderScreenshotError}</p>
                       )}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                       <div className="space-y-1">
                          <label className="text-[9px] font-black uppercase text-slate-400 ml-1 flex items-center gap-1"><User size={10}/> eBay User</label>
                          <input
                             type="text"
                             placeholder="buyer_123"
                             className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-blue-500"
                             value={ebayUsername}
                             onChange={e => setEbayUsername(e.target.value)}
                          />
                       </div>
                       <div className="space-y-1">
                          <label className="text-[9px] font-black uppercase text-slate-400 ml-1 flex items-center gap-1"><Hash size={10}/> Order ID</label>
                          <div className="flex gap-2">
                            <input
                               type="text"
                               placeholder="12-34567-89012"
                               className="flex-1 min-w-0 px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-blue-500"
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
                              className="shrink-0 flex items-center gap-1 px-2.5 py-2 bg-slate-800 text-white rounded-xl text-[9px] font-black uppercase hover:bg-slate-900 disabled:opacity-50"
                              title="Fill buyer from order cache or eBay API"
                            >
                              {orderIdLookupLoading ? <Loader2 size={12} className="animate-spin" /> : <Database size={12} />}
                              Load
                            </button>
                          </div>
                          {orderIdLookupMessage && (
                            <p className={`text-[10px] font-bold mt-1 ${orderIdLookupMessage.includes('filled') || orderIdLookupMessage.includes('Filled') ? 'text-emerald-600' : 'text-slate-500'}`}>
                              {orderIdLookupMessage}
                            </p>
                          )}
                       </div>
                    </div>
                 </div>
              )}

              <div className="space-y-3">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Payment Method</label>
                <div className="relative">
                   <select
                      className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl font-bold text-xs outline-none appearance-none cursor-pointer"
                      value={paymentType}
                      onChange={(e) => setPaymentType(e.target.value as PaymentType)}
                   >
                      {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                   </select>
                   <ChevronDown size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 flex items-center gap-2"><User size={12}/> Buyer Data (For Invoice)</label>
              <input type="text" placeholder="Buyer Full Name" className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-bold" value={customer.name} onChange={e => setCustomer({...customer, name: e.target.value})} />
              <textarea placeholder="Full Shipping Address" rows={3} className="w-full px-5 py-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs font-bold" value={customer.address} onChange={e => setCustomer({...customer, address: e.target.value})} />
            </div>
          </div>
        </div>

        <footer className="p-8 bg-slate-50/50 border-t border-slate-100 flex gap-4 shrink-0">
          <button onClick={onClose} className="flex-1 py-4 font-black text-xs uppercase text-slate-400">Cancel</button>
          <button onClick={handleSave} className="flex-[2] py-4 bg-slate-900 text-white rounded-[1.5rem] font-black text-xs uppercase tracking-widest shadow-xl flex items-center justify-center gap-2">
            <CheckCircle2 size={18}/>
            {isEditBuyer ? 'Save buyer data' : 'Save & Mark Sold'}
          </button>
        </footer>
      </div>
    </div>
  );
};

export default SaleModal;
