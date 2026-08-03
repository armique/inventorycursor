import React, { useState } from 'react';
import { Check, Download, FileText, Image as ImageIcon, ListChecks, Loader2, Type } from 'lucide-react';
import type { InventoryItem } from '../types';
import {
  canMarkSaleReady,
  downloadListingPhotosToComputer,
  getListingPrepChecklist,
  listingPrepMissingLabel,
  type ListingPrepKey,
} from '../utils/listingPrepChecklist';

type Props = {
  item: InventoryItem;
  compact?: boolean;
  listingBusy?: boolean;
  onToggleSaleReady: () => void;
  onGenerateListing: () => void;
  onOpenPhotos: () => void;
  onToast?: (msg: string) => void;
};

const LABELS: Record<ListingPrepKey, string> = {
  title: 'Title',
  description: 'Desc',
  photos: 'Photos',
};

const ListingPrepChecklistBar: React.FC<Props> = ({
  item,
  compact = true,
  listingBusy = false,
  onToggleSaleReady,
  onGenerateListing,
  onOpenPhotos,
  onToast,
}) => {
  const prep = getListingPrepChecklist(item);
  const canReady = canMarkSaleReady(item);
  const [downloading, setDownloading] = useState(false);

  const chipClass = (ok: boolean) =>
    `inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border ${
      ok
        ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
        : 'bg-slate-50 text-slate-400 border-slate-200'
    }`;

  const onChipClick = (key: ListingPrepKey) => {
    if (key === 'photos') onOpenPhotos();
    else onGenerateListing();
  };

  const handleDownloadPhotos = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!prep.hasPhotos || downloading) return;
    setDownloading(true);
    try {
      const { ok, failed } = await downloadListingPhotosToComputer(item);
      onToast?.(
        failed
          ? `Photos: ${ok} saved / opened · ${failed} failed`
          : `Saved ${ok} photo${ok === 1 ? '' : 's'} to Downloads`,
      );
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div
      className={`flex items-center gap-1 flex-wrap ${compact ? 'leading-tight' : ''}`}
      onClick={(e) => e.stopPropagation()}
    >
      {(['title', 'description', 'photos'] as ListingPrepKey[]).map((key) => {
        const ok =
          key === 'title' ? prep.hasTitle : key === 'description' ? prep.hasDescription : prep.hasPhotos;
        const Icon = key === 'title' ? Type : key === 'description' ? FileText : ImageIcon;
        const title =
          key === 'title'
            ? ok
              ? `Title OK · ${prep.titlePreview}`
              : 'Missing generated title — click to generate'
            : key === 'description'
              ? ok
                ? `Description OK · ${prep.descriptionChars} chars`
                : 'Missing description — click to generate'
              : ok
                ? `${prep.photoCount} photo${prep.photoCount === 1 ? '' : 's'} on item`
                : 'Add product photos';
        return (
          <button
            key={key}
            type="button"
            title={title}
            onClick={() => onChipClick(key)}
            className={chipClass(ok)}
          >
            {ok ? <Check size={10} strokeWidth={3} /> : <Icon size={10} strokeWidth={2.5} />}
            {LABELS[key]}
            {key === 'photos' && prep.photoCount > 0 ? (
              <span className="normal-case font-semibold opacity-80">{prep.photoCount}</span>
            ) : null}
          </button>
        );
      })}

      {prep.hasPhotos ? (
        <button
          type="button"
          title="Download listing photos to this computer (for KA/eBay file picker)"
          disabled={downloading}
          onClick={handleDownloadPhotos}
          className="inline-flex items-center justify-center p-0.5 rounded border border-slate-200 bg-white text-slate-500 hover:text-blue-700 hover:border-blue-300 disabled:opacity-60"
        >
          {downloading ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
        </button>
      ) : null}

      <button
        type="button"
        disabled={listingBusy || (!item.saleReady && !canReady)}
        title={
          item.saleReady
            ? 'List Ready — in queue for drafts. Click to unmark.'
            : canReady
              ? 'Checklist complete — mark List Ready'
              : `Finish checklist first: ${listingPrepMissingLabel(prep.missing)}`
        }
        onClick={() => {
          if (!item.saleReady && !canReady) {
            onToast?.(`List Ready needs: ${listingPrepMissingLabel(prep.missing)}`);
            return;
          }
          onToggleSaleReady();
        }}
        className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[11px] font-black uppercase tracking-wide border ${
          item.saleReady
            ? 'bg-violet-50 text-violet-800 border-violet-200'
            : canReady
              ? 'bg-violet-600 text-white border-violet-700 hover:bg-violet-700'
              : 'bg-slate-50 text-slate-300 border-slate-200 cursor-not-allowed'
        }`}
      >
        <ListChecks size={12} strokeWidth={2.5} />
        List Ready
      </button>
    </div>
  );
};

export default ListingPrepChecklistBar;
