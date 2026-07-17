import React, { useMemo, useState } from 'react';
import { Copy, GripVertical, Save, SkipForward, X } from 'lucide-react';
import type { InventoryItem } from '../types';
import {
  applyListingKitToItem,
  buildListingKitDraft,
  listingKitToClipboardText,
  type ListingKitDraft,
} from '../utils/listingKit';

interface Props {
  parent: InventoryItem;
  parts: InventoryItem[];
  onApply: (updatedParent: InventoryItem) => void;
  onSkip: () => void;
}

const ListingKitModal: React.FC<Props> = ({ parent, parts, onApply, onSkip }) => {
  const initial = useMemo(() => buildListingKitDraft(parent, parts), [parent, parts]);
  const [title, setTitle] = useState(initial.title);
  const [bulletsText, setBulletsText] = useState(initial.bullets.join('\n'));
  const [photoUrls, setPhotoUrls] = useState(initial.photoUrls);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const kit: ListingKitDraft = {
    title,
    bullets: bulletsText
      .split('\n')
      .map((l) => l.replace(/^[-•*]\s*/, '').trim())
      .filter(Boolean),
    photoUrls,
    body: '',
  };

  const movePhoto = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return;
    setPhotoUrls((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      if (!item) return prev;
      next.splice(to, 0, item);
      return next;
    });
  };

  const handleCopy = async () => {
    const full = listingKitToClipboardText({
      ...kit,
      body: buildListingKitDraft({ ...parent, marketTitle: title, marketDescription: kit.bullets.map((b) => `• ${b}`).join('\n') }, parts).body,
    });
    try {
      await navigator.clipboard.writeText(full);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center bg-slate-900/55 backdrop-blur-sm p-4 animate-in fade-in">
      <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
        <div className="flex items-start justify-between gap-3 px-6 py-5 border-b border-slate-100 shrink-0">
          <div>
            <h2 className="text-xl font-black text-slate-900">Listing kit</h2>
            <p className="text-xs font-bold text-slate-500 mt-1">
              Title, bullets & photo order for Kleinanzeigen / eBay
            </p>
          </div>
          <button type="button" onClick={onSkip} className="p-2 rounded-xl text-slate-400 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Title</label>
            <input
              className="mt-1.5 w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm outline-none focus:ring-2 focus:ring-emerald-100"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={80}
            />
            <p className="text-[10px] text-slate-400 mt-1">{title.length}/80</p>
          </div>

          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              Bullets (one per line)
            </label>
            <textarea
              className="mt-1.5 w-full min-h-36 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-medium text-xs outline-none focus:ring-2 focus:ring-emerald-100"
              value={bulletsText}
              onChange={(e) => setBulletsText(e.target.value)}
            />
          </div>

          <div>
            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">
              Photos (drag to reorder — first = main)
            </label>
            {photoUrls.length === 0 ? (
              <p className="mt-2 text-xs text-slate-400 font-bold">No photos yet — add them in inventory later.</p>
            ) : (
              <div className="mt-2 grid grid-cols-3 sm:grid-cols-4 gap-2">
                {photoUrls.map((url, idx) => (
                  <div
                    key={`${url}-${idx}`}
                    draggable
                    onDragStart={() => setDragIndex(idx)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragIndex != null) movePhoto(dragIndex, idx);
                      setDragIndex(null);
                    }}
                    className={`relative rounded-xl border overflow-hidden bg-slate-100 ${
                      idx === 0 ? 'border-emerald-400 ring-2 ring-emerald-100' : 'border-slate-200'
                    }`}
                  >
                    <img src={url} alt="" className="w-full h-20 object-cover" />
                    <div className="absolute top-1 left-1 flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/50 text-white text-[9px] font-black">
                      <GripVertical size={10} />
                      {idx === 0 ? 'MAIN' : idx + 1}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0 flex flex-wrap gap-2 px-6 py-4 border-t border-slate-100 bg-slate-50">
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-xs font-black uppercase text-slate-700 hover:bg-slate-100"
          >
            <Copy size={14} /> {copied ? 'Copied' : 'Copy text'}
          </button>
          <button
            type="button"
            onClick={onSkip}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-xs font-black uppercase text-slate-600 hover:bg-slate-100"
          >
            <SkipForward size={14} /> Skip
          </button>
          <button
            type="button"
            onClick={() => onApply(applyListingKitToItem(parent, kit))}
            className="ml-auto inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-xs font-black uppercase tracking-widest hover:bg-emerald-700"
          >
            <Save size={14} /> Save with listing
          </button>
        </div>
      </div>
    </div>
  );
};

export default ListingKitModal;
