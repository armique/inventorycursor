import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRightLeft,
  Calculator,
  Camera,
  Check,
  CheckCircle2,
  ExternalLink,
  FileText,
  Gift,
  Images,
  Layers,
  Link2,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Receipt,
  RotateCcw,
  RotateCw,
  Scissors,
  ShoppingBag,
  Trash2,
  Unlink,
  User,
  X,
  type LucideIcon,
} from 'lucide-react';
import type { InventoryItem } from '../types';
import { ItemStatus } from '../types';
import { getChildren, type InventoryLookup } from '../services/financialAggregation';
import { isRealizedDisposal, isSoldOrTradedOnly } from '../utils/itemDisposition';
import { getContainerKind } from '../utils/containerMembership';
import { getEbayPublishReadiness } from '../utils/ebayListingReadiness';
import { getItemPresenceCycleState, getItemUserPhotoCount } from '../utils/imageImport';
import { photoQcSummary } from '../utils/photoQc';
import { buildEbayItemUrl, buildEbayOrderUrl, resolveItemSourceLinks } from '../utils/sourceLinks';
import { canSplitItem, resolveIdenticalLotQty } from '../utils/splitParts';
import { hasEbaySaleSignals, resolveSalePlatform } from '../utils/salePlatform';
import ItemAccessoryToggles from './ItemAccessoryToggles';
import type { ProductCardBgJob } from '../services/productCardBackgroundQueue';

function shouldShowEbayOrderLinkInFlags(item: InventoryItem): boolean {
  if (item.status !== ItemStatus.SOLD && item.status !== ItemStatus.TRADED) return false;
  if (item.platformSold === 'kleinanzeigen.de') return false;
  if (item.paymentType?.startsWith('Kleinanzeigen')) return false;
  if ((item.ebayOrderId || '').trim()) return true;
  if (item.status !== ItemStatus.SOLD) return false;
  const platform = resolveSalePlatform(item);
  if (platform === 'kleinanzeigen.de') return false;
  return platform === 'ebay.de' || hasEbaySaleSignals(item);
}

function SoldEbayOrderLinkButton({
  item,
  onMatchOrder,
  iconClassName,
}: {
  item: InventoryItem;
  onMatchOrder: (item: InventoryItem) => void;
  iconClassName: string;
}) {
  if (!shouldShowEbayOrderLinkInFlags(item)) return null;
  const orderId = (item.ebayOrderId || '').trim();
  const url = orderId ? buildEbayOrderUrl(orderId) : undefined;
  if (orderId && url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        className={`${iconClassName} shrink-0 flex items-center justify-center rounded-lg border border-sky-200 bg-sky-50/80 text-sky-700 hover:bg-sky-100 transition-colors`}
        title={`Open eBay order ${orderId} ↗`}
        aria-label={`Open eBay order ${orderId}`}
      >
        <ExternalLink size={13} strokeWidth={2.25} />
      </a>
    );
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onMatchOrder(item);
      }}
      className={`${iconClassName} shrink-0 flex items-center justify-center rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors`}
      title="Match this sale to a cached eBay order (API backfill or CSV import)"
      aria-label="Match eBay order"
    >
      <Receipt size={13} strokeWidth={2.25} />
    </button>
  );
}

export type InventoryFlagsCellActions = {
  onMarkSold: (item: InventoryItem) => void;
  onDelete: (item: InventoryItem) => void;
  onTogglePresence: (item: InventoryItem) => void;
  onPatchAccessory: (item: InventoryItem, patch: Partial<InventoryItem>) => void;
  onOpenAddPhotos: (itemId: string) => void;
  onOpenEbayPhotos: (itemId: string) => void;
  onRequestAiCardsConfirm: (item: InventoryItem) => void;
  onQueueAiCards: (item: InventoryItem) => void;
  onCancelAiCardsConfirm: () => void;
  onOpenQuickBundle: (item: InventoryItem) => void;
  onOpenBulkImport: (bulkId: string) => void;
  onRebuildTitle: (item: InventoryItem) => void;
  onUnbundle: (item: InventoryItem) => void;
  onSplitParts: (item: InventoryItem) => void;
  onRecalcSoldContainer: (item: InventoryItem) => void;
  onResplitBuyPrices: (item: InventoryItem) => void;
  onTrade: (item: InventoryItem) => void;
  onGift: (item: InventoryItem) => void;
  onInvoice: (item: InventoryItem) => void;
  onEditBuyer: (item: InventoryItem) => void;
  onReturnOrUndoGift: (item: InventoryItem) => void;
  onMatchEbayOrder: (item: InventoryItem) => void;
  onEditForEbayPublish: (item: InventoryItem) => void;
  resolveBulkImportId: (item: InventoryItem) => string | null;
};

export type InventoryFlagsCellProps = {
  item: InventoryItem;
  dense?: boolean;
  items: InventoryItem[];
  inventoryLookup: InventoryLookup;
  bulkImportFilterId: string | null;
  activeBgCardItemIds: Set<string>;
  bgCardJobs: ProductCardBgJob[];
  itemAiCardCounts: Record<string, number>;
  aiCardRegenConfirmId: string | null;
  actions: InventoryFlagsCellActions;
};

function renderFlagGhost(Icon: LucideIcon, iconBtn: string) {
  return (
    <span
      data-flag-ghost
      className={`${iconBtn} shrink-0 inline-flex items-center justify-center rounded-lg border border-slate-200/80 bg-transparent text-slate-300 pointer-events-none select-none`}
      aria-hidden="true"
    >
      <Icon size={13} strokeWidth={2.25} className="opacity-45" />
    </span>
  );
}

function overflowHasHighlight(
  item: InventoryItem,
  items: InventoryItem[],
  inventoryLookup: InventoryLookup,
  itemAiCardCounts: Record<string, number>,
  activeBgCardItemIds: Set<string>,
  resolveBulkImportId: (item: InventoryItem) => string | null,
): boolean {
  if (!item.parentContainerId && (item.status === ItemStatus.IN_STOCK || item.status === ItemStatus.ORDERED)) {
    if (item.listedOnEbay && item.ebayListingId) return true;
    if (getEbayPublishReadiness(item).ok) return true;
  }
  if (getItemUserPhotoCount(item) > 0) return true;
  if ((itemAiCardCounts[item.id] || 0) > 0) return true;
  if (activeBgCardItemIds.has(item.id)) return true;
  if (resolveBulkImportId(item)) return true;
  if (getContainerKind(item)) return true;
  if (item.isPC || item.isBundle) return true;
  const childCount = item.isPC || item.isBundle ? getChildren(item, items, inventoryLookup).length : 0;
  if (canSplitItem(item, childCount)) return true;
  if (isSoldOrTradedOnly(item)) return true;
  if (shouldShowEbayOrderLinkInFlags(item)) return true;
  const links = resolveItemSourceLinks(item);
  if (links.chat || links.order || links.profile) return true;
  const qc = photoQcSummary(item);
  if (!qc.ok) return true;
  return false;
}

const InventoryFlagsCell = React.memo(function InventoryFlagsCell({
  item,
  dense = false,
  items,
  inventoryLookup,
  bulkImportFilterId,
  activeBgCardItemIds,
  bgCardJobs,
  itemAiCardCounts,
  aiCardRegenConfirmId,
  actions,
}: InventoryFlagsCellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const iconBtn = 'h-7 w-7';
  const childItems = item.isPC || item.isBundle ? getChildren(item, items, inventoryLookup) : [];
  const childCount = childItems.length;

  const showSell =
    !item.parentContainerId &&
    (item.status === ItemStatus.IN_STOCK || item.status === ItemStatus.ORDERED);
  const showDelete = !item.parentContainerId;

  const highlightMore = useMemo(
    () =>
      overflowHasHighlight(
        item,
        items,
        inventoryLookup,
        itemAiCardCounts,
        activeBgCardItemIds,
        actions.resolveBulkImportId,
      ),
    [item, items, inventoryLookup, itemAiCardCounts, activeBgCardItemIds, actions.resolveBulkImportId],
  );

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current?.contains(e.target as Node)) return;
      setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const scrollEl = rootRef.current?.closest('[data-inv-scroll]');
    if (!scrollEl) return;
    const close = () => setMenuOpen(false);
    scrollEl.addEventListener('scroll', close, { passive: true });
    return () => scrollEl.removeEventListener('scroll', close);
  }, [menuOpen]);

  const toggleMenu = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setMenuOpen((v) => !v);
  }, []);

  const cycleState = getItemPresenceCycleState(item);

  const soldInlineBuyerTitle = (() => {
    const bits = [
      item.customer?.name ? `Buyer: ${item.customer.name}` : null,
      item.ebayUsername ? `eBay: ${item.ebayUsername}` : null,
      item.ebayOrderId ? `Order #${item.ebayOrderId}` : null,
    ].filter(Boolean);
    return bits.length ? bits.join(' · ') : 'Add eBay order & buyer';
  })();

  const renderSoldInlineFlags = () => {
    const nodes: React.ReactNode[] = [];
    if (isSoldOrTradedOnly(item)) {
      nodes.push(
        <button
          key="invoice"
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            actions.onInvoice(item);
          }}
          className={`${iconBtn} shrink-0 flex items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100`}
          title="Generate Invoice"
        >
          <FileText size={13} strokeWidth={2.25} />
        </button>,
      );
    }
    if (item.status === ItemStatus.SOLD) {
      nodes.push(
        <button
          key="buyer"
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            actions.onEditBuyer(item);
          }}
          className={`${iconBtn} shrink-0 flex items-center justify-center rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100`}
          title={soldInlineBuyerTitle}
        >
          <User size={13} strokeWidth={2.25} />
        </button>,
      );
    }
    if (shouldShowEbayOrderLinkInFlags(item)) {
      nodes.push(
        <SoldEbayOrderLinkButton
          key="ebay-order"
          item={item}
          onMatchOrder={actions.onMatchEbayOrder}
          iconClassName={iconBtn}
        />,
      );
    }
    if (item.status === ItemStatus.SOLD || item.status === ItemStatus.GIFTED) {
      nodes.push(
        <button
          key="return"
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            actions.onReturnOrUndoGift(item);
          }}
          className={`${iconBtn} shrink-0 flex items-center justify-center rounded-lg border border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100`}
          title={item.status === ItemStatus.GIFTED ? 'Undo gift' : 'Mark Unsold / Return'}
        >
          <RotateCcw size={13} strokeWidth={2.25} />
        </button>,
      );
    }
    return nodes;
  };

  const renderOverflowFlags = () => {
    const soldLike = isRealizedDisposal(item) || item.status === ItemStatus.GIFTED;
    const isSoldContainer = (item.isPC || item.isBundle) && soldLike;
    const canQuickBundle = !soldLike || isSoldContainer;
    const itemBulkId = actions.resolveBulkImportId(item);
    const bgBusy = activeBgCardItemIds.has(item.id);
    const bgJob = bgCardJobs.find(
      (j) => j.itemId === item.id && (j.status === 'queued' || j.status === 'running'),
    );
    const cardCount = itemAiCardCounts[item.id] || 0;
    const hasCards = cardCount > 0;
    const confirming = aiCardRegenConfirmId === item.id;
    const qc = photoQcSummary(item);
    const links = resolveItemSourceLinks(item);
    const primaryLink = links.chat || links.order || links.profile;

    const chips: React.ReactNode[] = [];

    if (
      !item.parentContainerId &&
      (item.status === ItemStatus.IN_STOCK || item.status === ItemStatus.ORDERED)
    ) {
      if (item.listedOnEbay && item.ebayListingId) {
        chips.push(
          <a
            key="ebay-listing"
            href={buildEbayItemUrl(item.ebayListingId)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className={`${iconBtn} shrink-0 flex items-center justify-center rounded-lg border border-sky-200 bg-sky-50/80 text-sky-700 hover:bg-sky-100 transition-colors`}
            title="Live on eBay — click to open the listing"
          >
            <Link2 size={13} strokeWidth={2.25} />
          </a>,
        );
      } else if (getEbayPublishReadiness(item).ok) {
        chips.push(
          <button
            key="ebay-ready"
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              actions.onEditForEbayPublish(item);
            }}
            className={`${iconBtn} shrink-0 flex items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50/80 text-emerald-700 hover:bg-emerald-100 transition-colors`}
            title="Ready to publish to eBay"
          >
            <CheckCircle2 size={13} strokeWidth={2.25} />
          </button>,
        );
      }
    }

    chips.push(
      <button
        key="photos"
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          actions.onOpenAddPhotos(item.id);
        }}
        className={`${iconBtn} shrink-0 flex items-center justify-center rounded-lg border transition-colors ${
          !qc.ok && qc.issues.some((i) => i.level === 'error')
            ? 'border-rose-200 bg-rose-50/80 text-rose-600 hover:bg-rose-100'
            : !qc.ok
              ? 'border-amber-200 bg-amber-50/80 text-amber-700 hover:bg-amber-100'
              : getItemUserPhotoCount(item) > 0
                ? 'border-blue-200 bg-blue-50/80 text-blue-600 hover:bg-blue-100'
                : 'border-slate-200 bg-white text-slate-500 hover:border-blue-300 hover:text-blue-600 hover:bg-blue-50/50'
        }`}
        title={qc.ok ? 'Photos OK — click to add more' : `Photo QC: ${qc.label}`}
      >
        <Camera size={13} strokeWidth={2.25} />
      </button>,
    );

    chips.push(
      <button
        key="ebay-photos"
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          actions.onOpenEbayPhotos(item.id);
        }}
        className={`${iconBtn} shrink-0 flex items-center justify-center rounded-lg border border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 hover:border-sky-300 transition-colors`}
        title="Parse photos from my eBay listings into this item"
      >
        <ShoppingBag size={13} strokeWidth={2.25} />
      </button>,
    );

    chips.push(
      <div key="ai-cards" className="relative shrink-0">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (bgBusy) return;
            if (hasCards && !confirming) {
              actions.onRequestAiCardsConfirm(item);
              return;
            }
            actions.onQueueAiCards(item);
          }}
          disabled={bgBusy}
          className={`${iconBtn} relative shrink-0 flex items-center justify-center rounded-lg border transition-colors disabled:opacity-70 ${
            bgBusy
              ? 'border-violet-200 bg-violet-50/80 text-violet-700'
              : confirming
                ? 'border-amber-400 bg-amber-50 text-amber-800 ring-1 ring-amber-200'
                : hasCards
                  ? 'border-emerald-200 bg-emerald-50/80 text-emerald-800 hover:bg-emerald-100'
                  : 'border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100'
          }`}
          title={
            bgBusy
              ? `Generating in background… ${bgJob?.progress || ''}`.trim()
              : hasCards
                ? `Already has ${cardCount} AI card${cardCount === 1 ? '' : 's'} — click to generate more`
                : 'Generate AI cards in background'
          }
        >
          {bgBusy ? (
            <Loader2 size={13} strokeWidth={2.25} className="animate-spin" />
          ) : (
            <Images size={13} strokeWidth={2.25} />
          )}
          {hasCards && !bgBusy && (
            <span className="absolute -top-1 -right-1 min-w-[14px] h-3.5 px-0.5 rounded-full bg-emerald-600 text-white flex items-center justify-center shadow-sm">
              {cardCount > 9 ? (
                <Check size={8} strokeWidth={3} />
              ) : (
                <span className="text-[8px] font-black leading-none">{cardCount}</span>
              )}
            </span>
          )}
        </button>
        {confirming && (
          <div className="absolute top-full left-0 mt-0.5 z-[80] flex items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-0.5 shadow-md">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                actions.onQueueAiCards(item);
              }}
              className="p-1 rounded-md bg-emerald-600 text-white hover:bg-emerald-700"
              title="Yes — generate more cards"
            >
              <Check size={12} strokeWidth={2.75} />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                actions.onCancelAiCardsConfirm();
              }}
              className="p-1 rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-rose-600"
              title="No — keep existing cards"
            >
              <X size={12} strokeWidth={2.75} />
            </button>
          </div>
        )}
      </div>,
    );

    if (canQuickBundle) {
      chips.push(
        <button
          key="quick-bundle"
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            actions.onOpenQuickBundle(item);
          }}
          className={`${iconBtn} shrink-0 flex items-center justify-center rounded-lg border transition-colors border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 hover:border-violet-300`}
          title="Bundle / add parts"
        >
          <Plus size={13} strokeWidth={2.5} />
        </button>,
      );
    }

    if (itemBulkId) {
      chips.push(
        <button
          key="bulk-import"
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            actions.onOpenBulkImport(itemBulkId);
          }}
          className={`${iconBtn} shrink-0 flex items-center justify-center rounded-lg border transition-colors ${
            bulkImportFilterId === itemBulkId
              ? 'border-violet-400 bg-violet-100 text-violet-800'
              : 'border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 hover:border-violet-300'
          }`}
          title="Bulk import batch"
        >
          <Layers size={13} strokeWidth={2.25} />
        </button>,
      );
    }

    if (getContainerKind(item)) {
      chips.push(
        <button
          key="rebuild-title"
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            actions.onRebuildTitle(item);
          }}
          className={`${iconBtn} shrink-0 flex items-center justify-center rounded-lg border transition-colors border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100 hover:border-sky-300`}
          title="Rebuild title from parts"
        >
          <RotateCw size={13} strokeWidth={2.25} />
        </button>,
      );
    }

    if (item.isPC || item.isBundle) {
      chips.push(
        <button
          key="unbundle"
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            actions.onUnbundle(item);
          }}
          className={`${iconBtn} shrink-0 flex items-center justify-center rounded-lg border border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100`}
          title="Unbundle / Dismantle"
        >
          <Unlink size={13} strokeWidth={2.25} />
        </button>,
      );
    }

    if (canSplitItem(item, childCount)) {
      const lotQty = resolveIdenticalLotQty(item);
      chips.push(
        <button
          key="split"
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            actions.onSplitParts(item);
          }}
          className={`${iconBtn} shrink-0 inline-flex items-center justify-center gap-0.5 rounded-lg border border-violet-200 bg-violet-50 text-violet-700 hover:bg-violet-100 px-1`}
          title={lotQty != null ? `Split lot ×${lotQty}` : 'Split into parts'}
        >
          <Scissors size={13} strokeWidth={2.25} />
          {lotQty != null && (
            <span className="text-[9px] font-black tabular-nums leading-none pr-0.5">×{lotQty}</span>
          )}
        </button>,
      );
    }

    if ((item.isPC || item.isBundle) && isRealizedDisposal(item) && childCount > 0) {
      chips.push(
        <button
          key="recalc"
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            actions.onRecalcSoldContainer(item);
          }}
          className={`${iconBtn} shrink-0 flex items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100`}
          title="Recalculate component sell prices"
        >
          <Calculator size={13} strokeWidth={2.25} />
        </button>,
      );
    } else if ((item.isPC || item.isBundle) && !isRealizedDisposal(item) && childCount > 0) {
      chips.push(
        <button
          key="resplit-buy"
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            actions.onResplitBuyPrices(item);
          }}
          className={`${iconBtn} shrink-0 flex items-center justify-center rounded-lg border border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100`}
          title="Resplit buy prices across parts"
        >
          <Calculator size={13} strokeWidth={2.25} />
        </button>,
      );
    }

    if (item.status === ItemStatus.IN_STOCK) {
      chips.push(
        <button
          key="trade"
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            actions.onTrade(item);
          }}
          className={`${iconBtn} shrink-0 flex items-center justify-center rounded-lg border border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100`}
          title="Trade"
        >
          <ArrowRightLeft size={13} strokeWidth={2.25} />
        </button>,
      );
      chips.push(
        <button
          key="gift"
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            actions.onGift(item);
          }}
          className={`${iconBtn} shrink-0 flex items-center justify-center rounded-lg border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100`}
          title="Gift / Privatentnahme"
        >
          <Gift size={13} strokeWidth={2.25} />
        </button>,
      );
    }

    if (!shouldShowEbayOrderLinkInFlags(item) && primaryLink) {
      chips.push(
        <a
          key="source-link"
          href={primaryLink.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className={`${iconBtn} shrink-0 flex items-center justify-center rounded-lg border border-sky-200 bg-sky-50/80 text-sky-700 hover:bg-sky-100 transition-colors`}
          title={`${primaryLink.title} ↗`}
        >
          {primaryLink.kind === 'chat' ? (
            <MessageSquare size={13} strokeWidth={2.25} />
          ) : primaryLink.kind === 'order' ? (
            <ExternalLink size={13} strokeWidth={2.25} />
          ) : (
            <User size={13} strokeWidth={2.25} />
          )}
        </a>,
      );
    }

    return chips;
  };

  return (
    <div
      ref={rootRef}
      data-flags-strip
      className={`inline-flex flex-nowrap items-start justify-start ${dense ? 'gap-0' : 'gap-px'} w-max`}
    >
      {showSell && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            actions.onMarkSold(item);
          }}
          className={`${iconBtn} shrink-0 flex items-center justify-center rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-900 transition-colors`}
          title="Mark Sold"
          aria-label={`Mark ${item.name} sold`}
        >
          <ShoppingBag size={13} strokeWidth={2.25} />
        </button>
      )}

      {showDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            actions.onDelete(item);
          }}
          className={`${iconBtn} shrink-0 flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 hover:border-red-300 hover:bg-red-50 hover:text-red-600 transition-colors`}
          title="Delete"
          aria-label={`Delete ${item.name}`}
        >
          <Trash2 size={13} strokeWidth={2.25} />
        </button>
      )}

      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          actions.onTogglePresence(item);
        }}
        className={`${iconBtn} shrink-0 flex items-center justify-center rounded-lg border transition-colors ${
          cycleState === 'present'
            ? 'border-emerald-200 bg-emerald-50/80'
            : cycleState === 'lost'
              ? 'border-red-200 bg-red-50/80'
              : cycleState === 'defective'
                ? 'border-amber-200 bg-amber-50/80'
                : 'border-slate-200 bg-white hover:bg-slate-50'
        }`}
        title={
          cycleState === 'present'
            ? 'Present (click → lost)'
            : cycleState === 'lost'
              ? 'Lost (click → defective)'
              : cycleState === 'defective'
                ? 'Defective (click → clear)'
                : '? Presence not set — click to mark present / lost / defective'
        }
      >
        {cycleState === 'defective' ? (
          <AlertCircle size={13} className="text-amber-600" />
        ) : cycleState === 'unknown' ? (
          <span className="text-[11px] font-black leading-none text-slate-500">?</span>
        ) : (
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              cycleState === 'present' ? 'bg-emerald-500' : 'bg-red-500'
            }`}
          />
        )}
      </button>

      <ItemAccessoryToggles
        item={item}
        children={item.isPC || item.isBundle ? childItems : undefined}
        dense
        flags
        iconBtnClass={iconBtn}
        renderGhost={(Icon) => renderFlagGhost(Icon, iconBtn)}
        onPatch={(patch) => actions.onPatchAccessory(item, patch)}
      />

      {renderSoldInlineFlags()}

      <div className="relative shrink-0">
        <button
          type="button"
          onClick={toggleMenu}
          className={`${iconBtn} relative shrink-0 flex items-center justify-center rounded-lg border transition-colors ${
            menuOpen
              ? 'border-slate-400 bg-slate-100 text-slate-800'
              : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:border-slate-300'
          }`}
          title="More actions"
          aria-label="More flag actions"
          aria-expanded={menuOpen}
        >
          <MoreHorizontal size={13} strokeWidth={2.25} />
          {highlightMore && !menuOpen && (
            <span
              className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-violet-500 ring-1 ring-white"
              aria-hidden
            />
          )}
        </button>

        {menuOpen && (
          <div
            className="absolute left-0 top-full mt-1 z-[70] min-w-[8.5rem] max-w-[12.5rem] rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg shadow-slate-900/10"
            onClick={(e) => e.stopPropagation()}
            role="menu"
          >
            <div className={`flex flex-wrap items-center ${dense ? 'gap-0.5' : 'gap-1'}`}>
              {renderOverflowFlags()}
            </div>
          </div>
        )}
      </div>
    </div>
  );
});

export default InventoryFlagsCell;
