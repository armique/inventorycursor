import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Loader2, X } from 'lucide-react';

export interface ImageLightboxProps {
  open: boolean;
  src: string | null;
  loading?: boolean;
  title?: string;
  subtitle?: string;
  onClose: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  footer?: React.ReactNode;
  ariaLabel?: string;
}

/**
 * Full-screen image enlarge overlay. Escape / backdrop / X close;
 * optional prev/next for galleries.
 */
const ImageLightbox: React.FC<ImageLightboxProps> = ({
  open,
  src,
  loading = false,
  title,
  subtitle,
  onClose,
  onPrev,
  onNext,
  hasPrev = false,
  hasNext = false,
  footer,
  ariaLabel = 'Image preview',
}) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowLeft' && hasPrev && onPrev) {
        e.preventDefault();
        onPrev();
      }
      if (e.key === 'ArrowRight' && hasNext && onNext) {
        e.preventDefault();
        onNext();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, hasPrev, hasNext, onClose, onPrev, onNext]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[260] flex items-center justify-center bg-slate-950/85 p-3 sm:p-6"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-3 right-3 sm:top-5 sm:right-5 p-2 rounded-xl bg-white/10 text-white hover:bg-white/20"
        aria-label="Close"
      >
        <X size={20} />
      </button>

      {hasPrev && onPrev && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPrev();
          }}
          className="absolute left-2 sm:left-4 p-2 rounded-xl bg-white/10 text-white hover:bg-white/20"
          aria-label="Previous"
        >
          <ChevronLeft size={22} />
        </button>
      )}
      {hasNext && onNext && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onNext();
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
          {loading && <Loader2 size={28} className="absolute animate-spin text-white/70" />}
          {src ? (
            <img src={src} alt={title || ''} className="max-w-full max-h-[75vh] object-contain" />
          ) : (
            !loading && (
              <p className="text-sm text-white/70 font-medium py-20">Could not load image</p>
            )
          )}
        </div>

        {(title || subtitle || footer) && (
          <div className="w-full flex flex-wrap items-center justify-between gap-2 text-white/90 px-1">
            <div className="min-w-0">
              {title && <p className="text-sm font-bold truncate">{title}</p>}
              {subtitle && <p className="text-[11px] text-white/60 font-medium">{subtitle}</p>}
            </div>
            {footer && <div className="flex flex-wrap gap-2">{footer}</div>}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};

export default ImageLightbox;
