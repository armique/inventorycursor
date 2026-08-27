import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Crop, Loader2, Sparkles, Star, Trash2, X } from 'lucide-react';
import { analyzePhotosForCleanup, type PhotoCleanupOutcome } from '../services/photoCleanupAI';
import { cropFileToBox, isFullFrameBox } from '../utils/cropImageToBox';

type Props = {
  files: File[];
  onConfirm: (finalFiles: File[]) => void;
  onCancel: () => void;
};

type PhotoState = {
  file: File;
  previewUrl: string;
  outcome: PhotoCleanupOutcome | null;
  cropEnabled: boolean;
  removed: boolean;
};

function suggestionOf(outcome: PhotoCleanupOutcome | null) {
  return outcome?.status === 'ok' ? outcome.suggestion : null;
}

/** Review screen shown right after picking photos, before they're uploaded — the AI proposes a
 *  crop, flags clutter, and scores each photo as a card-photo candidate; nothing is applied
 *  until the user taps "Add photos". A failed AI call for one photo never blocks the rest —
 *  that photo just falls back to "use as shot". */
const PhotoCleanupReview: React.FC<Props> = ({ files, onConfirm, onCancel }) => {
  const [photos, setPhotos] = useState<PhotoState[]>(() =>
    files.map((file) => ({
      file,
      previewUrl: URL.createObjectURL(file),
      outcome: null,
      cropEnabled: false,
      removed: false,
    }))
  );
  const [analyzing, setAnalyzing] = useState(true);
  const [progress, setProgress] = useState({ done: 0, total: files.length });
  const [cardIndex, setCardIndex] = useState(0);
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void analyzePhotosForCleanup(files, {
      onProgress: (done, total) => {
        if (!cancelled) setProgress({ done, total });
      },
    }).then((outcomes) => {
      if (cancelled) return;
      setPhotos((prev) =>
        prev.map((p, i) => {
          const outcome = outcomes[i] || null;
          const suggestion = suggestionOf(outcome);
          return {
            ...p,
            outcome,
            cropEnabled: Boolean(suggestion && !isFullFrameBox(suggestion.cropBox)),
          };
        })
      );
      let bestIndex = 0;
      let bestScore = -1;
      outcomes.forEach((o, i) => {
        const s = suggestionOf(o);
        if (s && s.cardScore > bestScore) {
          bestScore = s.cardScore;
          bestIndex = i;
        }
      });
      setCardIndex(bestIndex);
      setAnalyzing(false);
    });
    return () => {
      cancelled = true;
    };
    // files is captured once at mount — this review screen is remounted fresh per photo batch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return () => {
      photos.forEach((p) => URL.revokeObjectURL(p.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const remaining = useMemo(() => photos.filter((p) => !p.removed), [photos]);

  const toggleCrop = (index: number) => {
    setPhotos((prev) => prev.map((p, i) => (i === index ? { ...p, cropEnabled: !p.cropEnabled } : p)));
  };

  const removePhoto = (index: number) => {
    setPhotos((prev) => prev.map((p, i) => (i === index ? { ...p, removed: true } : p)));
    if (cardIndex === index) {
      const nextIndex = photos.findIndex((p, i) => i !== index && !p.removed);
      if (nextIndex >= 0) setCardIndex(nextIndex);
    }
  };

  const useAsShot = () => onConfirm(files);

  const confirm = async () => {
    setApplying(true);
    try {
      const kept = photos.filter((p) => !p.removed);
      // Card photo goes first (matches imageUrls[0] convention); the rest keep their order.
      const cardPhoto = photos[cardIndex] && !photos[cardIndex].removed ? photos[cardIndex] : kept[0];
      const rest = kept.filter((p) => p !== cardPhoto);
      const finalOrder = cardPhoto ? [cardPhoto, ...rest] : kept;
      const finalFiles = await Promise.all(
        finalOrder.map(async (p) => {
          const suggestion = suggestionOf(p.outcome);
          if (p.cropEnabled && suggestion) return cropFileToBox(p.file, suggestion.cropBox);
          return p.file;
        })
      );
      onConfirm(finalFiles);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm p-0 sm:p-4">
      <div className="w-full sm:max-w-2xl sm:rounded-2xl rounded-t-2xl bg-white shadow-2xl border border-slate-200 max-h-[92vh] flex flex-col overflow-hidden">
        <div className="shrink-0 flex items-start justify-between gap-2 px-4 py-3 border-b border-slate-100 bg-slate-50">
          <div className="min-w-0">
            <p className="text-sm font-black text-slate-900 flex items-center gap-1.5">
              <Sparkles size={15} className="text-violet-600" /> Review photos
            </p>
            <p className="text-[11px] text-slate-500 font-semibold mt-0.5">
              {analyzing
                ? `Checking ${progress.done}/${progress.total} photos…`
                : `${remaining.length} photo${remaining.length === 1 ? '' : 's'} · tap a photo to make it the card photo`}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Cancel"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-3">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {photos.map((p, index) => {
              if (p.removed) return null;
              const suggestion = suggestionOf(p.outcome);
              const isCard = index === cardIndex;
              const box = p.cropEnabled && suggestion ? suggestion.cropBox : null;
              return (
                <div
                  key={p.previewUrl}
                  className={`relative rounded-xl border overflow-hidden bg-slate-100 ${
                    isCard ? 'border-amber-400 ring-2 ring-amber-300' : 'border-slate-200'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setCardIndex(index)}
                    className="block w-full aspect-square relative"
                    title={isCard ? 'Card photo' : 'Make this the card photo'}
                  >
                    <img src={p.previewUrl} alt="" className="w-full h-full object-cover" />
                    {box ? (
                      <>
                        <div className="absolute inset-x-0 top-0 bg-black/45" style={{ height: `${box.y * 100}%` }} />
                        <div
                          className="absolute inset-x-0 bottom-0 bg-black/45"
                          style={{ height: `${(1 - box.y - box.height) * 100}%` }}
                        />
                        <div
                          className="absolute bg-black/45"
                          style={{ left: 0, top: `${box.y * 100}%`, width: `${box.x * 100}%`, height: `${box.height * 100}%` }}
                        />
                        <div
                          className="absolute bg-black/45"
                          style={{
                            right: 0,
                            top: `${box.y * 100}%`,
                            width: `${(1 - box.x - box.width) * 100}%`,
                            height: `${box.height * 100}%`,
                          }}
                        />
                      </>
                    ) : null}
                    {analyzing ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-white/40">
                        <Loader2 size={18} className="animate-spin text-slate-500" />
                      </div>
                    ) : null}
                    {isCard ? (
                      <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 rounded-full bg-amber-400 text-amber-950 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wide">
                        <Star size={10} fill="currentColor" /> Card
                      </span>
                    ) : null}
                  </button>

                  <button
                    type="button"
                    onClick={() => removePhoto(index)}
                    className="absolute top-1.5 right-1.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-slate-500 hover:bg-white hover:text-red-600 shadow"
                    aria-label="Remove photo"
                  >
                    <Trash2 size={12} />
                  </button>

                  <div className="p-1.5 space-y-1">
                    {suggestion && !isFullFrameBox(suggestion.cropBox) ? (
                      <button
                        type="button"
                        onClick={() => toggleCrop(index)}
                        className={`w-full inline-flex items-center justify-center gap-1 rounded-lg px-1.5 py-1 text-[10px] font-bold border ${
                          p.cropEnabled
                            ? 'bg-violet-50 border-violet-200 text-violet-800'
                            : 'bg-white border-slate-200 text-slate-500'
                        }`}
                      >
                        {p.cropEnabled ? <Check size={11} /> : <Crop size={11} />}
                        {p.cropEnabled ? 'Cropped' : 'Use as shot'}
                      </button>
                    ) : null}
                    {suggestion?.hasClutter ? (
                      <p className="flex items-start gap-1 text-[9px] font-semibold text-amber-700 leading-tight">
                        <AlertTriangle size={10} className="shrink-0 mt-0.5" />
                        {suggestion.clutterNote || 'Background clutter'}
                      </p>
                    ) : null}
                    {p.outcome?.status === 'error' ? (
                      <p className="text-[9px] font-semibold text-slate-400">AI unavailable — using as shot</p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="shrink-0 flex items-center justify-between gap-2 px-4 py-3 border-t border-slate-100 bg-white">
          <button
            type="button"
            onClick={useAsShot}
            disabled={applying}
            className="text-[11px] font-black uppercase tracking-wider text-slate-500 hover:text-slate-800 disabled:opacity-40"
          >
            Skip AI, use as shot
          </button>
          <button
            type="button"
            onClick={() => void confirm()}
            disabled={applying || remaining.length === 0}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-black uppercase tracking-wider disabled:opacity-50"
          >
            {applying ? <Loader2 size={14} className="animate-spin" /> : null}
            Add {remaining.length} photo{remaining.length === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PhotoCleanupReview;
