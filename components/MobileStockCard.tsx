import React from 'react';
import {
  Camera,
  Copy,
  Gift,
  ImageOff,
  Layers,
  Monitor,
  MoreHorizontal,
  ShoppingBag,
  Sparkles,
  Trash2,
  ArrowRightLeft,
  X,
  Edit2,
} from 'lucide-react';
import type { InventoryItem } from '../types';
import { ItemStatus } from '../types';
import { formatEUR } from '../utils/formatMoney';
import { getItemUserPhotoCount } from '../utils/imageImport';
import ItemThumbnail from './ItemThumbnail';
import { MobileSheetShell } from './MobileBottomSheets';

export interface MobileStockCardActions {
  onEdit: (item: InventoryItem) => void;
  onSell: (item: InventoryItem) => void;
  onPhotos: (item: InventoryItem) => void;
  onListingStudio: (item: InventoryItem) => void;
  onTrade?: (item: InventoryItem) => void;
  onGift?: (item: InventoryItem) => void;
  onDuplicate?: (item: InventoryItem) => void;
  onDelete?: (item: InventoryItem) => void;
}

/** Compact Active/Draft stock card — primary PC actions without the wide table. */
export const MobileStockCard: React.FC<{
  item: InventoryItem;
  profit?: number | null;
  selected?: boolean;
  onToggleSelect?: () => void;
  actions: MobileStockCardActions;
}> = ({ item, profit, selected, onToggleSelect, actions }) => {
  const [moreOpen, setMoreOpen] = React.useState(false);
  const photoCount = getItemUserPhotoCount(item);
  const hasPhotos = photoCount > 0;
  const inStock = item.status === ItemStatus.IN_STOCK;

  return (
    <>
      <article
        className={`rounded-2xl border bg-white p-3.5 shadow-sm space-y-3 ${
          item.isPC
            ? 'border-indigo-200 shadow-[inset_3px_0_0_0_#6366f1]'
            : item.isBundle
              ? 'border-violet-200 shadow-[inset_3px_0_0_0_#8b5cf6]'
              : selected
                ? 'border-slate-900 ring-1 ring-slate-900/10'
                : 'border-slate-100'
        }`}
      >
        <div className="flex gap-3 items-start">
          {onToggleSelect && (
            <button
              type="button"
              onClick={onToggleSelect}
              className={`mt-1 h-5 w-5 rounded-md border shrink-0 flex items-center justify-center text-[10px] font-black ${
                selected ? 'bg-slate-900 border-slate-900 text-white' : 'border-slate-300 bg-white text-transparent'
              }`}
              aria-label={selected ? 'Deselect' : 'Select'}
            >
              ✓
            </button>
          )}
          <button
            type="button"
            onClick={() => actions.onPhotos(item)}
            className={`relative shrink-0 rounded-xl ${
              hasPhotos ? 'ring-2 ring-emerald-500/45' : 'ring-1 ring-dashed ring-amber-400/80'
            }`}
            title={hasPhotos ? 'Photos' : 'Add photos'}
          >
            <ItemThumbnail
              item={item}
              className="w-14 h-14 rounded-xl object-cover border border-slate-100 shrink-0"
              size={56}
            />
            <span
              className={`absolute -bottom-0.5 -right-0.5 min-w-[16px] h-4 px-0.5 rounded-full flex items-center justify-center text-[8px] font-black ${
                hasPhotos ? 'bg-emerald-600 text-white' : 'bg-amber-100 text-amber-700 border border-amber-300'
              }`}
            >
              {hasPhotos ? (photoCount > 1 ? photoCount : <Camera size={9} />) : <ImageOff size={9} />}
            </span>
          </button>
          <div className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => actions.onEdit(item)}
              className="text-left w-full"
            >
              <p className="font-black text-[15px] leading-snug text-slate-900 line-clamp-2">{item.name}</p>
            </button>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {(item.isPC || item.isBundle) && (
                <span
                  className={`inline-flex items-center gap-0.5 text-[9px] font-black uppercase px-1.5 py-0.5 rounded text-white ${
                    item.isPC ? 'bg-indigo-600' : 'bg-violet-600'
                  }`}
                >
                  {item.isPC ? <Monitor size={9} /> : <Layers size={9} />}
                  {item.isPC ? 'PC' : 'Bundle'}
                </span>
              )}
              <span className="text-[11px] font-bold text-slate-500">
                Buy €{formatEUR(item.buyPrice)}
                {item.sellPrice != null ? ` · Aim €${formatEUR(item.sellPrice)}` : ''}
              </span>
              {profit != null && (
                <span className={`text-[11px] font-bold ${profit >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {profit >= 0 ? '+' : ''}€{formatEUR(profit)}
                </span>
              )}
            </div>
            {(item.category || item.subCategory) && (
              <p className="text-[10px] text-slate-400 font-medium mt-1 truncate">
                {[item.category, item.subCategory].filter(Boolean).join(' · ')}
              </p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-4 gap-1.5">
          <button
            type="button"
            onClick={() => actions.onEdit(item)}
            className="py-2.5 rounded-xl bg-slate-900 text-white text-[10px] font-black uppercase tracking-wide"
          >
            Edit
          </button>
          <button
            type="button"
            disabled={!inStock}
            onClick={() => actions.onSell(item)}
            className="py-2.5 rounded-xl bg-emerald-600 text-white text-[10px] font-black uppercase tracking-wide disabled:opacity-40 inline-flex items-center justify-center gap-1"
          >
            <ShoppingBag size={12} /> Sell
          </button>
          <button
            type="button"
            onClick={() => actions.onListingStudio(item)}
            className="py-2.5 rounded-xl border border-rose-200 bg-rose-50 text-rose-800 text-[10px] font-black uppercase tracking-wide inline-flex items-center justify-center gap-1"
          >
            <Sparkles size={12} /> AI
          </button>
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            className="py-2.5 rounded-xl border border-slate-200 text-slate-700 text-[10px] font-black uppercase tracking-wide inline-flex items-center justify-center gap-1"
          >
            <MoreHorizontal size={12} /> More
          </button>
        </div>
      </article>

      <MobileSheetShell
        open={moreOpen}
        title={item.name}
        subtitle="Item actions"
        onClose={() => setMoreOpen(false)}
      >
        <div className="space-y-2 pb-2">
          {[
            {
              key: 'edit',
              label: 'Edit / Listing Studio',
              icon: <Edit2 size={16} />,
              run: () => actions.onEdit(item),
            },
            {
              key: 'photos',
              label: 'Add / manage photos',
              icon: <Camera size={16} />,
              run: () => actions.onPhotos(item),
            },
            {
              key: 'studio',
              label: 'Listing Studio (AI)',
              icon: <Sparkles size={16} />,
              run: () => actions.onListingStudio(item),
            },
            inStock && actions.onSell
              ? {
                  key: 'sell',
                  label: 'Mark sold',
                  icon: <ShoppingBag size={16} />,
                  run: () => actions.onSell(item),
                }
              : null,
            inStock && actions.onTrade
              ? {
                  key: 'trade',
                  label: 'Trade',
                  icon: <ArrowRightLeft size={16} />,
                  run: () => actions.onTrade?.(item),
                }
              : null,
            inStock && actions.onGift
              ? {
                  key: 'gift',
                  label: 'Gift / Privatentnahme',
                  icon: <Gift size={16} />,
                  run: () => actions.onGift?.(item),
                }
              : null,
            actions.onDuplicate
              ? {
                  key: 'dup',
                  label: 'Duplicate',
                  icon: <Copy size={16} />,
                  run: () => actions.onDuplicate?.(item),
                }
              : null,
            actions.onDelete
              ? {
                  key: 'del',
                  label: 'Delete',
                  icon: <Trash2 size={16} />,
                  run: () => actions.onDelete?.(item),
                  danger: true,
                }
              : null,
          ]
            .filter(Boolean)
            .map((row) => {
              const r = row as {
                key: string;
                label: string;
                icon: React.ReactNode;
                run: () => void;
                danger?: boolean;
              };
              return (
                <button
                  key={r.key}
                  type="button"
                  onClick={() => {
                    setMoreOpen(false);
                    r.run();
                  }}
                  className={`flex items-center gap-3 w-full rounded-2xl border px-3.5 py-3 text-left ${
                    r.danger
                      ? 'border-rose-100 bg-rose-50 text-rose-800'
                      : 'border-slate-100 bg-white text-slate-900'
                  }`}
                >
                  <span
                    className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${
                      r.danger ? 'bg-rose-100' : 'bg-slate-100'
                    }`}
                  >
                    {r.icon}
                  </span>
                  <span className="text-sm font-bold">{r.label}</span>
                </button>
              );
            })}
          <button
            type="button"
            onClick={() => setMoreOpen(false)}
            className="flex items-center justify-center gap-2 w-full py-3 text-[11px] font-black uppercase text-slate-400"
          >
            <X size={14} /> Close
          </button>
        </div>
      </MobileSheetShell>
    </>
  );
};

export default MobileStockCard;
