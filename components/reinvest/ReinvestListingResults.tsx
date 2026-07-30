import React, { useEffect, useState } from 'react';
import { ExternalLink, Loader2 } from 'lucide-react';
import { fetchListings, type DealwatchListing } from '../../services/dealwatchApi';
import { formatEURPrefix } from '../../utils/formatMoney';

type Props = {
  query: string;
  marketplace: 'ebay' | 'kleinanzeigen';
  /** Recommended max buy price — lots at or below this are highlighted. */
  maxPrice?: number;
};

type LoadState = { loading: boolean; error: string | null; items: DealwatchListing[] };

/** Green/amber/red vs the recommended buy price — a quick visual "is this lot worth it". */
function priceBandClass(price: number | undefined, maxPrice: number | undefined): string {
  if (!price || !maxPrice) return 'border-slate-200';
  if (price <= maxPrice * 0.9) return 'border-emerald-300 bg-emerald-50';
  if (price <= maxPrice * 1.05) return 'border-amber-300 bg-amber-50';
  return 'border-rose-300 bg-rose-50';
}

const ReinvestListingResults: React.FC<Props> = ({ query, marketplace, maxPrice }) => {
  const [state, setState] = useState<LoadState>({ loading: true, error: null, items: [] });

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, error: null, items: [] });
    fetchListings({ query, marketplace, minPrice: 1, maxPrice, condition: 'any' })
      .then((res) => {
        if (cancelled) return;
        setState({ loading: false, error: res.error || null, items: (res.items || []).slice(0, 12) });
      })
      .catch((err) => {
        if (cancelled) return;
        setState({ loading: false, error: err instanceof Error ? err.message : 'Failed to load listings', items: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [query, marketplace, maxPrice]);

  return (
    <div className="rounded-xl border border-slate-200 overflow-hidden">
      <div className="px-3 py-2 bg-slate-50 border-b border-slate-100 text-[10px] font-black uppercase tracking-widest text-slate-500">
        {marketplace === 'ebay' ? 'eBay.de' : 'Kleinanzeigen'} — "{query}"
      </div>
      {state.loading ? (
        <p className="p-4 text-xs text-slate-500 font-semibold flex items-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Searching…
        </p>
      ) : state.error ? (
        <p className="p-4 text-xs font-semibold text-rose-600">{state.error}</p>
      ) : !state.items.length ? (
        <p className="p-4 text-xs font-semibold text-slate-400">No listings found under €{maxPrice ?? '—'}.</p>
      ) : (
        <div className="divide-y divide-slate-100 max-h-80 overflow-y-auto">
          {state.items.map((item) => (
            <a
              key={item.id}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center gap-2 px-3 py-2 hover:bg-slate-50 border-l-4 ${priceBandClass(item.price ?? item.total, maxPrice)}`}
            >
              {item.image && (
                <img src={item.image} alt="" className="w-9 h-9 rounded-md object-cover shrink-0 bg-slate-100" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-slate-800 truncate">{item.title}</p>
                <p className="text-[10px] text-slate-400 font-semibold">
                  {item.condition || 'condition n/a'}
                  {item.seller ? ` · ${item.seller}` : ''}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-sm font-black text-slate-900">
                  {item.price != null ? formatEURPrefix(item.price) : '—'}
                </p>
                {item.shippingKnown && item.shipping != null && (
                  <p className="text-[10px] text-slate-400">+{formatEURPrefix(item.shipping)} ship</p>
                )}
              </div>
              <ExternalLink size={13} className="text-slate-300 shrink-0" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
};

export default ReinvestListingResults;
