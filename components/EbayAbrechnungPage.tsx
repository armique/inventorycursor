import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpDown, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronUp, Download, ExternalLink, FileSpreadsheet, Link2, Loader2, Pencil, Plus, RefreshCw, Trash2, Unlink, Upload, X } from 'lucide-react';
import type { InventoryItem, ItemUpdateOptions, TaxMode } from '../types';
import { formatEUR, formatSignedEUR } from '../utils/formatMoney';
import { hasEbaySaleSignals } from '../utils/salePlatform';
import { isRealizedDisposal } from '../utils/itemDisposition';
import { buildEbayOrderUrl, isRealEbayOrderId } from '../utils/sourceLinks';
import {
  shouldSkipForAggregatedSaleLine,
  getSoldContainerDisplayTotals,
} from '../services/financialAggregation';
import { POCKET_PROFIT_TAX_MODE } from '../services/financialAggregation';
import {
  applyEbayTxLabelOverrides,
  buildEbayTxOrderLedgers,
  buildEbayTxRefundNetByOrderId,
  classifyEbayTxOrderRefundState,
  classifyEbayTxType,
  collectEbayTxLabelPrices,
  ebayTxImportedCoverage,
  formatEbayTxDay,
  isEbayTransactionReportText,
  isInventoryProAbrechnungBackupText,
  isEbayTxAdFee,
  mergeEbayTxReports,
  parseEbayTransactionReport,
  summarizeEbayTxOrderLedgers,
  TX_KIND_LABEL,
  summarizeEbayTxRows,
  type EbayTxKind,
  type EbayTxOrderLedger,
  type EbayTxOrderRefundState,
  type EbayTxReport,
  type EbayTxRow,
  type EbayTxSummary,
} from '../utils/ebayTransactionReport';
import {
  loadEbayTransactionLibrary,
  loadEbayTxCloudStats,
  loadEbayTxLabelOverrides,
  type EbayTxCloudStats,
  removeEbayTransactionReport,
  removeEbayTxLabelOverride,
  upsertEbayTransactionReport,
  upsertEbayTxLabelOverride,
  type EbayTxLabelOverride,
} from '../services/ebayTransactionReportStore';
import { mergeDhlLabelPresets, type DhlLabelPreset } from '../utils/dhlLabelPresets';
import { syncNewEbayOrdersOnAppVisit } from '../services/ebayApiOrderSync';
import { backfillEbayOrders, type BackfillProgress } from '../services/ebayOrderBackfill';
import { getSuggestedBackfillRange, loadEbayOrderIndex } from '../services/ebayOrderIndex';
import EbayToolSearchInput from './EbayToolSearchInput';
import EbayAbrechnungMatchPicker from './EbayAbrechnungMatchPicker';
import {
  EBAY_TX_REPORT_UPDATED_EVENT,
  readEbayTxClearedAt,
} from '../services/ebayTransactionReportSync';
import {
  backfillEbayTxLinkedSellDates,
  countEbayTxLinkedSellDateFixes,
} from '../utils/backfillEbayTxLinkedSellDates';
import { findOwnOrderFullRefundReverts } from '../utils/refundFeeAbsorption';
import { downloadEbayTxCsvBackup, saveEbayTxCsvBackupToProject } from '../utils/ebayTxReportCsvExport';
import {
  linkInventoryItemToEbayTx,
  unlinkEbayTxOrderFromInventory,
} from '../utils/linkInventoryItemToEbayTx';
import {
  applyInventoryUpdatesInChunks,
  bulkStripAllEbaySoldLinks,
  countEbayLinkedSoldItems,
  countItemsWithEbayOrderData,
} from '../utils/bulkStripEbayAbrechnungLinks';
import { recoverPriorAbrechnungSale } from '../utils/itemSaleCycle';
import {
  buildEbayTxBulkMatchSuggestionsAsync,
  ebayTxBulkMatchSuggestionsToCsv,
  summarizeEbayTxBulkMatchSuggestions,
  type EbayTxBulkMatchSuggestion,
} from '../utils/ebayTxBulkMatchSuggestions';

type Props = {
  items: InventoryItem[];
  taxMode: TaxMode;
  onUpdate: (items: InventoryItem[], deleteIds?: string[], options?: ItemUpdateOptions) => void;
};

const KIND_TONE: Record<EbayTxKind, string> = {
  order: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  refund: 'bg-red-50 text-red-700 border-red-200',
  case: 'bg-amber-50 text-amber-800 border-amber-200',
  dispute: 'bg-rose-50 text-rose-700 border-rose-200',
  label: 'bg-orange-50 text-orange-800 border-orange-200',
  other_fee: 'bg-violet-50 text-violet-800 border-violet-200',
  payout: 'bg-slate-100 text-slate-700 border-slate-200',
  hold: 'bg-sky-50 text-sky-800 border-sky-200',
  transfer: 'bg-slate-50 text-slate-600 border-slate-200',
  adjustment: 'bg-indigo-50 text-indigo-800 border-indigo-200',
  purchase: 'bg-stone-50 text-stone-700 border-stone-200',
  other: 'bg-slate-50 text-slate-500 border-slate-200',
};

function amountClass(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || Math.abs(n) < 0.005) return 'text-slate-400';
  return 'text-slate-900';
}

/** Fees and costs (FVF, ads, label) — violet when deducted. */
function deductionClass(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || Math.abs(n) < 0.005) return 'text-slate-400';
  return n < 0 ? 'text-violet-700' : 'text-slate-900';
}

/** Pocket — red only when zero or negative. */
function pocketClass(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return 'text-slate-400';
  if (n <= 0.005) return 'text-red-600';
  return 'text-slate-900';
}

function moneyClass(n: number | null | undefined): string {
  return amountClass(n);
}

function formatSigned(n: number | null | undefined): string {
  return formatSignedEUR(n);
}

/** Aligned − + € amount for table cells (minus stays on the value baseline). */
function SignedEURCell({ n, fallback = '—' }: { n: number | null | undefined; fallback?: string }) {
  if (n == null || !Number.isFinite(n)) return <>{fallback}</>;
  const negative = n < 0;
  return (
    <span className="inline-flex items-baseline tabular-nums leading-none">
      <span className="w-[0.55em] shrink-0 text-right">{negative ? '−' : ''}</span>
      <span>€{formatEUR(Math.abs(n))}</span>
    </span>
  );
}

/** Short query to find a later resale of the same product in Bestellungen. */
function resaleSearchHint(title: string): string {
  const model = title.match(/\b[A-Za-z]{0,3}\d{2,4}[A-Za-z]{0,4}\b/)?.[0];
  if (model && model.length >= 3) return model;
  const words = title.split(/\s+/).filter((w) => w.length > 2 && !/^(EU|mit|und|für|the|and|for)$/i.test(w));
  return words.slice(0, 3).join(' ') || title.slice(0, 40);
}

const PAGE_SIZE = 80;
const OVERVIEW_STORAGE_KEY = 'ebay-abrechnung-overview-open';

/** Fixed component types offered as filter pills — subCategory matches classifyAbrechnungRowComponent's output. */
type ComponentPinDef = { id: string; label: string; subCategory: string };
const COMPONENT_PIN_CATALOG: ComponentPinDef[] = [
  { id: 'gpu', label: 'GPU', subCategory: 'Graphics Cards' },
  { id: 'cpu', label: 'CPU', subCategory: 'Processors' },
  { id: 'mobo', label: 'Motherboards', subCategory: 'Motherboards' },
  { id: 'ram', label: 'RAM', subCategory: 'RAM' },
  { id: 'storage', label: 'SSD/HDD', subCategory: 'Storage (SSD/HDD)' },
  { id: 'psu', label: 'PSU', subCategory: 'Power Supplies' },
  { id: 'case', label: 'Cases', subCategory: 'Cases' },
  { id: 'cooling', label: 'Cooling', subCategory: 'Cooling' },
  { id: 'pc', label: 'PC', subCategory: 'Custom Built PC' },
];
const DEFAULT_COMPONENT_PIN_IDS = ['gpu', 'cpu', 'ram', 'mobo', 'storage'];

// Same signal words as utils/itemCategoryDetect.ts's inferCategoryFromName, but applied
// differently: a full-PC listing title often mentions its CPU/GPU/RAM together (e.g.
// "Ryzen 3700X - X570 Gaming Edge - RTX 4070 - 16GB DDR4"), which would trip the GPU pin
// under a first-match-wins heuristic. Here every category is tested and a title only
// counts as that single component when exactly one category matches — two or more
// hardware signals (or an explicit "PC"/"bundle" word) means it's a build, not a
// standalone part, and it falls out of every component pin (only the PC pin catches it).
const ABRECHNUNG_PC_RE = /\b(pc|gaming pc|custom build|bundle)\b/i;
const ABRECHNUNG_COMPONENT_PATTERNS: { subCategory: string; re: RegExp }[] = [
  { subCategory: 'Graphics Cards', re: /(rtx|gtx|radeon|rx\s?\d{3,5}|quadro|tesla|firepro|nvidia\s+[qkmt]|graphics card|grafikkarte)/i },
  { subCategory: 'Processors', re: /(intel core|ryzen|threadripper|cpu|prozessor)/i },
  {
    subCategory: 'Motherboards',
    re: /\b(mainboard|motherboard|mobo|chipset|form\s*factor|io[\s-]*shield|(?:a|b|h|x|z)\d{2,4}[a-z0-9-]*)\b/i,
  },
  {
    subCategory: 'RAM',
    re: /(ddr[2345]|ram\b|memory\b|\d+x\d+\s*gb|12800u|10600u|1333u|2rx8|1rx8|jedec|hynix|samsung m\d|kingston khx|sk hynix)/i,
  },
  { subCategory: 'Storage (SSD/HDD)', re: /(ssd|hdd|nvme|m\.2)/i },
  { subCategory: 'Power Supplies', re: /(netzteil|power supply|psu|watt|80\+)/i },
  { subCategory: 'Cases', re: /(geh[aä]use|case|micro-atx|matx|atx case)/i },
  { subCategory: 'Cooling', re: /(aio|k[uü]hler|cooler|liquid freezer|fan|l[uü]fter|120mm|140mm)/i },
];

function classifyAbrechnungRowComponent(title: string): string {
  const n = title.toLowerCase();
  if (ABRECHNUNG_PC_RE.test(n)) return 'Custom Built PC';
  const matches = ABRECHNUNG_COMPONENT_PATTERNS.filter((p) => p.re.test(n));
  if (matches.length === 1) return matches[0].subCategory;
  if (matches.length > 1) return 'Custom Built PC';
  return 'Spare Parts';
}
const COMPONENT_PINS_STORAGE_KEY = 'ebay-abrechnung-component-pins';

function readComponentPinIds(): string[] {
  try {
    const stored = localStorage.getItem(COMPONENT_PINS_STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        const valid = parsed.filter(
          (id): id is string => typeof id === 'string' && COMPONENT_PIN_CATALOG.some((p) => p.id === id)
        );
        if (valid.length) return valid;
      }
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_COMPONENT_PIN_IDS;
}

/** Add/remove which component types show as filter pills — fixed catalog, no category settings needed. */
const ComponentPinPickerModal: React.FC<{
  activeIds: string[];
  onToggle: (id: string) => void;
  onClose: () => void;
}> = ({ activeIds, onToggle, onClose }) => {
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/60 backdrop-blur-md p-4 animate-in fade-in"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="bg-white w-full max-w-xs rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Component filter pills"
      >
        <div className="p-4 border-b border-slate-100 flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-black text-slate-900">Component pills</h3>
            <p className="text-xs text-slate-500 mt-0.5">Detected from the order title — same guess as Inventory.</p>
          </div>
          <button type="button" onClick={onClose} className="p-1.5 rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X size={16} />
          </button>
        </div>
        <div className="p-2 max-h-[60vh] overflow-y-auto">
          {COMPONENT_PIN_CATALOG.map((pin) => {
            const on = activeIds.includes(pin.id);
            return (
              <button
                key={pin.id}
                type="button"
                onClick={() => onToggle(pin.id)}
                className="w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl hover:bg-slate-50 text-left"
              >
                <span className="text-sm font-semibold text-slate-800">{pin.label}</span>
                <span
                  className={`h-5 w-5 shrink-0 rounded-md border flex items-center justify-center ${
                    on ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-300 text-transparent'
                  }`}
                >
                  <Check size={12} strokeWidth={3} />
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

function readOverviewOpen(): boolean {
  try {
    const stored = localStorage.getItem(OVERVIEW_STORAGE_KEY);
    if (stored === '0') return false;
    if (stored === '1') return true;
  } catch {
    /* ignore */
  }
  return true;
}

type EbayTxSortKey =
  | 'date'
  | 'type'
  | 'order'
  | 'buyer'
  | 'title'
  | 'inv'
  | 'item'
  | 'ship'
  | 'fvf'
  | 'ads'
  | 'label'
  | 'gross'
  | 'pocket';

type EbayTxSort = { key: EbayTxSortKey; dir: 'asc' | 'desc' };

function txSortValue(
  row: EbayTxRow,
  key: EbayTxSortKey,
  ledgers: Map<string, EbayTxOrderLedger>,
  linkedByOrder: Map<string, InventoryItem>
): string | number {
  const isOrder = row.kind === 'order';
  const ledger = row.orderId ? ledgers.get(row.orderId) || null : null;
  switch (key) {
    case 'date':
      return row.createdSort || row.createdAt || '';
    case 'type':
      return (row.typeRaw || row.kind || '').toLowerCase();
    case 'order':
      return (row.orderId || '').toLowerCase();
    case 'buyer':
      return (row.buyerUsername || row.buyerName || '').toLowerCase();
    case 'title':
      return (row.title || row.description || row.reference || '').toLowerCase();
    case 'inv':
      return (
        row.orderId ? linkedByOrder.get(row.orderId.trim().toLowerCase())?.name || '' : ''
      ).toLowerCase();
    case 'item':
      return row.itemSubtotalEur ?? 0;
    case 'ship':
      return row.shippingEur ?? 0;
    case 'fvf':
      return isOrder ? ledger?.fvfEur ?? 0 : 0;
    case 'ads':
      return isOrder ? ledger?.adsEur ?? 0 : isEbayTxAdFee(row) ? row.netEur ?? 0 : 0;
    case 'label':
      return isOrder ? ledger?.labelEur ?? 0 : row.kind === 'label' ? row.netEur ?? 0 : 0;
    case 'gross':
      return row.grossEur ?? 0;
    case 'pocket': {
      if (isOrder) return ledger?.pocketEur ?? row.netEur ?? 0;
      const rolled = !!row.orderId && (row.kind === 'label' || isEbayTxAdFee(row));
      return rolled ? 0 : row.netEur ?? 0;
    }
    default:
      return '';
  }
}

function compareTxSortValues(a: string | number, b: string | number): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

function mergeReportsPreservingLocalRows(prev: EbayTxReport[], incoming: EbayTxReport[]): EbayTxReport[] {
  if (!incoming.length) {
    if (readEbayTxClearedAt()) return [];
    return prev;
  }
  const prevById = new Map(prev.map((r) => [r.meta.id, r]));
  return incoming
    .map((report) => {
      if (report.rows?.length) return report;
      const old = prevById.get(report.meta.id);
      return old?.rows?.length ? { ...report, rows: old.rows } : report;
    })
    .sort((a, b) => (a.meta.id || '').localeCompare(b.meta.id || ''));
}

function resolveEbayTxViewReport(
  reports: EbayTxReport[],
  selectedId: string,
  cloudStats: EbayTxCloudStats | null
): EbayTxReport | null {
  if (!reports.length) {
    if (readEbayTxClearedAt()) return null;
    if (!cloudStats?.combinedSummary) return null;
    return {
      meta: {
        id: 'cloud',
        seller: '',
        startDate: cloudStats.coverage?.from || '',
        endDate: cloudStats.coverage?.to || '',
        fileName: 'Firebase',
        importedAt: cloudStats.updatedAt || new Date().toISOString(),
      },
      rows: [],
      summary: cloudStats.combinedSummary as EbayTxSummary,
    };
  }
  if (selectedId !== 'all') {
    return reports.find((r) => r.meta.id === selectedId) || reports[0] || null;
  }
  if (reports.length === 1) return reports[0];
  if (reports.every((r) => !(r.rows?.length))) {
    const first = reports[0];
    const last = reports[reports.length - 1];
    return {
      meta: {
        id: 'all',
        seller: reports.find((r) => r.meta.seller)?.meta.seller || '',
        startDate: first.meta.startDate,
        endDate: last.meta.endDate,
        fileName: reports.map((r) => r.meta.fileName).join(' + '),
        importedAt: reports.map((r) => r.meta.importedAt).sort().slice(-1)[0] || new Date().toISOString(),
      },
      rows: [],
      summary: (cloudStats?.combinedSummary as EbayTxSummary) || first.summary,
    };
  }
  return mergeEbayTxReports(reports);
}

const EbayAbrechnungPage: React.FC<Props> = ({ items, taxMode, onUpdate }) => {
  const [reports, setReports] = useState<EbayTxReport[]>([]);
  const [selectedId, setSelectedId] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<EbayTxKind | 'all' | 'refunded' | 'matcher'>('order');
  const [hideLinked, setHideLinked] = useState(false);
  const [componentPinIds, setComponentPinIds] = useState<string[]>(readComponentPinIds);
  const [activeComponentPin, setActiveComponentPin] = useState<string | null>(null);
  const [showComponentPinPicker, setShowComponentPinPicker] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(COMPONENT_PINS_STORAGE_KEY, JSON.stringify(componentPinIds));
    } catch {
      /* ignore */
    }
  }, [componentPinIds]);

  const toggleComponentPinVisible = useCallback((id: string) => {
    setComponentPinIds((prev) => {
      if (prev.includes(id)) {
        setActiveComponentPin((active) => (active === id ? null : active));
        return prev.filter((p) => p !== id);
      }
      return [...prev, id];
    });
  }, []);
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<EbayTxSort | null>(null);
  const [labelOverrides, setLabelOverrides] = useState<Record<string, EbayTxLabelOverride>>({});
  const [cloudStats, setCloudStats] = useState<EbayTxCloudStats | null>(null);
  const [matchRow, setMatchRow] = useState<EbayTxRow | null>(null);
  const [linkNote, setLinkNote] = useState<string | null>(null);
  const [ebaySyncBusy, setEbaySyncBusy] = useState(false);
  const [ebaySyncNote, setEbaySyncNote] = useState<{ kind: 'ok' | 'error'; text: string; hint?: string } | null>(null);
  const [backfillBusy, setBackfillBusy] = useState(false);
  const [backfillNote, setBackfillNote] = useState<string | null>(null);
  const backfillCancelRef = useRef<{ cancelled: boolean }>({ cancelled: false });
  const [overviewOpen, setOverviewOpen] = useState(readOverviewOpen);
  const [suggestions, setSuggestions] = useState<EbayTxBulkMatchSuggestion[] | null>(null);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const [matcherProgress, setMatcherProgress] = useState<{ done: number; total: number } | null>(null);
  const [matcherConfFilter, setMatcherConfFilter] = useState<'all' | EbayTxBulkMatchSuggestion['confidence']>('all');
  const [matcherPage, setMatcherPage] = useState(0);
  const matcherAutoBuiltRef = useRef(false);
  const matcherBuildAbortRef = useRef<AbortController | null>(null);
  const sellDateAutoFixKeyRef = useRef<string | null>(null);
  const refundRevertAutoFixKeyRef = useRef<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  useEffect(() => {
    const w = window as unknown as {
      __unlinkAllEbaySold?: () => Promise<Record<string, unknown>>;
      __countEbayOrderLinks?: () => Record<string, unknown>;
    };
    w.__countEbayOrderLinks = () => {
      const list = itemsRef.current;
      return {
        linkedSold: countEbayLinkedSoldItems(list),
        ...countItemsWithEbayOrderData(list),
        totalItems: list.length,
      };
    };
    w.__unlinkAllEbaySold = async () => {
      const list = itemsRef.current;
      const before = {
        linkedSold: countEbayLinkedSoldItems(list),
        ...countItemsWithEbayOrderData(list),
      };
      if (!before.linkedSold && !before.soldWithAnyOrderData && !before.withOrderId) {
        return { ok: true, skipped: true, before, after: before };
      }
      setBusy(true);
      setLinkNote(`Unlinking ${before.linkedSold || before.soldWithAnyOrderData} eBay-linked sold item(s)…`);
      try {
        (window as unknown as { __inventoryDev?: { suppressCloudPull?: (ms?: number) => void; flushCloudNow?: () => Promise<void> } })
          .__inventoryDev?.suppressCloudPull?.(90000);
        const result = bulkStripAllEbaySoldLinks(list);
        const patchOptions = {
          skipFieldPreserve: true,
          skipMembershipSync: true,
          skipContainerSync: true,
          skipContainerSaleMetaSync: true,
          skipUndo: true,
          flushCloud: true,
          actionNote: {
            action: 'Unlink all eBay sold',
            details: `${result.strippedItemCount} item(s), ${result.orderIds.length} order(s), eBay order fields cleared`,
          },
        } as const;
        if (result.updates.length <= 600) {
          onUpdate(result.updates, result.deleteIds, patchOptions);
        } else {
          await applyInventoryUpdatesInChunks(onUpdate, result.updates, result.deleteIds, patchOptions);
        }
        // Re-run once more in case cloud snapshot or container sync re-applied stale order fields.
        await new Promise<void>((resolve) => window.setTimeout(resolve, 3000));
        const second = bulkStripAllEbaySoldLinks(itemsRef.current);
        if (second.updates.length) {
          onUpdate(second.updates, second.deleteIds.length ? second.deleteIds : undefined, {
            ...patchOptions,
            actionNote: {
              action: 'Unlink all eBay sold',
              details: `Pass 2 · ${second.updates.length} leftover row(s) scrubbed`,
            },
          });
        }
        await new Promise<void>((resolve) => window.setTimeout(resolve, 5000));
        await (
          window as unknown as { __inventoryDev?: { flushCloudNow?: () => Promise<void> } }
        ).__inventoryDev?.flushCloudNow?.();
        await new Promise<void>((resolve) => window.setTimeout(resolve, 3000));
        const patched = new Map(list.map((item) => [item.id, item]));
        for (const id of result.deleteIds) patched.delete(id);
        for (const patch of result.updates) patched.set(patch.id, patch);
        const afterList = [...patched.values()];
        const after = {
          linkedSold: countEbayLinkedSoldItems(afterList),
          ...countItemsWithEbayOrderData(afterList),
        };
        setLinkNote(
          `Unlinked ${result.strippedItemCount} item(s) · ${result.orderIds.length} order(s) · sell cells cleared`
        );
        setSuggestions(null);
        return {
          ok: true,
          strippedItemCount: result.strippedItemCount,
          orderCount: result.orderIds.length,
          deleteCount: result.deleteIds.length,
          before,
          after,
        };
      } finally {
        setBusy(false);
      }
    };
    return () => {
      delete w.__unlinkAllEbaySold;
      delete w.__countEbayOrderLinks;
    };
  }, [onUpdate]);

  const toggleOverview = useCallback(() => {
    setOverviewOpen((open) => {
      const next = !open;
      try {
        localStorage.setItem(OVERVIEW_STORAGE_KEY, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const reloadLocal = useCallback(async () => {
    const [stored, labels, stats] = await Promise.all([
      loadEbayTransactionLibrary(),
      loadEbayTxLabelOverrides(),
      loadEbayTxCloudStats(),
    ]);
    setReports((prev) => mergeReportsPreservingLocalRows(prev, stored.reports));
    setLabelOverrides(labels);
    setCloudStats(stats);
    setSelectedId((id) => {
      if (id !== 'all' && stored.reports.some((r) => r.meta.id === id)) return id;
      return 'all';
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void reloadLocal()
      .then(() => {
        if (!cancelled) setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load saved reports.');
        setLoading(false);
      });
    const onUpdated = () => {
      void reloadLocal();
    };
    window.addEventListener(EBAY_TX_REPORT_UPDATED_EVENT, onUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener(EBAY_TX_REPORT_UPDATED_EVENT, onUpdated);
    };
  }, [reloadLocal]);

  /**
   * One-time (or resumable) full-history pull straight from the eBay API — every order the
   * account has ever had, not just the last ~30 days runEbaySync checks. Chunked in 45-day
   * windows so a slow/failed range doesn't lose earlier progress.
   *
   * getSuggestedBackfillRange is meant for resuming an ALREADY-STARTED full backfill — it
   * anchors on whatever's newest in the cache, which the small automatic 30-day sync
   * (runEbaySync, runs on every page visit) already touches. Using it here made a first-ever
   * click think almost all history was covered and only check a single day (0 orders, 0 new —
   * exactly the bug this comment is replacing). So: the true start date only gets used once,
   * tracked by whether a full backfill has ever actually completed from it; every run after
   * that resumes properly via getSuggestedBackfillRange like it's supposed to.
   */
  const FULL_HISTORY_START = '2020-01-01';
  const runFullBackfill = useCallback(() => {
    setBackfillBusy(true);
    setBackfillNote(null);
    backfillCancelRef.current = { cancelled: false };
    const today = new Date().toISOString().slice(0, 10);
    const apiBackfillMeta = loadEbayOrderIndex().meta.apiBackfill;
    const fullHistoryAlreadyBuilt = Boolean(
      apiBackfillMeta?.isComplete && apiBackfillMeta.fromDate && apiBackfillMeta.fromDate <= FULL_HISTORY_START
    );
    const range = fullHistoryAlreadyBuilt
      ? getSuggestedBackfillRange(FULL_HISTORY_START, today)
      : { from: FULL_HISTORY_START, to: today };
    void backfillEbayOrders(
      range.from,
      range.to,
      (p: BackfillProgress) => {
        setBackfillNote(`Fetching ${p.rangeLabel} — chunk ${p.chunkIndex + 1}/${p.chunkCount} · ${p.ordersFetchedTotal} orders so far`);
      },
      backfillCancelRef.current
    )
      .then((result) => {
        if (result.cancelled) {
          setBackfillNote('Cancelled.');
          return;
        }
        if (result.error) {
          setBackfillNote(`Stopped early: ${result.error} (progress was saved — click again to resume from here)`);
          return;
        }
        setBackfillNote(
          `Done — ${result.ordersFetched} orders fetched from the API, ${result.added} new, ${result.merged} merged into existing records.`
        );
      })
      .catch((e) => setBackfillNote(e instanceof Error ? e.message : 'Backfill failed'))
      .finally(() => setBackfillBusy(false));
  }, []);

  /** Pull recent orders via the OAuth API and add any new ones as Bestellung rows,
   *  ready to link. Runs once on visiting this page, and again on demand from the
   *  button — this used to be a global banner on every panel page, now it only
   *  happens here, where a new order can actually be reviewed and linked. */
  const runEbaySync = useCallback((force?: boolean) => {
    setEbaySyncBusy(true);
    void syncNewEbayOrdersOnAppVisit({ force })
      .then((outcome) => {
        if (outcome.status === 'ok') {
          setEbaySyncNote(
            outcome.added > 0
              ? { kind: 'ok', text: `${outcome.added} new eBay order${outcome.added === 1 ? '' : 's'} added — ready to link below.`, hint: outcome.feesWarning }
              : { kind: 'ok', text: `eBay orders up to date (${outcome.total} synced from the API).`, hint: outcome.feesWarning }
          );
        } else if (outcome.status === 'error') {
          setEbaySyncNote({ kind: 'error', text: outcome.error || 'eBay order sync failed', hint: outcome.hint });
        }
      })
      .catch((e) => setEbaySyncNote({ kind: 'error', text: e instanceof Error ? e.message : 'eBay order sync failed' }))
      .finally(() => setEbaySyncBusy(false));
  }, []);

  // Auto-runs again on visiting this page — but now gated on `loading` being false, not on
  // mount. The old version fired immediately alongside the CSV library load: on a device whose
  // local storage was just cleared/still populating, the API sync could read the CSV report
  // list before it finished loading, see nothing covered yet, and dump the ENTIRE order
  // history in as "new" api-sync rows — duplicating every order already in the CSVs (this is
  // what inflated a real €64.8k report into a fake €131.2k one). Waiting for `loading` to
  // actually turn false — the same signal the manual button's disabled state already uses —
  // means it only ever runs once CSV data is confirmed loaded, so it can correctly tell "new"
  // orders from ones already covered.
  const autoSyncRanRef = useRef(false);
  useEffect(() => {
    if (loading || autoSyncRanRef.current) return;
    autoSyncRanRef.current = true;
    runEbaySync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const hasImportedCsv = useMemo(
    () => reports.some((r) => (r.rows?.length ?? 0) > 0),
    [reports]
  );

  const coverage = useMemo(() => {
    if (readEbayTxClearedAt() && !hasImportedCsv) return null;
    return ebayTxImportedCoverage(reports) || cloudStats?.coverage || null;
  }, [reports, cloudStats, hasImportedCsv]);

  const report = useMemo(
    () => resolveEbayTxViewReport(reports, selectedId, cloudStats),
    [reports, selectedId, cloudStats]
  );

  const displayReport = useMemo(() => {
    if (!report) return null;
    const csvRows = (report.rows || []).filter((row) => row.source !== 'inventory');
    if (!csvRows.length) {
      if (!hasImportedCsv) return null;
      return { ...report, rows: [], summary: report.summary };
    }
    return { ...report, rows: csvRows, summary: summarizeEbayTxRows(csvRows) };
  }, [report, hasImportedCsv]);

  const inventoryOnlyRowCount = useMemo(() => {
    if (!displayReport?.rows?.length) return 0;
    return displayReport.rows.filter((row) => row.source === 'inventory').length;
  }, [displayReport]);

  const importText = useCallback(async (text: string, fileName: string) => {
    if (isInventoryProAbrechnungBackupText(text)) {
      throw new Error(
        `${fileName} is an app backup export, not an eBay Transaktionsbericht. Download fresh CSVs from eBay Seller Hub → Payments → Berichte.`
      );
    }
    if (!isEbayTransactionReportText(text)) {
      throw new Error('This is not an eBay Transaktionsbericht. Export Payments → Berichte → Transaktionsberichte.');
    }
    const next = parseEbayTransactionReport(text, fileName);
    const library = await upsertEbayTransactionReport(next);
    setReports(library.reports);
    setSelectedId(library.reports.length > 1 ? 'all' : next.meta.id);
    setKindFilter('order');
    setSuggestions(null);
    matcherAutoBuiltRef.current = false;
    setSearch('');
    setPage(0);
    void import('../services/ebayTxDailyExport').then((mod) =>
      mod.scheduleEbayTxDailyCsvExport({ force: true })
    );
  }, []);

  const onFiles = useCallback(
    async (files: FileList | File[] | null) => {
      const list = files ? [...files] : [];
      if (!list.length) return;
      setBusy(true);
      setError(null);
      try {
        for (const file of list) {
          const text = await file.text();
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
          await importText(text, file.name);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not read that CSV.');
      } finally {
        setBusy(false);
      }
    },
    [importText]
  );

  const ledgers = useMemo(
    () => applyEbayTxLabelOverrides(buildEbayTxOrderLedgers(displayReport?.rows || []), labelOverrides),
    [displayReport, labelOverrides]
  );
  const refundNetByOrderId = useMemo(
    () => buildEbayTxRefundNetByOrderId(displayReport?.rows || []),
    [displayReport]
  );
  const refundStateByRowId = useMemo(() => {
    const map = new Map<string, EbayTxOrderRefundState>();
    for (const row of displayReport?.rows || []) {
      if (row.kind !== 'order') continue;
      const refundNet = row.orderId ? refundNetByOrderId.get(row.orderId) || 0 : 0;
      const ledger = row.orderId ? ledgers.get(row.orderId) || null : null;
      map.set(row.id, classifyEbayTxOrderRefundState(ledger, row, refundNet));
    }
    return map;
  }, [displayReport, ledgers, refundNetByOrderId]);
  const refundedOrderStats = useMemo(() => {
    let count = 0;
    let pocketEur = 0;
    for (const row of displayReport?.rows || []) {
      if (row.kind !== 'order') continue;
      const state = refundStateByRowId.get(row.id) || 'none';
      if (state === 'none') continue;
      count += 1;
      const ledger = row.orderId ? ledgers.get(row.orderId) || null : null;
      pocketEur += ledger?.pocketEur ?? row.netEur ?? 0;
    }
    return { count, pocketEur };
  }, [displayReport, ledgers, refundStateByRowId]);

  // Title → guessed component subCategory, cached once per row set. See
  // classifyAbrechnungRowComponent above: a title with 2+ hardware signals (or an explicit
  // "PC"/"bundle" word) is a build and only counts toward the PC pin, never a single-part pin.
  const rowComponentSubCategoryById = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of displayReport?.rows || []) {
      if (row.kind !== 'order') continue;
      const title = (row.title || row.description || '').trim();
      if (!title) continue;
      map.set(row.id, classifyAbrechnungRowComponent(title));
    }
    return map;
  }, [displayReport]);

  const preComponentFiltered = useMemo(() => {
    if (!displayReport || kindFilter === 'matcher') return [];
    const q = search.trim().toLowerCase();
    return displayReport.rows.filter((row) => {
      if (kindFilter === 'refunded') {
        if (row.kind !== 'order') return false;
        if ((refundStateByRowId.get(row.id) || 'none') === 'none') return false;
      } else if (kindFilter !== 'all' && row.kind !== kindFilter) return false;
      if (!q) return true;
      return [
        row.orderId,
        row.buyerUsername,
        row.buyerName,
        row.title,
        row.description,
        row.reference,
        row.typeRaw,
        row.listingId,
      ]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [displayReport, kindFilter, search, refundStateByRowId]);

  /** How many rows in the current tab/search match each component pill — shown as the pill's count. */
  const componentPinCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of preComponentFiltered) {
      const sub = rowComponentSubCategoryById.get(row.id);
      if (!sub) continue;
      for (const pin of COMPONENT_PIN_CATALOG) {
        if (pin.subCategory === sub) counts.set(pin.id, (counts.get(pin.id) || 0) + 1);
      }
    }
    return counts;
  }, [preComponentFiltered, rowComponentSubCategoryById]);

  const filtered = useMemo(() => {
    const activePin = activeComponentPin ? COMPONENT_PIN_CATALOG.find((p) => p.id === activeComponentPin) : null;
    if (!activePin) return preComponentFiltered;
    return preComponentFiltered.filter((row) => rowComponentSubCategoryById.get(row.id) === activePin.subCategory);
  }, [preComponentFiltered, activeComponentPin, rowComponentSubCategoryById]);
  const livePocket = useMemo(() => summarizeEbayTxOrderLedgers(ledgers), [ledgers]);
  const pocket = displayReport?.rows?.length ? livePocket : cloudStats?.pocket || livePocket;
  const labelChoices = useMemo(
    () => mergeDhlLabelPresets(collectEbayTxLabelPrices(displayReport?.rows || [])),
    [displayReport]
  );

  const setOrderLabel = useCallback(async (orderId: string, amountEur: number, name?: string) => {
    setLabelOverrides(await upsertEbayTxLabelOverride(orderId, amountEur, name));
  }, []);

  const clearOrderLabel = useCallback(async (orderId: string) => {
    setLabelOverrides(await removeEbayTxLabelOverride(orderId));
  }, []);

  const linkedByOrder = useMemo(() => {
    const map = new Map<string, InventoryItem>();
    const linkScore = (item: InventoryItem) =>
      (item.isBundle || item.isPC ? 4 : 0) + (item.parentContainerId ? 0 : 2);
    for (const item of items) {
      const orderId = (item.ebayOrderId || '').trim();
      if (!orderId) continue;
      const key = orderId.toLowerCase();
      const existing = map.get(key);
      if (!existing || linkScore(item) > linkScore(existing)) {
        map.set(key, item);
      }
    }
    return map;
  }, [items]);

  // Refunded/cancelled orders whose fee has been manually absorbed into some item's buy
  // price (utils/refundFeeAbsorption.ts) — the item stays a "candidate" awaiting relink to
  // its actual successful order. Keyed the same way as linkedByOrder for the row lookup.
  const feeAbsorbedByOrder = useMemo(() => {
    const map = new Map<string, InventoryItem>();
    for (const item of items) {
      for (const orderId of item.pendingRefundFeeOrderIds || []) {
        map.set(orderId.trim().toLowerCase(), item);
      }
    }
    return map;
  }, [items]);

  const sellDateFixCount = useMemo(
    () => (report?.rows?.length ? countEbayTxLinkedSellDateFixes(items, report.rows) : 0),
    [items, report]
  );

  const rowIsLinked = useCallback(
    (row: EbayTxRow) => Boolean(row.orderId && linkedByOrder.has(row.orderId.trim().toLowerCase())),
    [linkedByOrder]
  );

  const linkedInFilteredCount = useMemo(
    () => filtered.reduce((n, row) => n + (rowIsLinked(row) ? 1 : 0), 0),
    [filtered, rowIsLinked]
  );

  const visibleRows = useMemo(
    () => (hideLinked ? filtered.filter((row) => !rowIsLinked(row)) : filtered),
    [filtered, hideLinked, rowIsLinked]
  );

  const sortedRows = useMemo(() => {
    if (!sort) return visibleRows;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...visibleRows].sort((a, b) => {
      const cmp = compareTxSortValues(
        txSortValue(a, sort.key, ledgers, linkedByOrder),
        txSortValue(b, sort.key, ledgers, linkedByOrder)
      );
      if (cmp !== 0) return cmp * dir;
      return a.id.localeCompare(b.id);
    });
  }, [visibleRows, sort, ledgers, linkedByOrder]);

  useEffect(() => {
    setPage(0);
  }, [kindFilter, search, sort, hideLinked, activeComponentPin]);

  const pageCount = Math.max(1, Math.ceil(sortedRows.length / PAGE_SIZE));
  const pageRows = sortedRows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);

  const toggleSort = useCallback((key: EbayTxSortKey) => {
    setSort((prev) => {
      if (prev?.key === key) return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
      return { key, dir: 'asc' };
    });
  }, []);

  const onSearchResale = useCallback((title: string) => {
    setMatchRow(null);
    setKindFilter('order');
    setSearch(resaleSearchHint(title));
    setPage(0);
  }, []);

  const onBackfillLinkedSellDates = useCallback(() => {
    if (!report?.rows?.length) return;
    const { updates, missingInCsv } = backfillEbayTxLinkedSellDates(items, report.rows);
    if (!updates.length) {
      setLinkNote('All Abrechnung-linked items already use CSV sell dates.');
      return;
    }
    onUpdate(updates, undefined, {
      skipFieldPreserve: true,
      skipMembershipSync: true,
      skipContainerSync: true,
      skipContainerSaleMetaSync: true,
      flushCloud: true,
      actionNote: {
        action: 'Abrechnung sell dates',
        details: `${updates.length} linked item(s) ← CSV order dates`,
      },
    });
    setLinkNote(
      `Updated sell date on ${updates.length} linked item${updates.length === 1 ? '' : 's'} from CSV.` +
        (missingInCsv.length
          ? ` ${missingInCsv.length} linked order${missingInCsv.length === 1 ? '' : 's'} not in this CSV.`
          : '')
    );
  }, [items, onUpdate, report]);

  // CSV Bestellung date is source of truth for every Abrechnung-linked item.
  //
  // `items` and `report` both populate asynchronously on page load (IndexedDB read, then
  // cloud sync merge; CSV/API-sync report rebuild). Reacting the instant they first become
  // non-empty means this can run against a still-partially-hydrated snapshot — computing a
  // "fix" for a row whose real, about-to-arrive data didn't actually need one, then finding
  // the reverse "fix" once hydration finishes a moment later. That's what shows up as this
  // note (and the linked-count nearby) never quite settling across reloads. Debouncing past
  // a quiet period lets the last hydration burst land before we compute/apply anything.
  useEffect(() => {
    if (!report?.rows?.length || !items.length || loading || busy) return;
    const t = setTimeout(() => {
      const { updates } = backfillEbayTxLinkedSellDates(items, report.rows);
      if (!updates.length) return;
      const key = updates
        .map((item) => `${item.id}:${(item.sellDate || '').slice(0, 10)}`)
        .sort()
        .join('|');
      if (sellDateAutoFixKeyRef.current === key) return;
      sellDateAutoFixKeyRef.current = key;
      onUpdate(updates, undefined, {
        skipFieldPreserve: true,
        skipMembershipSync: true,
        skipContainerSync: true,
        skipContainerSaleMetaSync: true,
        skipUndo: true,
        flushCloud: true,
        actionNote: {
          action: 'Abrechnung sell dates',
          details: `${updates.length} linked item(s) ← CSV order dates (auto)`,
        },
      });
      setLinkNote(
        `Updated sell date on ${updates.length} linked item${updates.length === 1 ? '' : 's'} from CSV.`
      );
    }, 800);
    return () => clearTimeout(t);
  }, [busy, items, loading, onUpdate, report]);

  // Auto-revert: an item's OWN order comes back fully refunded — unambiguous (it's that
  // exact item's sale, no candidate to pick), so this applies without a confirm step. Same
  // hydration-race debounce as the sell-date effect above; see that comment for why.
  useEffect(() => {
    if (!report?.rows?.length || !items.length || loading || busy) return;
    const t = setTimeout(() => {
      const updates = findOwnOrderFullRefundReverts(items, ledgers);
      if (!updates.length) return;
      const key = updates.map((item) => `${item.id}:${item.buyPrice}`).sort().join('|');
      if (refundRevertAutoFixKeyRef.current === key) return;
      refundRevertAutoFixKeyRef.current = key;
      // Unlike the sell-date/matcher auto-fixes above, this touches buyPrice and status —
      // keep it undoable (no skipUndo) since it's a real financial mutation, even though it
      // applies without a confirm click.
      onUpdate(updates, undefined, {
        skipFieldPreserve: true,
        skipMembershipSync: true,
        skipContainerSync: true,
        skipContainerSaleMetaSync: true,
        flushCloud: true,
        actionNote: {
          action: 'Abrechnung refund revert',
          details: `${updates.length} item(s) reverted to stock — order fully refunded (auto)`,
        },
      });
      setLinkNote(
        `Reverted ${updates.length} item${updates.length === 1 ? '' : 's'} to stock — order fully refunded (fee added to buy price).`
      );
    }, 800);
    return () => clearTimeout(t);
  }, [busy, items, ledgers, loading, onUpdate, report]);

  const matcherOrderCount = useMemo(() => {
    if (!report?.rows?.length) return 0;
    const seen = new Set<string>();
    for (const row of report.rows) {
      if (row.kind !== 'order' || !(row.orderId || '').trim()) continue;
      seen.add(row.orderId.trim());
    }
    return seen.size;
  }, [report]);

  const matcherStats = useMemo(
    () => (suggestions?.length ? summarizeEbayTxBulkMatchSuggestions(suggestions) : null),
    [suggestions]
  );

  const filteredSuggestions = useMemo(() => {
    if (!suggestions?.length) return [];
    if (matcherConfFilter === 'all') return suggestions;
    return suggestions.filter((s) => s.confidence === matcherConfFilter);
  }, [suggestions, matcherConfFilter]);

  const matcherPageCount = Math.max(1, Math.ceil(filteredSuggestions.length / PAGE_SIZE));
  const matcherPageRows = filteredSuggestions.slice(
    matcherPage * PAGE_SIZE,
    matcherPage * PAGE_SIZE + PAGE_SIZE
  );

  useEffect(() => {
    setMatcherPage(0);
  }, [matcherConfFilter, suggestions?.length]);

  const onBuildSuggestions = useCallback(async () => {
    if (!report?.rows?.length) {
      setLinkNote('Import CSV files first, then open the Matcher tab.');
      return;
    }
    matcherBuildAbortRef.current?.abort();
    const ac = new AbortController();
    matcherBuildAbortRef.current = ac;
    setSuggestBusy(true);
    setMatcherProgress({ done: 0, total: matcherOrderCount });
    setLinkNote(null);
    try {
      const rows = await buildEbayTxBulkMatchSuggestionsAsync(items, report.rows, ledgers, {
        batchSize: 28,
        signal: ac.signal,
        onProgress: (done, total) => setMatcherProgress({ done, total }),
      });
      if (ac.signal.aborted) return;
      setSuggestions(rows);
      const stats = summarizeEbayTxBulkMatchSuggestions(rows);
      setLinkNote(
        `Matcher: ${stats.total} orders · ${stats.high} high · ${stats.medium} medium · ${stats.low} low · ${stats.linked} linked · ${stats.none} none`
      );
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      setLinkNote(err instanceof Error ? err.message : 'Could not build matcher.');
    } finally {
      if (matcherBuildAbortRef.current === ac) matcherBuildAbortRef.current = null;
      setSuggestBusy(false);
      setMatcherProgress(null);
    }
  }, [items, ledgers, matcherOrderCount, report]);

  useEffect(() => {
    if (!hasImportedCsv) matcherAutoBuiltRef.current = false;
  }, [hasImportedCsv]);

  useEffect(() => {
    (
      window as unknown as {
        __setEbayAbrechnungMatcher?: (rows: EbayTxBulkMatchSuggestion[]) => void;
      }
    ).__setEbayAbrechnungMatcher = (rows) => {
      setSuggestions(rows);
      const stats = summarizeEbayTxBulkMatchSuggestions(rows);
      setLinkNote(
        `Matcher: ${stats.total} orders · ${stats.high} high · ${stats.medium} medium · ${stats.low} low · ${stats.linked} linked · ${stats.none} none`
      );
    };
    return () => {
      delete (
        window as unknown as {
          __setEbayAbrechnungMatcher?: (rows: EbayTxBulkMatchSuggestion[]) => void;
        }
      ).__setEbayAbrechnungMatcher;
    };
  }, []);

  // Same hydration-race guard as the sell-date effect above: wait for a quiet period so the
  // Matcher's "linked" count reflects fully-settled inventory data instead of whatever
  // partial snapshot happened to be in `items` the instant this tab first opened.
  useEffect(() => {
    if (kindFilter !== 'matcher') return;
    if (loading || !report?.rows?.length || !items.length || suggestBusy) return;
    if (suggestions?.length) return;
    if (matcherAutoBuiltRef.current) return;
    const t = setTimeout(() => {
      matcherAutoBuiltRef.current = true;
      void onBuildSuggestions();
    }, 800);
    return () => clearTimeout(t);
  }, [kindFilter, loading, report?.rows?.length, items, suggestBusy, suggestions?.length, onBuildSuggestions]);

  useEffect(() => {
    if (kindFilter === 'matcher') setMatchRow(null);
  }, [kindFilter]);

  useEffect(() => {
    return () => matcherBuildAbortRef.current?.abort();
  }, []);

  const onDownloadSuggestions = useCallback(() => {
    if (!suggestions?.length) return;
    const csv = ebayTxBulkMatchSuggestionsToCsv(suggestions);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ebay-abrechnung-suggested-matches-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [suggestions]);

  const onApplyHighConfidenceSuggestions = useCallback(() => {
    if (!suggestions?.length || !report?.rows?.length) return;
    const byOrder = new Map<string, EbayTxRow>();
    for (const row of report.rows) {
      if (row.kind === 'order' && row.orderId && !byOrder.has(row.orderId)) byOrder.set(row.orderId, row);
    }
    const updates: InventoryItem[] = [];
    let applied = 0;
    for (const sug of suggestions) {
      if (sug.confidence !== 'high' || !sug.suggestedItemId) continue;
      const row = byOrder.get(sug.orderId);
      const item = items.find((i) => i.id === sug.suggestedItemId);
      if (!row || !item) continue;
      updates.push(linkInventoryItemToEbayTx(item, row, ledgers.get(sug.orderId) || null, taxMode));
      applied += 1;
    }
    if (!updates.length) {
      setLinkNote('No high-confidence suggestions to apply.');
      return;
    }
    onUpdate(updates, undefined, {
      skipFieldPreserve: true,
      skipMembershipSync: true,
      skipContainerSync: true,
      flushCloud: true,
      actionNote: {
        action: 'Abrechnung bulk link',
        details: `${applied} high-confidence order(s) → inventory (CSV sell dates)`,
      },
    });
    setLinkNote(`Linked ${applied} high-confidence order${applied === 1 ? '' : 's'} with CSV sell dates.`);
    setSuggestions(null);
  }, [suggestions, report, items, ledgers, taxMode, onUpdate]);

  const onSaveBackupCsv = useCallback(async () => {
    if (!displayReport?.rows?.length) return;
    const coverageLine = coverage
      ? `${coverage.from} → ${coverage.to}${coverage.reportCount > 1 ? ` (${coverage.reportCount} CSVs)` : ''}`
      : displayReport.meta.fileName;
    const meta = {
      coverage: coverageLine,
      inventoryRowCount: 0,
      csvRowCount: displayReport.rows.length,
      note: 'Merged official eBay Transaktionsberichte (inventory-pro backup)',
    };
    const saved = await saveEbayTxCsvBackupToProject(displayReport.rows, labelOverrides, meta);
    const downloaded = downloadEbayTxCsvBackup(displayReport.rows, labelOverrides, meta);
    if (saved.saved) {
      setLinkNote(
        `Backup saved · data/ebay-abrechnung - backup/${saved.fileName} · ${downloaded.rowCount} rows` +
          (saved.renamed ? ' · original file was locked (Excel/OneDrive?), saved under a new name' : '')
      );
      return;
    }
    if (saved.saved === false && saved.reason === 'dev-only') {
      setLinkNote(`Downloaded ${downloaded.fileName} · ${downloaded.rowCount} rows (project save is dev-only)`);
      return;
    }
    if (saved.saved === false) {
      setLinkNote(
        `Downloaded ${downloaded.fileName} · ${downloaded.rowCount} rows` +
          (saved.error ? ` · could not save to project (${saved.error})` : '')
      );
    }
  }, [coverage, displayReport, labelOverrides]);

  const onLinkItem = useCallback(
    (next: InventoryItem) => {
      const created = !items.some((item) => item.id === next.id);
      onUpdate([next], undefined, {
        skipFieldPreserve: true,
        skipMembershipSync: true,
        skipContainerSync: true,
        skipContainerSaleMetaSync: true,
        flushCloud: true,
        actionNote: {
          action: created ? 'Abrechnung created' : 'Abrechnung linked',
          details: created
            ? `${next.ebayOrderId} → new ${next.name} (buy €${formatEUR(Number(next.buyPrice))}, sold ${next.sellDate || '—'})`
            : `${next.ebayOrderId} → ${next.name} (sell ${next.sellDate || '—'}, overwrite split)`,
        },
      });
      const pocket = next.saleProceeds?.netPayoutEur;
      setLinkNote(
        (created ? `Created ${next.name}` : `Linked ${next.name}`) +
          ` ← ${next.ebayOrderId}` +
          (next.sellDate ? ` · sold ${next.sellDate}` : '') +
          (created ? ` · buy €${formatEUR(Number(next.buyPrice))}` : '') +
          (pocket != null ? ` · pocket €${formatEUR(pocket)}` : '')
      );
      setMatchRow(null);
    },
    [items, onUpdate]
  );

  const onRecoverPriorSale = useCallback(
    (item: InventoryItem) => {
      const result = recoverPriorAbrechnungSale(item);
      if (!result) {
        setLinkNote(`Could not recover a prior sale for ${item.name}.`);
        return;
      }
      onUpdate([result.item], undefined, {
        skipFieldPreserve: true,
        skipMembershipSync: true,
        skipContainerSync: true,
        skipContainerSaleMetaSync: true,
        flushCloud: true,
        actionNote: {
          action: 'Abrechnung prior sale restored',
          details: `${item.name} → €${formatEUR(result.restoredSellPrice ?? 0)}${result.restoredOrderId ? ` · ${result.restoredOrderId}` : ''}`,
        },
      });
      setLinkNote(
        result.restoredPreviousSale
          ? `Restored prior sale on ${item.name}` +
              (result.restoredSellPrice != null ? ` · €${formatEUR(result.restoredSellPrice)}` : '') +
              (result.item.sellDate ? ` · sold ${result.item.sellDate}` : '') +
              (result.restoredOrderId ? ` · ${result.restoredOrderId}` : '')
          : `Removed false sale history from ${item.name}`
      );
    },
    [onUpdate]
  );

  const onUnlinkItem = useCallback(
    (item: InventoryItem, orderId: string) => {
      const result = unlinkEbayTxOrderFromInventory(items, orderId, item);
      if (!result) {
        setLinkNote(`Could not unlink — no inventory rows linked to order ${orderId}.`);
        return;
      }
      onUpdate(result.updates, result.deleteIds, {
        skipFieldPreserve: true,
        skipMembershipSync: false,
        skipContainerSync: true,
        skipContainerSaleMetaSync: true,
        flushCloud: true,
        actionNote: {
          action: 'Abrechnung unlinked',
          details: result.message,
        },
      });
      setLinkNote(
        result.message +
          (result.restoredSellPrice != null ? ` · €${formatEUR(result.restoredSellPrice)}` : '')
      );
    },
    [items, onUpdate]
  );

  const onLinkBundle = useCallback(
    (updates: InventoryItem[]) => {
      const bundle = updates.find(
        (item) => (item.isBundle || item.isPC) && item.ebayOrderId
      );
      onUpdate(updates, undefined, {
        skipFieldPreserve: true,
        skipMembershipSync: false,
        skipContainerSync: false,
        skipContainerSaleMetaSync: true,
        flushCloud: true,
        actionNote: {
          action: 'Abrechnung bundle linked',
          details: bundle
            ? `${bundle.ebayOrderId} → ${bundle.name} · ${(bundle.componentIds || []).length} parts · equal split · sold ${bundle.sellDate || '—'}`
            : `${updates.length} items linked as sold bundle`,
        },
      });
      const pocket = bundle?.saleProceeds?.netPayoutEur;
      setLinkNote(
        `Linked sold bundle ${bundle?.name || ''} ← ${bundle?.ebayOrderId || 'order'}` +
          (bundle?.sellDate ? ` · sold ${bundle.sellDate}` : '') +
          (pocket != null ? ` · pocket €${formatEUR(pocket)}` : '') +
          ` · ${Math.max(0, (bundle?.componentIds || []).length)} parts · equal split`
      );
      setMatchRow(null);
    },
    [onUpdate]
  );

  // Splitter menu inside the match picker (same underlying SplitPartsModal as Inventory) —
  // candidates like "1 working 1 defekt" often haven't been split into separate rows yet.
  const onSplitApply = useCallback(
    (updates: InventoryItem[], deleteIds?: string[]) => {
      onUpdate(updates, deleteIds, {
        skipFieldPreserve: true,
        flushCloud: true,
        actionNote: {
          action: 'Abrechnung split',
          details: `Split ${updates.length} part(s) from match picker`,
        },
      });
      setLinkNote(`Split into ${updates.length} part(s) — pick the sold one to link.`);
    },
    [onUpdate]
  );

  const compare = useMemo(() => {
    if (!displayReport) return null;
    const sorts = displayReport.rows.map((r) => r.createdSort).filter(Boolean).sort();
    const from = sorts[0] || '';
    const to = sorts[sorts.length - 1] || '';
    const reportOrders = new Set(
      displayReport.rows.filter((r) => r.kind === 'order' && r.orderId).map((r) => r.orderId)
    );
    const inv: { item: InventoryItem; orderId: string; sell: number }[] = [];
    for (const item of items) {
      if (!isRealizedDisposal(item)) continue;
      if (!hasEbaySaleSignals(item)) continue;
      if (shouldSkipForAggregatedSaleLine(item, items)) continue;
      const day = (item.sellDate || '').slice(0, 10);
      if (from && day && day < from) continue;
      if (to && day && day > to) continue;
      const totals = getSoldContainerDisplayTotals(item, items, POCKET_PROFIT_TAX_MODE);
      const sell = (totals.sellPrice ?? Number(item.saleProceeds?.buyerTotalEur) ?? Number(item.sellPrice)) || 0;
      inv.push({ item, orderId: (item.ebayOrderId || '').trim(), sell });
    }
    const invOrders = new Set(inv.map((r) => r.orderId).filter(Boolean));
    const missingInInventory = [...reportOrders].filter((id) => !invOrders.has(id));
    const extraInInventory = [...invOrders].filter((id) => !reportOrders.has(id));
    return {
      from,
      to,
      reportOrders: reportOrders.size,
      inventorySales: inv.length,
      inventoryGross: inv.reduce((s, r) => s + r.sell, 0),
      missingInInventory,
      extraInInventory,
    };
  }, [displayReport, items]);

  if (loading) {
    return (
      <div className="ebay-abrechnung-ui flex-1 flex items-center justify-center text-slate-400 gap-2 text-base">
        <Loader2 size={18} className="animate-spin" /> Loading eBay report…
      </div>
    );
  }

  const s = displayReport?.summary;
  const orderKindTab = (s?.byKind || []).find((bucket) => bucket.kind === 'order') ||
    (s && s.orderCount
      ? { kind: 'order' as const, label: TX_KIND_LABEL.order, count: s.orderCount, grossEur: s.salesGrossEur, netEur: 0 }
      : null);
  const otherKindTabs = (s?.byKind || []).filter((bucket) => bucket.kind !== 'order');

  return (
    <div className="ebay-abrechnung-ui flex-1 min-h-0 flex flex-col bg-slate-50">
      <div className="shrink-0 px-4 py-2 border-b border-slate-200 bg-white">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-start gap-2">
              {report || displayReport ? (
                <button
                  type="button"
                  onClick={toggleOverview}
                  className="mt-0.5 inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2 text-slate-600 hover:bg-slate-50"
                  title={overviewOpen ? 'Hide summary' : 'Show summary'}
                  aria-expanded={overviewOpen}
                  aria-label={overviewOpen ? 'Hide summary' : 'Show summary'}
                >
                  {overviewOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  <span className="text-[10px] font-black uppercase tracking-wider">
                    {overviewOpen ? 'Hide' : 'Show'}
                  </span>
                </button>
              ) : null}
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Seller Hub</p>
                <h1 className="text-lg font-black text-slate-900">eBay Abrechnung</h1>
                {overviewOpen ? (
                  <>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Official Payments Transaktionsbericht plus live eBay sales from inventory (sold, linked, restocked).
                    </p>
                    {coverage ? (
                      <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] text-emerald-900">
                        <p>
                          <span className="font-black uppercase tracking-wider text-emerald-700">Already imported</span>
                          {' · '}
                          <span className="font-bold tabular-nums">{coverage.from} → {coverage.to}</span>
                          {coverage.reportCount > 1 ? ` · ${coverage.reportCount} CSVs` : ''}
                        </p>
                        {coverage.nextExportStart ? (
                          <p className="mt-0.5 text-emerald-800">
                            Next Seller Hub CSV start date:{' '}
                            <span className="font-black tabular-nums">{coverage.nextExportStart}</span>
                            <span className="text-emerald-700"> — same last day, so later orders that day are not skipped</span>
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                    {report ? (
                      <p className="text-[11px] text-slate-500 mt-1">
                        {report.meta.seller ? <span className="font-semibold text-slate-700">{report.meta.seller}</span> : null}
                        {report.meta.seller ? ' · ' : ''}
                        {selectedId === 'all' && reports.length > 1
                          ? `${reports.length} reports combined`
                          : report.meta.fileName}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="text-[11px] text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    {coverage ? (
                      <span className="font-bold tabular-nums text-emerald-700">
                        {coverage.from} → {coverage.to}
                      </span>
                    ) : null}
                    {s ? (
                      <span>
                        Verkaufserlös <span className="font-black tabular-nums text-slate-800">{formatSigned(s.salesGrossEur)}</span>
                      </span>
                    ) : null}
                    {pocket ? (
                      <span>
                        In pocket <span className="font-black tabular-nums text-emerald-800">{formatSigned(pocket.pocketEur)}</span>
                      </span>
                    ) : null}
                  </p>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              multiple
              className="hidden"
              onChange={(e) => {
                void onFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              onClick={() => runEbaySync(true)}
              disabled={ebaySyncBusy || loading}
              title={
                loading
                  ? 'Waiting for your CSV/cloud data to finish loading first, so this can correctly skip orders already covered'
                  : 'Pull recent orders from the eBay API and add any new ones as Bestellung rows'
              }
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-violet-200 bg-violet-50 text-violet-900 text-xs font-bold hover:bg-violet-100 disabled:opacity-50"
            >
              {ebaySyncBusy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              Sync eBay orders
            </button>
            <button
              type="button"
              onClick={runFullBackfill}
              disabled={backfillBusy || loading}
              title="One-time (or resumable) pull of your ENTIRE eBay order history via the API — chunked, safe to stop and resume, only fetches the gap on a second run"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-900 text-xs font-bold hover:bg-indigo-100 disabled:opacity-50"
            >
              {backfillBusy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              Build order history
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 disabled:opacity-60"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              Add CSV
            </button>
            {displayReport?.rows?.length ? (
              <button
                type="button"
                onClick={() => void onSaveBackupCsv()}
                disabled={busy}
                title="Save merged Abrechnung backup to data/ebay-abrechnung - backup/ebay-abrechnung-backup.csv (dev) and download a copy"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-900 text-xs font-bold hover:bg-emerald-100 disabled:opacity-50"
              >
                <Download size={14} />
                Save backup
              </button>
            ) : null}
            {report?.rows?.length && (linkedByOrder.size > 0 || sellDateFixCount > 0) ? (
              <button
                type="button"
                onClick={onBackfillLinkedSellDates}
                disabled={busy || sellDateFixCount === 0}
                title={
                  sellDateFixCount > 0
                    ? `Set sell date from CSV on ${sellDateFixCount} item(s) (order id or unique listing id)`
                    : 'All linked / listing-matched items already match CSV sell dates'
                }
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-sky-200 bg-sky-50 text-sky-900 text-xs font-bold hover:bg-sky-100 disabled:opacity-50"
              >
                <CalendarDays size={14} />
                Fix sell dates
                {sellDateFixCount > 0 ? (
                  <span className="tabular-nums rounded-md bg-sky-200/80 px-1.5 py-0.5 text-[10px]">{sellDateFixCount}</span>
                ) : null}
              </button>
            ) : null}
          </div>
        </div>
        {error ? <p className="mt-2 text-xs font-semibold text-red-600">{error}</p> : null}
        {linkNote ? <p className="mt-2 text-xs font-semibold text-emerald-700">{linkNote}</p> : null}
        {ebaySyncNote ? (
          <p className={`mt-2 text-xs font-semibold ${ebaySyncNote.kind === 'error' ? 'text-amber-700' : 'text-violet-700'}`}>
            {ebaySyncNote.text}
            {ebaySyncNote.hint ? <span className="block mt-0.5 font-medium text-amber-600">{ebaySyncNote.hint}</span> : null}
          </p>
        ) : null}
        {backfillNote ? (
          <p className="mt-2 text-xs font-semibold text-indigo-700 flex items-center gap-2">
            {backfillNote}
            {backfillBusy ? (
              <button
                type="button"
                onClick={() => { backfillCancelRef.current.cancelled = true; }}
                className="shrink-0 px-2 py-0.5 rounded border border-indigo-300 text-[10px] font-bold uppercase text-indigo-700 hover:bg-indigo-100"
              >
                Stop
              </button>
            ) : null}
          </p>
        ) : null}
      </div>

      {!displayReport ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void onFiles(e.dataTransfer.files);
            }}
            className="max-w-lg w-full rounded-2xl border-2 border-dashed border-slate-300 bg-white px-6 py-12 text-center hover:border-slate-400"
          >
            <FileSpreadsheet className="mx-auto text-slate-400" size={28} />
            <p className="mt-3 text-sm font-bold text-slate-800">Drop the Transaktionsbericht CSV here</p>
            <p className="mt-1 text-xs text-slate-500">
              Seller Hub → Payments → Berichte → Transaktionsberichte. Add both period CSVs (2025 and 2026) to match Hub through today.
            </p>
          </button>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col">
          {overviewOpen ? (
          <div className="shrink-0 px-4 pt-3 space-y-3">
          {reports.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              {reports.length > 1 ? (
                <button
                  type="button"
                  onClick={() => setSelectedId('all')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border ${
                    selectedId === 'all' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'
                  }`}
                >
                  All periods
                </button>
              ) : null}
              {reports.map((r) => (
                <span key={r.meta.id} className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setSelectedId(r.meta.id)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border ${
                      selectedId === r.meta.id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'
                    }`}
                  >
                    {formatEbayTxDay(r.meta.startDate)} → {formatEbayTxDay(r.meta.endDate)}
                    <span className="ml-1 opacity-70">{r.summary.rowCount}</span>
                  </button>
                  <button
                    type="button"
                    title="Remove this report"
                    onClick={() => {
                      void removeEbayTransactionReport(r.meta.id).then((library) => {
                        setReports(library.reports);
                        setSelectedId(library.reports.length > 1 ? 'all' : library.reports[0]?.meta.id || 'all');
                      });
                    }}
                    className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50"
                  >
                    <Trash2 size={12} />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          {report && !report.rows.length && inventoryOnlyRowCount > 0 ? (
            <div className="rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-[11px] text-sky-900">
              <p>
                <span className="font-black uppercase tracking-wider text-sky-700">Live from inventory</span>
                {' · '}
                <span className="font-bold tabular-nums">{inventoryOnlyRowCount} rows</span>
                {' '}from eBay sales / restocks in your stock list. Import the official Transaktionsbericht CSV to replace estimates with wallet-accurate rows.
              </p>
            </div>
          ) : null}
          {report && !report.rows.length && !inventoryOnlyRowCount ? (
            <div className="rounded-lg border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-[11px] text-sky-900">
              KPI cards and In pocket are synced from Firebase. CSV rows stay on the device that imported them — add the Transaktionsbericht here to see the table.
            </div>
          ) : null}
          {s ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
              <SummaryCard
                title="Verkaufserlös"
                value={s.salesGrossEur}
                lines={[
                  ['Zwischensumme Artikel', s.itemSubtotalEur],
                  ['Verpackung & Versand', s.buyerShippingEur],
                  ['Steuer (Verkäufer)', s.sellerTaxEur],
                  [`${s.orderCount} Bestellungen · ${s.uniqueOrders} orders`, null],
                ]}
              />
              <SummaryCard
                title="Rückerstattungen"
                value={s.refundsTotalEur}
                negative
                lines={[
                  ['Rückerstattungen', s.refundGrossEur],
                  ['Fälle', s.caseGrossEur],
                  ['Zahlungsstreitfälle', s.disputeGrossEur],
                ]}
              />
              <SummaryCard
                title="Kosten"
                value={s.costsTotalEur}
                negative
                lines={[
                  ['Gebühren (Anzeigen + Angebotsgebühr)', s.feeRowsEur],
                  ['Verkaufsprovision auf Bestellung', s.orderEmbeddedFeesEur],
                  ['Versandetiketten', s.labelsEur],
                ]}
              />
              <SummaryCard
                title="In pocket"
                value={pocket.pocketEur}
                lines={[
                  ['FVF on Bestellung', pocket.fvfEur],
                  ['Ads (Basis-Anzeigen)', pocket.adsEur],
                  ['Versandetiketten', pocket.labelsEur],
                  pocket.otherEur
                    ? ['Refunds / other on orders', pocket.otherEur]
                    : [`${pocket.orderCount} orders with a wallet row`, null],
                ]}
              />
              <SummaryCard
                title="Auszahlungen / Wallet"
                value={s.payoutsEur}
                lines={[
                  ['Bank transfers (Auszahlung)', s.payoutsEur],
                  ['Wallet net (ex. payouts)', s.walletNetEur],
                  [`${s.rowCount} rows`, null],
                ]}
              />
            </div>
          ) : null}

          {s && s.feeSlices?.length > 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl px-3 py-2.5">
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1.5">Andere Gebühr by description</p>
              <div className="flex flex-wrap gap-1.5">
                {s.feeSlices.slice(0, 8).map((slice) => (
                  <span
                    key={slice.label}
                    className="inline-flex items-center gap-1.5 rounded-full border border-violet-100 bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-800"
                  >
                    {slice.label}
                    <span className="tabular-nums">{formatSigned(slice.amountEur)}</span>
                    <span className="text-violet-400">{slice.count}</span>
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {compare ? (
            <div className="bg-white border border-slate-200 rounded-xl px-3 py-2.5">
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Inventory vs this report</p>
              <p className="text-xs text-slate-600">
                Report orders <span className="font-bold tabular-nums">{compare.reportOrders}</span>
                {' · '}
                Inventory eBay sales in {compare.from} → {compare.to}{' '}
                <span className="font-bold tabular-nums">{compare.inventorySales}</span>
                {' · '}
                Inventory gross <span className="font-bold tabular-nums">€{formatEUR(compare.inventoryGross)}</span>
                {' vs report '}
                <span className="font-bold tabular-nums">€{formatEUR(s?.salesGrossEur || 0)}</span>
              </p>
              <p className="text-[11px] text-slate-500 mt-1">
                In report, not in inventory: {compare.missingInInventory.length}
                {compare.missingInInventory.length ? ` (${compare.missingInInventory.slice(0, 6).join(', ')}${compare.missingInInventory.length > 6 ? '…' : ''})` : ''}
                {' · '}
                In inventory, not in report: {compare.extraInInventory.length}
                {compare.extraInInventory.length ? ` (${compare.extraInInventory.slice(0, 6).join(', ')}${compare.extraInInventory.length > 6 ? '…' : ''})` : ''}
              </p>
            </div>
          ) : null}
          </div>
          ) : null}

          <div className="shrink-0 px-4 pt-3 pb-2">
          <div className="flex flex-wrap items-center gap-2">
            {orderKindTab ? (
              <button
                type="button"
                onClick={() => setKindFilter('order')}
                className={`px-2 py-1 rounded-lg text-[11px] font-bold border ${
                  kindFilter === 'order' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'
                }`}
              >
                {orderKindTab.label} {orderKindTab.count}
                <span className="ml-1 tabular-nums font-semibold opacity-80">{formatSigned(orderKindTab.grossEur)}</span>
              </button>
            ) : null}
            {refundedOrderStats.count > 0 ? (
              <button
                type="button"
                onClick={() => setKindFilter('refunded')}
                className={`px-2 py-1 rounded-lg text-[11px] font-bold border ${
                  kindFilter === 'refunded'
                    ? 'bg-red-700 text-white border-red-700'
                    : 'bg-red-50 text-red-800 border-red-200 hover:border-red-300'
                }`}
                title="Bestellungen with refund rows or negative pocket — do not link inventory here"
              >
                Refunded {refundedOrderStats.count}
                <span className="ml-1 tabular-nums font-semibold opacity-80">{formatSigned(refundedOrderStats.pocketEur)}</span>
              </button>
            ) : null}
            {matcherOrderCount > 0 ? (
              <button
                type="button"
                onClick={() => setKindFilter('matcher')}
                className={`px-2 py-1 rounded-lg text-[11px] font-bold border ${
                  kindFilter === 'matcher'
                    ? 'bg-violet-700 text-white border-violet-700'
                    : 'bg-violet-50 text-violet-900 border-violet-200 hover:border-violet-300'
                }`}
                title="CSV order ↔ inventory matcher (builds in background)"
              >
                {suggestBusy ? (
                  <Loader2 size={12} className="inline animate-spin mr-1 -mt-0.5" />
                ) : (
                  <Link2 size={12} className="inline mr-1 -mt-0.5" />
                )}
                Matcher {matcherStats?.total ?? matcherOrderCount}
                {matcherStats ? (
                  <span className="ml-1 tabular-nums font-semibold opacity-80">{matcherStats.high} high</span>
                ) : null}
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setKindFilter('all')}
              className={`px-2 py-1 rounded-lg text-[11px] font-bold border ${
                kindFilter === 'all' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'
              }`}
            >
              All {displayReport.rows.length}
            </button>
            {otherKindTabs.map((bucket) => (
              <button
                key={bucket.kind}
                type="button"
                onClick={() => setKindFilter(bucket.kind)}
                className={`px-2 py-1 rounded-lg text-[11px] font-bold border ${
                  kindFilter === bucket.kind ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'
                }`}
              >
                {bucket.label} {bucket.count}
                <span className="ml-1 tabular-nums font-semibold opacity-80">{formatSigned(bucket.grossEur)}</span>
              </button>
            ))}
            {kindFilter !== 'matcher' ? (
              <button
                type="button"
                onClick={() => setHideLinked((v) => !v)}
                aria-pressed={hideLinked}
                title={hideLinked ? 'Show orders already linked to an inventory item' : 'Hide orders already linked to an inventory item'}
                className={`px-2 py-1 rounded-lg text-[11px] font-bold border inline-flex items-center gap-1 ${
                  hideLinked
                    ? 'bg-emerald-700 text-white border-emerald-700'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                }`}
              >
                <Unlink size={12} />
                {hideLinked ? 'Linked hidden' : 'Hide linked'}
                {linkedInFilteredCount > 0 ? (
                  <span className="ml-0.5 tabular-nums font-semibold opacity-80">{linkedInFilteredCount}</span>
                ) : null}
              </button>
            ) : null}
            {kindFilter !== 'matcher' ? (
              <div className="flex flex-wrap items-center gap-1">
                {componentPinIds.map((id) => {
                  const pin = COMPONENT_PIN_CATALOG.find((p) => p.id === id);
                  if (!pin) return null;
                  const active = activeComponentPin === id;
                  const count = componentPinCounts.get(id) || 0;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setActiveComponentPin((prev) => (prev === id ? null : id))}
                      aria-pressed={active}
                      title={`Filter to orders whose title looks like ${pin.label} (guessed the same way Inventory does)`}
                      className={`px-2 py-1 rounded-lg text-[11px] font-bold border inline-flex items-center gap-1 ${
                        active
                          ? 'bg-indigo-700 text-white border-indigo-700'
                          : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'
                      }`}
                    >
                      {pin.label}
                      {count > 0 ? (
                        <span className="tabular-nums font-semibold opacity-80">{count}</span>
                      ) : null}
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => setShowComponentPinPicker(true)}
                  title="Add or remove component filter pills"
                  aria-label="Add or remove component filter pills"
                  className="h-[26px] w-[26px] shrink-0 inline-flex items-center justify-center rounded-lg border border-dashed border-slate-300 text-slate-400 hover:border-slate-400 hover:text-slate-600"
                >
                  <Plus size={12} />
                </button>
                {showComponentPinPicker ? (
                  <ComponentPinPickerModal
                    activeIds={componentPinIds}
                    onToggle={toggleComponentPinVisible}
                    onClose={() => setShowComponentPinPicker(false)}
                  />
                ) : null}
              </div>
            ) : null}
            <div className="flex-1 min-w-[12rem]">
              {kindFilter === 'matcher' ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  {(['all', 'high', 'medium', 'low', 'linked', 'none'] as const).map((conf) => (
                    <button
                      key={conf}
                      type="button"
                      onClick={() => setMatcherConfFilter(conf)}
                      className={`px-2 py-1 rounded-lg text-[10px] font-bold border ${
                        matcherConfFilter === conf
                          ? 'bg-violet-700 text-white border-violet-700'
                          : 'bg-white text-violet-900 border-violet-200'
                      }`}
                    >
                      {conf === 'all' ? 'All' : conf}
                      {matcherStats && conf !== 'all' ? (
                        <span className="ml-1 tabular-nums opacity-80">
                          {conf === 'high'
                            ? matcherStats.high
                            : conf === 'medium'
                              ? matcherStats.medium
                              : conf === 'low'
                                ? matcherStats.low
                                : conf === 'linked'
                                  ? matcherStats.linked
                                  : matcherStats.none}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              ) : (
                <EbayToolSearchInput
                  value={search}
                  onChange={setSearch}
                  placeholder="Order, buyer, title, fee…"
                  matchCount={filtered.length}
                  totalCount={displayReport.rows.length}
                />
              )}
            </div>
          </div>
          </div>

          <div className="flex-1 min-h-0 px-4 pb-3 flex gap-3 items-stretch min-w-0 overflow-hidden">
          <div className="min-h-0 flex flex-col flex-1 min-w-0 overflow-hidden">
          <div className="flex-1 min-h-0 bg-white border border-slate-200 rounded-xl overflow-hidden flex flex-col">
            {kindFilter === 'matcher' ? (
              <>
                <div className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2 border-b border-violet-100 bg-violet-50/60">
                  <p className="text-[11px] font-black uppercase tracking-wide text-violet-900">CSV ↔ inventory matcher</p>
                  {matcherStats ? (
                    <span className="text-[11px] text-violet-800 tabular-nums">
                      {matcherStats.high} high · {matcherStats.medium} medium · {matcherStats.linked} linked ·{' '}
                      {matcherStats.low + matcherStats.none} weak/none
                    </span>
                  ) : null}
                  <div className="flex-1" />
                  <button
                    type="button"
                    onClick={() => {
                      matcherAutoBuiltRef.current = false;
                      setSuggestions(null);
                      void onBuildSuggestions();
                    }}
                    disabled={suggestBusy || busy}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-violet-300 bg-white text-violet-900 text-[11px] font-bold hover:bg-violet-100 disabled:opacity-50"
                  >
                    {suggestBusy ? <Loader2 size={12} className="animate-spin" /> : null}
                    Rebuild
                  </button>
                  <button
                    type="button"
                    onClick={onApplyHighConfidenceSuggestions}
                    disabled={
                      busy ||
                      suggestBusy ||
                      !suggestions?.some((s) => s.confidence === 'high' && s.suggestedItemId)
                    }
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-violet-700 text-white text-[11px] font-bold hover:bg-violet-800 disabled:opacity-50"
                  >
                    Apply high confidence
                  </button>
                  <button
                    type="button"
                    onClick={onDownloadSuggestions}
                    disabled={!suggestions?.length}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-violet-300 bg-white text-violet-900 text-[11px] font-bold hover:bg-violet-100 disabled:opacity-50"
                  >
                    <Download size={12} /> CSV
                  </button>
                </div>
                {suggestBusy && matcherProgress ? (
                  <div className="shrink-0 px-3 py-2 border-b border-violet-100 bg-white">
                    <div className="flex items-center justify-between text-[11px] text-violet-900 mb-1">
                      <span className="font-semibold">Building matcher…</span>
                      <span className="tabular-nums">
                        {matcherProgress.done} / {matcherProgress.total}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-violet-100 overflow-hidden">
                      <div
                        className="h-full bg-violet-600 transition-[width] duration-150"
                        style={{
                          width: `${matcherProgress.total ? Math.round((matcherProgress.done / matcherProgress.total) * 100) : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                ) : null}
                <div className="flex-1 min-h-0 overflow-auto">
                  {!suggestions?.length && !suggestBusy ? (
                    <div className="flex flex-col items-center justify-center gap-2 p-10 text-center text-slate-500">
                      <Link2 size={24} className="text-violet-400" />
                      <p className="text-sm font-semibold text-slate-700">Matcher not built yet</p>
                      <button
                        type="button"
                        onClick={() => void onBuildSuggestions()}
                        className="mt-1 px-3 py-1.5 rounded-lg bg-violet-700 text-white text-xs font-bold hover:bg-violet-800"
                      >
                        Build matcher
                      </button>
                    </div>
                  ) : (
                    <table className="w-full text-[11px] text-left">
                      <thead className="sticky top-0 bg-slate-50 text-slate-500 font-bold uppercase tracking-wide z-10">
                        <tr>
                          <th className="px-2 py-1.5">Conf</th>
                          <th className="px-2 py-1.5">CSV date</th>
                          <th className="px-2 py-1.5">Order / title</th>
                          <th className="px-2 py-1.5">€</th>
                          <th className="px-2 py-1.5">Suggested inventory</th>
                          <th className="px-2 py-1.5">Why</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {matcherPageRows.map((s) => (
                          <tr key={s.orderId} className="align-top hover:bg-violet-50/40">
                            <td className="px-2 py-1.5">
                              <span
                                className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-black uppercase ${
                                  s.confidence === 'high'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : s.confidence === 'medium'
                                      ? 'bg-amber-100 text-amber-900'
                                      : s.confidence === 'linked'
                                        ? 'bg-sky-100 text-sky-800'
                                        : 'bg-slate-100 text-slate-600'
                                }`}
                              >
                                {s.confidence}
                              </span>
                            </td>
                            <td className="px-2 py-1.5 tabular-nums whitespace-nowrap text-slate-700">{s.csvSellDate || '—'}</td>
                            <td className="px-2 py-1.5 min-w-0">
                              <p className="font-mono text-[10px] text-slate-500 break-all">{s.orderId}</p>
                              <p className="text-slate-800 line-clamp-2">{s.title || '—'}</p>
                            </td>
                            <td className="px-2 py-1.5 tabular-nums whitespace-nowrap">€{formatEUR(s.buyerTotalEur)}</td>
                            <td className="px-2 py-1.5 min-w-0">
                              {s.confidence === 'linked' ? (
                                <p className="text-sky-800 font-semibold line-clamp-2">{s.alreadyLinkedName}</p>
                              ) : s.suggestedName ? (
                                <>
                                  <p className="text-slate-900 font-semibold line-clamp-2">{s.suggestedName}</p>
                                  <p className="text-[10px] text-slate-500 tabular-nums">
                                    {s.suggestedSellDate || 'no date'}
                                    {s.suggestedSellPrice != null ? ` · €${formatEUR(s.suggestedSellPrice)}` : ''}
                                  </p>
                                </>
                              ) : (
                                <span className="text-slate-400">—</span>
                              )}
                            </td>
                            <td className="px-2 py-1.5 text-slate-500">{s.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
                <div className="shrink-0 flex items-center justify-between px-3 py-2 border-t border-slate-100 text-[11px] text-slate-500">
                  <span>
                    {filteredSuggestions.length} orders
                    {matcherConfFilter !== 'all' ? ` · ${matcherConfFilter}` : ''}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={matcherPage <= 0}
                      onClick={() => setMatcherPage((p) => Math.max(0, p - 1))}
                      className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40"
                    >
                      Prev
                    </button>
                    <span>
                      {matcherPage + 1} / {matcherPageCount}
                    </span>
                    <button
                      type="button"
                      disabled={matcherPage + 1 >= matcherPageCount}
                      onClick={() => setMatcherPage((p) => p + 1)}
                      className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <>
            {overviewOpen ? (
            <p className="shrink-0 px-3 pt-2 text-[10px] text-slate-400">
              Pocket on Bestellung is the official wallet hit: item + buyer ship − FVF − ads − Versandetikett.
              Click Label on a Bestellung to add a missing DHL price (6,19 / 7,69 / 10,49…). Manual labels persist until the next official CSV has that row.
            </p>
            ) : null}
            <div className="hidden md:block flex-1 min-h-0 overflow-auto">
              <table className="w-full table-fixed text-left text-[11px]">
                <colgroup>
                  <col style={{ width: '5.5rem' }} />
                  <col style={{ width: '4.5rem' }} />
                  <col style={{ width: '9rem' }} />
                  <col style={{ width: '7.5rem' }} />
                  <col />
                  <col style={{ width: '10rem' }} />
                  <col style={{ width: '4.5rem' }} />
                  <col style={{ width: '4rem' }} />
                  <col style={{ width: '4rem' }} />
                  <col style={{ width: '4rem' }} />
                  <col style={{ width: '4.25rem' }} />
                  <col style={{ width: '4.5rem' }} />
                  <col style={{ width: '4.75rem' }} />
                </colgroup>
                <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400 font-bold">
                  <tr>
                    <SortTh label="Date" column="date" sort={sort} onSort={toggleSort} />
                    <SortTh label="Type" column="type" sort={sort} onSort={toggleSort} />
                    <SortTh label="Order" column="order" sort={sort} onSort={toggleSort} />
                    <SortTh label="Buyer" column="buyer" sort={sort} onSort={toggleSort} />
                    <SortTh label="Title" column="title" sort={sort} onSort={toggleSort} />
                    <SortTh label="Inv" column="inv" sort={sort} onSort={toggleSort} />
                    <SortTh label="Item" column="item" sort={sort} onSort={toggleSort} align="right" title="Buyer paid for the item" />
                    <SortTh label="Ship" column="ship" sort={sort} onSort={toggleSort} align="right" title="Buyer paid for shipping" />
                    <SortTh label="FVF" column="fvf" sort={sort} onSort={toggleSort} align="right" title="Verkaufsprovision on the Bestellung row" />
                    <SortTh label="Ads" column="ads" sort={sort} onSort={toggleSort} align="right" title="Gebühr für Basis-Anzeigen linked to this order" />
                    <SortTh label="Label" column="label" sort={sort} onSort={toggleSort} align="right" title="Versandetikett you paid" />
                    <SortTh label="Gross" column="gross" sort={sort} onSort={toggleSort} align="right" title="Buyer total (item + ship)" />
                    <SortTh label="Pocket" column="pocket" sort={sort} onSort={toggleSort} align="right" title="What hit the eBay wallet: item + buyer ship − FVF − ads − label" />
                  </tr>
                </thead>
                <tbody>
                  {pageRows.map((row) => (
                    <TxRow
                      key={row.id}
                      row={row}
                      ledger={row.orderId ? ledgers.get(row.orderId) || null : null}
                      linked={
                        row.orderId ? linkedByOrder.get(row.orderId.trim().toLowerCase()) || null : null
                      }
                      feeAbsorbedItem={
                        row.orderId ? feeAbsorbedByOrder.get(row.orderId.trim().toLowerCase()) || null : null
                      }
                      refundState={refundStateByRowId.get(row.id) || 'none'}
                      matchActive={matchRow?.id === row.id}
                      presets={labelChoices.presets}
                      extras={labelChoices.extras}
                      onSetLabel={setOrderLabel}
                      onClearLabel={clearOrderLabel}
                      onMatch={() => setMatchRow((cur) => (cur?.id === row.id ? null : row))}
                      onUnlinkItem={onUnlinkItem}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <div className="md:hidden flex-1 min-h-0 overflow-auto px-2 py-2 space-y-2">
              {pageRows.map((row) => (
                <TxCard
                  key={row.id}
                  row={row}
                  ledger={row.orderId ? ledgers.get(row.orderId) || null : null}
                  linked={
                    row.orderId ? linkedByOrder.get(row.orderId.trim().toLowerCase()) || null : null
                  }
                  feeAbsorbedItem={
                    row.orderId ? feeAbsorbedByOrder.get(row.orderId.trim().toLowerCase()) || null : null
                  }
                  refundState={refundStateByRowId.get(row.id) || 'none'}
                  presets={labelChoices.presets}
                  extras={labelChoices.extras}
                  onSetLabel={setOrderLabel}
                  onClearLabel={clearOrderLabel}
                  onMatch={() => setMatchRow((cur) => (cur?.id === row.id ? null : row))}
                  onUnlinkItem={onUnlinkItem}
                />
              ))}
            </div>
            <div className="shrink-0 flex items-center justify-between px-3 py-2 border-t border-slate-100 text-[11px] text-slate-500">
              <span>
                {visibleRows.length} rows
                {hideLinked && linkedInFilteredCount > 0 ? ` · ${linkedInFilteredCount} linked hidden` : ''}
                {kindFilter === 'refunded'
                  ? ' · Refunded Bestellungen'
                  : kindFilter !== 'all'
                    ? ` · ${TX_KIND_LABEL[kindFilter as EbayTxKind]}`
                    : ''}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={page <= 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40"
                >
                  Prev
                </button>
                <span>
                  {page + 1} / {pageCount}
                </span>
                <button
                  type="button"
                  disabled={page + 1 >= pageCount}
                  onClick={() => setPage((p) => p + 1)}
                  className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
              </>
            )}
          </div>
          </div>
          <div className="hidden md:flex shrink-0 w-[29.9rem] min-h-0 flex-col">
            {matchRow ? (
              <EbayAbrechnungMatchPicker
                variant="panel"
                row={matchRow}
                ledger={matchRow.orderId ? ledgers.get(matchRow.orderId) || null : null}
                refundState={refundStateByRowId.get(matchRow.id) || 'none'}
                items={items}
                taxMode={taxMode}
                onClose={() => setMatchRow(null)}
                onLink={onLinkItem}
                onLinkBundle={onLinkBundle}
                onSplitApply={onSplitApply}
                onRecoverPriorSale={onRecoverPriorSale}
                onSearchResale={onSearchResale}
              />
            ) : null}
          </div>
          {matchRow ? (
            <div className="md:hidden">
              <EbayAbrechnungMatchPicker
                variant="modal"
                row={matchRow}
                ledger={matchRow.orderId ? ledgers.get(matchRow.orderId) || null : null}
                refundState={refundStateByRowId.get(matchRow.id) || 'none'}
                items={items}
                taxMode={taxMode}
                onClose={() => setMatchRow(null)}
                onLink={onLinkItem}
                onLinkBundle={onLinkBundle}
                onSplitApply={onSplitApply}
                onRecoverPriorSale={onRecoverPriorSale}
                onSearchResale={onSearchResale}
              />
            </div>
          ) : null}
          </div>
        </div>
      )}
    </div>
  );
};

function SortTh({
  label,
  column,
  sort,
  onSort,
  align = 'left',
  title,
}: {
  label: string;
  column: EbayTxSortKey;
  sort: EbayTxSort | null;
  onSort: (column: EbayTxSortKey) => void;
  align?: 'left' | 'right';
  title?: string;
}) {
  const active = sort?.key === column;
  return (
    <th className={`px-2 py-2 ${align === 'right' ? 'text-right' : ''}`} title={title}>
      <button
        type="button"
        onClick={() => onSort(column)}
        className={`inline-flex items-center gap-0.5 whitespace-nowrap ${
          align === 'right' ? 'justify-end w-full' : ''
        } ${active ? 'text-slate-800' : 'text-slate-400 hover:text-slate-700'}`}
      >
        {label}
        {active ? (
          sort?.dir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />
        ) : (
          <ArrowUpDown size={10} className="opacity-40" />
        )}
      </button>
    </th>
  );
}

function SummaryCard({
  title,
  value,
  lines,
  negative,
}: {
  title: string;
  value: number;
  lines: Array<[string, number | null]>;
  negative?: boolean;
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl px-3 py-2.5">
      <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{title}</p>
      <p className={`text-xl font-black tabular-nums mt-0.5 ${negative && value < 0 ? 'text-red-600' : 'text-slate-900'}`}>
        {formatSigned(value)}
      </p>
      <ul className="mt-2 space-y-0.5">
        {lines.map(([label, amount]) => (
          <li key={label} className="flex items-center justify-between gap-2 text-[11px]">
            <span className="text-slate-500 truncate">{label}</span>
            {amount != null ? (
              <span className={`tabular-nums font-semibold ${moneyClass(amount)}`}>{formatSigned(amount)}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function LabelCell({
  isOrder,
  orderId,
  label,
  manual,
  presets,
  extras,
  onSetLabel,
  onClearLabel,
  as = 'td',
}: {
  isOrder: boolean;
  orderId: string;
  label: number | null;
  manual: boolean;
  presets: DhlLabelPreset[];
  extras: number[];
  onSetLabel: (orderId: string, amountEur: number, name?: string) => void;
  onClearLabel: (orderId: string) => void;
  /** Table row (default) or a plain block for the mobile card layout, which isn't a <table>. */
  as?: 'td' | 'div';
}) {
  const Wrapper = as;
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const missing = !(Math.abs(label ?? 0) >= 0.01);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (event: MouseEvent) => {
      const target = event.target as Node;
      if (btnRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  if (!isOrder || !orderId) {
    return (
      <Wrapper className={`${as === 'td' ? 'px-2 py-1.5' : ''} text-right font-semibold ${deductionClass(label)}`}>
        <SignedEURCell n={label} />
      </Wrapper>
    );
  }

  return (
    <Wrapper className={`${as === 'td' ? 'px-2 py-1.5' : ''} text-right`}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => {
          const rect = btnRef.current?.getBoundingClientRect();
          if (rect) {
            setPos({
              top: Math.min(rect.bottom + 4, window.innerHeight - 280),
              left: Math.min(Math.max(8, rect.right - 220), window.innerWidth - 232),
            });
          }
          setOpen((value) => !value);
        }}
        className={`inline-flex items-baseline justify-end gap-1 w-full font-semibold ${
          missing ? 'text-slate-400 hover:text-slate-700' : deductionClass(label)
        }`}
        title="Set DHL Versandetikett"
      >
        <span className="min-w-0 flex-1 text-right">
          {missing ? 'Add' : <SignedEURCell n={label} />}
        </span>
        <Pencil size={10} className={`shrink-0 self-center ${manual ? 'text-amber-500' : 'text-slate-300'}`} />
      </button>
      {open
        ? createPortal(
            <div
              ref={menuRef}
              style={{ top: pos.top, left: pos.left }}
              className="fixed z-[240] w-56 rounded-xl border border-slate-200 bg-white shadow-xl p-2"
            >
              <p className="px-1 pb-1.5 text-[10px] font-black uppercase tracking-wider text-slate-400">
                DHL label
              </p>
              <div className="grid grid-cols-1 gap-0.5">
                {presets.map((preset) => (
                  <button
                    key={preset.amountEur}
                    type="button"
                    onClick={() => {
                      onSetLabel(orderId, preset.amountEur, preset.name);
                      close();
                    }}
                    className={`flex items-center justify-between rounded-lg px-2 py-1.5 text-[11px] hover:bg-slate-50 ${
                      Math.abs((label ?? 0) + preset.amountEur) < 0.005 ? 'bg-slate-100 font-bold' : ''
                    }`}
                  >
                    <span className="text-slate-600">{preset.name}</span>
                    <span className="tabular-nums font-semibold text-violet-700">−€{formatEUR(preset.amountEur)}</span>
                  </button>
                ))}
              </div>
              {extras.length ? (
                <div className="mt-1.5 pt-1.5 border-t border-slate-100">
                  <p className="px-1 pb-1 text-[10px] font-black uppercase tracking-wider text-slate-400">Also in your CSVs</p>
                  <div className="flex flex-wrap gap-1">
                    {extras.map((amount) => (
                      <button
                        key={amount}
                        type="button"
                        onClick={() => {
                          onSetLabel(orderId, amount, 'Label');
                          close();
                        }}
                        className={`rounded-md border px-1.5 py-0.5 text-[10px] tabular-nums font-semibold hover:bg-slate-50 ${
                          Math.abs((label ?? 0) + amount) < 0.005
                            ? 'border-slate-400 bg-slate-100 text-slate-900'
                            : 'border-slate-200 text-slate-600'
                        }`}
                      >
                        {formatEUR(amount)}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => {
                  onClearLabel(orderId);
                  close();
                }}
                className="mt-1 w-full rounded-lg px-2 py-1.5 text-[11px] font-semibold text-slate-500 hover:bg-slate-50"
              >
                {manual ? 'Remove manual label' : 'No label yet'}
              </button>
            </div>,
            document.body
          )
        : null}
    </Wrapper>
  );
}

/** Derived display values shared by the desktop table row and the mobile card — kept in one
 *  place so the two layouts can never quietly disagree on what a row's numbers mean. */
function deriveTxRowDisplay(
  row: EbayTxRow,
  ledger: EbayTxOrderLedger | null,
  refundState: EbayTxOrderRefundState
) {
  const detail = row.title || row.description || row.reference || '—';
  const isOrder = row.kind === 'order';
  const isFullRefund = refundState === 'full';
  const isPartialRefund = refundState === 'partial';
  const ads = isOrder ? ledger?.adsEur ?? null : isEbayTxAdFee(row) ? row.netEur : null;
  const label = isOrder ? ledger?.labelEur ?? null : row.kind === 'label' ? row.netEur : null;
  const fvf = isOrder ? ledger?.fvfEur ?? null : null;
  const rolledIntoOrder = !isOrder && !!row.orderId && (row.kind === 'label' || isEbayTxAdFee(row));
  const pocket = isOrder ? ledger?.pocketEur ?? row.netEur : rolledIntoOrder ? null : row.netEur;
  const realOrderId = isRealEbayOrderId(row.orderId);
  const orderUrl = realOrderId ? buildEbayOrderUrl(row.orderId) : undefined;
  return { detail, isOrder, isFullRefund, isPartialRefund, ads, label, fvf, rolledIntoOrder, pocket, realOrderId, orderUrl };
}

function TxRow({
  row,
  ledger,
  linked,
  feeAbsorbedItem,
  refundState,
  matchActive,
  presets,
  extras,
  onSetLabel,
  onClearLabel,
  onMatch,
  onUnlinkItem,
}: {
  row: EbayTxRow;
  ledger: EbayTxOrderLedger | null;
  linked: InventoryItem | null;
  /** Item that absorbed this order's refund/cancellation fee, if any — see refundFeeAbsorption.ts. */
  feeAbsorbedItem?: InventoryItem | null;
  refundState: EbayTxOrderRefundState;
  matchActive?: boolean;
  presets: DhlLabelPreset[];
  extras: number[];
  onSetLabel: (orderId: string, amountEur: number, name?: string) => void;
  onClearLabel: (orderId: string) => void;
  onMatch: () => void;
  onUnlinkItem?: (item: InventoryItem, orderId: string) => void;
}) {
  const { detail, isOrder, isFullRefund, isPartialRefund, ads, label, fvf, pocket, realOrderId, orderUrl } =
    deriveTxRowDisplay(row, ledger, refundState);
  const rowClass = matchActive
    ? 'border-t border-indigo-200 bg-indigo-50/80 hover:bg-indigo-50 ring-1 ring-inset ring-indigo-300/80'
    : isFullRefund
      ? 'border-t border-red-200 bg-red-50/70 hover:bg-red-50 ring-1 ring-inset ring-red-300/80'
      : isPartialRefund
        ? 'border-t border-amber-200 bg-amber-50/60 hover:bg-amber-50 ring-1 ring-inset ring-amber-300/70'
        : row.source === 'inventory'
          ? 'border-t border-sky-100 bg-sky-50/40 hover:bg-sky-50/60'
          : 'border-t border-slate-100 hover:bg-slate-50/80';
  return (
    <tr className={rowClass} title={isFullRefund ? 'Fully refunded' : isPartialRefund ? 'Partial refund' : row.source === 'inventory' ? 'From inventory — not yet in CSV' : undefined}>
      <td className="px-1.5 py-1.5 whitespace-nowrap text-slate-600 tabular-nums">{row.createdAt || '—'}</td>
      <td className="px-1.5 py-1.5">
        <span className={`inline-flex px-1.5 py-0.5 rounded border text-[10px] font-bold ${KIND_TONE[row.kind]}`}>
          {row.typeRaw || classifyEbayTxType(row.typeRaw)}
        </span>
      </td>
      <td className="px-1.5 py-1.5 font-mono text-[10px] text-slate-700 whitespace-nowrap max-w-[8.25rem]">
        {realOrderId ? (
          <span className="inline-flex items-center gap-1.5 max-w-full min-w-0">
            <span className="min-w-0 truncate">{row.orderId}</span>
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
          </span>
        ) : row.orderId && row.source === 'inventory' ? (
          <span className="text-slate-400" title="Inventory sale without a stored eBay order number">
            —
          </span>
        ) : row.orderId ? (
          <span className="truncate">{row.orderId}</span>
        ) : (
          '—'
        )}
      </td>
      <td className="px-1.5 py-1.5 text-slate-700 truncate max-w-0" title={row.buyerName || row.buyerUsername}>
        {row.buyerUsername || row.buyerName || '—'}
      </td>
      <td className="px-1.5 py-1.5 text-slate-700 truncate max-w-0" title={detail}>
        {detail}
      </td>
      <td className="px-1.5 py-1.5 max-w-0">
        {isOrder && realOrderId ? (
          <div className="flex items-center gap-0.5 min-w-0">
            <button
              type="button"
              onClick={onMatch}
              title={
                matchActive
                  ? 'Close match panel'
                  : isFullRefund && feeAbsorbedItem
                    ? `Fee absorbed into ${feeAbsorbedItem.name} — still a candidate, click to relink once you find the real order`
                    : isFullRefund
                      ? 'Cancelled sale — pick the item that ate this fee, or find the later resale order'
                      : linked
                        ? `Linked: ${linked.name}`
                        : 'Match sold inventory item'
              }
              className={`inline-flex items-center gap-1 flex-1 min-w-0 px-1.5 py-0.5 rounded-md border text-[10px] font-bold ${
                matchActive
                  ? 'border-indigo-300 bg-indigo-100 text-indigo-900'
                  : isFullRefund && feeAbsorbedItem
                    ? 'border-violet-300 bg-violet-100 text-violet-900 hover:border-violet-400'
                    : isFullRefund
                      ? 'border-red-200 bg-red-50 text-red-700 hover:border-red-300'
                      : linked
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-400'
              }`}
            >
              {linked || feeAbsorbedItem ? <CheckCircle2 size={11} className="shrink-0" /> : <Link2 size={11} className="shrink-0" />}
              <span className="truncate min-w-0">
                {linked
                  ? linked.name
                  : isFullRefund && feeAbsorbedItem
                    ? `Absorbed → ${feeAbsorbedItem.name}`
                    : matchActive
                      ? 'Matching…'
                      : isFullRefund
                        ? 'Refunded'
                        : 'Match'}
              </span>
            </button>
            {linked && onUnlinkItem && row.orderId ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onUnlinkItem(linked, row.orderId);
                }}
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100"
                title={`Unlink ${linked.name} — archive sale, return to stock, free this order to match again`}
                aria-label={`Unlink ${linked.name} from order ${row.orderId}`}
              >
                <Unlink size={11} strokeWidth={2.25} />
              </button>
            ) : null}
          </div>
        ) : (
          <span className="text-slate-300">—</span>
        )}
      </td>
      <td className={`px-1.5 py-1.5 text-right tabular-nums font-semibold whitespace-nowrap ${amountClass(row.itemSubtotalEur)}`}>
        {formatSigned(row.itemSubtotalEur)}
      </td>
      <td className={`px-1.5 py-1.5 text-right tabular-nums font-semibold whitespace-nowrap ${amountClass(row.shippingEur)}`} title="Buyer paid">
        {formatSigned(row.shippingEur)}
      </td>
      <td className={`px-1.5 py-1.5 text-right tabular-nums font-semibold whitespace-nowrap ${deductionClass(fvf)}`}>
        {formatSigned(fvf)}
      </td>
      <td className={`px-1.5 py-1.5 text-right tabular-nums font-semibold whitespace-nowrap ${deductionClass(ads)}`}>
        {formatSigned(ads)}
      </td>
      <LabelCell
        isOrder={isOrder}
        orderId={row.orderId}
        label={label}
        manual={!!ledger?.labelManual}
        presets={presets}
        extras={extras}
        onSetLabel={onSetLabel}
        onClearLabel={onClearLabel}
      />
      <td className={`px-1.5 py-1.5 text-right tabular-nums font-semibold whitespace-nowrap ${amountClass(row.grossEur)}`}>
        {formatSigned(row.grossEur)}
      </td>
      <td
        className={`px-1.5 py-1.5 text-right tabular-nums font-black whitespace-nowrap ${pocketClass(pocket)}`}
        title={isOrder ? 'Item + buyer ship − FVF − ads − label' : undefined}
      >
        {formatSigned(pocket)}
      </td>
    </tr>
  );
}

function Stat({ label, value, cls }: { label: string; value: number | null | undefined; cls: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`tabular-nums font-semibold truncate ${cls}`}>{formatSigned(value)}</p>
    </div>
  );
}

/** Phone-width alternative to TxRow — same data, same handlers, laid out as a card instead of
 *  a 13-column table row. Shares deriveTxRowDisplay with TxRow so the two can't disagree on
 *  what a row's numbers mean. */
function TxCard({
  row,
  ledger,
  linked,
  feeAbsorbedItem,
  refundState,
  presets,
  extras,
  onSetLabel,
  onClearLabel,
  onMatch,
  onUnlinkItem,
}: {
  row: EbayTxRow;
  ledger: EbayTxOrderLedger | null;
  linked: InventoryItem | null;
  feeAbsorbedItem?: InventoryItem | null;
  refundState: EbayTxOrderRefundState;
  presets: DhlLabelPreset[];
  extras: number[];
  onSetLabel: (orderId: string, amountEur: number, name?: string) => void;
  onClearLabel: (orderId: string) => void;
  onMatch: () => void;
  onUnlinkItem?: (item: InventoryItem, orderId: string) => void;
}) {
  const { detail, isOrder, isFullRefund, isPartialRefund, ads, label, fvf, pocket, realOrderId, orderUrl } =
    deriveTxRowDisplay(row, ledger, refundState);
  const cardTone = isFullRefund
    ? 'border-red-200 bg-red-50/70'
    : isPartialRefund
      ? 'border-amber-200 bg-amber-50/50'
      : row.source === 'inventory'
        ? 'border-sky-100 bg-sky-50/40'
        : 'border-slate-200 bg-white';

  return (
    <div className={`rounded-xl border px-3 py-2.5 ${cardTone}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] font-bold text-slate-500 tabular-nums">{row.createdAt || '—'}</span>
            <span className={`inline-flex px-1.5 py-0.5 rounded border text-[10px] font-bold ${KIND_TONE[row.kind]}`}>
              {row.typeRaw || classifyEbayTxType(row.typeRaw)}
            </span>
            {isFullRefund ? <span className="text-[10px] font-bold text-red-600">Refunded</span> : null}
            {isPartialRefund ? <span className="text-[10px] font-bold text-amber-600">Partial refund</span> : null}
          </div>
          <p className="mt-1 text-sm font-semibold text-slate-800 truncate">{detail}</p>
          <p className="text-[11px] text-slate-500 truncate">{row.buyerUsername || row.buyerName || '—'}</p>
        </div>
        {orderUrl ? (
          <a
            href={orderUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-sky-300 bg-sky-50 text-sky-700"
            title={`Open eBay order ${row.orderId} ↗`}
            aria-label={`Open eBay order ${row.orderId}`}
          >
            <ExternalLink size={12} strokeWidth={2.25} />
          </a>
        ) : null}
      </div>

      <div className="mt-2 grid grid-cols-4 gap-x-2 gap-y-1.5 text-[11px]">
        <Stat label="Item" value={row.itemSubtotalEur} cls={amountClass(row.itemSubtotalEur)} />
        <Stat label="Ship" value={row.shippingEur} cls={amountClass(row.shippingEur)} />
        <Stat label="FVF" value={fvf} cls={deductionClass(fvf)} />
        <Stat label="Ads" value={ads} cls={deductionClass(ads)} />
        <div className="min-w-0">
          <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Label</p>
          <LabelCell
            as="div"
            isOrder={isOrder}
            orderId={row.orderId}
            label={label}
            manual={!!ledger?.labelManual}
            presets={presets}
            extras={extras}
            onSetLabel={onSetLabel}
            onClearLabel={onClearLabel}
          />
        </div>
        <Stat label="Gross" value={row.grossEur} cls={amountClass(row.grossEur)} />
        <div className="col-span-2 min-w-0" title={isOrder ? 'Item + buyer ship − FVF − ads − label' : undefined}>
          <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Pocket</p>
          <p className={`tabular-nums font-black ${pocketClass(pocket)}`}>{formatSigned(pocket)}</p>
        </div>
      </div>

      {isOrder && realOrderId ? (
        <div className="mt-2.5 flex items-center gap-1.5">
          <button
            type="button"
            onClick={onMatch}
            className={`inline-flex flex-1 min-w-0 items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg border text-xs font-bold ${
              linked
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : isFullRefund && feeAbsorbedItem
                  ? 'border-violet-300 bg-violet-100 text-violet-900'
                  : isFullRefund
                    ? 'border-red-200 bg-red-50 text-red-700'
                    : 'border-slate-200 bg-white text-slate-600'
            }`}
          >
            {linked || feeAbsorbedItem ? <CheckCircle2 size={13} className="shrink-0" /> : <Link2 size={13} className="shrink-0" />}
            <span className="truncate">
              {linked
                ? linked.name
                : isFullRefund && feeAbsorbedItem
                  ? `Absorbed → ${feeAbsorbedItem.name}`
                  : isFullRefund
                    ? 'Refunded — find match'
                    : 'Match item'}
            </span>
          </button>
          {linked && onUnlinkItem && row.orderId ? (
            <button
              type="button"
              onClick={() => onUnlinkItem(linked, row.orderId)}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-purple-200 bg-purple-50 text-purple-700"
              title={`Unlink ${linked.name}`}
              aria-label={`Unlink ${linked.name} from order ${row.orderId}`}
            >
              <Unlink size={13} strokeWidth={2.25} />
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default EbayAbrechnungPage;
