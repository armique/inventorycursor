import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, ChevronRight, ExternalLink, Flag, Link2, Loader2, Plus, Scissors, Tag, X } from 'lucide-react';
import { ItemStatus, type InventoryItem, type TaxMode } from '../types';
import { formatSignedEUR } from '../utils/formatMoney';
import { isRealizedDisposal } from '../utils/itemDisposition';
import { buildEbayOrderUrl, isRealEbayOrderId } from '../utils/sourceLinks';
import type { EbayTxOrderLedger, EbayTxOrderRefundState, EbayTxRow } from '../utils/ebayTransactionReport';
import { formatEbayTxDay } from '../utils/ebayTransactionReport';
import { findEbayTxInventoryMatches, itemLinkedToEbayTxOrder, type EbayTxItemCandidate } from '../utils/ebayTxInventoryMatch';
import { getChildren, getParentContainer } from '../services/financialAggregation';
import { resolveComponentPartTone } from '../utils/componentPartTone';
import {
  getRecoverablePriorAbrechnungSale,
  recoverPriorAbrechnungSale,
} from '../utils/itemSaleCycle';
import {
  addressFromEbayTxRow,
  createInventoryItemFromEbayTx,
  ebayTxBuyerTotalEur,
  linkExistingContainerToEbayTx,
  linkInventoryItemToEbayTx,
  linkMultipleInventoryItemsToEbayTx,
} from '../utils/linkInventoryItemToEbayTx';
import {
  isOrderMatcherNeedsReview,
  flagOrderMatcherNeedsReview,
  unflagOrderMatcherNeedsReview,
} from '../utils/orderMatcherNeedsReview';
import { orderCancellationCostAbs } from '../utils/ebaySaleAdjustments';
import { applyRefundFeeAbsorption, hasAbsorbedRefundFee } from '../utils/refundFeeAbsorption';
import SplitPartsModal from './SplitPartsModal';
import { detectWorkingDefektSplit } from '../utils/detectWorkingDefektSplit';
import { buildSplitApplyItems, buildWorkingDefektSplitDrafts } from '../utils/splitParts';

type Props = {
  row: EbayTxRow;
  ledger: EbayTxOrderLedger | null;
  refundState?: EbayTxOrderRefundState;
  items: InventoryItem[];
  taxMode: TaxMode;
  onClose: () => void;
  onLink: (next: InventoryItem) => void;
  onLinkBundle: (updates: InventoryItem[]) => void;
  onSplitApply?: (updates: InventoryItem[], deleteIds?: string[]) => void;
  onRecoverPriorSale?: (item: InventoryItem) => void;
  onSearchResale?: (title: string) => void;
  /** panel = inline right column on Abrechnung page; modal = centered overlay */
  variant?: 'panel' | 'modal';
};

export type ChipTone = 'slate' | 'sky' | 'emerald' | 'amber' | 'violet' | 'rose';

const CHIP: Record<ChipTone, string> = {
  slate: 'border-slate-200 bg-slate-50 text-slate-600',
  sky: 'border-sky-200 bg-sky-50 text-sky-800',
  emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  amber: 'border-amber-200 bg-amber-50 text-amber-800',
  violet: 'border-violet-200 bg-violet-50 text-violet-800',
  rose: 'border-rose-200 bg-rose-50 text-rose-800',
};

export function Chip({
  tone,
  children,
  title,
}: {
  tone: ChipTone;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${CHIP[tone]}`}
    >
      {children}
    </span>
  );
}

export function dayKey(raw?: string | null): string {
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const day = formatEbayTxDay(raw);
  if (!/^\d{2}\.\d{2}\.\d{4}$/.test(day)) return '';
  const [dd, mm, yyyy] = day.split('.');
  return `${yyyy}-${mm}-${dd}`;
}

function daysApart(a: string, b: string): number | null {
  if (!a || !b) return null;
  const ms = Math.abs(Date.parse(`${a}T12:00:00`) - Date.parse(`${b}T12:00:00`));
  if (!Number.isFinite(ms)) return null;
  return Math.round(ms / 86400000);
}

export function dateTone(orderDay: string, itemDay: string): ChipTone {
  const gap = daysApart(orderDay, itemDay);
  if (gap == null) return 'slate';
  if (gap === 0) return 'emerald';
  if (gap <= 2) return 'sky';
  if (gap <= 7) return 'amber';
  return 'slate';
}

export function priceTone(orderEur: number, itemEur: number): ChipTone {
  if (!(orderEur >= 0.01) || !(itemEur >= 0.01)) return 'slate';
  const gap = Math.abs(orderEur - itemEur);
  if (gap <= 1.5) return 'emerald';
  if (gap <= 5) return 'amber';
  return 'slate';
}

export function statusTone(status: string): ChipTone {
  if (status === ItemStatus.SOLD) return 'amber';
  if (status === ItemStatus.IN_STOCK) return 'emerald';
  if (status === ItemStatus.ORDERED) return 'sky';
  if (status === ItemStatus.TRADED) return 'violet';
  if (status === ItemStatus.GIFTED) return 'rose';
  return 'slate';
}

function kindTone(kind: string): ChipTone {
  if (kind === 'order') return 'emerald';
  if (kind === 'listingId') return 'sky';
  if (kind === 'sku') return 'violet';
  if (kind === 'price') return 'amber';
  return 'slate';
}

function kindLabel(kind: string): string {
  if (kind === 'order') return 'Already linked';
  if (kind === 'listingId') return 'Listing ID';
  if (kind === 'sku') return 'SKU';
  if (kind === 'price') return 'Price';
  return 'Title';
}

export function inventorySoldDay(item: InventoryItem): string {
  if (!isRealizedDisposal(item)) return '';
  const raw = item.sellDate || item.containerSoldDate || '';
  if (!raw) return '';
  const day = formatEbayTxDay(raw);
  return day === '—' ? '' : day;
}

function isInventoryContainer(item: InventoryItem): boolean {
  return Boolean(item.isPC || item.isBundle || (item.componentIds && item.componentIds.length > 0));
}

type MatchTreeEntry = {
  hit: EbayTxItemCandidate;
  children: InventoryItem[];
};

/** Top-level match rows; container parts never stand alone — promote to parent PC/bundle/mix. */
function buildMatchTree(
  matches: EbayTxItemCandidate[],
  items: InventoryItem[],
  orderId: string
): MatchTreeEntry[] {
  const byParentId = new Map<string, EbayTxItemCandidate>();

  const takeBest = (candidate: EbayTxItemCandidate) => {
    const existing = byParentId.get(candidate.item.id);
    if (!existing || candidate.score > existing.score) {
      byParentId.set(candidate.item.id, candidate);
    }
  };

  for (const hit of matches) {
    if (isInventoryContainer(hit.item)) {
      takeBest(hit);
      continue;
    }
    const parent = getParentContainer(hit.item, items);
    if (parent && isInventoryContainer(parent)) {
      // Part matched → show the parent shell instead (parts never get their own Link row).
      takeBest({
        item: parent,
        score: hit.score,
        kind: hit.kind,
        alreadyLinked: itemLinkedToEbayTxOrder(parent, orderId),
        dateScore: hit.dateScore,
        priceScore: hit.priceScore,
        titleScore: hit.titleScore,
      });
      continue;
    }
    // Orphaned parentContainerId with missing parent — skip (not linkable alone).
    if (hit.item.parentContainerId) continue;
    takeBest(hit);
  }

  return [...byParentId.values()]
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name))
    .map((hit) => ({
      hit,
      children: isInventoryContainer(hit.item) ? getChildren(hit.item, items) : [],
    }));
}

type MatchPickerRowProps = {
  item: InventoryItem;
  hit?: EbayTxItemCandidate;
  nested?: boolean;
  parent?: InventoryItem;
  /** Nested parts under a matched container — no own Link/checkbox (parent Link does the family). */
  nestOnly?: boolean;
  orderDayKey: string;
  sellTotal: number;
  busyId: string | null;
  checked: boolean;
  onToggleSelected: (itemId: string) => void;
  onApply: (item: InventoryItem, renameToOrderTitle: boolean) => void;
  onRecoverPriorSale?: (item: InventoryItem) => void;
  onSplit?: (item: InventoryItem) => void;
  /** "1 working, 1 defekt" title detection — pre-filled one-click split, suggest-only. */
  onApplyDetectedSplit?: (item: InventoryItem) => void;
};

function MatchPickerRow({
  item,
  hit,
  nested = false,
  parent,
  nestOnly = false,
  orderDayKey,
  sellTotal,
  busyId,
  checked,
  onToggleSelected,
  onApply,
  onRecoverPriorSale,
  onSplit,
  onApplyDetectedSplit,
}: MatchPickerRowProps) {
  const soldDay = inventorySoldDay(item);
  const itemDayKey = dayKey(item.sellDate || item.containerSoldDate);
  const invSell = Number(item.saleProceeds?.buyerTotalEur ?? item.sellPrice) || 0;
  // Parts of PC / bundle / mix never get Link — only the parent shell does.
  const isContainerPart = nestOnly || Boolean(parent) || Boolean(item.parentContainerId);
  const detectedSplit = !isContainerPart ? detectWorkingDefektSplit(item.name) : null;
  const recoverable = onRecoverPriorSale && !isContainerPart ? getRecoverablePriorAbrechnungSale(item) : null;
  const childTone = nested ? resolveComponentPartTone(item) : null;
  const isPc = parent?.isPC ?? item.isPC;
  const linkLabel = hit?.alreadyLinked ? 'Overwrite' : 'Link';
  const linkBusy = busyId === item.id;
  const perPartHint =
    isContainerPart && parent && sellTotal >= 0.01
      ? Math.round((sellTotal / Math.max(1, (parent.componentIds || []).length || 1) + Number.EPSILON) * 100) / 100
      : null;

  return (
    <div
      className={`w-full px-1.5 py-1.5 flex items-start gap-2 ${
        isContainerPart
          ? 'rounded-md'
          : checked
            ? 'rounded-lg border border-indigo-200 bg-indigo-50/60'
            : 'rounded-lg border border-transparent hover:border-slate-100 hover:bg-slate-50/80'
      }`}
      style={
        nested && childTone
          ? { borderLeftWidth: 3, borderLeftColor: childTone.accentHex, borderLeftStyle: 'solid' }
          : undefined
      }
    >
      {isContainerPart ? (
        <span className="mt-1 h-4 w-4 shrink-0" aria-hidden />
      ) : (
        <button
          type="button"
          disabled={busyId != null}
          onClick={() => onToggleSelected(item.id)}
          className={`mt-1 h-4 w-4 shrink-0 rounded border flex items-center justify-center ${
            checked ? 'border-indigo-500 bg-indigo-500 text-white' : 'border-slate-300 bg-white text-transparent'
          }`}
          title={checked ? 'Remove from bundle selection' : 'Select for bundle link'}
          aria-label={checked ? 'Deselect' : 'Select for bundle'}
        >
          <Check size={10} strokeWidth={3} />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <p
          className={`${isContainerPart ? 'text-[10px] font-semibold' : 'text-[11px] font-bold'} break-words ${
            nested
              ? isPc
                ? 'text-indigo-900'
                : 'text-violet-900'
              : item.isPC
                ? 'text-indigo-950'
                : isInventoryContainer(item)
                  ? 'text-violet-950'
                  : 'text-slate-700'
          }`}
        >
          {item.name}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-0.5">
          {!isContainerPart ? <Chip tone={statusTone(item.status)}>{item.status}</Chip> : null}
          {soldDay && !isContainerPart ? (
            <Chip tone={dateTone(orderDayKey, itemDayKey)} title="Inventory sell date">
              {soldDay}
            </Chip>
          ) : null}
          {invSell >= 0.01 && !isContainerPart ? (
            <Chip tone={priceTone(sellTotal, invSell)} title="Inventory sell price">
              {formatSignedEUR(invSell)}
            </Chip>
          ) : null}
          {hit && !isContainerPart ? (
            <>
              <Chip tone={kindTone(hit.kind)}>{kindLabel(hit.kind)}</Chip>
              {hit.alreadyLinked ? (
                <Chip tone="emerald">this order</Chip>
              ) : item.ebayOrderId ? (
                <Chip tone="rose" title="Linked to a different eBay order">
                  {item.ebayOrderId}
                </Chip>
              ) : null}
            </>
          ) : isContainerPart ? (
            <>
              <Chip tone="slate">Part</Chip>
              {item.buyPrice != null ? (
                <Chip tone="slate" title="Buy price">
                  EK {formatSignedEUR(item.buyPrice)}
                </Chip>
              ) : null}
              {perPartHint != null ? (
                <Chip tone="violet" title="Equal split of order total after link">
                  ~{formatSignedEUR(perPartHint)}
                </Chip>
              ) : null}
            </>
          ) : null}
        </div>
        {recoverable ? (
          <button
            type="button"
            disabled={busyId != null}
            onClick={() => onRecoverPriorSale?.(item)}
            className="mt-1 inline-flex items-center rounded-md border border-purple-200 bg-purple-50 px-1.5 py-0.5 text-[10px] font-bold text-purple-800 hover:bg-purple-100 disabled:opacity-50"
            title={
              recoverable.id.startsWith('cleanup-')
                ? 'Remove false sale entry from history'
                : `Restore prior sale${recoverable.sellPrice != null ? ` · €${recoverable.sellPrice.toFixed(2)}` : ''}${recoverable.sellDate ? ` · ${recoverable.sellDate}` : ''}`
            }
          >
            {recoverable.id.startsWith('cleanup-')
              ? 'Remove false sale history'
              : `Restore prior sale${recoverable.sellPrice != null ? ` · €${recoverable.sellPrice.toFixed(2)}` : ''}`}
          </button>
        ) : null}
        {detectedSplit && onApplyDetectedSplit ? (
          <button
            type="button"
            disabled={busyId != null}
            onClick={() => onApplyDetectedSplit(item)}
            className="mt-1 inline-flex items-center rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-900 hover:bg-amber-100 disabled:opacity-50"
            title="Detected from the title — never applies without this click"
          >
            ⚠ Detected: 1 working + 1 defekt
            {detectedSplit.defektPriceEur != null ? ` (€${detectedSplit.defektPriceEur.toFixed(2)})` : ''}
            {' — Split now'}
          </button>
        ) : null}
      </div>
      {isContainerPart ? (
        <span className="mt-0.5 shrink-0 text-[9px] font-bold uppercase tracking-wide text-slate-400 px-1">
          included
        </span>
      ) : (
        <div className="mt-0.5 shrink-0 flex items-center gap-1">
          <button
            type="button"
            disabled={busyId != null}
            onClick={() => onApply(item, false)}
            aria-label={linkLabel}
            className={`h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-lg border shadow-sm transition-colors disabled:opacity-50 ${
              hit?.alreadyLinked
                ? 'border-amber-300 bg-amber-500 text-white hover:bg-amber-600'
                : 'border-indigo-400 bg-indigo-600 text-white hover:bg-indigo-700'
            }`}
            title={
              isInventoryContainer(item) && (item.componentIds?.length || 0) > 0
                ? 'Link bundle + equal-split sell value and date onto all parts'
                : hit?.alreadyLinked
                  ? 'Replace existing link with this order'
                  : 'Link this inventory item to the order'
            }
          >
            {linkBusy ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} strokeWidth={2.25} />}
          </button>
          <button
            type="button"
            disabled={busyId != null}
            onClick={() => onApply(item, true)}
            aria-label={`${linkLabel} and rename`}
            className={`h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-lg border shadow-sm transition-colors disabled:opacity-50 ${
              hit?.alreadyLinked
                ? 'border-amber-300 bg-amber-500 text-white hover:bg-amber-600'
                : 'border-indigo-400 bg-indigo-600 text-white hover:bg-indigo-700'
            }`}
            title={`${hit?.alreadyLinked ? 'Replace existing link' : 'Link'} and rename the item to the order title`}
          >
            {linkBusy ? <Loader2 size={13} className="animate-spin" /> : <Tag size={13} strokeWidth={2.25} />}
          </button>
          {onSplit ? (
            <button
              type="button"
              disabled={busyId != null}
              onClick={() => onSplit(item)}
              aria-label="Split into parts"
              className="h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-sm hover:border-slate-400 hover:text-slate-900 disabled:opacity-50"
              title="Split into parts — e.g. 1 working + 1 defekt weren't separated yet"
            >
              <Scissors size={13} strokeWidth={2.25} />
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

const EbayAbrechnungMatchPicker: React.FC<Props> = ({
  row,
  ledger,
  refundState = 'none',
  items,
  taxMode,
  onClose,
  onLink,
  onLinkBundle,
  onSplitApply,
  onRecoverPriorSale,
  onSearchResale,
  variant = 'panel',
}) => {
  const [query, setQuery] = useState('');
  const [hideLinked, setHideLinked] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [collapsedContainers, setCollapsedContainers] = useState<Set<string>>(() => new Set());
  const [splitTarget, setSplitTarget] = useState<InventoryItem | null>(null);
  const [needsReviewFlagged, setNeedsReviewFlagged] = useState(() => isOrderMatcherNeedsReview(row.id));
  useEffect(() => {
    setNeedsReviewFlagged(isOrderMatcherNeedsReview(row.id));
  }, [row.id]);
  useEffect(() => {
    if (needsReviewFlagged) flagOrderMatcherNeedsReview(row.id);
    else unflagOrderMatcherNeedsReview(row.id);
  }, [needsReviewFlagged, row.id]);
  const isPanel = variant === 'panel';
  const address = addressFromEbayTxRow(row);
  const itemEur = ledger?.itemEur || row.itemSubtotalEur;
  const shipEur = ledger?.buyerShipEur || row.shippingEur;
  const pocketEur = ledger?.pocketEur ?? row.netEur;
  const orderDayKey = dayKey(row.createdSort || row.createdAt);
  const orderDayLabel = formatEbayTxDay(row.createdSort || row.createdAt);
  const orderDayShow = orderDayLabel !== '—' ? orderDayLabel : '';
  const orderUrl = isRealEbayOrderId(row.orderId) ? buildEbayOrderUrl(row.orderId) : undefined;
  const isFullRefund = refundState === 'full';
  const isPartialRefund = refundState === 'partial';
  const blockLink = isFullRefund;
  const title = row.title || row.description || 'Bestellung';

  const matches = useMemo(
    () => findEbayTxInventoryMatches(items, row, ledger, query, 12),
    [items, row, ledger, query]
  );
  // "Already linked" = has an ebayOrderId at all (this order or a different one) — the
  // toggle is for decluttering the search, not for the "already linked to THIS order"
  // summary flag below, which still needs matches to compute correctly.
  const visibleMatches = useMemo(
    () => (hideLinked ? matches.filter((hit) => !hit.item.ebayOrderId) : matches),
    [matches, hideLinked]
  );
  const matchTree = useMemo(
    () => buildMatchTree(visibleMatches, items, row.orderId || ''),
    [visibleMatches, items, row.orderId]
  );
  const alreadyLinked = matches.some((hit) => hit.alreadyLinked);
  const stubPreview = useMemo(() => createInventoryItemFromEbayTx(row, ledger), [row, ledger]);
  const sellTotal = ebayTxBuyerTotalEur(row, ledger);
  const absorbFeeEur = orderCancellationCostAbs(pocketEur ?? 0);

  const handleAbsorbFee = (item: InventoryItem) => {
    if (absorbFeeEur < 0.01) return;
    setBusyId(item.id);
    try {
      const updates = applyRefundFeeAbsorption(
        item,
        row.orderId,
        absorbFeeEur,
        items,
        `Absorbed from ${isFullRefund ? 'fully' : 'partially'} refunded order ${row.orderId}`
      );
      // A bundle/PC target returns [parent, ...children] — that needs the multi-item path
      // (onLinkBundle) so every changed part actually saves, not just the container.
      if (updates.length > 1) onLinkBundle(updates);
      else onLink(updates[0]);
    } finally {
      setBusyId(null);
    }
  };

  // "1 working, 1 defekt" auto-detect suggestion — pre-fills the same split mechanics as
  // the manual Splitter (buildWorkingDefektSplitDrafts + buildSplitApplyItems), but only
  // ever runs on this explicit click, never automatically.
  const handleApplyDetectedSplit = (item: InventoryItem) => {
    if (!onSplitApply) return;
    const detection = detectWorkingDefektSplit(item.name);
    if (!detection) return;
    setBusyId(item.id);
    try {
      const drafts = buildWorkingDefektSplitDrafts(item, detection.defektPriceEur);
      const result = buildSplitApplyItems(item, drafts, items, { standalone: true });
      if (result.parent) {
        onSplitApply([result.parent, ...result.children]);
      } else {
        onSplitApply(result.children, [item.id]);
      }
    } finally {
      setBusyId(null);
    }
  };

  useEffect(() => {
    setQuery('');
    setBusyId(null);
    setSelectedIds(new Set());
    setCollapsedContainers(new Set());
  }, [row.id]);

  const toggleContainerExpanded = (containerId: string) => {
    setCollapsedContainers((prev) => {
      const next = new Set(prev);
      if (next.has(containerId)) next.delete(containerId);
      else next.add(containerId);
      return next;
    });
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const apply = (item: InventoryItem, renameToOrderTitle: boolean) => {
    // Parts never link alone — always go through the parent PC/bundle/mix.
    const parent = !isInventoryContainer(item) ? getParentContainer(item, items) : undefined;
    const target = parent && isInventoryContainer(parent) ? parent : item;
    setBusyId(target.id);
    try {
      if (isInventoryContainer(target)) {
        const children = getChildren(target, items);
        if (children.length > 0) {
          const result = linkExistingContainerToEbayTx(target, children, row, ledger, taxMode, {
            renameToOrderTitle,
          });
          if (result) {
            onLinkBundle(result.updates);
            return;
          }
        }
      }
      if (target.parentContainerId) return;
      onLink(linkInventoryItemToEbayTx(target, row, ledger, taxMode, { renameToOrderTitle }));
    } finally {
      setBusyId(null);
    }
  };

  const applyBundle = () => {
    const selected = [...selectedIds]
      .map((id) => items.find((item) => item.id === id))
      .filter((item): item is InventoryItem => Boolean(item))
      // Never multi-link nested parts — only standalone rows / shells.
      .filter((item) => !item.parentContainerId && !getParentContainer(item, items));
    if (selected.length < 2) return;
    setBusyId('__bundle__');
    try {
      const result = linkMultipleInventoryItemsToEbayTx(selected, row, ledger, taxMode, {
        renameToOrderTitle: false,
      });
      if (result) onLinkBundle(result.updates);
    } finally {
      setBusyId(null);
    }
  };

  const toggleSelected = (itemId: string) => {
    const item = items.find((row) => row.id === itemId);
    if (item?.parentContainerId || (item && getParentContainer(item, items))) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const selectedCount = selectedIds.size;
  const perPartSell =
    selectedCount >= 2 && sellTotal >= 0.01
      ? Math.round((sellTotal / selectedCount + Number.EPSILON) * 100) / 100
      : null;

  const createStub = () => {
    setBusyId(stubPreview.id);
    try {
      onLink(linkInventoryItemToEbayTx(stubPreview, row, ledger, taxMode));
    } finally {
      setBusyId(null);
    }
  };

  // The modal variant only ever renders on mobile (md:hidden in EbayAbrechnungPage) — it must
  // NOT carry the desktop ".ebay-abrechnung-ui" 120% zoom class. That class scales the box
  // *after* max-h-[90vh] is computed against the real viewport (zoom, unlike transform, inflates
  // layout, not just paint), so a 730px cap rendered at 877px — pushing Link/Rename/Split/Create
  // below the screen with no way to scroll to them, since the fixed overlay itself doesn't scroll.
  const shellClass = isPanel
    ? 'h-full min-h-0 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col text-[11px] text-slate-700'
    : 'bg-white w-full max-w-3xl max-h-[90vh] rounded-2xl border border-slate-200 shadow-2xl overflow-hidden flex flex-col text-[11px] text-slate-700';

  const body = (
    <div className={shellClass} onClick={isPanel ? undefined : (e) => e.stopPropagation()} role="dialog" aria-modal={!isPanel} aria-label="Match inventory item">
      <div className={`shrink-0 flex items-start gap-2 border-b border-slate-100 ${isPanel ? 'px-3 py-2 bg-slate-50' : 'px-4 py-3 bg-slate-50'}`}>
        <Link2 size={14} className="mt-0.5 text-slate-600 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold text-slate-700 leading-snug whitespace-normal break-words">
            {title}
          </p>
          {row.orderId && isRealEbayOrderId(row.orderId) ? (
            <p className="text-[10px] text-slate-700 font-mono mt-0.5 break-all inline-flex items-center gap-1.5 max-w-full min-w-0">
              <span className="min-w-0 break-all">{row.orderId}</span>
              {orderUrl ? (
                <a
                  href={orderUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(event) => event.stopPropagation()}
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100"
                  title={`Open eBay order ${row.orderId} ↗`}
                  aria-label={`Open eBay order ${row.orderId}`}
                >
                  <ExternalLink size={11} strokeWidth={2.25} />
                </a>
              ) : null}
            </p>
          ) : null}
          <div className="mt-1 flex flex-wrap items-center gap-0.5">
            {orderDayShow ? (
              <Chip tone="sky" title="eBay order date">
                {orderDayShow}
              </Chip>
            ) : null}
            {itemEur != null && Number.isFinite(itemEur) ? (
              <Chip tone="emerald" title="Item price the buyer paid">
                {formatSignedEUR(itemEur)}
              </Chip>
            ) : null}
            {shipEur != null && Math.abs(shipEur) >= 0.005 ? (
              <Chip tone="sky" title="Buyer shipping">
                {formatSignedEUR(shipEur)}
              </Chip>
            ) : null}
            {pocketEur != null && Number.isFinite(pocketEur) ? (
              <Chip tone="slate" title="Pocket">
                {formatSignedEUR(pocketEur)}
              </Chip>
            ) : null}
          </div>
          {!isPanel ? (
            <p className="text-[11px] text-slate-500 mt-1 break-words">
              {row.buyerUsername || row.buyerName || '—'}
              {address ? ` · ${address}` : ''}
            </p>
          ) : (
            <p className="text-[11px] text-slate-500 mt-0.5 truncate" title={row.buyerUsername || row.buyerName || undefined}>
              {row.buyerUsername || row.buyerName || '—'}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setNeedsReviewFlagged((f) => !f)}
          className={`p-1 rounded-lg shrink-0 ${
            needsReviewFlagged ? 'text-violet-700 bg-violet-100' : 'text-slate-400 hover:bg-slate-100'
          }`}
          title={needsReviewFlagged ? 'Flagged for review — click to clear' : 'Flag this order for review'}
          aria-label="Toggle needs review"
        >
          <Flag size={14} />
        </button>
        <button type="button" onClick={onClose} className="p-1 rounded-lg text-slate-400 hover:bg-slate-100 shrink-0" aria-label="Close">
          <X size={14} />
        </button>
      </div>
      {isFullRefund || isPartialRefund ? (
        <div
          className={`shrink-0 rounded-lg border text-[10px] mx-3 mt-2 px-2 py-1.5 ${
            isFullRefund ? 'border-red-200 bg-red-50 text-red-900' : 'border-amber-200 bg-amber-50 text-amber-900'
          }`}
        >
          <p className="font-bold uppercase tracking-wider text-[10px] text-slate-500">
            {isFullRefund ? 'Fully refunded' : 'Partial refund'}
          </p>
          <p className="mt-0.5 leading-relaxed text-[11px]">
            {isFullRefund
              ? 'Do not link here — find the later resale Bestellung.'
              : 'Link only if this is still the correct sale.'}
            {pocketEur != null && Number.isFinite(pocketEur) ? (
              <span className="ml-1 font-semibold tabular-nums">{formatSignedEUR(pocketEur)}</span>
            ) : null}
          </p>
          {isFullRefund && onSearchResale ? (
            <button
              type="button"
              onClick={() => onSearchResale(title)}
              className="mt-1 inline-flex items-center rounded-md border border-red-300 bg-white px-1.5 py-0.5 text-[10px] font-bold text-red-800 hover:bg-red-100"
            >
              Find later resale
            </button>
          ) : null}
        </div>
      ) : null}
      <div className={`shrink-0 ${isPanel ? 'px-3 py-1.5' : 'px-4 py-2'} space-y-1.5`}>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search stock or sold items…"
          className="w-full px-2 py-1.5 rounded-lg border border-slate-200 text-[11px] font-semibold outline-none focus:border-indigo-400"
          autoFocus
        />
        <button
          type="button"
          onClick={() => setHideLinked((v) => !v)}
          className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${
            hideLinked
              ? 'border-indigo-300 bg-indigo-100 text-indigo-800'
              : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
          }`}
          aria-pressed={hideLinked}
          title="Hide items that already have an eBay order linked (this one or another one)"
        >
          <Check size={10} strokeWidth={3} className={hideLinked ? '' : 'opacity-0'} />
          Hide already-linked items
        </button>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-1.5 pb-2">
        <p className="px-1.5 py-1 text-[10px] text-slate-400 uppercase tracking-wider font-bold">
          {blockLink
            ? 'Linking disabled — absorb the fee instead'
            : 'Match inventory'}
        </p>
        <p className="px-1.5 pb-1 text-[10px] text-slate-400">
          {blockLink
            ? `You paid ${formatSignedEUR(-absorbFeeEur)} on this cancelled order. Pick the item you ` +
              `think this really was — the fee gets added to its buy price and it stays available ` +
              `to link once you find the real successful order below.`
            : `Link a bundle to equal-split sell + CSV date onto all parts · or check 2+ items → new sold bundle`}
        </p>
        {blockLink && absorbFeeEur >= 0.01 ? (
          matches.length === 0 ? (
            <p className="px-1.5 py-3 text-center text-[11px] text-slate-400">No close match — search above.</p>
          ) : (
            matches.slice(0, 12).map((hit) => (
              <div
                key={hit.item.id}
                className="mt-0.5 w-full px-1.5 py-1.5 rounded-lg border border-slate-200 hover:border-violet-300 hover:bg-violet-50/50 flex items-start gap-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-bold text-slate-800 truncate">{hit.item.name}</p>
                  <p className="text-[10px] text-slate-500">
                    {hit.item.status} · EK {formatSignedEUR(-(hit.item.buyPrice || 0))}
                    {hasAbsorbedRefundFee(hit.item, row.orderId) ? ' · already absorbed this order' : ''}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busyId != null || hasAbsorbedRefundFee(hit.item, row.orderId)}
                  onClick={() => handleAbsorbFee(hit.item)}
                  className="shrink-0 inline-flex items-center justify-center gap-1 rounded-lg border border-violet-400 bg-violet-600 px-3 py-2 min-h-[34px] text-[11px] font-bold text-white shadow-sm hover:bg-violet-700 disabled:opacity-50"
                >
                  {busyId === hit.item.id ? <Loader2 size={13} className="animate-spin" /> : null}
                  Absorb fee
                </button>
              </div>
            ))
          )
        ) : null}
        {!blockLink && matchTree.length === 0 ? (
          <p className="px-1.5 py-3 text-center text-[11px] text-slate-400">No close match — search or create stub.</p>
        ) : !blockLink ? (
          matchTree.map(({ hit, children }) => {
            const container = hit.item;
            const isContainer = children.length > 0;
            const expanded = isContainer && !collapsedContainers.has(container.id);
            const isPc = Boolean(container.isPC);
            return (
              <div
                key={hit.item.id}
                className={`mb-1.5 overflow-hidden rounded-xl border ${
                  isContainer
                    ? isPc
                      ? 'border-indigo-200 bg-indigo-50/50 shadow-sm'
                      : 'border-violet-200 bg-violet-50/50 shadow-sm'
                    : 'border-transparent'
                }`}
              >
                <div className={`flex items-start gap-0.5 ${isContainer ? 'px-1 pt-1' : ''}`}>
                  {isContainer ? (
                    <button
                      type="button"
                      onClick={() => toggleContainerExpanded(container.id)}
                      className={`mt-2 shrink-0 p-0.5 rounded-md transition-colors ${
                        isPc
                          ? 'text-indigo-600 hover:text-indigo-800 hover:bg-indigo-100/80'
                          : 'text-violet-600 hover:text-violet-800 hover:bg-violet-100/80'
                      }`}
                      title={expanded ? 'Collapse contents' : 'Expand contents'}
                      aria-expanded={expanded}
                    >
                      {expanded ? <ChevronDown size={14} strokeWidth={2.75} /> : <ChevronRight size={14} strokeWidth={2.75} />}
                    </button>
                  ) : (
                    <span className="w-5 shrink-0" aria-hidden />
                  )}
                  <div className="min-w-0 flex-1">
                    <MatchPickerRow
                      item={hit.item}
                      hit={hit}
                      orderDayKey={orderDayKey}
                      sellTotal={sellTotal}
                      busyId={busyId}
                      checked={selectedIds.has(hit.item.id)}
                      onToggleSelected={toggleSelected}
                      onApply={apply}
                      onRecoverPriorSale={onRecoverPriorSale}
                      onSplit={onSplitApply ? setSplitTarget : undefined}
                      onApplyDetectedSplit={onSplitApply ? handleApplyDetectedSplit : undefined}
                    />
                    {isContainer ? (
                      <p className={`px-1.5 pb-1 text-[9px] font-bold uppercase tracking-wider ${isPc ? 'text-indigo-500' : 'text-violet-500'}`}>
                        {children.length} part{children.length === 1 ? '' : 's'} · Link splits sell equally · same CSV date
                      </p>
                    ) : null}
                  </div>
                </div>
                {isContainer && expanded ? (
                  <div
                    className={`mx-1.5 mb-1.5 ml-6 rounded-lg border border-dashed px-1 py-0.5 space-y-0.5 ${
                      isPc
                        ? 'border-indigo-200/80 bg-white/70'
                        : 'border-violet-200/80 bg-white/70'
                    }`}
                  >
                    {children.map((child) => (
                      <MatchPickerRow
                        key={child.id}
                        item={child}
                        nested
                        nestOnly
                        parent={container}
                        orderDayKey={orderDayKey}
                        sellTotal={sellTotal}
                        busyId={busyId}
                        checked={false}
                        onToggleSelected={toggleSelected}
                        onApply={apply}
                        onRecoverPriorSale={onRecoverPriorSale}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })
        ) : null}
        {!blockLink && !alreadyLinked ? (
          <div className="mt-0.5 w-full px-1.5 py-1.5 rounded-lg border border-dashed border-slate-300 hover:border-slate-400 hover:bg-slate-50 flex items-start gap-2">
            <Plus size={14} className="mt-1 text-slate-500 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold text-slate-700">Create item and link</p>
              <p className="text-[11px] text-slate-500 break-words">{stubPreview.name}</p>
              <div className="mt-0.5 flex flex-wrap items-center gap-0.5">
                <Chip tone="amber" title="Stub buy price (50% of sell)">
                  Buy {formatSignedEUR(stubPreview.buyPrice)}
                </Chip>
              </div>
            </div>
            <button
              type="button"
              disabled={busyId != null || sellTotal < 0.01}
              onClick={createStub}
              className="mt-0.5 shrink-0 inline-flex items-center justify-center gap-1 rounded-lg border border-emerald-400 bg-emerald-600 px-3 py-2 min-h-[34px] min-w-[4.75rem] text-[11px] font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
            >
              {busyId === stubPreview.id ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Plus size={13} strokeWidth={2.25} />
              )}
              Create
            </button>
          </div>
        ) : null}
      </div>
      {!blockLink && selectedCount >= 2 ? (
        <div className="shrink-0 border-t border-slate-100 px-3 py-2 bg-indigo-50/80">
          <button
            type="button"
            disabled={busyId != null}
            onClick={applyBundle}
            className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-indigo-300 bg-indigo-600 px-2 py-2 text-[11px] font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {busyId === '__bundle__' ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />}
            Link {selectedCount} as sold bundle
            {perPartSell != null ? (
              <span className="tabular-nums font-semibold opacity-90">· {formatSignedEUR(perPartSell)} each</span>
            ) : null}
          </button>
          <p className="mt-1 text-[10px] text-indigo-800/80 text-center">
            Creates a bundle row · splits buyer total equally · replaces per-item sell prices
          </p>
        </div>
      ) : null}
    </div>
  );

  const splitModal =
    splitTarget && onSplitApply
      ? createPortal(
          <SplitPartsModal
            item={splitTarget}
            items={items}
            onClose={() => setSplitTarget(null)}
            onApply={(updates, deleteIds) => {
              onSplitApply(updates, deleteIds);
              setSplitTarget(null);
            }}
          />,
          document.body
        )
      : null;

  if (isPanel) {
    return (
      <>
        {body}
        {splitModal}
      </>
    );
  }

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[240] flex items-center justify-center bg-slate-900/50 p-3"
        onClick={onClose}
        role="presentation"
      >
        {body}
      </div>
      {splitModal}
    </>,
    document.body
  );
};

export default EbayAbrechnungMatchPicker;
