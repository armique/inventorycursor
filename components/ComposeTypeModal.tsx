import React from 'react';
import { Monitor, Package, Boxes, History, X } from 'lucide-react';

export type ComposeType = 'pc' | 'bundle' | 'mixed' | 'sold';

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
    desc: 'Full PC from inventory · slots + compatibility · no defective parts',
    icon: <Monitor size={22} />,
    accent: 'border-teal-300 hover:border-teal-500 hover:bg-teal-50',
  },
  {
    type: 'bundle',
    title: 'Bundle / Aufrustkit',
    desc: 'PC-style kit · same rules as PC · title includes PC Bundle or Aufrustkit',
    icon: <Package size={22} />,
    accent: 'border-violet-300 hover:border-violet-500 hover:bg-violet-50',
  },
  {
    type: 'mixed',
    title: 'Mixed Bundle',
    desc: 'Any parts & quantities · defective allowed · no slot rules',
    icon: <Boxes size={22} />,
    accent: 'border-amber-300 hover:border-amber-500 hover:bg-amber-50',
  },
  {
    type: 'sold',
    title: 'Sold group',
    desc: 'Group already-sold items into a retro mixed bundle',
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
              {selectedCount} selected — PC, Bundle, Mixed, or Sold group
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
        </div>
      </div>
    </div>
  );
};

export default ComposeTypeModal;
