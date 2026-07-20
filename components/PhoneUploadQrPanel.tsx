import React, { useEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Check, Copy, Loader2, Smartphone, X } from 'lucide-react';
import {
  buildPhoneUploadUrl,
  createPhotoUploadSession,
  revokePhotoUploadSession,
  subscribePhotoUploadSession,
  type PhotoUploadSession,
} from '../services/photoUploadSession';

interface Props {
  itemId: string;
  itemName: string;
  onUrls: (urls: string[]) => void | Promise<void>;
  onClose: () => void;
}

const PhoneUploadQrPanel: React.FC<Props> = ({ itemId, itemName, onUrls, onClose }) => {
  const [session, setSession] = useState<PhotoUploadSession | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attachStatus, setAttachStatus] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const seenRef = useRef<Set<string>>(new Set());
  const attachChainRef = useRef<Promise<void>>(Promise.resolve());
  const onUrlsRef = useRef(onUrls);
  const [now, setNow] = useState(Date.now());

  // Keep latest callback without recreating the Firestore session.
  useEffect(() => {
    onUrlsRef.current = onUrls;
  }, [onUrls]);

  // Create ONE session per itemId. Do not recreate when the item name edits —
  // that invalidated the QR while the phone still uploaded to the old token.
  useEffect(() => {
    let unsub: (() => void) | undefined;
    let cancelled = false;
    seenRef.current = new Set();
    setSession(null);
    setQrDataUrl(null);
    setError(null);
    setAttachStatus(null);

    (async () => {
      try {
        const created = await createPhotoUploadSession({
          itemId,
          itemName: itemName || 'Item',
        });
        if (cancelled) {
          await revokePhotoUploadSession(created.token);
          return;
        }
        setSession(created);
        const url = buildPhoneUploadUrl(created.token);
        const dataUrl = await QRCode.toDataURL(url, {
          margin: 1,
          width: 220,
          color: { dark: '#0f172a', light: '#ffffff' },
        });
        if (!cancelled) setQrDataUrl(dataUrl);
        unsub = subscribePhotoUploadSession(created.token, (live) => {
          if (!cancelled) setSession(live);
        });
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : 'Could not start iPhone upload';
        const permission =
          /permission|insufficient|Missing or insufficient/i.test(msg) ||
          (e as { code?: string })?.code === 'permission-denied';
        setError(
          permission
            ? 'Could not create upload session. Hard-refresh (Ctrl+Shift+R). You must be signed in with Google (AUTHENTICATED). If it still fails, click Save Now in Settings once, then try again.'
            : msg
        );
      }
    })();

    return () => {
      cancelled = true;
      unsub?.();
    };
    // intentionally only itemId — name changes must not rotate the QR token
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  // Attach new session URLs to the inventory item (serialized, retryable).
  useEffect(() => {
    if (!session?.uploadedUrls?.length) return;
    const fresh = session.uploadedUrls.filter((u) => !seenRef.current.has(u));
    if (!fresh.length) return;
    const batch = [...fresh];

    attachChainRef.current = attachChainRef.current
      .catch(() => undefined)
      .then(async () => {
        const stillFresh = batch.filter((u) => !seenRef.current.has(u));
        if (!stillFresh.length) return;
        setAttachStatus(
          stillFresh.length === 1
            ? 'Attaching photo to item…'
            : `Attaching ${stillFresh.length} photos to item…`
        );
        setError(null);
        try {
          await onUrlsRef.current(stillFresh);
          stillFresh.forEach((u) => seenRef.current.add(u));
          setAttachStatus(
            stillFresh.length === 1
              ? 'Photo saved on this item'
              : `${stillFresh.length} photos saved on this item`
          );
        } catch (e) {
          setAttachStatus(null);
          setError(
            e instanceof Error
              ? `Photos reached the PC but failed to save on the item: ${e.message}`
              : 'Photos reached the PC but failed to save on the item.'
          );
          // Leave URLs unseen so the next snapshot / remount can retry.
        }
      });
  }, [session?.uploadedUrls, session?.token]);

  const uploadUrl = useMemo(
    () => (session ? buildPhoneUploadUrl(session.token) : ''),
    [session]
  );

  const remainingSec = session
    ? Math.max(0, Math.floor((session.expiresAtMs - now) / 1000))
    : 0;
  const mm = String(Math.floor(remainingSec / 60)).padStart(2, '0');
  const ss = String(remainingSec % 60).padStart(2, '0');

  const handleClose = async () => {
    if (session?.token) {
      try {
        await revokePhotoUploadSession(session.token);
      } catch {
        /* ignore */
      }
    }
    onClose();
  };

  const copyLink = async () => {
    if (!uploadUrl) return;
    try {
      await navigator.clipboard.writeText(uploadUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setError('Copy failed');
    }
  };

  const retryAttach = () => {
    if (!session?.uploadedUrls?.length) return;
    seenRef.current = new Set();
    setError(null);
    setAttachStatus('Retrying attach…');
    // Force effect by clearing then setting — trigger via re-filter
    void (async () => {
      try {
        await onUrlsRef.current(session.uploadedUrls);
        session.uploadedUrls.forEach((u) => seenRef.current.add(u));
        setAttachStatus(
          session.uploadedUrls.length === 1
            ? 'Photo saved on this item'
            : `${session.uploadedUrls.length} photos saved on this item`
        );
      } catch (e) {
        setAttachStatus(null);
        setError(
          e instanceof Error
            ? `Retry failed: ${e.message}`
            : 'Retry failed — keep this panel open and try again.'
        );
      }
    })();
  };

  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50/80 p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-widest text-sky-800 flex items-center gap-1">
            <Smartphone size={12} /> From iPhone
          </p>
          <p className="text-[10px] text-sky-900/70 font-medium mt-0.5">
            Keep this panel open while you upload. Scan → same Google account → Photos.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleClose()}
          className="p-1 rounded-lg text-sky-700/60 hover:bg-sky-100"
          title="Close & revoke link"
        >
          <X size={14} />
        </button>
      </div>

      {error && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-2 py-1.5">
            {error}
          </p>
          {session && session.uploadedUrls.length > 0 && (
            <button
              type="button"
              onClick={retryAttach}
              className="text-[9px] font-black uppercase text-rose-800 underline"
            >
              Retry attach to item
            </button>
          )}
        </div>
      )}

      {attachStatus && !error && (
        <p className="text-[10px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-lg px-2 py-1.5">
          {attachStatus}
        </p>
      )}

      {!session && !error && (
        <div className="flex justify-center py-6 text-sky-700">
          <Loader2 size={20} className="animate-spin" />
        </div>
      )}

      {session && (
        <div className="flex flex-col sm:flex-row gap-3 items-center sm:items-start">
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt="QR code for iPhone upload"
              className="w-[140px] h-[140px] rounded-xl border border-white shadow-sm bg-white"
            />
          ) : (
            <div className="w-[140px] h-[140px] rounded-xl bg-white border border-slate-200 flex items-center justify-center">
              <Loader2 size={18} className="animate-spin text-slate-400" />
            </div>
          )}
          <div className="min-w-0 flex-1 space-y-1.5 w-full">
            <p className="text-[11px] font-bold text-slate-800 truncate" title={itemName}>
              {itemName}
            </p>
            <p className="text-[10px] font-semibold text-slate-500">
              Expires in {mm}:{ss} · {session.uploadedUrls.length}/{session.maxPhotos} received
            </p>
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={() => void copyLink()}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white border border-sky-200 text-[9px] font-black uppercase text-sky-800"
              >
                {copied ? <Check size={11} /> : <Copy size={11} />}
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
            {session.uploadedUrls.length > 0 && (
              <div className="grid grid-cols-4 gap-1 pt-1">
                {session.uploadedUrls.slice(-4).map((u) => (
                  <img
                    key={u.slice(-40)}
                    src={u}
                    alt=""
                    className="aspect-square rounded-lg object-cover border border-sky-100 bg-white"
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default PhoneUploadQrPanel;
