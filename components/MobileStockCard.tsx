import React from 'react';
import {
  Camera,
  Copy,
  Gift,
  ImageOff,
  MoreHorizontal,
  Plus,
  ShoppingBag,
  Trash2,
  ArrowRightLeft,
  X,
  Edit2,
  Layers,
  Scissors,
  Loader2,
  PackageCheck,
  Sparkles,
  EyeOff,
  Undo2,
  Bookmark,
  Unlink,
  User,
  RotateCcw,
  AlertCircle,
  AlertTriangle,
} from 'lucide-react';
import type { InventoryItem, TaxMode } from '../types';
import { ItemStatus } from '../types';
import { formatEUR } from '../utils/formatMoney';
import { BuyPriceBumpBadge } from './BuyPriceHistory';
import { canEditManualSellerShipping, shouldShowSellCellMarketplaceFees } from '../utils/saleProceeds';
import { resolveSellColumnSplit } from '../utils/sellColumnDisplay';
import { buildInventoryLookup, getChildren, POCKET_PROFIT_TAX_MODE } from '../services/financialAggregation';
import { SellerShippingEditorDialog } from './SaleProceedsPopover';
import { SellSplitLedger } from './SellSplitLedger';
import { getItemPresenceCycleState, getItemUserPhotoCount } from '../utils/imageImport';
import { computePriceAnalyzer } from '../utils/listingWatch';
import ItemThumbnail from './ItemThumbnail';
import { MobileSheetShell } from './MobileBottomSheets';
import ItemAccessoryToggles from './ItemAccessoryToggles';
import { resolveComponentPartTone, componentPartPillProps } from '../utils/componentPartTone';
import { canSplitItem, resolveIdenticalLotQty } from '../utils/splitParts';
import { buildEbayItemUrl } from '../utils/sourceLinks';
import { getFaultyRowMeta } from '../utils/inventoryFaulty';

export interface MobileStockCardActions {
  onEdit: (item: InventoryItem) => void;
  onSell: (item: InventoryItem) => void;
  onPhotos: (item: InventoryItem) => void;
  /** Open Add photos and auto-match My eBay listing images. */
  onEbayPhotos?: (item: InventoryItem) => void;
  /** Quick Bundle / add parts — same as desktop Flags “+”. */
  onQuickBundle?: (item: InventoryItem) => void;
  /** Split a single item into sellable parts (AIO → fans, radiator…). */
  onSplitParts?: (item: InventoryItem) => void;
  onTrade?: (item: InventoryItem) => void;
  onGift?: (item: InventoryItem) => void;
  onDuplicate?: (item: InventoryItem) => void;
  onDelete?: (item: InventoryItem) => void;
  onPatchAccessory?: (item: InventoryItem, patch: Partial<InventoryItem>) => void;
  /** Present → lost → defective → unknown — same cycle as the desktop Flags dot. */
  onTogglePresence?: (item: InventoryItem) => void;
  /** PC/bundle only — breaks the container back into its standalone parts. */
  onUnbundle?: (item: InventoryItem) => void;
  /** Sold only — edit buyer name/address/eBay order link. */
  onEditBuyer?: (item: InventoryItem) => void;
  /** Sold/gifted only — revert back to active stock. */
  onMarkUnsold?: (item: InventoryItem) => void;
}

export interface MobilePurchaseActions {
  onParseSpecs: () => void;
  onConfirmReceived: () => void;
  onIgnore?: () => void;
  onUndoIgnore?: () => void;
  parsing?: boolean;
  confirming?: boolean;
  hasParsedSpecs?: boolean;
  /** Already linked to Active — show Open instead of Confirm. */
  received?: boolean;
  ignored?: boolean;
  onOpenActive?: () => void;
}

/** Dense phone stock row — fits several items on screen without a tall action strip. */
export const MobileStockCard: React.FC<{
  item: InventoryItem;
  /** Suggested list prices — Klein lower (0% fees), eBay higher (fee-aware). */
  suggestedEbayList?: number | null;
  suggestedKleinList?: number | null;
  suggestedFeePct?: number | null;
  /** When on, compact row also lists ads / eBay / shipping under the sell price. */
  showPriceBreakdown?: boolean;
  /** Hub refund not yet stamped on the sold row. */
  refundFallbackEur?: number;
  /** Needed for bundle sell totals + Hub-linked sell split. */
  allItems?: InventoryItem[];
  taxMode?: TaxMode;
  /** Non-eBay sold rows — tap sell price to type shipping you paid. */
  onSaveShipping?: (amount: number) => void;
  selected?: boolean;
  onToggleSelect?: () => void;
  actions: MobileStockCardActions;
  /** When set, row acts like inventory but Parse/Confirm replace Sell/More. */
  purchaseActions?: MobilePurchaseActions;
}> = ({
  item,
  suggestedEbayList,
  suggestedKleinList,
  suggestedFeePct,
  showPriceBreakdown = false,
  refundFallbackEur = 0,
  allItems = [],
  taxMode = POCKET_PROFIT_TAX_MODE,
  onSaveShipping,
  selected,
  onToggleSelect,
  actions,
  purchaseActions,
}) => {
  const [moreOpen, setMoreOpen] = React.useState(false);
  const [shippingOpen, setShippingOpen] = React.useState(false);
  const photoCount = getItemUserPhotoCount(item);
  const hasPhotos = photoCount > 0;
  const inStock = item.status === ItemStatus.IN_STOCK;
  const soldLike =
    item.status === ItemStatus.SOLD ||
    item.status === ItemStatus.TRADED ||
    item.status === ItemStatus.GIFTED;
  // Sold/traded/gifted PC/bundle containers can still take more parts (the new part is
  // stamped Sold to match) — only individual sold/disposed non-container items stay locked.
  const isSoldContainer = (item.isPC || item.isBundle) && soldLike;
  const canQuickBundle = Boolean(actions.onQuickBundle) && (!soldLike || isSoldContainer);
  /** Containers use Unbundle; Split is for single stock SKUs — or a single sold/traded/
   *  gifted item whose one sale actually covers several separately-shippable parts. */
  const canSplit =
    Boolean(actions.onSplitParts) &&
    (inStock || (soldLike && !item.isPC && !item.isBundle)) &&
    canSplitItem(item, item.isPC || item.isBundle ? 1 : 0);
  const lotQty = canSplit ? resolveIdenticalLotQty(item) : null;
  const partTone = !item.isPC && !item.isBundle ? resolveComponentPartTone(item) : null;
  const partPill = !item.isPC && !item.isBundle ? componentPartPillProps(item) : null;

  const quickBundleLabel = item.isPC
    ? 'Add parts to this PC'
    : item.isBundle
      ? 'Add parts to this bundle'
      : 'Make Bundle / Mixed Bundle';

  const lookupItems = allItems.length ? allItems : [item];
  const faultyMeta = getFaultyRowMeta(item, lookupItems, buildInventoryLookup(lookupItems));

  return (
    <>
      <article
        className={`rounded-2xl border bg-slate-900/90 px-3 py-2.5 shadow-lg shadow-black/30 transition-all ${
          faultyMeta.selfFaulty
            ? 'border-red-500/60 shadow-[inset_4px_0_0_0_#ef4444]'
            : faultyMeta.faultyChildCount > 0
              ? 'border-red-500/40 shadow-[inset_4px_0_0_0_rgba(239,68,68,0.55)]'
              : item.isPC
            ? 'border-indigo-500/50 shadow-[inset_4px_0_0_0_#6366f1]'
            : item.isBundle
              ? 'border-violet-500/50 shadow-[inset_4px_0_0_0_#8b5cf6]'
              : selected
                ? 'border-emerald-500 ring-1 ring-emerald-500/30'
                : 'border-slate-800/90 hover:border-slate-700'
        }`}
      >
        <div className="flex gap-2.5 items-center">
          {onToggleSelect && (
            <button
              type="button"
              onClick={onToggleSelect}
              className="h-10 w-8 shrink-0 flex items-center justify-center -ml-1"
              aria-label={selected ? 'Deselect' : 'Select'}
            >
              <span
                className={`h-5 w-5 rounded-lg border flex items-center justify-center text-[10px] font-black transition-all ${
                  selected
                    ? 'bg-emerald-500 border-emerald-500 text-slate-950'
                    : 'border-slate-700 bg-slate-950 text-transparent'
                }`}
              >
                ✓
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={() => actions.onPhotos(item)}
            className={`relative shrink-0 rounded-xl overflow-hidden ${
              hasPhotos ? 'ring-1 ring-emerald-500/50' : 'ring-1 ring-dashed ring-amber-400/50'
            }`}
            title={hasPhotos ? 'Photos' : 'Add photos'}
          >
            <ItemThumbnail
              item={item}
              className="w-13 h-13 rounded-xl object-cover bg-slate-950 border border-slate-800 shrink-0"
              size={52}
            />
            {!hasPhotos && (
              <span className="absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center justify-center">
                <ImageOff size={9} />
              </span>
            )}
          </button>

          <div className="min-w-0 flex-1 py-0.5">
            <div
              role="button"
              tabIndex={0}
              onClick={() => actions.onEdit(item)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  actions.onEdit(item);
                }
              }}
              className="w-full text-left cursor-pointer"
            >
              <div className="flex items-center gap-1.5 mb-1">
                <span
                  className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider ${
                    inStock
                      ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                      : item.status === ItemStatus.SOLD
                        ? 'bg-sky-500/15 text-sky-400 border border-sky-500/30'
                        : 'bg-purple-500/15 text-purple-400 border border-purple-500/30'
                  }`}
                >
                  {item.status}
                </span>

                {(item.isPC || item.isBundle) && (
                  <span className={`text-[10px] font-bold ${item.isPC ? 'text-indigo-400' : 'text-violet-400'}`}>
                    {item.isPC ? 'PC Build' : 'Bundle'}
                  </span>
                )}

                {item.ebayOrderId && (
                  <span className="text-[9px] font-black text-amber-400 bg-amber-500/10 px-1 py-0.2 rounded border border-amber-500/20">
                    ⚡ eBay
                  </span>
                )}

                {faultyMeta.selfFaulty && (
                  <span
                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-black uppercase bg-red-500/15 text-red-400 border border-red-500/35"
                    title="Marked as defective / for parts"
                  >
                    <AlertTriangle size={9} strokeWidth={2.5} />
                    DEFEKT
                  </span>
                )}
                {!faultyMeta.selfFaulty && faultyMeta.faultyChildCount > 0 && (
                  <span
                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-black uppercase bg-red-500/10 text-red-400/90 border border-red-500/25"
                    title={`${faultyMeta.faultyChildCount} defective part(s) in this container`}
                  >
                    <AlertTriangle size={9} strokeWidth={2.5} />
                    {faultyMeta.faultyChildCount} defekt
                  </span>
                )}
              </div>

              <p className="font-black text-[13px] leading-tight text-white line-clamp-1">
                {item.name}
              </p>

              {/* Price & Profit Row */}
              <div className="mt-1 flex items-center gap-2 flex-wrap">
                <span className="text-[11px] font-bold text-slate-400 tabular-nums">
                  EK <span className="text-slate-200">€{formatEUR(item.buyPrice)}</span>
                </span>

                {item.sellPrice != null && Number(item.sellPrice) > 0 && (
                  <span className="text-[11px] font-bold text-slate-400 tabular-nums">
                    VK <span className="text-white font-black">€{formatEUR(item.sellPrice)}</span>
                  </span>
                )}

                {inStock && item.sellPrice != null && Number(item.sellPrice) > Number(item.buyPrice) && (
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-black bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 tabular-nums">
                    +€{formatEUR(Number(item.sellPrice) - Number(item.buyPrice))}
                  </span>
                )}
              </div>
              {(() => {
                const split =
                  item.sellPrice != null
                    ? resolveSellColumnSplit(item, allItems.length ? allItems : [item], taxMode, {
                        refundFallbackEur,
                      })
                    : null;
                if (!split) return null;
                return (
                  <div className="mt-1 flex flex-wrap items-start gap-3">
                    {onSaveShipping && canEditManualSellerShipping(item) ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setShippingOpen(true);
                        }}
                        className="text-left"
                      >
                        <SellSplitLedger
                          split={split}
                          showFees={shouldShowSellCellMarketplaceFees(item, showPriceBreakdown)}
                        />
                      </button>
                    ) : (
                      <SellSplitLedger
                        split={split}
                        showFees={shouldShowSellCellMarketplaceFees(item, showPriceBreakdown)}
                      />
                    )}
                  </div>
                );
              })()}
              {item.specs && Object.keys(item.specs).length > 0 && (
                <p
                  className="mt-0.5 text-[10px] text-slate-500 font-medium leading-snug truncate"
                  title={Object.entries(item.specs)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(' • ')}
                >
                  {Object.entries(item.specs)
                    .slice(0, 4)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(' · ')}
                </p>
              )}
              {(() => {
                const hasSugg =
                  suggestedKleinList != null &&
                  suggestedKleinList > 0 &&
                  suggestedEbayList != null &&
                  suggestedEbayList > 0;
                const analyzer = computePriceAnalyzer(
                  item,
                  hasSugg
                    ? {
                        ebayList: suggestedEbayList!,
                        kleinList: suggestedKleinList!,
                        pocketTarget: suggestedKleinList!,
                        feePct: suggestedFeePct || 0,
                        compCount: 0,
                        fromSnapshot: false,
                      }
                    : null
                );
                if (!analyzer) return null;
                const cls = (channel: 'KA' | 'EB', action: string) => {
                  if (action === 'drop') return 'bg-amber-50 text-amber-950 border-amber-300';
                  if (action === 'raise') return 'bg-sky-50 text-sky-950 border-sky-300';
                  // Option 3: KA green, eBay orange
                  if (channel === 'KA') return 'bg-emerald-100 text-emerald-950 border-emerald-400';
                  return 'bg-orange-100 text-orange-800 border-orange-300';
                };
                return (
                  <div
                    className="mt-1 flex items-center gap-1.5 flex-wrap leading-tight"
                    onClick={(e) => e.stopPropagation()}
                    title={analyzer.ageLabel}
                  >
                    <span className="text-[11px] font-bold text-slate-500 tabular-nums">
                      d{analyzer.daysHeld} · {analyzer.targetMarginPct}%
                    </span>
                    {analyzer.minKlein > 0 && analyzer.minEbay > 0 && (
                      <span className="inline-flex px-1.5 py-0.5 rounded border border-rose-200 bg-rose-50 text-[11px] font-black uppercase text-rose-900 tabular-nums">
                        min €{Math.round(analyzer.minKlein)}/€{Math.round(analyzer.minEbay)}
                      </span>
                    )}
                    {analyzer.channels.map((ch) => {
                      const label =
                        ch.action === 'drop'
                          ? `↓${ch.channel} €${Math.round(ch.live || 0)}→€${Math.round(ch.suggest)}`
                          : ch.action === 'raise'
                            ? `↑${ch.channel} €${Math.round(ch.live || 0)}→€${Math.round(ch.suggest)}`
                            : ch.action === 'ok'
                              ? `OK ${ch.channel} €${Math.round(ch.live || ch.suggest)}`
                              : `${ch.channel} €${Math.round(ch.suggest)}`;
                      return (
                        <span
                          key={ch.channel}
                          className={`inline-flex px-1.5 py-0.5 rounded border text-[11px] font-black uppercase tabular-nums ${cls(ch.channel, ch.action)}`}
                        >
                          {label}
                        </span>
                      );
                    })}
                  </div>
                );
              })()}
            </div>
            {(actions.onPatchAccessory || actions.onTogglePresence) && !purchaseActions && (
              <div className="mt-1 flex items-center gap-1.5 flex-wrap" onClick={(e) => e.stopPropagation()}>
                {actions.onTogglePresence && (() => {
                  const cycleState = getItemPresenceCycleState(item);
                  return (
                    <button
                      type="button"
                      title={
                        cycleState === 'present'
                          ? 'Present (tap → lost)'
                          : cycleState === 'lost'
                            ? 'Lost (tap → defective)'
                            : cycleState === 'defective'
                              ? 'Defective (tap → clear)'
                              : 'Presence not set — tap to mark'
                      }
                      onClick={() => actions.onTogglePresence?.(item)}
                      className={`inline-flex items-center gap-0.5 px-2 py-1.5 rounded text-[10px] font-black uppercase border ${
                        cycleState === 'present'
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-300'
                          : cycleState === 'lost'
                            ? 'bg-red-50 text-red-800 border-red-300'
                            : cycleState === 'defective'
                              ? 'bg-amber-50 text-amber-900 border-amber-300'
                              : 'bg-slate-50 text-slate-400 border-slate-200'
                      }`}
                    >
                      {cycleState === 'defective' ? (
                        <AlertCircle size={10} />
                      ) : (
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            cycleState === 'present'
                              ? 'bg-emerald-500'
                              : cycleState === 'lost'
                                ? 'bg-red-500'
                                : 'bg-slate-300'
                          }`}
                        />
                      )}
                      {cycleState === 'unknown' ? '?' : cycleState}
                    </button>
                  );
                })()}
                {actions.onPatchAccessory && (
                <ItemAccessoryToggles
                  item={item}
                  mini
                  onPatch={(patch) => actions.onPatchAccessory?.(item, patch)}
                />
                )}
                {actions.onPatchAccessory && (
                <button
                  type="button"
                  title={item.photosReady ? 'Photos ready' : 'Mark photos ready'}
                  onClick={() => actions.onPatchAccessory?.(item, { photosReady: !item.photosReady })}
                  className={`inline-flex items-center gap-0.5 px-2 py-1.5 rounded text-[10px] font-black uppercase border ${
                    item.photosReady
                      ? 'bg-violet-50 text-violet-800 border-violet-200'
                      : 'bg-slate-50 text-slate-400 border-slate-200'
                  }`}
                >
                  <Camera size={10} /> Photo
                </button>
                )}
                {actions.onPatchAccessory && (
                <button
                  type="button"
                  title={item.reserved ? 'Reserved' : 'Hold'}
                  onClick={() => actions.onPatchAccessory?.(item, { reserved: !item.reserved })}
                  className={`inline-flex items-center gap-0.5 px-2 py-1.5 rounded text-[10px] font-black uppercase border ${
                    item.reserved
                      ? 'bg-amber-50 text-amber-900 border-amber-300'
                      : 'bg-slate-50 text-slate-400 border-slate-200'
                  }`}
                >
                  <Bookmark size={10} /> Hold
                </button>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {purchaseActions ? (
              purchaseActions.ignored ? (
                <button
                  type="button"
                  onClick={() => purchaseActions.onUndoIgnore?.()}
                  className="h-9 px-2.5 rounded-lg border border-slate-200 bg-white text-slate-700 text-[10px] font-black uppercase inline-flex items-center gap-1"
                >
                  <Undo2 size={12} /> Undo
                </button>
              ) : purchaseActions.received ? (
                <button
                  type="button"
                  onClick={() => purchaseActions.onOpenActive?.()}
                  className="h-9 px-2.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-[10px] font-black uppercase inline-flex items-center"
                >
                  Open
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => purchaseActions.onParseSpecs()}
                    disabled={purchaseActions.parsing || purchaseActions.confirming}
                    className="h-9 px-2 rounded-lg bg-violet-600 text-white text-[10px] font-black uppercase inline-flex items-center gap-1 disabled:opacity-50"
                    title={purchaseActions.hasParsedSpecs ? 'Re-parse specs' : 'Parse specs'}
                  >
                    {purchaseActions.parsing ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Sparkles size={12} />
                    )}
                    {purchaseActions.parsing ? '…' : 'Specs'}
                  </button>
                  <button
                    type="button"
                    onClick={() => purchaseActions.onConfirmReceived()}
                    disabled={purchaseActions.parsing || purchaseActions.confirming}
                    className="h-9 px-2 rounded-lg bg-emerald-600 text-white text-[10px] font-black uppercase inline-flex items-center gap-1 disabled:opacity-50"
                    title="Confirm received → Active"
                  >
                    {purchaseActions.confirming ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <PackageCheck size={12} />
                    )}
                    {purchaseActions.confirming ? '…' : 'Confirm'}
                  </button>
                  <button
                    type="button"
                    onClick={() => purchaseActions.onIgnore?.()}
                    disabled={purchaseActions.parsing || purchaseActions.confirming}
                    className="h-11 w-11 rounded-lg border border-slate-200 text-slate-500 inline-flex items-center justify-center disabled:opacity-50"
                    title="Ignore — not for this business"
                    aria-label="Ignore purchase"
                  >
                    <EyeOff size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => actions.onEdit(item)}
                    className="h-11 w-11 rounded-lg bg-slate-900 text-white inline-flex items-center justify-center"
                    title="Edit draft"
                    aria-label="Edit draft"
                  >
                    <Edit2 size={16} />
                  </button>
                </>
              )
            ) : (
              <>
            {canQuickBundle ? (
              <button
                type="button"
                onClick={() => actions.onQuickBundle?.(item)}
                className="h-11 w-11 rounded-lg border border-violet-200 bg-violet-50 text-violet-700 inline-flex items-center justify-center"
                title={quickBundleLabel}
                aria-label={quickBundleLabel}
              >
                <Plus size={18} strokeWidth={2.5} />
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => actions.onEdit(item)}
              className="h-10 w-10 rounded-xl bg-slate-800 border border-slate-700 text-slate-200 inline-flex items-center justify-center active:scale-95 shadow-sm"
              title="Edit"
              aria-label="Edit"
            >
              <Edit2 size={15} />
            </button>
            <button
              type="button"
              disabled={!inStock}
              onClick={() => actions.onSell(item)}
              className="h-10 w-10 rounded-xl bg-emerald-500 text-slate-950 font-black inline-flex items-center justify-center disabled:opacity-30 disabled:bg-slate-800 disabled:text-slate-500 active:scale-95 shadow-md shadow-emerald-500/20"
              title="Sell"
              aria-label="Sell"
            >
              <ShoppingBag size={16} />
            </button>
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              className="h-10 w-10 rounded-xl bg-slate-800/80 border border-slate-700/80 text-slate-300 inline-flex items-center justify-center active:scale-95 shadow-sm"
              title="More"
              aria-label="More actions"
            >
              <MoreHorizontal size={17} />
            </button>
              </>
            )}
          </div>
        </div>
      </article>

      {!purchaseActions && (
      <MobileSheetShell
        open={moreOpen}
        title={item.name}
        subtitle="Item actions"
        onClose={() => setMoreOpen(false)}
      >
        <div className="space-y-2 pb-2">
          {[
            canQuickBundle
              ? {
                  key: 'bundle',
                  label: quickBundleLabel,
                  icon: item.isPC || item.isBundle ? <Plus size={16} /> : <Layers size={16} />,
                  run: () => actions.onQuickBundle?.(item),
                }
              : null,
            canSplit
              ? {
                  key: 'split',
                  label: lotQty != null ? `Split lot ×${lotQty}` : 'Split into parts',
                  icon: <Scissors size={16} />,
                  run: () => actions.onSplitParts?.(item),
                }
              : null,
            (item.isPC || item.isBundle) && actions.onUnbundle
              ? {
                  key: 'unbundle',
                  label: 'Unbundle / Dismantle',
                  icon: <Unlink size={16} />,
                  run: () => actions.onUnbundle?.(item),
                }
              : null,
            {
              key: 'edit',
              label: 'Edit item',
              icon: <Edit2 size={16} />,
              run: () => actions.onEdit(item),
            },
            {
              key: 'photos',
              label: 'Add / manage photos',
              icon: <Camera size={16} />,
              run: () => actions.onPhotos(item),
            },
            actions.onEbayPhotos
              ? {
                  key: 'ebay_photos',
                  label: 'Parse eBay photos',
                  icon: <ShoppingBag size={16} />,
                  run: () => actions.onEbayPhotos?.(item),
                }
              : null,
            item.listedOnEbay && item.ebayListingId
              ? {
                  key: 'view_ebay_listing',
                  label: 'View eBay listing',
                  icon: <ShoppingBag size={16} />,
                  run: () => window.open(buildEbayItemUrl(item.ebayListingId), '_blank', 'noopener,noreferrer'),
                }
              : null,
            inStock && actions.onSell
              ? {
                  key: 'sell',
                  label: 'Mark sold',
                  icon: <ShoppingBag size={16} />,
                  run: () => actions.onSell(item),
                }
              : null,
            item.status === ItemStatus.SOLD && actions.onEditBuyer
              ? {
                  key: 'buyer',
                  label: 'Buyer & eBay order',
                  icon: <User size={16} />,
                  run: () => actions.onEditBuyer?.(item),
                }
              : null,
            (item.status === ItemStatus.SOLD || item.status === ItemStatus.GIFTED) && actions.onMarkUnsold
              ? {
                  key: 'unsold',
                  label: item.status === ItemStatus.GIFTED ? 'Undo gift' : 'Mark Unsold / Return',
                  icon: <RotateCcw size={16} />,
                  run: () => actions.onMarkUnsold?.(item),
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
                      : r.key === 'bundle'
                        ? 'border-violet-100 bg-violet-50 text-violet-900'
                        : 'border-slate-100 bg-white text-slate-900'
                  }`}
                >
                  <span
                    className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${
                      r.danger
                        ? 'bg-rose-100'
                        : r.key === 'bundle'
                          ? 'bg-violet-100 text-violet-700'
                          : 'bg-slate-100'
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
      )}
      {shippingOpen && onSaveShipping ? (
        <SellerShippingEditorDialog
          item={item}
          onSave={(amount) => {
            onSaveShipping(amount);
            setShippingOpen(false);
          }}
          onClose={() => setShippingOpen(false)}
        />
      ) : null}
    </>
  );
};

export default MobileStockCard;
