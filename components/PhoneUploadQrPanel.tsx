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
  const [copied, setCopied] = useState(false);
  const seenRef = useRef<Set<string>>(new Set());
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    let unsub: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      try {
        const created = await createPhotoUploadSession({ itemId, itemName });
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
        setQrDataUrl(dataUrl);
        unsub = subscribePhotoUploadSession(created.token, (live) => {
          setSession(live);
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Could not start iPhone upload';
        const permission =
          /permission|insufficient|Missing or insufficient/i.test(msg) ||
          (e as { code?: string })?.code === 'permission-denied';
        setError(
          permission
            ? 'Missing or insufficient permissions. Redeploy Firestore rules, then hard-refresh the app (Ctrl+Shift+R). You must be signed in with Google on the PC.'
            : msg
        );
      }
    })();
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [itemId, itemName]);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  useEffect(() => {
    if (!session?.uploadedUrls?.length) return;
    const fresh = session.uploadedUrls.filter((u) => !seenRef.current.has(u));
    if (!fresh.length) return;
    fresh.forEach((u) => seenRef.current.add(u));
    void onUrls(fresh);
  }, [session?.uploadedUrls, onUrls]);

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

  return (
    <div className="rounded-xl border border-sky-200 bg-sky-50/80 p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-black uppercase tracking-widest text-sky-800 flex items-center gap-1">
            <Smartphone size={12} /> From iPhone
          </p>
          <p className="text-[10px] text-sky-900/70 font-medium mt-0.5">
            Scan with Camera → pick from your full Photos library. Photos land here live.
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
        <p className="text-[10px] font-semibold text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-2 py-1.5">
          {error}
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
                    key={u.slice(-24)}
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
