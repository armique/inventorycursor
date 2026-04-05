
import React, { useState } from 'react';
import { X, Euro, CheckCircle2, User, Globe, ChevronDown, Link as LinkIcon, MessageCircle, Hash, Upload, Download, Sparkles } from 'lucide-react';
import { fetchEbayOrder } from '../services/ebayService';
import { parseEbayOrderFromImageInput } from '../services/ebayOrderScreenshotAI';
import { InventoryItem, ItemStatus, PaymentType, CustomerInfo, Platform, TaxMode } from '../types';
import { parseLocaleNumber } from '../utils/formatMoney';

interface Props {
  item: InventoryItem;
  taxMode?: TaxMode;
  onSave: (updatedItem: InventoryItem) => void;
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

const SaleModal: React.FC<Props> = ({ item, taxMode = 'SmallBusiness', onSave, onClose }) => {
  const [salePrice, setSalePrice] = useState<string>(item.sellPrice != null ? String(item.sellPrice) : '');
  const [saleDate, setSaleDate] = useState(item.sellDate || new Date().toISOString().split('T')[0]);
  const [paymentType, setPaymentType] = useState<PaymentType>(item.paymentType || 'ebay.de');
  const [platformSold, setPlatformSold] = useState<Platform>(item.platformSold || 'ebay.de');
  const [hasFee, setHasFee] = useState(item.hasFee || false);
  const [feeAmount, setFeeAmount] = useState(item.feeAmount || 0);
  const [comment, setComment] = useState(item.comment2 || '');
  
  // New Sales Data Fields
  const [ebayUsername, setEbayUsername] = useState(item.ebayUsername || '');
  const [ebayOrderId, setEbayOrderId] = useState(item.ebayOrderId || '');
  const [kleinanzeigenChatUrl, setKleinanzeigenChatUrl] = useState(item.kleinanzeigenChatUrl || '');
  const [kleinanzeigenChatImage, setKleinanzeigenChatImage] = useState(item.kleinanzeigenChatImage || '');
  
  const [customer, setCustomer] = useState<CustomerInfo>({
    name: item.customer?.name || '',
    address: item.customer?.address || ''
  });
  const [fetchEbayLoading, setFetchEbayLoading] = useState(false);
  const [fetchEbayError, setFetchEbayError] = useState<string | null>(null);

  const [orderScreenshotSource, setOrderScreenshotSource] = useState('');
  const [orderScreenshotParsing, setOrderScreenshotParsing] = useState(false);
  const [orderScreenshotError, setOrderScreenshotError] = useState<string | null>(null);

  const handleFetchFromEbay = async () => {
    const id = ebayOrderId.trim();
    if (!id) {
      setFetchEbayError('Enter an order ID first');
      return;
    }
    setFetchEbayError(null);
    setFetchEbayLoading(true);
    try {
      const data = await fetchEbayOrder(id);
      setEbayUsername(data.ebayUsername);
      setEbayOrderId(data.ebayOrderId);
      setCustomer(prev => ({
        ...prev,
        name: data.customer.name || prev.name,
        address: data.customer.address || prev.address,
        ...(data.customer.phone && { phone: data.customer.phone }),
        ...(data.customer.email && { email: data.customer.email }),
      }));
      if (data.sellPrice != null) setSalePrice(String(data.sellPrice));
      if (data.sellDate) setSaleDate(data.sellDate);
    } catch (e: any) {
      setFetchEbayError(e?.message || 'Failed to fetch order');
    } finally {
      setFetchEbayLoading(false);
    }
  };

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

  const handleOrderScreenshotUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 6 * 1024 * 1024) return alert('Screenshot too large. Max 6MB.');
    const reader = new FileReader();
    reader.onloadend = () => {
      setOrderScreenshotSource(reader.result as string);
      setOrderScreenshotError(null);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
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
    } catch (err: unknown) {
      setOrderScreenshotError(err instanceof Error ? err.message : 'Parse failed');
    } finally {
      setOrderScreenshotParsing(false);
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
    const parsedPrice = parseLocaleNumber(salePrice);
    const priceNum = salePrice.trim() === '' || !Number.isFinite(parsedPrice) ? undefined : parsedPrice;
    const profit = priceNum != null ? calculateProfit(priceNum, item.buyPrice, finalFee) : undefined;
    
    onSave({
      ...item,
      sellPrice: priceNum,
      sellDate: saleDate,
      paymentType,
      platformSold,
      hasFee,
      feeAmount: finalFee,
      comment2: comment,
      customer,
      status: ItemStatus.SOLD,
      profit: profit != null ? parseFloat(profit.toFixed(2)) : undefined,
      ebayUsername,
      ebayOrderId,
      kleinanzeigenChatUrl,
      kleinanzeigenChatImage
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
      <div className="bg-white w-full max-w-2xl rounded-[3rem] shadow-2xl border border-slate-100 overflow-hidden animate-in zoom-in-95 flex flex-col max-h-[90vh]">
        <header className="p-8 border-b border-slate-50 flex justify-between items-center bg-slate-50/30 shrink-0">
          <div>
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">Finalize Transaction</h2>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Invoice Generation Engine</p>
          </div>
          <button onClick={onClose} className="p-3 hover:bg-white rounded-2xl transition-all text-slate-400"><X size={24} /></button>
        </header>

        <div className="p-8 space-y-8 overflow-y-auto scrollbar-hide flex-1">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-6">
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

              <div className="space-y-3">
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1 flex items-center gap-2"><Globe size={12}/> Sold On</label>
                <div className="flex gap-2">
                   {['ebay.de', 'kleinanzeigen.de'].map(p => (
                      <button 
                        key={p} 
                        onClick={() => setPlatformSold(p as Platform)}
                        className={`flex-1 py-3 rounded-xl border text-[10px] font-black uppercase transition-all ${platformSold === p ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-100 text-slate-500 hover:bg-slate-50'}`}
                      >
                        {p}
                      </button>
                   ))}
                </div>
              </div>

              {/* Platform Specific Data Inputs */}
              {platformSold === 'kleinanzeigen.de' && (
                 <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3 animate-in fade-in">
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
                                onChange={e => setKleinanzeigenChatImage(e.target.value)}
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
                                <img src={kleinanzeigenChatImage} className="w-full h-full object-cover" />
                             </a>
                          )}
                       </div>
                    </div>
                 </div>
              )}

              {platformSold === 'ebay.de' && (
                 <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-3 animate-in fade-in">
                    <div className="space-y-1">
                       <label className="text-[9px] font-black uppercase text-slate-400 ml-1 flex items-center gap-1"><Sparkles size={10}/> Order screenshot (AI)</label>
                       <p className="text-[10px] text-slate-500 ml-1 leading-relaxed">
                          Paste a direct image URL (e.g. <span className="font-mono">i.imgur.com/…</span>) or upload. Uses Gemini or OpenAI from your .env.
                       </p>
                       <div className="flex flex-col sm:flex-row gap-2">
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
                          <input 
                             type="text" 
                             placeholder="12-34567-89012"
                             className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold outline-none focus:border-blue-500"
                             value={ebayOrderId}
                             onChange={e => { setEbayOrderId(e.target.value); setFetchEbayError(null); }}
                          />
                       </div>
                    </div>
                    <div className="flex items-center gap-2">
                       <button
                          type="button"
                          onClick={handleFetchFromEbay}
                          disabled={fetchEbayLoading}
                          className="flex items-center gap-2 px-3 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
                       >
                          <Download size={14}/>
                          {fetchEbayLoading ? 'Importing…' : 'Import from eBay'}
                       </button>
                       {fetchEbayError && (
                          <span className="text-xs text-red-600 font-medium">{fetchEbayError}</span>
                       )}
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
          <button onClick={handleSave} className="flex-[2] py-4 bg-slate-900 text-white rounded-[1.5rem] font-black text-xs uppercase tracking-widest shadow-xl flex items-center justify-center gap-2"><CheckCircle2 size={18}/> Save & Mark Sold</button>
        </footer>
      </div>
    </div>
  );
};

export default SaleModal;
