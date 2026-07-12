
import React, { useMemo, useState } from 'react';
import { X, Gift, TrendingUp, TrendingDown, User, Calendar, FileText } from 'lucide-react';
import { InventoryItem, ItemStatus, TaxMode } from '../types';
import { computeItemProfitBeforeOverhead } from '../services/financialAggregation';
import { formatEUR, parseLocaleMoney } from '../utils/formatMoney';
import ItemThumbnail from './ItemThumbnail';

export type GiftRelation = 'family' | 'friend' | 'other';

interface Props {
  item: InventoryItem;
  taxMode?: TaxMode;
  onSave: (updatedItem: InventoryItem) => void;
  onClose: () => void;
}

function defaultMarketValue(item: InventoryItem): number {
  if (item.storePrice != null && Number(item.storePrice) > 0) return Number(item.storePrice);
  if (item.sellPrice != null && Number(item.sellPrice) > 0) return Number(item.sellPrice);
  return Number(item.buyPrice) || 0;
}

const GiftModal: React.FC<Props> = ({ item, taxMode = 'SmallBusiness', onSave, onClose }) => {
  const [marketValue, setMarketValue] = useState<string>(String(defaultMarketValue(item)));
  const [giftDate, setGiftDate] = useState(item.sellDate || new Date().toISOString().split('T')[0]);
  const [recipient, setRecipient] = useState(item.giftRecipient || item.customer?.name || '');
  const [relation, setRelation] = useState<GiftRelation>(item.giftRelation || 'family');
  const [note, setNote] = useState('');

  const marketNum = parseLocaleMoney(marketValue, 0);
  const projectedProfit = useMemo(() => {
    const draft: InventoryItem = {
      ...item,
      status: ItemStatus.GIFTED,
      sellPrice: marketNum,
      buyPrice: Number(item.buyPrice) || 0,
      feeAmount: 0,
      hasFee: false,
    };
    return computeItemProfitBeforeOverhead(draft, taxMode);
  }, [item, marketNum, taxMode]);

  const handleConfirm = () => {
    if (marketNum <= 0) {
      alert('Enter the market value (Verkehrswert) of the gifted item — required for German Privatentnahme bookkeeping.');
      return;
    }
    if (!recipient.trim()) {
      alert('Enter who received the gift (e.g. daughter, friend).');
      return;
    }

    const relationLabel =
      relation === 'family' ? 'Family' : relation === 'friend' ? 'Friend' : 'Other';
    const noteSuffix = note.trim()
      ? `\n\n[Gift / Privatentnahme]: ${note.trim()}`
      : `\n\n[Gift / Privatentnahme]: Given to ${recipient.trim()} (${relationLabel})`;

    const updated: InventoryItem = {
      ...item,
      status: ItemStatus.GIFTED,
      sellPrice: marketNum,
      sellDate: giftDate,
      profit: projectedProfit,
      paymentType: 'Gift',
      giftRecipient: recipient.trim(),
      giftRelation: relation,
      customer: { name: recipient.trim(), address: '' },
      platformSold: undefined,
      hasFee: false,
      feeAmount: undefined,
      comment2: (item.comment2 || '') + noteSuffix,
    };

    onSave(updated);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4 animate-in fade-in">
      <div className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl border border-slate-100 overflow-hidden flex flex-col max-h-[95vh]">
        <header className="p-8 border-b border-slate-100 flex justify-between items-center bg-rose-50/50 shrink-0">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-rose-500 text-white rounded-2xl flex items-center justify-center shadow-lg shadow-rose-200">
              <Gift size={24} />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-900 tracking-tight">Gift / Privatentnahme</h2>
              <p className="text-[10px] text-rose-600 font-bold uppercase tracking-widest mt-1">
                Business withdrawal — no cash received
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-3 hover:bg-white rounded-2xl transition-all text-slate-400">
            <X size={24} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-8 space-y-6">
          <div className="bg-white rounded-2xl p-4 border border-slate-100 flex gap-4 items-center">
            <div className="w-14 h-14 rounded-xl overflow-hidden shrink-0 border border-slate-100">
              <ItemThumbnail item={item} className="w-full h-full object-cover" size={56} />
            </div>
            <div className="min-w-0">
              <h4 className="font-black text-sm text-slate-900 line-clamp-2">{item.name}</h4>
              <p className="text-[10px] text-slate-500 font-bold mt-1">
                Book cost: €{formatEUR(Number(item.buyPrice))}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-amber-100 bg-amber-50/80 p-4 text-[11px] text-amber-950 leading-relaxed space-y-1">
            <p>
              <strong>German tax (EÜR):</strong> gifting business stock is a{' '}
              <strong>Privatentnahme</strong> — booked at <strong>Verkehrswert</strong> (fair market
              value), not at €0. No cash is received, but imputed revenue and profit/loss still apply on
              your dashboard and tax export.
            </p>
            <p className="text-amber-800/90">
              Schenkungsteuer on the recipient is separate (usually irrelevant for PC parts under family
              allowances).
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase text-slate-400 ml-1 flex items-center gap-2">
              <TrendingUp size={12} /> Market value / Verkehrswert (€)
            </label>
            <input
              type="text"
              inputMode="decimal"
              className="w-full px-5 py-3 rounded-2xl border border-slate-200 font-black text-lg outline-none focus:border-rose-300"
              value={marketValue}
              onChange={(e) => setMarketValue(e.target.value)}
              placeholder="e.g. current resale value"
            />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase text-slate-400 ml-1 flex items-center gap-2">
              <Calendar size={12} /> Gift date
            </label>
            <input
              type="date"
              className="w-full px-5 py-3 rounded-2xl border border-slate-200 font-bold text-sm outline-none"
              value={giftDate}
              onChange={(e) => setGiftDate(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase text-slate-400 ml-1 flex items-center gap-2">
              <User size={12} /> Recipient
            </label>
            <input
              type="text"
              className="w-full px-5 py-3 rounded-2xl border border-slate-200 font-bold text-sm outline-none"
              placeholder="e.g. Daughter, Max, …"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Relation</label>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { id: 'family' as const, label: 'Family' },
                  { id: 'friend' as const, label: 'Friend' },
                  { id: 'other' as const, label: 'Other' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setRelation(opt.id)}
                  className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-wide border transition-all ${
                    relation === opt.id
                      ? 'bg-rose-500 text-white border-rose-500'
                      : 'bg-white text-slate-600 border-slate-200 hover:border-rose-200'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase text-slate-400 ml-1 flex items-center gap-2">
              <FileText size={12} /> Note (optional)
            </label>
            <textarea
              className="w-full px-5 py-3 rounded-2xl border border-slate-200 font-medium text-xs outline-none resize-none h-20"
              placeholder="e.g. Birthday gift, no longer needed for resale…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
              <p className="text-[10px] font-black uppercase text-slate-400 mb-1">Imputed revenue</p>
              <p className="text-xl font-black text-slate-900">€{formatEUR(marketNum)}</p>
            </div>
            <div
              className={`rounded-2xl border p-4 ${
                projectedProfit >= 0
                  ? 'border-emerald-100 bg-emerald-50'
                  : 'border-red-100 bg-red-50'
              }`}
            >
              <p className="text-[10px] font-black uppercase text-slate-400 mb-1">Booked P/L</p>
              <div className="flex items-center gap-2">
                {projectedProfit >= 0 ? (
                  <TrendingUp size={18} className="text-emerald-600" />
                ) : (
                  <TrendingDown size={18} className="text-red-600" />
                )}
                <p
                  className={`text-xl font-black ${
                    projectedProfit >= 0 ? 'text-emerald-700' : 'text-red-700'
                  }`}
                >
                  {projectedProfit >= 0 ? '+' : ''}€{formatEUR(projectedProfit)}
                </p>
              </div>
            </div>
          </div>
        </div>

        <footer className="p-8 bg-slate-50/50 border-t border-slate-100 flex gap-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 px-6 py-4 font-bold text-slate-500 hover:bg-white rounded-2xl transition-all"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="flex-1 px-6 py-4 bg-rose-500 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-xl hover:bg-rose-600 transition-all"
          >
            Confirm gift
          </button>
        </footer>
      </div>
    </div>
  );
};

export default GiftModal;
