import type { LiveDeal } from '../services/geminiService';
import { matchesItemConditions } from '../services/dealSearchConditions';
import type { DealItemCondition } from '../services/dealSearchConditions';

export type DealWatchlistItem = LiveDeal & { savedAt: string; searchId?: string; dealScore?: number };

const WATCHLIST_KEY = 'deal_watchlist_v1';
const ALERTS_KEY = 'deal_price_alerts_v1';

export function loadDealWatchlist(): DealWatchlistItem[] {
  try {
    const raw = localStorage.getItem(WATCHLIST_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveToWatchlist(deal: LiveDeal, searchId?: string, dealScore?: number): DealWatchlistItem[] {
  const list = loadDealWatchlist();
  if (list.some((d) => d.url === deal.url)) return list;
  const next = [{ ...deal, savedAt: new Date().toISOString(), searchId, dealScore }, ...list].slice(0, 100);
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(next));
  return next;
}

export function removeFromWatchlist(url: string): DealWatchlistItem[] {
  const next = loadDealWatchlist().filter((d) => d.url !== url);
  localStorage.setItem(WATCHLIST_KEY, JSON.stringify(next));
  return next;
}

export type PriceAlert = {
  id: string;
  searchId: string;
  query: string;
  maxPrice: number;
  enabled: boolean;
  lastTriggered?: string;
};

export function loadPriceAlerts(): PriceAlert[] {
  try {
    const raw = localStorage.getItem(ALERTS_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function upsertPriceAlert(alert: PriceAlert): void {
  const list = loadPriceAlerts().filter((a) => a.id !== alert.id);
  list.unshift(alert);
  localStorage.setItem(ALERTS_KEY, JSON.stringify(list.slice(0, 50)));
}

/** Simple deal score 0–100 vs max buy price (#35). */
export function computeDealScore(dealPrice: number, maxPrice: number, marketAvg?: number): number {
  if (maxPrice <= 0 && !marketAvg) return 50;
  const ref = marketAvg && marketAvg > 0 ? marketAvg : maxPrice;
  if (ref <= 0 || dealPrice <= 0) return 40;
  const ratio = dealPrice / ref;
  if (ratio <= 0.7) return 95;
  if (ratio <= 0.85) return 80;
  if (ratio <= 1) return 60;
  return 30;
}

export function filterDealByFlags(
  deal: LiveDeal,
  opts: {
    excludeVB?: boolean;
    excludeTausch?: boolean;
    plz?: string;
    maxKm?: number;
    itemConditions?: DealItemCondition[];
  }
): boolean {
  const t = `${deal.title} ${deal.price}`.toLowerCase();
  if (opts.excludeVB && (t.includes('vb') || t.includes('verhandlungsbasis'))) return false;
  if (opts.excludeTausch && (t.includes('tausch') || t.includes('swap'))) return false;
  if (opts.plz && opts.plz.length >= 4) {
    if (!t.includes(opts.plz.slice(0, 4))) return false;
  }
  if (!matchesItemConditions(deal, opts.itemConditions)) return false;
  return true;
}
