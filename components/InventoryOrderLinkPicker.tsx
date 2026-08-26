import React, { useEffect, useMemo, useState } from 'react';
import { Link2, Loader2, Package, Search, Tag, X } from 'lucide-react';
import { InventoryItem, TaxMode } from '../types';
import {
  loadEbayTransactionLibrary,
  loadEbayTxLabelOverrides,
  type EbayTxLabelOverride,
} from '../services/ebayTransactionReportStore';
import {
  applyEbayTxLabelOverrides,
  buildEbayTxOrderLedgers,
  formatEbayTxDay,
  mergeEbayTxReports,
  type EbayTxOrderLedger,
  type EbayTxReport,
  type EbayTxRow,
} from '../utils/ebayTransactionReport';
import { ebayTxBuyerTotalEur, linkInventoryItemToEbayTx } from '../utils/linkInventoryItemToEbayTx';
import { formatSignedEUR } from '../utils/formatMoney';
import {
  Chip,
  dateTone,
  dayKey,
  inventorySoldDay,
  priceTone,
  statusTone,
} from './EbayAbrechnungMatchPicker';

type Props = {
  item: InventoryItem;
  taxMode: TaxMode;
  onLink: (updated: InventoryItem) => void;
  onClose: () => void;
};

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Rough relevance score against the item name — used to sort and to show a "Title match" hint. */
function relevanceScore(row: EbayTxRow, itemWords: Set<string>): number {
  if (itemWords.size === 0) return 0;
  const rowWords = normalize(row.title || row.description || '').split(' ').filter(Boolean);
  let hits = 0;
  for (const w of rowWords) {
    if (w.length > 2 && itemWords.has(w)) hits += 1;
  }
  return hits;
}

const InventoryOrderLinkPicker: React.FC<Props> = ({ item, taxMode, onLink, onClose }) => {
  const [reports, setReports] = useState<EbayTxReport[] | null>(null);
  const [labelOverrides, setLabelOverrides] = useState<Record<string, EbayTxLabelOverride>>({});
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([loadEbayTransactionLibrary(), loadEbayTxLabelOverrides()]).then(
      ([library, overrides]) => {
        if (cancelled) return;
        setReports(library.reports);
        setLabelOverrides(overrides);
      }
    );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const merged = useMemo(() => (reports ? mergeEbayTxReports(reports) : null), [reports]);
  const ledgers = useMemo(
    () => applyEbayTxLabelOverrides(buildEbayTxOrderLedgers(merged?.rows || []), labelOverrides),
    [merged, labelOverrides]
  );
  const orderRows = useMemo(
    () => (merged?.rows || []).filter((row) => row.kind === 'order'),
    [merged]
  );

  const itemWords = useMemo(() => new Set(normalize(item.name || '').split(' ').filter((w) => w.length > 2)), [item.name]);
  const itemDayKey = dayKey(item.sellDate || item.containerSoldDate);
  const itemSoldDay = inventorySoldDay(item);
  const itemSell = Number(item.saleProceeds?.buyerTotalEur ?? item.sellPrice) || 0;

  const results = useMemo(() => {
    const q = normalize(search);
    let rows = orderRows;
    if (q) {
      const terms = q.split(' ').filter(Boolean);
      rows = rows.filter((row) => {
        const hay = normalize(
          [row.title, row.description, row.buyerName, row.buyerUsername, row.orderId, row.sku].join(' ')
        );
        return terms.every((t) => hay.includes(t));
      });
    }
    const sorted = [...rows].sort((a, b) => {
      if (!q) {
        const diff = relevanceScore(b, itemWords) - relevanceScore(a, itemWords);
        if (diff !== 0) return diff;
      }
      return (b.createdSort || '').localeCompare(a.createdSort || '');
    });
    return sorted.slice(0, 40);
  }, [orderRows, search, itemWords]);

  const apply = (row: EbayTxRow, renameToOrderTitle: boolean) => {
    setBusyId(row.id);
    try {
      const ledger: EbayTxOrderLedger | null = row.orderId ? ledgers.get(row.orderId) || null : null;
      const updated = linkInventoryItemToEbayTx(item, row, ledger, taxMode, { renameToOrderTitle });
      onLink(updated);
    } finally {
      setBusyId(null);
    }
  };

  const loading = reports === null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 p-0 sm:p-4 pb-safe"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white w-full max-w-[560px] rounded-t-2xl sm:rounded-2xl shadow-2xl border overflow-hidden flex flex-col max-h-[92dvh] sm:max-h-[88vh]"
      >
        <div className="shrink-0 px-4 py-3 border-b border-slate-100 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="text-sm font-black text-slate-900">Find eBay order to link</h2>
            <p className="text-[11px] font-bold text-slate-700 break-words" title={item.name}>
              {item.name}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-0.5">
              <Chip tone={statusTone(item.status)}>{item.status}</Chip>
              {itemSoldDay ? (
                <Chip tone="slate" title="Inventory sell date">
                  {itemSoldDay}
                </Chip>
              ) : null}
              {itemSell >= 0.01 ? (
                <Chip tone="slate" title="Inventory sell price">
                  {formatSignedEUR(itemSell)}
                </Chip>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 p-1 rounded-lg text-slate-400 hover:bg-slate-100"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="shrink-0 px-4 py-2 border-b border-slate-100">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search Abrechnung orders — buyer, order id, title…"
              className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 text-xs font-semibold outline-none focus:border-indigo-400"
              autoFocus
            />
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-1">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-slate-400 text-xs font-semibold">
              <Loader2 size={14} className="animate-spin" /> Loading Abrechnung orders…
            </div>
          ) : results.length === 0 ? (
            <p className="px-2 py-6 text-center text-[11px] text-slate-400">
              No matching orders — try a different search, or import more Abrechnung CSVs.
            </p>
          ) : (
            results.map((row) => {
              const busy = busyId === row.id;
              const ledger = row.orderId ? ledgers.get(row.orderId) || null : null;
              const gross = ebayTxBuyerTotalEur(row, ledger);
              const orderDayKey = dayKey(row.createdSort || row.createdAt);
              const titleHits = relevanceScore(row, itemWords);
              return (
                <div
                  key={row.id}
                  className="flex items-start gap-2 rounded-lg border border-transparent hover:border-slate-100 hover:bg-slate-50/80 px-1.5 py-1.5"
                >
                  <Package size={14} className="text-slate-400 shrink-0 mt-1" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-bold text-slate-800 break-words">
                      {row.title || row.description || 'eBay order'}
                    </p>
                    <p className="mt-0.5 text-[10px] font-semibold text-slate-500">
                      {row.buyerUsername || row.buyerName || '—'}
                      {row.orderId ? ` · ${row.orderId}` : ''}
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-0.5">
                      <Chip
                        tone={dateTone(orderDayKey, itemDayKey)}
                        title="Order date vs inventory sell date"
                      >
                        {formatEbayTxDay(row.createdSort || row.createdAt)}
                      </Chip>
                      {gross >= 0.01 ? (
                        <Chip tone={priceTone(gross, itemSell)} title="Order total vs inventory sell price">
                          {formatSignedEUR(gross)}
                        </Chip>
                      ) : null}
                      {titleHits > 0 ? (
                        <Chip tone="violet" title="Words shared with the item name">
                          Title match
                        </Chip>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-0.5 shrink-0 flex items-center gap-1">
                    <button
                      type="button"
                      disabled={busyId != null}
                      onClick={() => apply(row, false)}
                      aria-label="Link"
                      title="Link this order to the item"
                      className="h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-lg border border-indigo-400 bg-indigo-600 text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                    >
                      {busy ? <Loader2 size={13} className="animate-spin" /> : <Link2 size={13} strokeWidth={2.25} />}
                    </button>
                    <button
                      type="button"
                      disabled={busyId != null}
                      onClick={() => apply(row, true)}
                      aria-label="Link and rename"
                      title="Link and rename the item to the order title"
                      className="h-8 w-8 shrink-0 inline-flex items-center justify-center rounded-lg border border-indigo-400 bg-indigo-600 text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                    >
                      {busy ? <Loader2 size={13} className="animate-spin" /> : <Tag size={13} strokeWidth={2.25} />}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default InventoryOrderLinkPicker;
