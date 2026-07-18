import React from 'react';
import { ExternalLink, MessageCircle } from 'lucide-react';
import type { InventoryItem } from '../types';

type Props = {
  item: InventoryItem;
  /** Open screenshot in a lightbox / preview instead of a new tab. */
  onPreviewImage?: (url: string, label: string) => void;
  className?: string;
};

function ProofChip({
  label,
  href,
  imageUrl,
  onPreviewImage,
}: {
  label: string;
  href?: string;
  imageUrl?: string;
  onPreviewImage?: (url: string, label: string) => void;
}) {
  if (!href && !imageUrl) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[9px] font-bold text-slate-700 bg-white px-1.5 py-1 rounded-lg border border-slate-200 shadow-sm">
      <MessageCircle size={10} className="text-emerald-600 shrink-0" />
      <span className="uppercase tracking-wide text-slate-500">{label}</span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-0.5 text-emerald-700 hover:underline max-w-[9rem] truncate"
          title={href}
        >
          Open chat <ExternalLink size={9} />
        </a>
      ) : null}
      {imageUrl ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (onPreviewImage) onPreviewImage(imageUrl, label);
            else window.open(imageUrl, '_blank', 'noopener,noreferrer');
          }}
          className="w-7 h-7 rounded-md overflow-hidden border border-slate-200 shrink-0 hover:ring-2 hover:ring-emerald-300"
          title={`View ${label} screenshot`}
        >
          <img src={imageUrl} alt="" className="w-full h-full object-cover" />
        </button>
      ) : null}
    </span>
  );
}

/** Compact buy/sell chat link + screenshot chips for inventory cards. */
export default function ItemChatProofBadges({ item, onPreviewImage, className = '' }: Props) {
  const buyUrl = (item.kleinanzeigenBuyChatUrl || '').trim();
  const buyImage = (item.kleinanzeigenBuyChatImage || '').trim();
  const sellUrl = (item.kleinanzeigenChatUrl || '').trim();
  const sellImage = (item.kleinanzeigenChatImage || '').trim();

  if (!buyUrl && !buyImage && !sellUrl && !sellImage) return null;

  return (
    <div className={`mt-1.5 flex flex-wrap items-center gap-1.5 ${className}`}>
      <ProofChip label="Bought" href={buyUrl || undefined} imageUrl={buyImage || undefined} onPreviewImage={onPreviewImage} />
      <ProofChip label="Sold" href={sellUrl || undefined} imageUrl={sellImage || undefined} onPreviewImage={onPreviewImage} />
    </div>
  );
}
