/**
 * Seller Hub ledger: incremental scrape + Firestore mirror.
 * Daily fetch only upserts new/changed order IDs; the JSON dump is a one-time seed.
 */

import type { EbayOrderRecord } from './ebayOrderIndex';
import {
  fetchEbayHubArchiveFromCloud,
  fetchEbayHubArchiveMetaFromCloud,
  isCloudEnabled,
  writeEbayHubArchiveToCloud,
  type EbayHubArchiveCloudMeta,
} from './firebaseService';
import {
  backfillHubTitlesFromOrderIndex,
  flushHubArchivePersist,
  getHubArchiveStats,
  getHubIncrementalFromDate,
  getHubKnownOrderIdsForIncremental,
  hydrateHubArchiveIndex,
  loadHubArchiveIndex,
  upsertHubArchiveOrders,
} from './ebayHubArchiveIndex';
import { invalidateEbaySalesSyncPeekCache } from './ebaySalesSync';
import {
  hubOrdersFromBrowserDump,
  isHubBrowserDump,
  parseHubBrowserDump,
} from '../utils/hubBrowserDump';
import { todayLocalDateKey } from '../utils/calendarDate';

const HUB_DAILY_BOOT_PARSE_KEY = 'ebay_hub_daily_boot_parse_v1';

function hubBootParseRanToday(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(HUB_DAILY_BOOT_PARSE_KEY) === todayLocalDateKey();
}

function markHubBootParseDone(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(HUB_DAILY_BOOT_PARSE_KEY, todayLocalDateKey());
}

export interface HubArchiveSyncResult {
  ok: boolean;
  code?: string;
  error?: string;
  hint?: string;
  openUrl?: string;
  fromDate?: string;
  toDate?: string;
  listed?: number;
  scraped?: number;
  added?: number;
  merged?: number;
  total?: number;
  cloudPushed?: number;
  persistError?: string;
  cloudError?: string;
  orders?: EbayOrderRecord[];
}

export interface HubArchiveCloudSyncResult {
  pulled: number;
  seeded: number;
  skipped: boolean;
  error?: string;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function cloudMetaFromLocal(): EbayHubArchiveCloudMeta {
  const { meta } = loadHubArchiveIndex();
  const stats = getHubArchiveStats();
  return {
    updatedAt: meta.updatedAt,
    count: meta.count,
    fromDate: meta.fromDate,
    toDate: meta.toDate,
    fileName: meta.fileName,
    lastIncrementalAt: meta.lastIncrementalAt,
    newestDate: stats.newestDate || undefined,
  };
}

export interface HubArchivePushResult {
  ok: boolean;
  pushed: number;
  skipped: boolean;
  error?: string;
}

/** Upload only the given Hub rows (plus current meta). Skips when empty; errors when unsigned-in. */
export async function pushHubArchiveToCloud(records: EbayOrderRecord[]): Promise<HubArchivePushResult> {
  if (!records.length) return { ok: true, pushed: 0, skipped: true };
  if (!isCloudEnabled()) {
    return { ok: false, pushed: 0, skipped: true, error: 'Firebase is not configured in this build.' };
  }
  try {
    await writeEbayHubArchiveToCloud(
      records as unknown as (Record<string, unknown> & { orderId: string })[],
      cloudMetaFromLocal()
    );
    return { ok: true, pushed: records.length, skipped: false };
  } catch (e) {
    const error = (e as Error)?.message || 'Failed to push Hub archive to Firebase.';
    console.warn('Failed to push Hub archive to Firebase:', e);
    return { ok: false, pushed: 0, skipped: false, error };
  }
}

export async function pullHubArchiveFromCloud(options?: { force?: boolean }): Promise<HubArchiveCloudSyncResult> {
  if (!isCloudEnabled()) return { pulled: 0, seeded: 0, skipped: true };
  try {
    await hydrateHubArchiveIndex();
    const localCount = loadHubArchiveIndex().orders.length;
    if (!options?.force && localCount > 0) {
      const remoteMeta = await fetchEbayHubArchiveMetaFromCloud();
      const localMeta = loadHubArchiveIndex().meta;
      const cloudCount = remoteMeta?.count || 0;
      const cloudNewer =
        cloudCount > localCount || (remoteMeta?.updatedAt || '') > (localMeta.updatedAt || '');
      if (!cloudNewer) return { pulled: 0, seeded: 0, skipped: true };
    }
    const cloud = await fetchEbayHubArchiveFromCloud();
    if (!cloud) return { pulled: 0, seeded: 0, skipped: true };
    const cloudOrders = cloud.orders.filter((o) =>
      Boolean(o && typeof o === 'object' && (o as { orderId?: unknown }).orderId)
    ) as unknown as EbayOrderRecord[];
    if (!cloudOrders.length) return { pulled: 0, seeded: 0, skipped: true };
    const result = upsertHubArchiveOrders(cloudOrders, {
      fileName: cloud.meta?.fileName,
      lastIncrementalAt: cloud.meta?.lastIncrementalAt,
      fromDate: cloud.meta?.fromDate,
      toDate: cloud.meta?.toDate,
    });
    await flushHubArchivePersist();
    invalidateEbaySalesSyncPeekCache();
    return { pulled: result.added + result.merged, seeded: 0, skipped: false };
  } catch (e: unknown) {
    return { pulled: 0, seeded: 0, skipped: false, error: (e as Error)?.message || 'Hub cloud pull failed.' };
  }
}

/**
 * Boot helper: restore Hub from Firebase when this browser is empty;
 * seed Firebase from the local dump when the cloud copy is still empty.
 */
export async function syncHubArchiveWithCloud(): Promise<HubArchiveCloudSyncResult> {
  if (!isCloudEnabled()) return { pulled: 0, seeded: 0, skipped: true };
  try {
    await hydrateHubArchiveIndex();
    const local = loadHubArchiveIndex();
    const remoteMeta = await fetchEbayHubArchiveMetaFromCloud();
    const cloudCount = remoteMeta?.count || 0;

    if (!local.orders.length) {
      return pullHubArchiveFromCloud({ force: true });
    }

    if (cloudCount === 0) {
      const pushed = await pushHubArchiveToCloud(local.orders);
      if (!pushed.ok) {
        return { pulled: 0, seeded: 0, skipped: false, error: pushed.error };
      }
      return { pulled: 0, seeded: local.orders.length, skipped: false };
    }

    return pullHubArchiveFromCloud();
  } catch (e: unknown) {
    return { pulled: 0, seeded: 0, skipped: false, error: (e as Error)?.message || 'Hub cloud sync failed.' };
  }
}

async function mergeIncomingHubOrders(
  incoming: EbayOrderRecord[],
  meta: { fromDate: string; toDate: string; listed?: number }
): Promise<HubArchiveSyncResult> {
  await hydrateHubArchiveIndex();
  if (!incoming.length) {
    return {
      ok: true,
      fromDate: meta.fromDate,
      toDate: meta.toDate,
      listed: meta.listed,
      scraped: 0,
      added: 0,
      merged: 0,
      total: loadHubArchiveIndex().orders.length,
      cloudPushed: 0,
    };
  }
  const upsert = upsertHubArchiveOrders(incoming, {
    toDate: meta.toDate,
    lastIncrementalAt: new Date().toISOString(),
  });
  const persist = await flushHubArchivePersist();
  const cloud = await pushHubArchiveToCloud(upsert.changed);
  invalidateEbaySalesSyncPeekCache();
  return {
    ok: true,
    fromDate: meta.fromDate,
    toDate: meta.toDate,
    listed: meta.listed,
    scraped: incoming.length,
    added: upsert.added,
    merged: upsert.merged,
    total: upsert.total,
    cloudPushed: cloud.pushed,
    persistError: persist.ok ? undefined : persist.error,
    cloudError: cloud.ok || cloud.skipped ? undefined : cloud.error,
  };
}

/** Merge a bookmarklet / paste dump into the Hub ledger (IndexedDB + Firebase). Old rows stay. */
export async function ingestHubBrowserDump(dump: unknown): Promise<HubArchiveSyncResult> {
  const parsed =
    isHubBrowserDump(dump) ? dump : parseHubBrowserDump(typeof dump === 'string' ? dump : '');
  if (!parsed) {
    return { ok: false, code: 'scrape_error', error: 'Not a Hub browser dump.' };
  }
  const orders = hubOrdersFromBrowserDump(parsed);
  if (!orders.length) {
    return {
      ok: false,
      code: 'scrape_error',
      error: 'Dump had no readable Hub order pages.',
      hint: 'Click the bookmarklet while logged into Seller Hub → All orders.',
    };
  }
  return mergeIncomingHubOrders(orders, {
    fromDate: getHubIncrementalFromDate(),
    toDate: todayISO(),
    listed: parsed.pages.length,
  });
}

export async function pollHubBrowserIngestInbox(): Promise<HubArchiveSyncResult | null> {
  try {
    const res = await fetch('/api/ebay-hub-browser-ingest', { method: 'GET' });
    const data = (await res.json().catch(() => null)) as { ok?: boolean; dump?: unknown } | null;
    if (!data?.ok || !data.dump) return null;
    return ingestHubBrowserDump(data.dump);
  } catch {
    return null;
  }
}

export type HubAppVisitSyncOutcome =
  | { status: 'skipped'; reason: 'already_ran' | 'already_parsed_today' | 'offline' }
  | {
      status: 'ok';
      mode: 'scrape' | 'cloud' | 'inbox';
      added: number;
      merged: number;
      scraped: number;
      total: number;
      listed?: number;
      upToDate?: boolean;
    }
  | { status: 'error'; code?: string; error?: string; hint?: string };

export interface HubPreflightResult {
  ok?: boolean;
  code?: string;
  cdpAvailable?: boolean;
  loginInProgress?: boolean;
  hubReady?: boolean;
  tabs?: string[];
  hint?: string;
  openUrl?: string;
}

/** Check Chrome tabs before scraping — skip when eBay/Google sign-in is in progress. */
export async function fetchHubPreflight(): Promise<HubPreflightResult> {
  try {
    const res = await fetch('/api/ebay-hub-preflight', { method: 'GET' });
    return (await res.json().catch(() => ({}))) as HubPreflightResult;
  } catch {
    return { ok: false, cdpAvailable: false, loginInProgress: false, hubReady: false, tabs: [] };
  }
}

/** @deprecated use HubAppVisitSyncOutcome */
export type HubBootSyncOutcome = HubAppVisitSyncOutcome;

/** True when this browser can reach the local Hub scrape API (localhost dev server). */
export function isLocalHubScrapeAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || import.meta.env.DEV;
}

let hubAppVisitSyncRan = false;

export function resetHubAppVisitSyncForRetry() {
  hubAppVisitSyncRan = false;
}

/**
 * Run once per page load when the user opens the panel (/panel).
 * - Local dev: incremental Seller Hub scrape (skips ~950+ known IDs from IndexedDB).
 * - Live/deployed: pull the Hub ledger from Firebase (scraped on local dev, pushed to cloud).
 */
export async function runHubSyncOnAppVisit(options?: { force?: boolean }): Promise<HubAppVisitSyncOutcome> {
  if (hubAppVisitSyncRan) {
    return { status: 'skipped', reason: 'already_ran' };
  }

  await hydrateHubArchiveIndex();

  if (isLocalHubScrapeAvailable()) {
    if (!options?.force && hubBootParseRanToday()) {
      hubAppVisitSyncRan = true;
      return { status: 'skipped', reason: 'already_parsed_today' };
    }

    const preflight = await fetchHubPreflight();
    if (preflight.loginInProgress) {
      return {
        status: 'error',
        code: 'ebay_login_in_progress',
        error: 'Finish signing into eBay in Chrome first.',
        hint:
          preflight.hint ||
          'Complete Google/eBay login in the Seller Hub tab. Hub sync waits until you click Retry — it will not interrupt sign-in.',
      };
    }

    hubAppVisitSyncRan = true;

    const inbox = await pollHubBrowserIngestInbox();
    if (inbox?.ok && ((inbox.added ?? 0) > 0 || (inbox.merged ?? 0) > 0)) {
      const filled = backfillHubTitlesFromOrderIndex();
      if (filled.filled) await flushHubArchivePersist();
      markHubBootParseDone();
      return {
        status: 'ok',
        mode: 'inbox',
        added: inbox.added ?? 0,
        merged: inbox.merged ?? 0,
        scraped: inbox.scraped ?? 0,
        total: inbox.total ?? loadHubArchiveIndex().orders.length,
      };
    }

    const result = await fetchNewHubOrdersFromSellerHub();
    if (result.ok) {
      const filled = backfillHubTitlesFromOrderIndex();
      if (filled.filled) await flushHubArchivePersist();
      const added = result.added ?? 0;
      const merged = result.merged ?? 0;
      const total = result.total ?? loadHubArchiveIndex().orders.length;
      const listed = result.listed ?? 0;
      if (added === 0 && merged === 0 && listed === 0) {
        return {
          status: 'error',
          code: 'hub_empty',
          error: 'Seller Hub returned no orders. Sign into eBay.de in the Seller Hub Chrome tab first.',
          hint: 'Use the other Chrome tab (Seller Hub / Bestellungen), complete sign-in, then press F5 on this panel.',
        };
      }
      markHubBootParseDone();
      return {
        status: 'ok',
        mode: 'scrape',
        added,
        merged,
        scraped: result.scraped ?? 0,
        total,
        listed,
        upToDate: added === 0 && merged === 0 && listed > 0,
      };
    }
    if (result.code === 'cdp_unavailable' || result.code === 'network') {
      if (isCloudEnabled()) {
        const cloud = await pullHubArchiveFromCloud();
        if (cloud.pulled > 0) {
          const filled = backfillHubTitlesFromOrderIndex();
          if (filled.filled) await flushHubArchivePersist();
          return {
            status: 'ok',
            mode: 'cloud',
            added: cloud.pulled,
            merged: 0,
            scraped: 0,
            total: loadHubArchiveIndex().orders.length,
          };
        }
      }
      return {
        status: 'error',
        code: result.code,
        error: result.error || 'Could not reach Chrome for Seller Hub scrape.',
        hint:
          result.hint ||
          'Double-click "Inventory Pro" on your Desktop, then open the panel again.',
      };
    }
    if (result.code !== 'local_only') {
      return { status: 'error', code: result.code, error: result.error, hint: result.hint };
    }
  } else {
    hubAppVisitSyncRan = true;
  }

  if (isCloudEnabled()) {
    const cloud = await pullHubArchiveFromCloud();
    if (cloud.error) {
      return { status: 'error', error: cloud.error };
    }
    if (cloud.pulled > 0) {
      const filled = backfillHubTitlesFromOrderIndex();
      if (filled.filled) await flushHubArchivePersist();
      return {
        status: 'ok',
        mode: 'cloud',
        added: cloud.pulled,
        merged: 0,
        scraped: 0,
        total: loadHubArchiveIndex().orders.length,
      };
    }
  }

  return { status: 'skipped', reason: 'offline' };
}

/** @deprecated use runHubSyncOnAppVisit */
export async function runHubBootIncrementalSync(): Promise<HubAppVisitSyncOutcome> {
  return runHubSyncOnAppVisit();
}

export async function fetchNewHubOrdersFromSellerHub(options?: {
  fromDate?: string;
  toDate?: string;
}): Promise<HubArchiveSyncResult> {
  const fromDate = options?.fromDate || getHubIncrementalFromDate();
  const toDate = options?.toDate || todayISO();
  await hydrateHubArchiveIndex();
  const knownOrderIds = getHubKnownOrderIdsForIncremental();

  let res: Response;
  try {
    res = await fetch('/api/ebay-hub-archive-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fromDate, toDate, knownOrderIds }),
    });
  } catch (e) {
    return {
      ok: false,
      code: 'network',
      error: (e as Error)?.message || 'Could not reach the Hub scrape API.',
      hint: 'Run npm run dev:ebay so Vite can talk to Chrome on port 9222.',
    };
  }

  const data = (await res.json().catch(() => null)) as HubArchiveSyncResult | null;
  if (!data) {
    return { ok: false, code: 'scrape_error', error: `Hub sync failed (${res.status}).` };
  }
  if (!data.ok) return { ...data, fromDate, toDate };

  const incoming = Array.isArray(data.orders) ? data.orders : [];
  const merged = await mergeIncomingHubOrders(incoming, { fromDate, toDate, listed: data.listed });
  return { ...data, ...merged, ok: true, orders: undefined };
}
