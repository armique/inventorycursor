import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Loader2, Upload, X, Link2, Images } from 'lucide-react';
import {
  filesToDataUrls,
  fetchImgurAlbumImageUrls,
  normalizeImageList,
  resolveImageUrlsFromInput,
} from '../utils/imageImport';

interface Props {
  open: boolean;
  onClose: () => void;
  onApply: (urls: string[]) => void | Promise<void>;
  itemCount: number;
}

const AddPhotosModal: React.FC<Props> = ({ open, onClose, onApply, itemCount }) => {
  const [urlInput, setUrlInput] = useState('');
  const [imgurInput, setImgurInput] = useState('');
  const [pendingUrls, setPendingUrls] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setUrlInput('');
    setImgurInput('');
    setPendingUrls([]);
    setLoading(false);
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, loading, onClose]);

  const addUrls = useCallback((urls: string[]) => {
    const merged = normalizeImageList([...pendingUrls, ...urls]);
    if (!merged.length) return;
    setPendingUrls(merged);
    setError(null);
  }, [pendingUrls]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setLoading(true);
    setError(null);
    try {
      addUrls(await filesToDataUrls(files));
    } catch {
      setError('Could not read one or more image files.');
    } finally {
      setLoading(false);
      e.target.value = '';
    }
  };

  const handleParseUrls = async () => {
    if (!urlInput.trim()) return;
    setLoading(true);
    setError(null);
    try {
      addUrls(await resolveImageUrlsFromInput(urlInput));
      setUrlInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not parse image URL(s).');
    } finally {
      setLoading(false);
    }
  };

  const handleParseImgurAlbum = async () => {
    if (!imgurInput.trim()) return;
    setLoading(true);
    setError(null);
    try {
      addUrls(await fetchImgurAlbumImageUrls(imgurInput.trim()));
      setImgurInput('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load Imgur album.');
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    if (!pendingUrls.length) {
      setError('Add at least one photo first.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await onApply(pendingUrls);
    } catch {
      setError('Could not add photos. Try again.');
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
      onClick={() => !loading && onClose()}
    >
      <div
        className="bg-white w-full max-w-lg rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[min(90vh,640px)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2 bg-slate-50/80 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Camera size={18} className="text-blue-600 shrink-0" />
            <div className="min-w-0">
              <h2 className="text-sm font-black text-slate-900 truncate">Add photos</h2>
              <p className="text-[10px] text-slate-500 truncate">
                {itemCount} selected item{itemCount === 1 ? '' : 's'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-200 hover:text-slate-700 disabled:opacity-40"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-4 overflow-y-auto flex-1 min-h-0">
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Upload size={12} /> Upload from device
            </label>
            <label className="flex items-center justify-center gap-2 w-full py-4 rounded-xl border-2 border-dashed border-slate-200 bg-slate-50 text-xs font-bold text-slate-600 cursor-pointer hover:border-blue-300 hover:bg-blue-50/50 transition-colors">
              <Camera size={16} className="text-slate-400" />
              Choose images
              <input type="file" accept="image/*" multiple className="hidden" onChange={handleUpload} disabled={loading} />
            </label>
            <p className="text-[10px] text-slate-400">Uploads are resized and compressed before saving.</p>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Link2 size={12} /> Image URL(s)
            </label>
            <textarea
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="Paste one or more direct image URLs (one per line)"
              rows={2}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-medium outline-none focus:ring-2 focus:ring-blue-500/20 resize-none"
            />
            <button
              type="button"
              onClick={handleParseUrls}
              disabled={loading || !urlInput.trim()}
              className="w-full py-2 rounded-xl bg-slate-900 text-white text-xs font-black uppercase tracking-wide disabled:opacity-50"
            >
              Add from URL
            </button>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Images size={12} /> Imgur album / gallery
            </label>
            <input
              value={imgurInput}
              onChange={(e) => setImgurInput(e.target.value)}
              placeholder="https://imgur.com/a/… or /gallery/…"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs font-medium outline-none focus:ring-2 focus:ring-blue-500/20"
            />
            <button
              type="button"
              onClick={handleParseImgurAlbum}
              disabled={loading || !imgurInput.trim()}
              className="w-full py-2 rounded-xl border border-slate-200 bg-white text-xs font-black uppercase tracking-wide text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Import album
            </button>
          </div>

          {error && (
            <p className="text-xs text-red-600 font-medium bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
          )}

          {pendingUrls.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                Preview ({pendingUrls.length})
              </p>
              <div className="grid grid-cols-4 gap-2 max-h-40 overflow-y-auto">
                {pendingUrls.map((url) => (
                  <div key={url} className="relative group">
                    <img src={url} alt="" className="w-full h-16 object-cover rounded-lg border border-slate-200 bg-slate-100" />
                    <button
                      type="button"
                      onClick={() => setPendingUrls((prev) => prev.filter((u) => u !== url))}
                      className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                      aria-label="Remove"
                    >
                      <X size={10} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-slate-100 flex gap-2 shrink-0 bg-white">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="flex-1 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={loading || pendingUrls.length === 0}
            className="flex-1 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-black uppercase tracking-wide hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
            {loading ? 'Saving…' : 'Add to items'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default React.memo(AddPhotosModal);
