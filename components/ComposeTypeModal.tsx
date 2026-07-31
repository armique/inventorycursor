import React from 'react';
import { Monitor, Package, Boxes, History, X } from 'lucide-react';
import { AddOptionTile } from './addFlowShared';

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
  hint: string;
  icon: React.ReactNode;
  soldOnly?: boolean;
}[] = [
  {
    type: 'pc',
    title: 'PC Build',
    hint: 'Slots · no defekt',
    icon: <Monitor size={22} strokeWidth={1.75} />,
  },
  {
    type: 'bundle',
    title: 'Bundle',
    hint: 'Aufrustkit kit',
    icon: <Package size={22} strokeWidth={1.75} />,
  },
  {
    type: 'mixed',
    title: 'Mixed',
    hint: 'Any parts · defekt OK',
    icon: <Boxes size={22} strokeWidth={1.75} />,
  },
  {
    type: 'sold',
    title: 'Sold group',
    hint: 'Already sold items',
    icon: <History size={22} strokeWidth={1.75} />,
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

  const visible = OPTIONS.filter((o) => !o.soldOnly || allowSold);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-in fade-in">
      <div className="bg-white w-full max-w-lg rounded-3xl shadow-2xl border border-slate-200 overflow-hidden">
        <div className="flex items-start justify-between gap-3 px-6 py-5 border-b border-slate-100">
          <div>
            <h2 className="text-xl font-black text-slate-900">Compose</h2>
            <p className="text-xs font-bold text-slate-500 mt-1">
              {selectedCount} selected — pick a type
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
        <div className={`p-4 grid gap-1 sm:gap-2 ${visible.length > 3 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}`}>
          {visible.map((opt) => (
            <AddOptionTile
              key={opt.type}
              label={opt.title}
              hint={opt.hint}
              icon={opt.icon}
              onClick={() => onChoose(opt.type)}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

export default ComposeTypeModal;
