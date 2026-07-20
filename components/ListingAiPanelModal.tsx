import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Copy, Check, Loader2, Sparkles, X } from 'lucide-react';
import type { InventoryItem } from '../types';
import {
  formatOwnerListingHints,
  generateMarketplaceListing,
  type MarketplaceListingResult,
} from '../services/marketplaceListingAI';

interface Props {
  item: InventoryItem;
  allItems?: InventoryItem[] | null;
  onClose: () => void;
  onApply: (patch: Pick<InventoryItem, 'marketTitle' | 'marketDescription'>) => void | Promise<void>;
}

const ListingAiPanelModal: React.FC<Props> = ({ item, onClose, onApply }) => {
  const [title, setTitle] = useState(item.marketTitle?.trim() || item.name || '');
  const [description, setDescription] = useState(item.marketDescription || '');
  const [ownerHints, setOwnerHints] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'title' | 'desc' | 'owner' | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const copyText = async (which: 'title' | 'desc' | 'owner', text: string) => {
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      setError('Copy failed');
    }
  };

  const applyResult = (result: MarketplaceListingResult) => {
    setTitle(result.ebayTitle);
    setDescription(result.listingText);
    setOwnerHints(formatOwnerListingHints(result));
  };

  const runGenerate = async () => {
    if (!item.name?.trim()) {
      setError('Item needs a name first.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await generateMarketplaceListing(item, {
        hasOVP: item.hasOVP,
        hasIOShield: item.hasIOShield,
        hasReceipt: item.hasReceipt,
        aiDescriptionNote: item.aiDescriptionNote,
      });
      applyResult(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    setApplying(true);
    setError(null);
    try {
      await onApply({
        marketTitle: title.trim().slice(0, 80),
        marketDescription: description.trim(),
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setApplying(false);
    }
  };

  const titleLen = [...title].length;

  return createPortal(
    <div
      className="fixed inset-0 z-[230] flex items-center justify-center bg-slate-900/55 backdrop-blur-sm p-3 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-3xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-slate-100 flex items-start justify-between gap-3 bg-slate-50/80">
          <div className="min-w-0">
            <h3 className="text-sm font-black text-slate-900 flex items-center gap-1.5">
              <Sparkles size={14} className="text-emerald-600" /> Listing AI
            </h3>
            <p className="text-[11px] text-slate-500 font-medium truncate mt-0.5" title={item.name}>
              {item.name}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto flex-1 min-h-0">
          {ownerHints && (
            <div className="rounded-xl border border-dashed border-emerald-300 bg-emerald-50/70 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2 mb-1">
                <p className="text-[10px] font-black uppercase tracking-widest text-emerald-800">
                  Für dich (nicht Teil der Anzeige)
                </p>
                <button
                  type="button"
                  onClick={() => void copyText('owner', ownerHints)}
                  className="inline-flex items-center gap-1 text-[10px] font-bold uppercase text-emerald-700 hover:text-emerald-900"
                >
                  {copied === 'owner' ? <Check size={11} /> : <Copy size={11} />}
                  Copy
                </button>
              </div>
              <pre className="text-[11px] text-emerald-900/90 whitespace-pre-wrap font-sans leading-relaxed m-0">
                {ownerHints}
              </pre>
            </div>
          )}

          {/* Block 1 — Title */}
          <section className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-3 py-2 border-b border-slate-100 bg-slate-50 flex items-center justify-between gap-2">
              <div>
                <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  AI Titel
                </h4>
                <p className="text-[10px] text-slate-400 font-medium">eBay · max 80 Zeichen</p>
              </div>
              <button
                type="button"
                disabled={!title.trim()}
                onClick={() => void copyText('title', title)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 text-[10px] font-black uppercase text-slate-600 hover:bg-white disabled:opacity-40"
              >
                {copied === 'title' ? <Check size={11} /> : <Copy size={11} />}
                Copy
              </button>
            </div>
            <input
              type="text"
              value={title}
              maxLength={80}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none"
              placeholder="eBay title…"
            />
            <div className="px-3 py-1.5 border-t border-slate-100 text-[10px] font-bold text-slate-400 flex justify-between">
              <span>Optimierter Marktplatz-Titel</span>
              <span className={titleLen > 78 ? 'text-amber-600' : 'text-emerald-700'}>
                {titleLen}/80
              </span>
            </div>
          </section>

          {/* Block 2 — Description */}
          <section className="rounded-xl border border-slate-200 bg-white overflow-hidden flex flex-col">
            <div className="px-3 py-2 border-b border-slate-100 bg-slate-50 flex items-center justify-between gap-2">
              <div>
                <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                  AI Beschreibung
                </h4>
                <p className="text-[10px] text-slate-400 font-medium">
                  eBay.de / Kleinanzeigen · DE
                </p>
              </div>
              <button
                type="button"
                disabled={!description.trim()}
                onClick={() => void copyText('desc', description)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 text-[10px] font-black uppercase text-slate-600 hover:bg-white disabled:opacity-40"
              >
                {copied === 'desc' ? <Check size={11} /> : <Copy size={11} />}
                Copy
              </button>
            </div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full min-h-[260px] px-3 py-2.5 text-sm text-slate-800 outline-none resize-y leading-relaxed"
              placeholder="Generate a German listing…"
            />
          </section>

          {error && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900 whitespace-pre-wrap">
              {error}
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center gap-2 py-2 text-slate-500 text-xs font-bold">
              <Loader2 size={16} className="animate-spin text-emerald-600" />
              Generating title + description…
            </div>
          )}
        </div>

        <div className="px-4 py-3 border-t border-slate-100 flex flex-wrap gap-2 bg-white">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 rounded-xl border border-slate-200 text-[10px] font-black uppercase text-slate-500"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => void runGenerate()}
            disabled={loading || applying}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-600 text-white text-[10px] font-black uppercase hover:bg-emerald-700 disabled:opacity-50"
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {description.trim() ? 'Regenerate both' : 'Generate both'}
          </button>
          <button
            type="button"
            onClick={() => void handleApply()}
            disabled={loading || applying || (!title.trim() && !description.trim())}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-900 bg-slate-900 text-white text-[10px] font-black uppercase hover:bg-slate-800 disabled:opacity-50 ml-auto"
          >
            {applying ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            Apply to item
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ListingAiPanelModal;
