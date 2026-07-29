/**
 * "Proof / Nachweise" — evidence files for one record.
 *
 * Deliberately separate from the product photo gallery: these are tax-audit documents
 * (chat screenshots, payment confirmations, receipts), not pictures of the item.
 *
 * Accepts drag & drop, a file picker, and paste from the clipboard — a screenshot goes
 * from Win+Shift+S straight into the record.
 */

import React, { useCallback, useRef, useState } from 'react';
import { ExternalLink, FileText, Loader2, Paperclip, Trash2, Upload } from 'lucide-react';
import type { ProofAttachment, ProofAttachmentType } from '../types';
import { uploadProofAttachment } from '../services/firebaseService';
import {
  addProofAttachment,
  collectProofAttachments,
  PROOF_TYPE_LABELS,
  removeProofAttachment,
  type CollectedProof,
} from '../utils/proofAttachments';

interface Props {
  recordId: string;
  attachments?: ProofAttachment[];
  /** Legacy screenshot fields are read off this so they show up in the gallery too. */
  record?: Record<string, unknown>;
  onChange: (next: ProofAttachment[]) => void;
  /** Hidden while the record has no id yet (nothing to attach files to). */
  disabled?: boolean;
  className?: string;
}

const TYPE_OPTIONS: ProofAttachmentType[] = [
  'chat_screenshot',
  'payment_confirmation',
  'shipping_label',
  'receipt',
  'other',
];

function isImage(url: string): boolean {
  return /\.(png|jpe?g|gif|webp|avif|heic)(\?|$)/i.test(url) || url.includes('images%2F');
}

const ProofAttachmentsPanel: React.FC<Props> = ({
  recordId,
  attachments,
  record,
  onChange,
  disabled = false,
  className = '',
}) => {
  const [type, setType] = useState<ProofAttachmentType>('chat_screenshot');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const proofs: CollectedProof[] = collectProofAttachments({
    ...(record || {}),
    proofAttachments: attachments,
  } as never);

  const upload = useCallback(
    async (files: File[]) => {
      if (!files.length || disabled) return;
      setBusy(true);
      setError(null);
      try {
        let next = attachments || [];
        for (const file of files) {
          const url = await uploadProofAttachment(file, recordId, file.name);
          next = addProofAttachment(next, {
            type,
            fileUrl: url,
            fileName: file.name,
            uploadedBy: 'manual',
            note: note.trim() || undefined,
          });
        }
        onChange(next);
        setNote('');
      } catch (e) {
        setError((e as Error)?.message || 'Upload failed.');
      } finally {
        setBusy(false);
      }
    },
    [attachments, disabled, note, onChange, recordId, type]
  );

  const onPaste = useCallback(
    (e: React.ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files || []);
      if (!files.length) return;
      e.preventDefault();
      void upload(files);
    },
    [upload]
  );

  return (
    <div className={`rounded-2xl border border-slate-200 bg-white p-4 space-y-3 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-black text-slate-900 flex items-center gap-2">
          <Paperclip size={15} className="text-slate-400" />
          Proof / Nachweise
          {proofs.length > 0 && (
            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] tabular-nums">
              {proofs.length}
            </span>
          )}
        </h3>
        <p className="text-[10px] font-semibold text-slate-400">Evidence for the tax audit</p>
      </div>

      {proofs.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {proofs.map((p) => (
            <div
              key={p.id}
              className="group relative rounded-xl border border-slate-200 overflow-hidden bg-slate-50"
            >
              <a href={p.fileUrl} target="_blank" rel="noopener noreferrer" className="block">
                {isImage(p.fileUrl) ? (
                  <img
                    src={p.fileUrl}
                    alt={p.note || PROOF_TYPE_LABELS[p.type]}
                    className="w-full h-24 object-cover"
                    loading="lazy"
                  />
                ) : (
                  <span className="w-full h-24 flex items-center justify-center text-slate-400">
                    <FileText size={26} />
                  </span>
                )}
              </a>
              <div className="px-2 py-1.5 space-y-0.5">
                <p className="text-[10px] font-black uppercase tracking-wide text-slate-600 truncate">
                  {PROOF_TYPE_LABELS[p.type]}
                </p>
                <p className="text-[10px] font-semibold text-slate-400 truncate" title={p.note || p.fileName}>
                  {p.note || p.fileName || '—'}
                  {p.uploadedBy === 'ai' ? ' · by AI' : ''}
                </p>
              </div>
              <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <a
                  href={p.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1 rounded-md bg-white/90 text-slate-600 hover:text-slate-900 shadow-sm"
                  title="Open in new tab"
                >
                  <ExternalLink size={12} />
                </a>
                {!p.legacy && (
                  <button
                    type="button"
                    onClick={() => onChange(removeProofAttachment(attachments, p.id))}
                    className="p-1 rounded-md bg-white/90 text-red-600 hover:bg-red-50 shadow-sm"
                    title="Remove this proof"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
              {p.legacy && (
                <span
                  className="absolute top-1 left-1 px-1 py-0.5 rounded bg-slate-900/70 text-white text-[8px] font-black uppercase"
                  title={`Attached earlier via the ${p.legacyField} field`}
                >
                  Legacy
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as ProofAttachmentType)}
          disabled={disabled}
          className="py-1.5 px-2 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700"
        >
          {TYPE_OPTIONS.map((t) => (
            <option key={t} value={t}>
              {PROOF_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={disabled}
          placeholder="Note (e.g. chat at the moment payment was confirmed)"
          className="flex-1 min-w-[12rem] py-1.5 px-2.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 placeholder:text-slate-400"
        />
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void upload(Array.from(e.dataTransfer.files || []));
        }}
        onPaste={onPaste}
        tabIndex={0}
        className={`rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors outline-none ${
          disabled
            ? 'border-slate-100 bg-slate-50/50 opacity-60'
            : dragging
              ? 'border-sky-400 bg-sky-50'
              : 'border-slate-200 hover:border-slate-300 focus:border-sky-400'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => {
            void upload(Array.from(e.target.files || []));
            e.target.value = '';
          }}
        />
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-black uppercase tracking-wider hover:bg-slate-800 disabled:opacity-50"
        >
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          {busy ? 'Uploading…' : 'Add proof'}
        </button>
        <p className="mt-2 text-[11px] font-semibold text-slate-400">
          {disabled
            ? 'Save the record first, then attach proof files.'
            : 'Drop files here, click above, or paste a screenshot from the clipboard.'}
        </p>
      </div>

      {error && (
        <p className="text-xs font-bold text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
    </div>
  );
};

export default ProofAttachmentsPanel;
