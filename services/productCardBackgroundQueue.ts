/**
 * Background AI product-card generation queue.
 * Runs in the open browser tab (API work is server-side); results always go through
 * saveGeneratedProductCard → IndexedDB + cloud gallery (same as the edit modal).
 */

import type { GeneratedProductCardEntry, InventoryItem } from '../types';
import { getItemUserPhotoUrls } from '../utils/imageImport';
import {
  fetchProductCardProviders,
  generateProductCard,
  type ProductCardProviderId,
} from './productCardGemini';
import { saveGeneratedProductCard } from './productCardGallery';
import {
  DEFAULT_PRODUCT_CARD_STYLE_ID,
  type ProductCardStyleId,
} from './productCardStyles';

export type ProductCardBgJobStatus = 'queued' | 'running' | 'done' | 'error';

export type ProductCardBgJob = {
  id: string;
  itemId: string;
  itemName: string;
  status: ProductCardBgJobStatus;
  /** e.g. "Generating card 2 / 3…" */
  progress?: string;
  error?: string;
  createdAt: string;
  completedAt?: string;
  cardsSaved: number;
  plannedCards: number;
};

export type EnqueueProductCardBgOptions = {
  categoryFields?: string[];
  styleId?: ProductCardStyleId | string;
  provider?: ProductCardProviderId;
  /** Override photo URLs; default = item user photos (max 3). */
  photos?: string[] | null;
  /** Explicit card count (1–3). Overrides photo-based batch size. */
  count?: number;
};

type Listener = (jobs: ProductCardBgJob[]) => void;

const jobs: ProductCardBgJob[] = [];
const listeners = new Set<Listener>();
let pumping = false;

/** Same batch rule as Listing Studio: 1 with no photos, else one card per photo (max 3). */
export function resolveProductCardBatchCount(photoCount: number): number {
  const n = Math.max(0, Math.floor(photoCount || 0));
  if (n <= 0) return 1;
  return Math.min(3, n);
}

export function resolveProductCardJobCount(
  photoCount: number,
  countOverride?: number
): number {
  if (countOverride != null && Number.isFinite(countOverride)) {
    return Math.max(1, Math.min(3, Math.floor(countOverride)));
  }
  return resolveProductCardBatchCount(photoCount);
}

type WakeLockLike = { release: () => Promise<void>; addEventListener: (type: 'release', fn: () => void) => void };
let wakeLockSentinel: WakeLockLike | null = null;

async function acquireWakeLock(): Promise<void> {
  try {
    const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<WakeLockLike> };
    }) : null;
    if (!nav?.wakeLock?.request) return;
    wakeLockSentinel = await nav.wakeLock.request('screen');
    wakeLockSentinel.addEventListener('release', () => {
      wakeLockSentinel = null;
    });
  } catch {
    wakeLockSentinel = null;
  }
}

async function releaseWakeLock(): Promise<void> {
  try {
    await wakeLockSentinel?.release();
  } catch {
    /* ignore */
  }
  wakeLockSentinel = null;
}

function isTransientNetworkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || '');
  return /load failed|failed to fetch|network|abort|timeout|timed out/i.test(msg);
}

async function generateProductCardWithRetry(
  item: InventoryItem,
  categoryFields: string[] | undefined,
  opts: Parameters<typeof generateProductCard>[2]
): Promise<Awaited<ReturnType<typeof generateProductCard>>> {
  try {
    return await generateProductCard(item, categoryFields, opts);
  } catch (err) {
    if (!isTransientNetworkError(err)) throw err;
    // iOS often kills in-flight fetches when backgrounding; one retry after a short settle helps on return.
    await new Promise((r) => setTimeout(r, 900));
    return await generateProductCard(item, categoryFields, opts);
  }
}

function emit() {
  const snapshot = jobs.map((j) => ({ ...j }));
  listeners.forEach((fn) => {
    try {
      fn(snapshot);
    } catch {
      /* ignore listener errors */
    }
  });
}

function newJobId(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `bgcard_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function subscribeProductCardBackgroundJobs(fn: Listener): () => void {
  listeners.add(fn);
  fn(jobs.map((j) => ({ ...j })));
  return () => {
    listeners.delete(fn);
  };
}

export function getProductCardBackgroundJobs(): ProductCardBgJob[] {
  return jobs.map((j) => ({ ...j }));
}

export function isItemProductCardJobActive(itemId: string): boolean {
  return jobs.some(
    (j) => j.itemId === itemId && (j.status === 'queued' || j.status === 'running')
  );
}

export function countActiveProductCardBackgroundJobs(): number {
  return jobs.filter((j) => j.status === 'queued' || j.status === 'running').length;
}

async function resolveProvider(
  preferred?: ProductCardProviderId
): Promise<ProductCardProviderId> {
  if (preferred) return preferred;
  try {
    const list = await fetchProductCardProviders();
    const pick =
      list.find((p) => p.id === 'openai' && p.available) ||
      list.find((p) => p.available) ||
      list[0];
    return (pick?.id as ProductCardProviderId) || 'openai';
  } catch {
    return 'openai';
  }
}

type PendingWork = {
  jobId: string;
  item: InventoryItem;
  options: EnqueueProductCardBgOptions;
};

const pending: PendingWork[] = [];

async function runOne(work: PendingWork): Promise<void> {
  const job = jobs.find((j) => j.id === work.jobId);
  if (!job) return;

  job.status = 'running';
  job.progress = 'Starting…';
  emit();

  const photos =
    work.options.photos !== undefined && work.options.photos !== null
      ? work.options.photos.slice(0, 3)
      : getItemUserPhotoUrls(work.item).slice(0, 3);
  const count = resolveProductCardJobCount(photos.length, work.options.count);
  job.plannedCards = count;
  emit();

  const styleId = work.options.styleId || DEFAULT_PRODUCT_CARD_STYLE_ID;
  const provider = await resolveProvider(work.options.provider);
  const saved: GeneratedProductCardEntry[] = [];
  const errors: string[] = [];

  await acquireWakeLock();
  try {
    for (let i = 0; i < count; i++) {
      const still = jobs.find((j) => j.id === work.jobId);
      if (!still) return;
      still.progress = `Generating card ${i + 1} / ${count}…`;
      emit();

      const jobPhotos = photos.length ? [photos[i % photos.length]] : [];
      try {
        const result = await generateProductCardWithRetry(
          work.item,
          work.options.categoryFields,
          {
            styleId,
            provider,
            photos: jobPhotos,
            editFromPhoto: jobPhotos.length > 0,
          }
        );
        const entry = await saveGeneratedProductCard({
          itemId: work.item.id,
          itemName: work.item.name,
          dataUrl: result.dataUrl,
          provider: result.provider,
          model: result.model,
          styleId: (result.styleId as string) || String(styleId),
          styleName: result.styleName,
        });
        saved.push(entry);
        still.cardsSaved = saved.length;
        emit();
      } catch (e) {
        errors.push(`Card ${i + 1}: ${e instanceof Error ? e.message : 'failed'}`);
      }
    }
  } finally {
    await releaseWakeLock();
  }

  const final = jobs.find((j) => j.id === work.jobId);
  if (!final) return;
  final.completedAt = new Date().toISOString();
  final.cardsSaved = saved.length;
  if (saved.length === 0) {
    final.status = 'error';
    final.error = errors.join('\n') || 'Generation failed';
    final.progress = undefined;
  } else {
    final.status = 'done';
    final.progress = undefined;
    final.error = errors.length ? errors.join('\n') : undefined;
  }
  emit();
}

async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    while (pending.length) {
      const work = pending.shift()!;
      try {
        await runOne(work);
      } catch (e) {
        const job = jobs.find((j) => j.id === work.jobId);
        if (job) {
          job.status = 'error';
          job.error = e instanceof Error ? e.message : 'Generation failed';
          job.completedAt = new Date().toISOString();
          job.progress = undefined;
          emit();
        }
      }
    }
  } finally {
    pumping = false;
  }
}

/**
 * Queue background card generation for an item. Returns job id.
 * No-ops (returns existing active job id) if that item already has a queued/running job.
 */
export function enqueueProductCardBackgroundJob(
  item: InventoryItem,
  options: EnqueueProductCardBgOptions = {}
): string {
  const active = jobs.find(
    (j) => j.itemId === item.id && (j.status === 'queued' || j.status === 'running')
  );
  if (active) return active.id;

  const photos =
    options.photos !== undefined && options.photos !== null
      ? options.photos.slice(0, 3)
      : getItemUserPhotoUrls(item).slice(0, 3);
  const planned = resolveProductCardJobCount(photos.length, options.count);
  const id = newJobId();
  const job: ProductCardBgJob = {
    id,
    itemId: item.id,
    itemName: item.name,
    status: 'queued',
    progress: 'Queued…',
    createdAt: new Date().toISOString(),
    cardsSaved: 0,
    plannedCards: planned,
  };
  jobs.unshift(job);
  // Keep list bounded
  while (jobs.length > 40) jobs.pop();
  pending.push({ jobId: id, item, options });
  emit();
  void pump();
  return id;
}

/** Keep screen awake + resume the queue when returning from background (iOS). */
function installVisibilityResume(): void {
  if (typeof document === 'undefined') return;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (countActiveProductCardBackgroundJobs() > 0) {
      void acquireWakeLock();
      void pump();
    }
  });
}

installVisibilityResume();

/** Remove finished jobs from the in-memory list (UI cleanup). */
export function clearFinishedProductCardBackgroundJobs(): void {
  for (let i = jobs.length - 1; i >= 0; i--) {
    if (jobs[i].status === 'done' || jobs[i].status === 'error') jobs.splice(i, 1);
  }
  emit();
}
