import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, History, Layers, MessageCircle, Package, Search } from 'lucide-react';
import type { BulkImportRecord, InventoryItem } from '../types';
import {
  bulkImportSourceLabel,
  chatProofFromBulkMembers,
  countBulkImportItems,
} from '../utils/bulkImportHistory';
import { formatEUR } from '../utils/formatMoney';

interface Props {
  records: BulkImportRecord[];
  items: InventoryItem[];
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isViewableImageUrl(url: string): boolean {
  const s = (url || '').trim();
  return s.startsWith('data:image/') || /^https?:\/\//i.test(s);
}

const BulkImportHistoryPage: React.FC<Props> = ({ records, items }) => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  const itemsById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const sorted = useMemo(
    () =>
      [...records].sort(
        (a, b) => (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0)
      ),
    [records]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((r) => {
      const fromMembers = chatProofFromBulkMembers(r.itemIds, itemsById);
      const chatUrl = r.kleinanzeigenBuyChatUrl || fromMembers.kleinanzeigenBuyChatUrl || '';
      const hay = [r.label, r.source, r.buyDate, r.platformBought, r.id, chatUrl]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [sorted, query, itemsById]);

  return (
    <div className="w-full min-w-0 -mx-2 sm:-mx-4 md:-mx-6 lg:-mx-8 px-2 sm:px-4 md:px-6 lg:px-8 pb-10 animate-in fade-in duration-300">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4 min-w-0">
          <div className="p-3 rounded-2xl bg-slate-900 text-white shrink-0 shadow-lg shadow-slate-900/15">
            <Layers size={26} />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl md:text-3xl font-black text-slate-900 tracking-tight">
              Bulk import history
            </h1>
            <p className="text-sm text-slate-500 font-medium mt-1">
              Every Bulk Entry confirm (manual, paste, or AI parse). Chat URL and archived
              screenshot are kept on the session when you added purchase proof.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => navigate('/panel/add-bulk')}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-800"
        >
          <Package size={16} />
          New bulk entry
        </button>
      </header>

      <div className="mb-4 relative max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search label, source, date, chat URL…"
          className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium focus:outline-none focus:ring-2 focus:ring-slate-900/10"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center">
          <History size={40} className="mx-auto mb-3 text-slate-300" />
          <p className="font-bold text-slate-500">
            {records.length === 0 ? 'No bulk imports yet' : 'No matches'}
          </p>
          <p className="text-sm text-slate-400 mt-1">
            {records.length === 0
              ? 'Confirm a Bulk Entry to start tracking sessions here.'
              : 'Try a different search.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((record) => {
            const counts = countBulkImportItems(record, itemsById);
            const fromMembers = chatProofFromBulkMembers(record.itemIds, itemsById);
            const chatUrl = (
              record.kleinanzeigenBuyChatUrl ||
              fromMembers.kleinanzeigenBuyChatUrl ||
              ''
            ).trim();
            const chatImage = (
              record.kleinanzeigenBuyChatImage ||
              fromMembers.kleinanzeigenBuyChatImage ||
              ''
            ).trim();
            const showImage = isViewableImageUrl(chatImage);

            return (
              <button
                key={record.id}
                type="button"
                onClick={() =>
                  navigate(`/panel/inventory?bulkImport=${encodeURIComponent(record.id)}`)
                }
                className="w-full text-left rounded-2xl border border-slate-200 bg-white p-4 hover:border-slate-300 hover:bg-slate-50/80 transition-colors shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 flex gap-3">
                    {showImage && (
                      <a
                        href={chatImage}
                        target="_blank"
                        rel="noreferrer"
                        title="Open archived chat screenshot"
                        onClick={(e) => e.stopPropagation()}
                        className="w-14 h-14 rounded-xl overflow-hidden border border-slate-200 bg-slate-100 shrink-0"
                      >
                        <img
                          src={chatImage}
                          alt="Chat screenshot"
                          className="w-full h-full object-cover"
                        />
                      </a>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wide border bg-violet-50 text-violet-800 border-violet-200">
                          {bulkImportSourceLabel(record.source)}
                        </span>
                        <span className="text-xs font-semibold text-slate-400">
                          {formatWhen(record.createdAt)}
                        </span>
                        {(chatUrl || chatImage) && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wide border bg-emerald-50 text-emerald-800 border-emerald-200">
                            <MessageCircle size={10} />
                            Chat proof
                          </span>
                        )}
                      </div>
                      <p className="font-bold text-slate-900 truncate">{record.label}</p>
                      <p className="text-xs text-slate-500 mt-1">
                        Buy date {record.buyDate || '—'}
                        {record.platformBought ? ` · ${record.platformBought}` : ''}
                        {record.bundleId ? ' · Bundle' : ''}
                      </p>
                      {chatUrl && (
                        <a
                          href={chatUrl}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="mt-2 inline-flex items-center gap-1.5 max-w-full text-[11px] font-bold text-sky-700 hover:underline"
                          title={chatUrl}
                        >
                          <ExternalLink size={12} className="shrink-0" />
                          <span className="truncate">{chatUrl}</span>
                        </a>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0 space-y-1">
                    <p className="text-sm font-black text-slate-900">
                      {formatEUR(record.totalCost)}
                    </p>
                    <p className="text-[11px] font-bold text-slate-500">
                      {record.itemCount} items
                    </p>
                    <p className="text-[11px] font-semibold text-slate-500">
                      {counts.inStock} in stock · {counts.sold} sold
                      {counts.missing > 0 ? ` · ${counts.missing} missing` : ''}
                    </p>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default BulkImportHistoryPage;
