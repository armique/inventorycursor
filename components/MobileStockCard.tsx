import React from 'react';
import {
  Camera,
  Copy,
  Gift,
  ImageOff,
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

/** Dense phone stock row — fits several items on screen without a tall action strip. */
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
        className={`rounded-xl border bg-white px-2.5 py-2 ${
          item.isPC
            ? 'border-indigo-200 shadow-[inset_3px_0_0_0_#6366f1]'
            : item.isBundle
              ? 'border-violet-200 shadow-[inset_3px_0_0_0_#8b5cf6]'
              : selected
                ? 'border-slate-900 ring-1 ring-slate-900/10'
                : 'border-slate-100'
        }`}
      >
        <div className="flex gap-2 items-center">
          {onToggleSelect && (
            <button
              type="button"
              onClick={onToggleSelect}
              className={`h-5 w-5 rounded border shrink-0 flex items-center justify-center text-[10px] font-black ${
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
            className={`relative shrink-0 rounded-lg ${
              hasPhotos ? 'ring-1 ring-emerald-500/50' : 'ring-1 ring-dashed ring-amber-400/70'
            }`}
            title={hasPhotos ? 'Photos' : 'Add photos'}
          >
            <ItemThumbnail
              item={item}
              className="w-11 h-11 rounded-lg object-cover border border-slate-100 shrink-0"
              size={44}
            />
            {!hasPhotos && (
              <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-amber-100 text-amber-700 border border-amber-300 flex items-center justify-center">
                <ImageOff size={8} />
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => actions.onEdit(item)}
            className="min-w-0 flex-1 text-left py-0.5"
          >
            <p className="font-bold text-[13px] leading-tight text-slate-900 line-clamp-1">{item.name}</p>
            <p className="mt-0.5 text-[11px] font-semibold text-slate-500 truncate">
              {(item.isPC || item.isBundle) && (
                <span className={item.isPC ? 'text-indigo-600' : 'text-violet-600'}>
                  {item.isPC ? 'PC · ' : 'Bundle · '}
                </span>
              )}
              €{formatEUR(item.buyPrice)}
              {item.sellPrice != null ? ` · aim €${formatEUR(item.sellPrice)}` : ''}
              {profit != null ? (
                <span className={profit >= 0 ? ' text-emerald-600' : ' text-rose-600'}>
                  {' '}
                  ({profit >= 0 ? '+' : ''}€{formatEUR(profit)})
                </span>
              ) : null}
              {item.subCategory || item.category
                ? ` · ${item.subCategory || item.category}`
                : ''}
            </p>
          </button>

          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              onClick={() => actions.onEdit(item)}
              className="h-9 w-9 rounded-lg bg-slate-900 text-white inline-flex items-center justify-center"
              title="Edit"
              aria-label="Edit"
            >
              <Edit2 size={14} />
            </button>
            <button
              type="button"
              disabled={!inStock}
              onClick={() => actions.onSell(item)}
              className="h-9 w-9 rounded-lg bg-emerald-600 text-white inline-flex items-center justify-center disabled:opacity-35"
              title="Sell"
              aria-label="Sell"
            >
              <ShoppingBag size={14} />
            </button>
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              className="h-9 w-9 rounded-lg border border-slate-200 text-slate-600 inline-flex items-center justify-center"
              title="More"
              aria-label="More actions"
            >
              <MoreHorizontal size={16} />
            </button>
          </div>
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
