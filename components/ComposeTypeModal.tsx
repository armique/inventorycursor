import React from 'react';
import { Monitor, Package, History, X } from 'lucide-react';

export type ComposeType = 'pc' | 'lot' | 'sold';

interface Props {
  open: boolean;
  selectedCount: number;
  allowSold: boolean;
  onChoose: (type: ComposeType) => void;
  onClose: () => void;
}

const OPTIONS: {
  type: ComposeType;
  title: string;
  desc: string;
  icon: React.ReactNode;
  accent: string;
  soldOnly?: boolean;
}[] = [
  {
    type: 'pc',
    title: 'PC Build',
    desc: 'Fixed slots · compatibility checks · defective parts blocked',
    icon: <Monitor size={22} />,
    accent: 'border-teal-300 hover:border-teal-500 hover:bg-teal-50',
  },
  {
    type: 'lot',
    title: 'Lot Bundle',
    desc: 'Loose bag of parts · any qty mix · defective parts allowed',
    icon: <Package size={22} />,
    accent: 'border-amber-300 hover:border-amber-500 hover:bg-amber-50',
  },
  {
    type: 'sold',
    title: 'Sold group',
    desc: 'Group already-sold items into a retro lot for history & profit',
    icon: <History size={22} />,
    accent: 'border-slate-300 hover:border-slate-500 hover:bg-slate-50',
    soldOnly: true,
  },
];

const ComposeTypeModal: React.FC<Props> = ({
  open,
  selectedCount,
  allowSold,
  onChoose,
  onClose,
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-in fade-in">
      <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl border border-slate-200 overflow-hidden">
        <div className="flex items-start justify-between gap-3 px-6 py-5 border-b border-slate-100">
          <div>
            <h2 className="text-xl font-black text-slate-900">Compose</h2>
            <p className="text-xs font-bold text-slate-500 mt-1">
              {selectedCount} selected — choose PC, Lot, or Sold group
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-800"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-4 space-y-3">
          {OPTIONS.filter((o) => !o.soldOnly || allowSold).map((opt) => (
            <button
              key={opt.type}
              type="button"
              onClick={() => onChoose(opt.type)}
              className={`w-full text-left flex items-start gap-4 p-4 rounded-2xl border-2 transition-all ${opt.accent}`}
            >
              <div className="w-11 h-11 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
                {opt.icon}
              </div>
              <div className="min-w-0">
                <p className="font-black text-slate-900 text-sm">{opt.title}</p>
                <p className="text-[11px] font-semibold text-slate-500 mt-0.5 leading-snug">
                  {opt.desc}
                </p>
              </div>
            </button>
          ))}
          {!allowSold && (
            <p className="text-[10px] text-slate-400 font-bold px-1">
              Tip: select sold items to enable “Sold group”.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default ComposeTypeModal;
