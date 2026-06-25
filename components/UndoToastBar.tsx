import React from 'react';
import { RotateCcw, X } from 'lucide-react';

interface Props {
  message: string | null;
  onUndo: () => void;
  onDismiss: () => void;
}

const UndoToastBar: React.FC<Props> = ({ message, onUndo, onDismiss }) => {
  if (!message) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[500] flex items-center gap-3 px-5 py-3 bg-slate-900 text-white rounded-2xl shadow-2xl border border-slate-700 animate-in slide-in-from-bottom-4">
      <span className="text-sm font-bold">{message}</span>
      <button
        type="button"
        onClick={onUndo}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white text-slate-900 text-xs font-black uppercase tracking-wide hover:bg-slate-100"
      >
        <RotateCcw size={14} /> Undo
      </button>
      <button type="button" onClick={onDismiss} className="p-1 text-slate-400 hover:text-white" aria-label="Dismiss">
        <X size={16} />
      </button>
    </div>
  );
};

export default UndoToastBar;
