import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Download,
  Images,
  Loader2,
  Package,
  Trash2,
  RefreshCw,
  X,
} from 'lucide-react';
import type { GeneratedProductCardEntry, InventoryItem } from '../types';
import {
  downloadProductCardEntries,
  downloadProductCardEntry,
  groupProductCardGalleryByItem,
  isProductCardGalleryCloudReady,
  listProductCardGallery,
  removeProductCardFromGallery,
  resolveProductCardImageUrl,
} from '../services/productCardGallery';
import {
  mergeMainPhotoOntoItem,
  resolveUrlForInventoryMainPhoto,
} from '../utils/applyProductCardAsMainPhoto';

interface Props {
  items: InventoryItem[];
  onUpdate: (items: InventoryItem[]) => void | Promise<void>;
}

const Thumb: React.FC<{
  entry: GeneratedProductCardEntry;
  onOpen?: () => void;
}> = ({ entry, onOpen }) => {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void resolveProductCardImageUrl(entry)
      .then((url) => {
        if (!cancelled) setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [entry]);

  if (!src) {
    return (
      <div className="w-full aspect-square bg-slate-100 flex items-center justify-center text-slate-300">
        <Images size={20} />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full text-left cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
      title="View full size"
    >
      <img
        src={src}
        alt={entry.itemName}
        className="w-full aspect-square object-cover bg-white transition-opacity hover:opacity-90"
      />
    </button>
  );
};

const ProductCardGalleryPage: React.FC<Props> = ({ items, onUpdate }) => {
  const [entries, setEntries] = useState<GeneratedProductCardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [downloadingItemId, setDownloadingItemId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [preview, setPreview] = useState<{
    entry: GeneratedProductCardEntry;
    siblings: GeneratedProductCardEntry[];
  } | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const itemById = useMemo(() => {
    const m = new Map<string, InventoryItem>();
    items.forEach((i) => m.set(i.id, i));
    return m;
  }, [items]);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEntries(await listProductCardGallery());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load gallery');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? entries.filter(
          (e) =>
            e.itemName.toLowerCase().includes(q) ||
            (e.styleName || '').toLowerCase().includes(q) ||
            (e.fileName || '').toLowerCase().includes(q)
        )
      : entries;
    return groupProductCardGalleryByItem(filtered);
  }, [entries, query]);

  useEffect(() => {
    if (!preview) {
      setPreviewSrc(null);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewSrc(null);
    void resolveProductCardImageUrl(preview.entry)
      .then((url) => {
        if (!cancelled) setPreviewSrc(url);
      })
      .catch(() => {
        if (!cancelled) setPreviewSrc(null);
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [preview]);

  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPreview(null);
        return;
      }
      const siblings = preview.siblings;
      const idx = siblings.findIndex((s) => s.id === preview.entry.id);
      if (e.key === 'ArrowLeft' && idx > 0) {
        setPreview({ entry: siblings[idx - 1]!, siblings });
      }
      if (e.key === 'ArrowRight' && idx >= 0 && idx < siblings.length - 1) {
        setPreview({ entry: siblings[idx + 1]!, siblings });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview]);

  const showToast = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2400);
  };

  const applyEntry = async (entry: GeneratedProductCardEntry) => {
    const item = itemById.get(entry.itemId);
    if (!item) {
      setError('Item not found in inventory (deleted?). You can still download the card.');
      return;
    }
    setBusyId(entry.id);
    setError(null);
    try {
      const url = await resolveUrlForInventoryMainPhoto('', item.id, entry);
      await onUpdate([mergeMainPhotoOntoItem(item, url)]);
      showToast(`Applied to ${item.name}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not apply card');
    } finally {
      setBusyId(null);
    }
  };

  const deleteEntry = async (id: string) => {
    setBusyId(id);
    try {
      await removeProductCardFromGallery(id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
      if (preview?.entry.id === id) setPreview(null);
      showToast('Card removed from gallery');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setBusyId(null);
    }
  };

  const downloadAllForItem = async (
    itemId: string,
    itemName: string,
    groupEntries: GeneratedProductCardEntry[]
  ) => {
    if (!groupEntries.length) return;
    setDownloadingItemId(itemId);
    setDownloadProgress(`0 / ${groupEntries.length}`);
    setError(null);
    try {
      const { ok, failed } = await downloadProductCardEntries(groupEntries, {
        onProgress: (done, total) => setDownloadProgress(`${done} / ${total}`),
      });
      if (failed && !ok) {
        setError(`Could not download cards for ${itemName}`);
      } else if (failed) {
        showToast(`Downloaded ${ok} of ${groupEntries.length} for ${itemName}`);
      } else {
        showToast(`Downloaded ${ok} card${ok === 1 ? '' : 's'} · ${itemName}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed');
    } finally {
      setDownloadingItemId(null);
      setDownloadProgress(null);
    }
  };

  const cloudReady = isProductCardGalleryCloudReady();
  const previewIndex = preview
    ? preview.siblings.findIndex((s) => s.id === preview.entry.id)
    : -1;

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
            <Images className="text-emerald-600" size={22} /> Card gallery
          </h1>
          <p className="text-sm text-slate-500 font-medium mt-1 max-w-xl">
            Paid AI generations, grouped by product. Click a photo to view full size.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void reload()}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 bg-white text-[10px] font-black uppercase text-slate-600 hover:bg-slate-50"
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-slate-500">
        <span className="inline-flex items-center gap-1">
          <Cloud size={12} className={cloudReady ? 'text-emerald-600' : 'text-slate-400'} />
          {cloudReady ? 'Cloud + local backup' : 'Local IndexedDB backup (sign in for cloud)'}
        </span>
        <span className="text-slate-300">·</span>
        <span>
          {entries.length} card{entries.length === 1 ? '' : 's'} · {groups.length} product
          {groups.length === 1 ? '' : 's'}
        </span>
      </div>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by product or style…"
        className="w-full max-w-md px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-200"
      />

      {error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-20 text-slate-400">
          <Loader2 size={28} className="animate-spin" />
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white py-16 text-center">
          <Images size={36} className="mx-auto text-slate-300 mb-3" />
          <p className="text-sm font-bold text-slate-600">No saved cards yet</p>
          <p className="text-xs text-slate-400 font-medium mt-1">
            Generate an AI product card from Inventory — it will show up here automatically.
          </p>
          <Link
            to="/panel/inventory"
            className="inline-flex mt-4 px-4 py-2 rounded-xl bg-slate-900 text-white text-[10px] font-black uppercase"
          >
            Open inventory
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map((group) => {
            const live = itemById.get(group.itemId);
            return (
              <section
                key={group.itemId}
                className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm"
              >
                <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2 bg-slate-50/80">
                  <div className="min-w-0 flex items-start gap-2">
                    <Package size={16} className="text-emerald-600 mt-0.5 shrink-0" />
                    <div className="min-w-0">
                      <h2 className="text-sm font-black text-slate-900 truncate" title={group.itemName}>
                        {group.itemName}
                      </h2>
                      <p className="text-[10px] text-slate-400 font-medium">
                        {group.entries.length} generation{group.entries.length === 1 ? '' : 's'}
                        {!live ? ' · item not in inventory' : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={
                        group.entries.length === 0 || downloadingItemId === group.itemId
                      }
                      onClick={() =>
                        void downloadAllForItem(group.itemId, group.itemName, group.entries)
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-[10px] font-black uppercase text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      title="Download every card for this product"
                    >
                      {downloadingItemId === group.itemId ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <Download size={12} />
                      )}
                      {downloadingItemId === group.itemId && downloadProgress
                        ? downloadProgress
                        : `Download all (${group.entries.length})`}
                    </button>
                    {live && (
                      <Link
                        to={`/panel/edit/${group.itemId}`}
                        className="text-[10px] font-black uppercase text-emerald-700 hover:underline"
                      >
                        Open item
                      </Link>
                    )}
                  </div>
                </div>
                <div className="p-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
                  {group.entries.map((entry) => (
                    <div
                      key={entry.id}
                      className="rounded-xl border border-slate-200 overflow-hidden bg-slate-50"
                    >
                      <Thumb
                        entry={entry}
                        onOpen={() => setPreview({ entry, siblings: group.entries })}
                      />
                      <div className="px-2 py-2 space-y-1.5">
                        <p className="text-[9px] font-bold text-slate-600 truncate">
                          {entry.styleName || entry.styleId || 'AI card'}
                        </p>
                        <p className="text-[9px] text-slate-400 font-medium truncate" title={entry.fileName}>
                          {new Date(entry.createdAt).toLocaleString()}
                          {entry.cloudStored ? ' · cloud' : ' · local'}
                        </p>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            disabled={!live || busyId === entry.id}
                            onClick={() => void applyEntry(entry)}
                            className="flex-1 inline-flex items-center justify-center gap-0.5 py-1.5 rounded-lg bg-slate-900 text-white text-[9px] font-black uppercase disabled:opacity-40"
                          >
                            {busyId === entry.id ? (
                              <Loader2 size={10} className="animate-spin" />
                            ) : (
                              <Check size={10} />
                            )}
                            Apply
                          </button>
                          <button
                            type="button"
                            disabled={busyId === entry.id}
                            onClick={() => void downloadProductCardEntry(entry)}
                            className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-white"
                            title={entry.fileName || 'Download'}
                          >
                            <Download size={12} />
                          </button>
                          <button
                            type="button"
                            disabled={busyId === entry.id}
                            onClick={() => void deleteEntry(entry.id)}
                            className="p-1.5 rounded-lg border border-slate-200 text-rose-500 hover:bg-rose-50"
                            title="Delete"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-6 z-[180] pointer-events-none">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-slate-900 text-white text-xs font-bold shadow-lg">
            <Check size={14} className="text-emerald-400" />
            {toast}
          </div>
        </div>
      )}

      {preview &&
        createPortal(
          <div
            className="fixed inset-0 z-[250] flex items-center justify-center bg-slate-950/85 p-3 sm:p-6"
            onClick={() => setPreview(null)}
            role="dialog"
            aria-modal="true"
            aria-label="Card preview"
          >
            <button
              type="button"
              onClick={() => setPreview(null)}
              className="absolute top-3 right-3 sm:top-5 sm:right-5 p-2 rounded-xl bg-white/10 text-white hover:bg-white/20"
              aria-label="Close"
            >
              <X size={20} />
            </button>

            {previewIndex > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setPreview({
                    entry: preview.siblings[previewIndex - 1]!,
                    siblings: preview.siblings,
                  });
                }}
                className="absolute left-2 sm:left-4 p-2 rounded-xl bg-white/10 text-white hover:bg-white/20"
                aria-label="Previous"
              >
                <ChevronLeft size={22} />
              </button>
            )}
            {previewIndex >= 0 && previewIndex < preview.siblings.length - 1 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setPreview({
                    entry: preview.siblings[previewIndex + 1]!,
                    siblings: preview.siblings,
                  });
                }}
                className="absolute right-2 sm:right-4 p-2 rounded-xl bg-white/10 text-white hover:bg-white/20"
                aria-label="Next"
              >
                <ChevronRight size={22} />
              </button>
            )}

            <div
              className="relative w-full max-w-4xl max-h-[90vh] flex flex-col items-center gap-3"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="relative w-full flex-1 min-h-0 flex items-center justify-center rounded-2xl overflow-hidden bg-black/40">
                {previewLoading && (
                  <Loader2 size={28} className="absolute animate-spin text-white/70" />
                )}
                {previewSrc ? (
                  <img
                    src={previewSrc}
                    alt={preview.entry.itemName}
                    className="max-w-full max-h-[75vh] object-contain"
                  />
                ) : (
                  !previewLoading && (
                    <p className="text-sm text-white/70 font-medium py-20">Could not load image</p>
                  )
                )}
              </div>
              <div className="w-full flex flex-wrap items-center justify-between gap-2 text-white/90 px-1">
                <div className="min-w-0">
                  <p className="text-sm font-bold truncate">{preview.entry.itemName}</p>
                  <p className="text-[11px] text-white/60 font-medium">
                    {preview.entry.styleName || preview.entry.styleId || 'AI card'}
                    {' · '}
                    {new Date(preview.entry.createdAt).toLocaleString()}
                    {preview.siblings.length > 1
                      ? ` · ${previewIndex + 1} / ${preview.siblings.length}`
                      : ''}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void downloadProductCardEntry(preview.entry)}
                    className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-white text-slate-900 text-[10px] font-black uppercase"
                  >
                    <Download size={12} /> Download
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreview(null)}
                    className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-white/15 text-white text-[10px] font-black uppercase hover:bg-white/25"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

export default ProductCardGalleryPage;
