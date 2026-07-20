import React, { useEffect, useMemo, useState } from 'react';
import { FolderOpen, Loader2, RefreshCw, Search, X } from 'lucide-react';
import {
  attachPreviews,
  canUseLocalPhotoFolder,
  clearPhotoFolderHandle,
  fileFromLocalPhoto,
  getOrReconnectPhotoFolder,
  listPhotosInFolder,
  pickPhotoFolder,
  revokePreviewUrls,
  type LocalPhotoEntry,
} from '../utils/localPhotoFolder';

interface Props {
  onPickFiles: (files: File[]) => void | Promise<void>;
  onClose: () => void;
  maxSelect?: number;
}

const LocalPhotoFolderPanel: React.FC<Props> = ({ onPickFiles, onClose, maxSelect = 6 }) => {
  const supported = canUseLocalPhotoFolder();
  const [folderName, setFolderName] = useState<string | null>(null);
  const [entries, setEntries] = useState<LocalPhotoEntry[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFromHandle = async (handle: FileSystemDirectoryHandle) => {
    setLoading(true);
    setError(null);
    try {
      setFolderName(handle.name);
      const listed = await listPhotosInFolder(handle);
      const withPrev = await attachPreviews(listed, 100);
      setEntries((prev) => {
        revokePreviewUrls(prev);
        return withPrev;
      });
      setSelected(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read folder');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!supported) return;
    let cancelled = false;
    (async () => {
      const existing = await getOrReconnectPhotoFolder();
      if (cancelled || !existing) return;
      await loadFromHandle(existing);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported]);

  useEffect(() => {
    return () => {
      revokePreviewUrls(entries);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) => e.name.toLowerCase().includes(q));
  }, [entries, query]);

  const chooseFolder = async () => {
    try {
      setError(null);
      const handle = await pickPhotoFolder();
      await loadFromHandle(handle);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setError(e instanceof Error ? e.message : 'Folder pick cancelled');
    }
  };

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else {
        if (next.size >= maxSelect) return prev;
        next.add(id);
      }
      return next;
    });
  };

  const importSelected = async () => {
    if (!selected.size) return;
    setImporting(true);
    setError(null);
    try {
      const chosen = entries.filter((e) => selected.has(e.id));
      const files: File[] = [];
      for (const entry of chosen) {
        files.push(await fileFromLocalPhoto(entry));
      }
      await onPickFiles(files);
      onClose();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Could not read one or more files (iCloud may still be downloading them).'
      );
    } finally {
      setImporting(false);
    }
  };

  if (!supported) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-amber-900">
            iCloud folder
          </p>
          <button type="button" onClick={onClose} className="p-1 text-amber-800/60 hover:bg-amber-100 rounded-lg">
            <X size={14} />
          </button>
        </div>
        <p className="text-[11px] text-amber-950/80 font-medium leading-relaxed">
          Local folder access needs <strong>Chrome or Edge on Windows</strong>. Point it at your
          iCloud Photos / Pictures folder once iCloud for Windows has synced files locally.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-violet-200 bg-violet-50/70 p-3 space-y-2 max-h-[420px] flex flex-col">
      <div className="flex items-start justify-between gap-2 shrink-0">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-widest text-violet-900 flex items-center gap-1">
            <FolderOpen size={12} /> iCloud / local folder
          </p>
          <p className="text-[10px] text-violet-950/70 font-medium mt-0.5">
            Choose your synced Photos folder on this PC, then pick images for this item.
          </p>
        </div>
        <button type="button" onClick={onClose} className="p-1 text-violet-800/50 hover:bg-violet-100 rounded-lg">
          <X size={14} />
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5 shrink-0">
        <button
          type="button"
          onClick={() => void chooseFolder()}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-violet-700 text-white text-[9px] font-black uppercase"
        >
          <FolderOpen size={11} />
          {folderName ? 'Change folder' : 'Choose folder'}
        </button>
        {folderName && (
          <button
            type="button"
            onClick={() => void getOrReconnectPhotoFolder().then((h) => h && loadFromHandle(h))}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-violet-200 bg-white text-violet-800 text-[9px] font-black uppercase"
          >
            <RefreshCw size={11} /> Refresh
          </button>
        )}
        {folderName && (
          <button
            type="button"
            onClick={() => {
              void clearPhotoFolderHandle();
              revokePreviewUrls(entries);
              setEntries([]);
              setFolderName(null);
              setSelected(new Set());
            }}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-black uppercase text-violet-700/70 hover:underline"
          >
            Forget
          </button>
        )}
      </div>

      {folderName && (
        <p className="text-[10px] font-bold text-violet-900/80 truncate shrink-0">📁 {folderName}</p>
      )}

      {error && (
        <p className="text-[10px] font-semibold text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-2 py-1.5 shrink-0">
          {error}
        </p>
      )}

      {folderName && (
        <div className="relative shrink-0">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-violet-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by file name…"
            className="w-full pl-7 pr-2 py-1.5 rounded-lg border border-violet-200 bg-white text-[11px] font-semibold outline-none"
          />
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-8 text-violet-500">
            <Loader2 className="animate-spin" size={20} />
          </div>
        ) : !folderName ? (
          <p className="text-[11px] text-violet-900/60 font-medium py-4 text-center">
            Typical path: <span className="font-bold">iCloud Photos / Photos</span> or your Pictures
            library after iCloud for Windows sync.
          </p>
        ) : filtered.length === 0 ? (
          <p className="text-[11px] text-violet-900/60 font-medium py-4 text-center">
            No local image files found (online-only iCloud placeholders won’t appear until
            downloaded).
          </p>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5">
            {filtered.map((entry) => {
              const on = selected.has(entry.id);
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => toggle(entry.id)}
                  className={`relative aspect-square rounded-lg overflow-hidden border bg-white ${
                    on ? 'border-violet-600 ring-2 ring-violet-300' : 'border-violet-100'
                  }`}
                  title={entry.name}
                >
                  {entry.previewUrl ? (
                    <img src={entry.previewUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="absolute inset-0 flex items-center justify-center text-[8px] font-bold text-violet-400 px-1 text-center">
                      {entry.name}
                    </span>
                  )}
                  {on && (
                    <span className="absolute top-1 right-1 w-4 h-4 rounded-full bg-violet-700 text-white text-[9px] font-black flex items-center justify-center">
                      ✓
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {folderName && (
        <button
          type="button"
          disabled={!selected.size || importing}
          onClick={() => void importSelected()}
          className="shrink-0 w-full py-2 rounded-xl bg-violet-800 text-white text-[10px] font-black uppercase disabled:opacity-50"
        >
          {importing
            ? 'Importing…'
            : `Add ${selected.size || 0} photo${selected.size === 1 ? '' : 's'} to item`}
        </button>
      )}
    </div>
  );
};

export default LocalPhotoFolderPanel;
