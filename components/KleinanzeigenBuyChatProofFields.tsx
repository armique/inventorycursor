import React, { useRef, useState } from 'react';
import { ExternalLink, Loader2, Trash2, Upload } from 'lucide-react';
import { persistSaleProofImage, urlNeedsPhotoArchive } from '../services/inventoryImageStorage';

export type ChatProofPatch = {
  kleinanzeigenBuyChatUrl?: string;
  kleinanzeigenBuyChatImage?: string;
};

interface Props {
  itemId: string;
  chatUrl: string;
  chatImage: string;
  onChatUrlChange: (url: string) => void;
  onChatImageChange: (image: string) => void;
  /** Persist to the inventory item (and archive image to Storage when needed). */
  onPersist: (patch: ChatProofPatch) => void | Promise<void>;
  compact?: boolean;
}

/**
 * Add / edit / clear Kleinanzeigen purchase chat URL + screenshot proof.
 * Screenshots are archived to Firebase Storage so Imgur / host deletion cannot wipe them.
 */
const KleinanzeigenBuyChatProofFields: React.FC<Props> = ({
  itemId,
  chatUrl,
  chatImage,
  onChatUrlChange,
  onChatImageChange,
  onPersist,
  compact,
}) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const archiveAndPersist = async (nextUrl: string, nextImage: string) => {
    setSaving(true);
    setError(null);
    try {
      let image = (nextImage || '').trim();
      if (image && urlNeedsPhotoArchive(image)) {
        image = await persistSaleProofImage(image, itemId);
        onChatImageChange(image);
      }
      const url = (nextUrl || '').trim();
      await onPersist({
        kleinanzeigenBuyChatUrl: url || undefined,
        kleinanzeigenBuyChatImage: image || undefined,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save chat proof');
    } finally {
      setSaving(false);
    }
  };

  const handleFile = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = String(reader.result || '');
      if (!dataUrl) return;
      onChatImageChange(dataUrl);
      void archiveAndPersist(chatUrl, dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const clearUrl = () => {
    onChatUrlChange('');
    void archiveAndPersist('', chatImage);
  };

  const clearImage = () => {
    onChatImageChange('');
    void onPersist({
      kleinanzeigenBuyChatUrl: chatUrl.trim() || undefined,
      kleinanzeigenBuyChatImage: undefined,
    });
  };

  const clearAll = () => {
    onChatUrlChange('');
    onChatImageChange('');
    void onPersist({
      kleinanzeigenBuyChatUrl: undefined,
      kleinanzeigenBuyChatImage: undefined,
    });
  };

  const showPreview =
    !!chatImage &&
    (chatImage.startsWith('data:image/') || /^https?:\/\//i.test(chatImage));

  return (
    <div className={compact ? 'space-y-1.5' : 'space-y-2'}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[9px] font-black uppercase tracking-widest text-slate-400">
          Kleinanzeigen chat proof
        </p>
        {(chatUrl || chatImage) && (
          <button
            type="button"
            onClick={clearAll}
            disabled={saving}
            className="text-[9px] font-black uppercase text-rose-600 hover:underline disabled:opacity-50"
          >
            Remove all
          </button>
        )}
      </div>
      <p className="text-[10px] text-slate-400 font-medium leading-snug">
        Add later if you forgot — screenshot is saved on the server when you upload.
      </p>

      <div className="flex gap-1.5">
        <input
          className="flex-1 min-w-0 px-2 py-1.5 rounded-lg bg-white border border-slate-200 text-[11px] font-semibold text-slate-900 outline-none focus:border-rose-400"
          placeholder="https://www.kleinanzeigen.de/s-nachrichten/…"
          value={chatUrl}
          disabled={saving}
          onChange={(e) => onChatUrlChange(e.target.value)}
          onBlur={() => void archiveAndPersist(chatUrl, chatImage)}
        />
        {chatUrl.trim() && (
          <>
            <a
              href={chatUrl.trim()}
              target="_blank"
              rel="noreferrer"
              className="p-2 rounded-lg border border-slate-200 bg-white text-sky-700 hover:bg-sky-50"
              title="Open chat"
            >
              <ExternalLink size={14} />
            </a>
            <button
              type="button"
              onClick={clearUrl}
              disabled={saving}
              className="p-2 rounded-lg border border-slate-200 bg-white text-slate-400 hover:text-rose-600"
              title="Clear URL"
            >
              <Trash2 size={14} />
            </button>
          </>
        )}
      </div>

      <div className="flex gap-1.5">
        <input
          className="flex-1 min-w-0 px-2 py-1.5 rounded-lg bg-white border border-slate-200 text-[11px] font-semibold text-slate-900 outline-none focus:border-rose-400"
          placeholder="Or paste screenshot URL (imgur…)"
          value={chatImage.startsWith('data:') ? '' : chatImage}
          disabled={saving}
          onChange={(e) => onChatImageChange(e.target.value.trim())}
          onBlur={() => {
            if (chatImage.startsWith('data:')) return;
            void archiveAndPersist(chatUrl, chatImage);
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={saving}
          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-[9px] font-black uppercase text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          title="Upload chat screenshot"
        >
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
          Photo
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            handleFile(e.target.files?.[0] || null);
            e.target.value = '';
          }}
        />
      </div>

      {showPreview && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50/80 px-2 py-1.5">
          <a
            href={chatImage}
            target="_blank"
            rel="noreferrer"
            className="w-12 h-12 rounded-lg overflow-hidden border border-emerald-200 shrink-0 bg-white"
          >
            <img src={chatImage} alt="Chat proof" className="w-full h-full object-cover" />
          </a>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-bold text-emerald-800">
              {chatImage.startsWith('data:')
                ? 'Uploading / local preview'
                : 'Proof saved on server'}
            </p>
            <p className="text-[9px] text-emerald-700/70 truncate font-medium">{chatImage}</p>
          </div>
          <button
            type="button"
            onClick={clearImage}
            disabled={saving}
            className="p-1.5 rounded-lg text-emerald-800/50 hover:text-rose-600"
            title="Remove screenshot"
          >
            <Trash2 size={14} />
          </button>
        </div>
      )}

      {error && (
        <p className="text-[10px] font-semibold text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-2 py-1">
          {error}
        </p>
      )}
    </div>
  );
};

export default KleinanzeigenBuyChatProofFields;
