import React from 'react';
import { useNavigate } from 'react-router-dom';
import { PartyPopper, TrendingUp, Newspaper, X } from 'lucide-react';
import { formatEURPrefix } from '../../utils/formatMoney';
import type { GamificationEvent } from '../../hooks/useGamificationEvents';

type Props = {
  event: GamificationEvent | null;
  onDismiss: () => void;
  onResolveDealClosed: (event: Extract<GamificationEvent, { kind: 'deal-closed' }>, choice: 'take' | 'keep') => void;
};

/** Proactive game-event toast — deal closed / expansion signal / weekly digest ready.
 * Styled like components/UndoToastBar.tsx; mounted once in PanelLayout so it's visible anywhere
 * in /panel/*, since a sale can be confirmed from several different pages. */
const GamificationEventLayer: React.FC<Props> = ({ event, onDismiss, onResolveDealClosed }) => {
  const navigate = useNavigate();
  if (!event) return null;

  return (
    <div className="relative fixed bottom-6 left-1/2 -translate-x-1/2 z-[500] w-[min(92vw,26rem)] rounded-2xl bg-slate-900 text-white shadow-2xl border border-slate-700 p-4 animate-in slide-in-from-bottom-4">
      <button
        type="button"
        onClick={onDismiss}
        className="absolute top-2.5 right-2.5 p-1 text-slate-400 hover:text-white"
        aria-label="Dismiss"
      >
        <X size={16} />
      </button>

      {event.kind === 'deal-closed' && (
        <>
          <p className="flex items-center gap-2 text-sm font-black">
            <PartyPopper size={18} className="text-amber-300" /> You earned {formatEURPrefix(event.profit)} on this
            deal!
          </p>
          <p className="mt-1 text-xs text-slate-300 font-semibold">{event.itemName}</p>
          {event.circulationCredit > 0 && (
            <p className="mt-1 text-[11px] text-emerald-300 font-semibold">
              +{formatEURPrefix(event.circulationCredit)} already went to working capital automatically.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => onResolveDealClosed(event, 'take')}
              className="px-3 py-2 rounded-xl bg-white text-slate-900 text-xs font-black uppercase tracking-wide hover:bg-slate-100"
            >
              Take {formatEURPrefix(event.suggestedTake)} for yourself
            </button>
            <button
              type="button"
              onClick={() => onResolveDealClosed(event, 'keep')}
              className="px-3 py-2 rounded-xl border border-slate-600 text-xs font-black uppercase tracking-wide hover:bg-slate-800"
            >
              Leave in circulation
            </button>
          </div>
        </>
      )}

      {event.kind === 'expansion-signal' && (
        <>
          <p className="flex items-center gap-2 text-sm font-black">
            <TrendingUp size={18} className="text-emerald-300" /> Things are looking up — worth expanding?
          </p>
          <p className="mt-1 text-xs text-slate-300 font-semibold">
            Buy "{event.label}" for ~{formatEURPrefix(event.buyMax)} → typical sale ~{formatEURPrefix(event.sellHint)}{' '}
            (based on {event.sampleSize} similar deals, ~{Math.round(event.avgDaysToSell)}d to sell).
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                onDismiss();
                navigate('/panel/reinvest');
              }}
              className="px-3 py-2 rounded-xl bg-white text-slate-900 text-xs font-black uppercase tracking-wide hover:bg-slate-100"
            >
              Show lots
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="px-3 py-2 rounded-xl border border-slate-600 text-xs font-black uppercase tracking-wide hover:bg-slate-800"
            >
              Not now
            </button>
          </div>
        </>
      )}

      {event.kind === 'digest-ready' && (
        <>
          <p className="flex items-center gap-2 text-sm font-black">
            <Newspaper size={18} className="text-sky-300" /> Your weekly digest is ready
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                onDismiss();
                navigate('/panel/reinvest');
              }}
              className="px-3 py-2 rounded-xl bg-white text-slate-900 text-xs font-black uppercase tracking-wide hover:bg-slate-100"
            >
              Open
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default GamificationEventLayer;
