import React from 'react';
import type { Platform } from '../types';

type BadgePlatform = 'kleinanzeigen' | 'ebay' | 'other';

function normalize(platform?: string | Platform | null): BadgePlatform {
  const p = (platform || '').toLowerCase();
  if (p.includes('kleinanzeigen') || p === 'ka') return 'kleinanzeigen';
  if (p.includes('ebay')) return 'ebay';
  return 'other';
}

const STYLES: Record<BadgePlatform, string> = {
  kleinanzeigen: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  ebay: 'bg-blue-100 text-blue-800 border-blue-200',
  other: 'bg-slate-100 text-slate-600 border-slate-200',
};

const LABELS: Record<BadgePlatform, string> = {
  kleinanzeigen: 'KA',
  ebay: 'eBay',
  other: 'Other',
};

interface Props {
  platform?: string | Platform | null;
  className?: string;
  showFull?: boolean;
}

/** Consistent Kleinanzeigen / eBay badges across the app (#132). */
const PlatformBadge: React.FC<Props> = ({ platform, className = '', showFull = false }) => {
  const kind = normalize(platform);
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-lg text-[9px] font-black uppercase tracking-widest border ${STYLES[kind]} ${className}`}
    >
      {showFull ? (kind === 'kleinanzeigen' ? 'Kleinanzeigen' : kind === 'ebay' ? 'eBay.de' : 'Other') : LABELS[kind]}
    </span>
  );
};

export default PlatformBadge;
export { normalize as normalizePlatformBadge };
