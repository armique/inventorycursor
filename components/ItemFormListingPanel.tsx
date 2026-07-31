import React from 'react';
import { Copy, FileText, Loader2, Sparkles } from 'lucide-react';
import { ADD_FLOW_INPUT, ADD_FLOW_LABEL } from './addFlowShared';

type Props = {
  title: string;
  description: string;
  generating: boolean;
  open: boolean;
  onOpen: () => void;
  onGenerate: () => void;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  /** When set, Generate stays disabled (e.g. OVP/IO not confirmed). */
  generateBlockedReason?: string | null;
};

/**
 * Bottom-left listing panel: empty hint → generate → edit title + DE description.
 */
const ItemFormListingPanel: React.FC<Props> = ({
  title,
  description,
  generating,
  open,
  onOpen,
  onGenerate,
  onTitleChange,
  onDescriptionChange,
  generateBlockedReason,
}) => {
  const hasContent = Boolean(title.trim() || description.trim());
  const showEditor = open || hasContent;
  const blocked = Boolean(generateBlockedReason);
  const canGenerate = !generating && !blocked;

  const copy = async (text: string) => {
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      alert('Could not copy');
    }
  };

  if (!showEditor) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center gap-3 px-4 py-8">
        <div className="w-12 h-12 rounded-2xl border border-slate-200 bg-white text-slate-600 inline-flex items-center justify-center">
          <FileText size={22} strokeWidth={1.75} />
        </div>
        <div>
          <p className="text-sm font-black text-slate-900">AI listing text</p>
          <p className="text-[11px] font-semibold text-slate-500 mt-1 max-w-[16rem]">
            Uses your item, note, and OVP / IO flags for a German eBay title + description.
          </p>
        </div>
        {blocked && (
          <p className="text-[10px] font-semibold text-violet-900 bg-violet-100 border border-violet-300 rounded-lg px-3 py-2 max-w-[18rem]">
            {generateBlockedReason}
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            onOpen();
            onGenerate();
          }}
          disabled={!canGenerate}
          title={generateBlockedReason || undefined}
          className="inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-slate-900 text-white text-[11px] font-black uppercase tracking-widest hover:bg-slate-800 disabled:opacity-40"
        >
          {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          Generate listing
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col gap-3 min-h-0">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className={`${ADD_FLOW_LABEL} flex items-center gap-1.5`}>
            <FileText size={11} /> AI listing text
          </p>
          <p className="text-[11px] font-semibold text-slate-500 mt-0.5">
            Edit freely · copy when ready for eBay / KA
          </p>
        </div>
        <button
          type="button"
          onClick={onGenerate}
          disabled={!canGenerate}
          title={generateBlockedReason || undefined}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 text-white text-[9px] font-black uppercase tracking-wider hover:bg-slate-800 disabled:opacity-40"
        >
          {generating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
          {hasContent ? 'Regen' : 'Generate'}
        </button>
      </div>

      {blocked && (
        <p className="text-[10px] font-semibold text-violet-900 bg-violet-100 border border-violet-300 rounded-lg px-2.5 py-1.5">
          {generateBlockedReason}
        </p>
      )}

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
        <div className="px-3 py-1.5 border-b border-slate-100 flex items-center justify-between gap-2">
          <span className={ADD_FLOW_LABEL}>Title · 80</span>
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-bold text-slate-400">{[...title].length}/80</span>
            <button
              type="button"
              onClick={() => void copy(title)}
              disabled={!title.trim()}
              className="p-1 rounded-md text-slate-400 hover:text-slate-900 disabled:opacity-30"
              title="Copy title"
            >
              <Copy size={12} />
            </button>
          </div>
        </div>
        <input
          type="text"
          maxLength={80}
          className="w-full px-3 py-2 text-xs font-semibold outline-none"
          placeholder="Optimierter eBay-Titel…"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
        />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white overflow-hidden flex-1 min-h-0 flex flex-col">
        <div className="px-3 py-1.5 border-b border-slate-100 flex items-center justify-between gap-2 shrink-0">
          <span className={ADD_FLOW_LABEL}>Beschreibung · DE</span>
          <button
            type="button"
            onClick={() => void copy(description)}
            disabled={!description.trim()}
            className="p-1 rounded-md text-slate-400 hover:text-slate-900 disabled:opacity-30"
            title="Copy description"
          >
            <Copy size={12} />
          </button>
        </div>
        <textarea
          className={`${ADD_FLOW_INPUT} flex-1 min-h-[8rem] border-0 rounded-none focus:ring-0 resize-none font-medium text-xs`}
          placeholder="German listing appears here after Generate…"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
        />
      </div>
    </div>
  );
};

export default ItemFormListingPanel;
