import React from 'react';
import { X } from 'lucide-react';

/** Full-screen dim + bottom sheet chrome for mobile Stock filters / card actions. */
export const MobileSheetShell: React.FC<{
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ open, title, subtitle, onClose, children }) => {
  if (!open) return null;
  return (
    <div className="lg:hidden fixed inset-0 z-[200] flex flex-col justify-end">
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/45 backdrop-blur-[2px]"
        aria-label="Close"
        onClick={onClose}
      />
      <div
        className="relative bg-white rounded-t-[1.75rem] border border-slate-200 shadow-2xl max-h-[min(88dvh,720px)] flex flex-col pb-safe animate-in slide-in-from-bottom duration-300"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="flex justify-center pt-2.5 pb-1">
          <span className="w-10 h-1 rounded-full bg-slate-200" />
        </div>
        <div className="px-4 pb-3 flex items-start justify-between gap-3 border-b border-slate-100">
          <div className="min-w-0">
            <h2 className="text-base font-black text-slate-900 tracking-tight">{title}</h2>
            {subtitle && <p className="text-[11px] text-slate-500 font-medium mt-0.5">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 shrink-0"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="overflow-y-auto flex-1 min-h-0 px-3 py-3">{children}</div>
      </div>
    </div>
  );
};
