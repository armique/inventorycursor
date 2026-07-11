import React, { useCallback, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ShoppingBag,
  TrendingDown,
} from 'lucide-react';
import { InventoryItem, ItemStatus, TaxMode } from '../types';
import { clearPendingReminder } from '../services/ebayListingReminder';
import { fetchMyEbayListings, getEbayUsername } from '../services/ebayService';
import {
  compareEbayListingSnapshots,
  loadEbayListingSnapshot,
  saveEbayListingSnapshot,
  type EbayListingSnapshotEntry,
} from '../services/ebayListingSnapshot';
import {
  buildEbaySoldDetectionPlan,
  defaultSellPriceForDetection,
  type EbaySoldDetectionMatch,
} from '../utils/ebaySoldDetectionPlan';
import { formatEUR, parseLocaleNumber } from '../utils/formatMoney';
import { computeItemProfitBeforeOverhead } from '../services/financialAggregation';
import type { ParsedEbayOrderScreenshot } from '../services/ebayOrderScreenshotAI';
import EbayOrderScreenshotInline from './EbayOrderScreenshotInline';

interface SoldRowState {
  selected: boolean;
  confirmed: boolean;
  sellPrice: string;
  sellDate: string;
  ebayOrderId: string;
  ebayUsername: string;
  buyerName: string;
}

interface Props {
  items: InventoryItem[];
  taxMode: TaxMode;
  onUpdate: (items: InventoryItem[]) => void;
  onPublishCatalog?: () => void | Promise<void>;
}

function defaultSoldRowState(match: EbaySoldDetectionMatch): SoldRowState {
  return {
    selected: true,
    confirmed: false,
    sellPrice: defaultSellPriceForDetection(match.item, match.lastKnownListing),
    sellDate: new Date().toISOString().split('T')[0],
    ebayOrderId: '',
    ebayUsername: '',
    buyerName: '',
  };
}

function matchKindLabel(kind: EbaySoldDetectionMatch['matchKind']): string {
  if (kind === 'listing_id') return 'Linked listing';
  if (kind === 'sku') return 'SKU match';
  return 'Title match';
}

const EbayStorePullSoldTab: React.FC<Props> = ({ items, taxMode, onUpdate, onPublishCatalog }) => {
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [applyMessage, setApplyMessage] = useState<string | null>(null);
  const [matches, setMatches] = useState<EbaySoldDetectionMatch[]>([]);
  const [unmatched, setUnmatched] = useState<EbayListingSnapshotEntry[]>([]);
  const [snapshotMeta, setSnapshotMeta] = useState<{ previousAt: string; disappeared: number } | null>(null);
  const [rowState, setRowState] = useState<Record<string, SoldRowState>>({});

  const rowKey = (match: EbaySoldDetectionMatch) => match.item.id;

  const previousSnapshot = loadEbayListingSnapshot();

  const checkForSold = useCallback(async () => {
    setLoading(true);
    setError(null);
    setInfo(null);
    setApplyMessage(null);
    setMatches([]);
    setUnmatched([]);
    setSnapshotMeta(null);
    setRowState({});

    try {
      const listings = await fetchMyEbayListings();
      const prev = loadEbayListingSnapshot();

      if (!prev) {
        saveEbayListingSnapshot(listings, getEbayUsername());
        setInfo(
          `Saved baseline snapshot of ${listings.length} active listing${listings.length === 1 ? '' : 's'}. Run this check again after listings disappear to detect likely sales.`
        );
        return;
      }

      const { disappeared } = compareEbayListingSnapshots(prev.entries, listings);
      saveEbayListingSnapshot(listings, getEbayUsername());

      if (!disappeared.length) {
        setInfo(
          `No listings disappeared since ${new Date(prev.meta.capturedAt).toLocaleString()}. Snapshot updated (${listings.length} active).`
        );
        return;
      }

      const plan = buildEbaySoldDetectionPlan(items, disappeared);
      setMatches(plan.matches);
      setUnmatched(plan.unmatchedDisappeared);
      setSnapshotMeta({
        previousAt: prev.meta.capturedAt,
        disappeared: disappeared.length,
      });

      const initial: Record<string, SoldRowState> = {};
      for (const match of plan.matches) {
        initial[rowKey(match)] = defaultSoldRowState(match);
      }
      setRowState(initial);
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to check eBay listings.');
    } finally {
      setLoading(false);
    }
  }, [items]);

  const updateRow = (key: string, patch: Partial<SoldRowState>) => {
    setRowState((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };

  const applyParsedOrder = (key: string, data: ParsedEbayOrderScreenshot) => {
    setRowState((prev) => {
      const row = prev[key];
      if (!row) return prev;
      const next: SoldRowState = { ...row };
      if (data.ebayOrderId) next.ebayOrderId = data.ebayOrderId;
      if (data.ebayUsername) next.ebayUsername = data.ebayUsername;
      if (data.buyerFullName) next.buyerName = data.buyerFullName;
      if (data.amountReceivedNetEur != null && Number.isFinite(data.amountReceivedNetEur)) {
        next.sellPrice = formatEUR(data.amountReceivedNetEur);
      }
      if (data.saleDate) next.sellDate = data.saleDate;
      return { ...prev, [key]: next };
    });
  };

  const readyToApply = useMemo(() => {
    return matches.filter((m) => {
      const row = rowState[rowKey(m)];
      return row?.selected && row.confirmed;
    });
  }, [matches, rowState]);

  const applyConfirmed = async () => {
    if (!readyToApply.length) return;
    setApplying(true);
    setError(null);
    try {
      const updates: InventoryItem[] = [];

      for (const match of readyToApply) {
        const key = rowKey(match);
        const row = rowState[key];
        if (!row) continue;

        const sellParsed = parseLocaleNumber(row.sellPrice);
        const sellPrice =
          row.sellPrice.trim() === '' || !Number.isFinite(sellParsed) ? undefined : sellParsed;

        const draft: InventoryItem = {
          ...match.item,
          status: ItemStatus.SOLD,
          sellPrice,
          sellDate: row.sellDate || new Date().toISOString().split('T')[0],
          platformSold: 'ebay.de',
          paymentType: 'ebay.de',
          listedOnEbay: true,
          storeVisible: false,
          ebayOrderId: row.ebayOrderId.trim() || match.item.ebayOrderId,
          ebayUsername: row.ebayUsername.trim() || match.item.ebayUsername,
          customer: row.buyerName.trim()
            ? { ...(match.item.customer || { name: '', address: '' }), name: row.buyerName.trim() }
            : match.item.customer,
          comment2: [
            match.item.comment2,
            `Marked sold via eBay Store Pull — listing ${match.lastKnownListing.listingId} ended.`,
          ]
            .filter(Boolean)
            .join('\n'),
        };

        draft.profit =
          sellPrice != null
            ? computeItemProfitBeforeOverhead(
                { ...draft, sellPrice, feeAmount: draft.feeAmount || 0 },
                taxMode
              )
            : undefined;

        updates.push(draft);
      }

      if (updates.length) {
        onUpdate(updates);
        void onPublishCatalog?.();
        clearPendingReminder();
        setApplyMessage(`Marked ${updates.length} item${updates.length === 1 ? '' : 's'} as sold.`);
        setMatches([]);
        setUnmatched([]);
        setRowState({});
        setSnapshotMeta(null);
      }
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Failed to mark items as sold.');
    } finally {
      setApplying(false);
    }
  };

  const resetBaseline = () => {
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const listings = await fetchMyEbayListings();
        saveEbayListingSnapshot(listings, getEbayUsername());
        setInfo(`Baseline reset — ${listings.length} active listings saved.`);
        setMatches([]);
        setUnmatched([]);
        setSnapshotMeta(null);
        setRowState({});
      } catch (e: unknown) {
        setError((e as Error)?.message || 'Could not reset baseline.');
      } finally {
        setLoading(false);
      }
    })();
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3 shadow-sm">
        <h2 className="text-sm font-black text-slate-900">Detect likely sales (ended listings)</h2>
        <p className="text-xs text-slate-600">
          Compares your current active eBay listings to the last saved snapshot. Listings that
          disappeared are matched to in-stock inventory and suggested as sold — with the same sell-price
          and order-screenshot parsing as the inventory sale dialog.
        </p>
        {previousSnapshot && (
          <p className="text-[11px] text-slate-500">
            Last snapshot: {new Date(previousSnapshot.meta.capturedAt).toLocaleString()} ·{' '}
            {previousSnapshot.meta.count} listings
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void checkForSold()}
            disabled={loading || applying}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-rose-600 text-white text-xs font-black uppercase tracking-widest hover:bg-rose-700 disabled:opacity-50"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <TrendingDown size={16} />}
            {loading ? 'Checking…' : 'Check for sold listings'}
          </button>
          <button
            type="button"
            onClick={resetBaseline}
            disabled={loading || applying}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-xs font-black uppercase text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            <RefreshCw size={14} />
            Reset baseline
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertCircle size={18} className="shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {info && (
        <div className="flex items-start gap-3 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
          <ShoppingBag size={18} className="shrink-0 mt-0.5" />
          {info}
        </div>
      )}

      {applyMessage && (
        <div className="flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 size={18} className="shrink-0 mt-0.5" />
          {applyMessage}
        </div>
      )}

      {snapshotMeta && matches.length > 0 && (
        <div className="rounded-2xl border border-rose-200 bg-rose-50/50 p-3 flex flex-wrap items-center gap-2">
          <p className="text-xs font-bold text-rose-900 flex-1 min-w-[200px]">
            {snapshotMeta.disappeared} listing{snapshotMeta.disappeared === 1 ? '' : 's'} ended since{' '}
            {new Date(snapshotMeta.previousAt).toLocaleString()} · {matches.length} likely sale
            {matches.length === 1 ? '' : 's'}
          </p>
          <button
            type="button"
            disabled={applying || readyToApply.length === 0}
            onClick={() => void applyConfirmed()}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest hover:bg-emerald-700 disabled:opacity-50"
          >
            {applying ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            Mark {readyToApply.length} confirmed as sold
          </button>
        </div>
      )}

      <div className="space-y-3">
        {matches.map((match) => {
          const key = rowKey(match);
          const row = rowState[key] ?? defaultSoldRowState(match);
          const listing = match.lastKnownListing;

          return (
            <div
              key={key}
              className={`rounded-2xl border bg-white overflow-hidden shadow-sm transition-all ${
                row.confirmed ? 'border-rose-200' : row.selected ? 'border-slate-300' : 'border-slate-200 opacity-70'
              }`}
            >
              <div className="p-4 space-y-3">
                <div className="flex flex-wrap gap-3 items-start">
                  <input
                    type="checkbox"
                    checked={row.selected}
                    onChange={(e) => updateRow(key, { selected: e.target.checked })}
                    className="mt-1 rounded border-slate-300"
                  />
                  {listing.thumbnail ? (
                    <img
                      src={listing.thumbnail}
                      alt=""
                      className="w-12 h-12 rounded-lg object-cover border border-slate-100 shrink-0"
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-lg bg-slate-100 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-black uppercase text-slate-400">Inventory item</p>
                    <p className="text-sm font-bold text-slate-900">{match.item.name}</p>
                    <p className="text-[10px] text-slate-500 mt-1 line-clamp-2">
                      Ended listing: {listing.title}
                      {listing.price != null ? ` · was €${formatEUR(listing.price)}` : ''}
                    </p>
                    <div className="flex flex-wrap gap-2 mt-1.5">
                      <span className="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-100">
                        {matchKindLabel(match.matchKind)}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => updateRow(key, { confirmed: !row.confirmed })}
                    className={`shrink-0 px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wide border ${
                      row.confirmed
                        ? 'bg-rose-600 text-white border-rose-600'
                        : 'bg-white text-rose-700 border-rose-200 hover:bg-rose-50'
                    }`}
                  >
                    {row.confirmed ? 'Confirmed sold' : 'Mark as sold'}
                  </button>
                </div>

                {match.warning && (
                  <p className="text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    {match.warning}
                  </p>
                )}

                {row.confirmed && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-2 border-t border-slate-100">
                    <label className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase text-slate-500">
                      Sell €
                      <input
                        type="text"
                        inputMode="decimal"
                        value={row.sellPrice}
                        onChange={(e) => updateRow(key, { sellPrice: e.target.value })}
                        placeholder={defaultSellPriceForDetection(match.item, listing) || '0,00'}
                        className="w-24 px-2 py-1.5 rounded-lg border border-slate-200 text-sm font-bold text-slate-900 outline-none focus:border-emerald-400"
                      />
                    </label>
                    <label className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase text-slate-500">
                      Date
                      <input
                        type="date"
                        value={row.sellDate}
                        onChange={(e) => updateRow(key, { sellDate: e.target.value })}
                        className="px-2 py-1.5 rounded-lg border border-slate-200 text-[11px] font-bold outline-none focus:border-emerald-400"
                      />
                    </label>
                    <EbayOrderScreenshotInline
                      onParsed={(data) => applyParsedOrder(key, data)}
                      className="flex-1 min-w-[280px]"
                    />
                    {(row.ebayOrderId || row.ebayUsername || row.buyerName) && (
                      <div className="w-full flex flex-wrap gap-2 text-[10px] text-slate-600">
                        {row.ebayOrderId && (
                          <span className="font-bold">
                            Order #{row.ebayOrderId}
                          </span>
                        )}
                        {row.ebayUsername && <span>@{row.ebayUsername}</span>}
                        {row.buyerName && <span>{row.buyerName}</span>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {unmatched.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 space-y-2">
          <p className="text-xs font-black uppercase text-amber-800">
            {unmatched.length} ended listing{unmatched.length === 1 ? '' : 's'} with no inventory match
          </p>
          <ul className="text-xs text-amber-900 space-y-1 max-h-32 overflow-y-auto">
            {unmatched.map((l) => (
              <li key={l.listingId} className="line-clamp-1">
                {l.title}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default EbayStorePullSoldTab;
