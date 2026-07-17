import React from 'react';
import { BoxSelect, Crosshair, ExternalLink, Layers, Monitor } from 'lucide-react';
import {
  ContainerKind,
  getContainerKindLabel,
  getContainerKindShortLabel,
  containerMembershipStyles,
} from '../utils/containerMembership';

type Props = {
  kind: ContainerKind;
  parentName: string;
  onOpen: () => void;
  onLocate?: () => void;
  /** Inline chip in inventory rows (default) vs banner in edit modal */
  variant?: 'inline' | 'banner';
  className?: string;
};

const kindIcon = (kind: ContainerKind, size: number) => {
  switch (kind) {
    case 'mixed':
      return <BoxSelect size={size} className="shrink-0" />;
    case 'bundle':
      return <Layers size={size} className="shrink-0" />;
    case 'pc':
      return <Monitor size={size} className="shrink-0" />;
  }
};

const ContainerMembershipBadge: React.FC<Props> = ({
  kind,
  parentName,
  onOpen,
  onLocate,
  variant = 'inline',
  className = '',
}) => {
  const styles = containerMembershipStyles(kind);
  const shortKind = getContainerKindShortLabel(kind);
  const fullKind = getContainerKindLabel(kind);
  const displayName = parentName.trim() || 'Untitled';

  if (variant === 'banner') {
    return (
      <div
        className={`flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 rounded-2xl border px-3 py-2.5 ${styles.badge} ${className}`}
      >
        <div className="flex items-start gap-2 min-w-0 flex-1">
          {kindIcon(kind, 16)}
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-widest opacity-80">Part of {fullKind}</p>
            <p className="text-sm font-bold truncate" title={displayName}>
              {displayName}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {onLocate && (
            <button
              type="button"
              onClick={onLocate}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase bg-white/70 hover:bg-white border border-black/5 transition-colors"
              title={`Find ${fullKind.toLowerCase()} in inventory list`}
            >
              <Crosshair size={12} />
              Find
            </button>
          )}
          <button
            type="button"
            onClick={onOpen}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10px] font-black uppercase bg-slate-900 text-white hover:bg-slate-800 transition-colors"
            title={`Open ${fullKind.toLowerCase()}`}
          >
            <ExternalLink size={12} />
            Open
          </button>
        </div>
      </div>
    );
  }

  return (
    <span
      className={`inline-flex items-center max-w-full rounded border overflow-hidden ${styles.badge} ${className}`}
      title={`Part of ${fullKind}: ${displayName}`}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 min-w-0 hover:bg-black/5 transition-colors"
      >
        {kindIcon(kind, 9)}
        <span className="text-[9px] font-black uppercase shrink-0">{shortKind}</span>
        <span className="text-[9px] font-bold truncate max-w-[9rem]">{displayName}</span>
      </button>
      {onLocate && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onLocate();
          }}
          className="inline-flex items-center justify-center px-1 py-0.5 border-l border-black/10 hover:bg-black/5 transition-colors shrink-0"
          title={`Find ${fullKind.toLowerCase()} in list`}
          aria-label={`Find ${fullKind.toLowerCase()} in list`}
        >
          <Crosshair size={10} />
        </button>
      )}
    </span>
  );
};

export default ContainerMembershipBadge;
