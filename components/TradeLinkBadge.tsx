import React from 'react';
import { ArrowRightLeft, Crosshair, ExternalLink } from 'lucide-react';
import { InventoryItem } from '../types';
import { formatTradeItemList } from '../utils/tradeLinks';

type OutgoingProps = {
  variant: 'outgoing';
  receivedItems: InventoryItem[];
  onLocateItem: (item: InventoryItem) => void;
  onOpenItem: (item: InventoryItem) => void;
  className?: string;
};

type IncomingProps = {
  variant: 'incoming';
  sourceItem: InventoryItem;
  onLocate: () => void;
  onOpen: () => void;
  className?: string;
};

type BannerProps = {
  variant: 'banner-outgoing';
  receivedItems: InventoryItem[];
  onLocateItem: (item: InventoryItem) => void;
  onOpenItem: (item: InventoryItem) => void;
  className?: string;
} | {
  variant: 'banner-incoming';
  sourceItem: InventoryItem;
  onLocate: () => void;
  onOpen: () => void;
  className?: string;
};

type Props = OutgoingProps | IncomingProps | BannerProps;

const TradeLinkBadge: React.FC<Props> = (props) => {
  if (props.variant === 'outgoing') {
    const { receivedItems, onLocateItem, onOpenItem, className = '' } = props;
    if (receivedItems.length === 0) return null;
    const summary = formatTradeItemList(receivedItems.map((i) => i.name));

    return (
      <span
        className={`inline-flex flex-wrap items-center gap-1 max-w-full ${className}`}
        title={`Traded for: ${receivedItems.map((i) => i.name).join(', ')}`}
      >
        <span className="inline-flex items-center gap-1 text-[9px] font-black uppercase text-indigo-700 bg-indigo-50 border border-indigo-100 rounded px-1.5 py-0.5 shrink-0">
          <ArrowRightLeft size={9} className="shrink-0" />
          Received
        </span>
        {receivedItems.map((rec) => (
          <span
            key={rec.id}
            className="inline-flex items-center max-w-full rounded border border-indigo-100 bg-indigo-50/80 text-indigo-900 overflow-hidden"
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenItem(rec);
              }}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 min-w-0 hover:bg-indigo-100/80 transition-colors"
              title={`Open ${rec.name}`}
            >
              <span className="text-[9px] font-bold truncate max-w-[8rem]">{rec.name}</span>
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onLocateItem(rec);
              }}
              className="inline-flex items-center justify-center px-1 py-0.5 border-l border-indigo-200/80 hover:bg-indigo-100/80 transition-colors shrink-0"
              title={`Find ${rec.name} in list`}
              aria-label={`Find ${rec.name} in list`}
            >
              <Crosshair size={10} />
            </button>
          </span>
        ))}
        {receivedItems.length > 1 && (
          <span className="text-[8px] font-bold text-indigo-600/80 sr-only">{summary}</span>
        )}
      </span>
    );
  }

  if (props.variant === 'incoming') {
    const { sourceItem, onLocate, onOpen, className = '' } = props;
    const name = sourceItem.name.trim() || 'Untitled';

    return (
      <span
        className={`inline-flex items-center max-w-full rounded border border-violet-200 bg-violet-50 text-violet-900 overflow-hidden ${className}`}
        title={`Acquired via trade from: ${name}`}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 min-w-0 hover:bg-violet-100/80 transition-colors"
        >
          <ArrowRightLeft size={9} className="shrink-0 text-violet-600" />
          <span className="text-[9px] font-black uppercase shrink-0 text-violet-700">From trade</span>
          <span className="text-[9px] font-bold truncate max-w-[9rem]">{name}</span>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onLocate();
          }}
          className="inline-flex items-center justify-center px-1 py-0.5 border-l border-violet-200 hover:bg-violet-100/80 transition-colors shrink-0"
          title={`Find ${name} in list`}
          aria-label={`Find ${name} in list`}
        >
          <Crosshair size={10} />
        </button>
      </span>
    );
  }

  if (props.variant === 'banner-outgoing') {
    const { receivedItems, onLocateItem, onOpenItem, className = '' } = props;
    return (
      <div className={`rounded-2xl border border-indigo-100 bg-indigo-50/80 px-3 py-2.5 space-y-2 ${className}`}>
        <p className="text-[10px] font-black uppercase tracking-widest text-indigo-700 flex items-center gap-1.5">
          <ArrowRightLeft size={14} />
          Traded for {receivedItems.length} item{receivedItems.length === 1 ? '' : 's'}
        </p>
        <ul className="space-y-1.5">
          {receivedItems.map((rec) => (
            <li key={rec.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="font-bold truncate text-indigo-950" title={rec.name}>{rec.name}</span>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => onLocateItem(rec)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-black uppercase bg-white/80 border border-indigo-100 hover:bg-white"
                >
                  <Crosshair size={12} />
                  Find
                </button>
                <button
                  type="button"
                  onClick={() => onOpenItem(rec)}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-black uppercase bg-indigo-700 text-white hover:bg-indigo-800"
                >
                  <ExternalLink size={12} />
                  Open
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const { sourceItem, onLocate, onOpen, className = '' } = props;
  const name = sourceItem.name.trim() || 'Untitled';
  return (
    <div className={`flex flex-col sm:flex-row sm:items-center gap-2 rounded-2xl border border-violet-100 bg-violet-50/80 px-3 py-2.5 ${className}`}>
      <div className="flex items-start gap-2 min-w-0 flex-1">
        <ArrowRightLeft size={16} className="text-violet-600 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-widest text-violet-700">Acquired via trade</p>
          <p className="text-sm font-bold truncate text-violet-950" title={name}>{name}</p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={onLocate}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase bg-white/80 border border-violet-100 hover:bg-white"
        >
          <Crosshair size={12} />
          Find
        </button>
        <button
          type="button"
          onClick={onOpen}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase bg-violet-700 text-white hover:bg-violet-800"
        >
          <ExternalLink size={12} />
          Open
        </button>
      </div>
    </div>
  );
};

export default TradeLinkBadge;
