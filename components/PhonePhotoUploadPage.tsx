import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, ImagePlus, Loader2, Smartphone, Upload } from 'lucide-react';
import {
  ensureAnonymousUploadAuth,
  fetchPhotoUploadSession,
  uploadPhonePhotoToSession,
  type PhotoUploadSession,
} from '../services/photoUploadSession';
import { compressImageFileToBlob, INVENTORY_PHOTO_STORAGE_OPTIONS } from '../utils/imageCompress';

const PhonePhotoUploadPage: React.FC = () => {
  const { token = '' } = useParams<{ token: string }>();
  const [session, setSession] = useState<PhotoUploadSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [doneCount, setDoneCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        await ensureAnonymousUploadAuth();
        const s = await fetchPhotoUploadSession(token);
        if (cancelled) return;
        if (!s) {
          setError('This upload link is invalid or was removed.');
          setSession(null);
        } else if (s.status !== 'active' || Date.now() > s.expiresAtMs) {
          setError('This upload link expired or was closed on the PC.');
          setSession(s);
        } else {
          setSession(s);
        }
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : 'Could not open upload link';
          setError(
            msg.includes('auth/operation-not-allowed') || msg.includes('admin-restricted-operation')
              ? 'Anonymous sign-in is not enabled yet. In Firebase Console → Authentication → Sign-in method, enable Anonymous. Or open the panel on this iPhone and sign in with the same Google account, then edit the item there.'
              : msg
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const remaining = useMemo(() => {
    if (!session) return 0;
    return Math.max(0, session.maxPhotos - session.uploadedUrls.length - doneCount);
  }, [session, doneCount]);

  const handleFiles = async (list: FileList | null) => {
    if (!list?.length || !session || !token) return;
    const files = Array.from(list).slice(0, remaining);
    if (!files.length) {
      setError('Photo limit reached for this link.');
      return;
    }
    setUploading(true);
    setError(null);
    let ok = 0;
    try {
      for (let i = 0; i < files.length; i++) {
        setProgress(`Uploading ${i + 1} / ${files.length}…`);
        const file = files[i];
        let blob: Blob = file;
        try {
          blob = await compressImageFileToBlob(file, INVENTORY_PHOTO_STORAGE_OPTIONS);
        } catch {
          blob = file;
        }
        await uploadPhonePhotoToSession(token, blob, file.name.replace(/\.\w+$/, '.jpg'));
        ok += 1;
        setDoneCount((c) => c + 1);
      }
      const refreshed = await fetchPhotoUploadSession(token);
      if (refreshed) setSession(refreshed);
      setProgress(ok ? `${ok} photo${ok === 1 ? '' : 's'} sent to your PC` : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
      setProgress(null);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="min-h-[100dvh] bg-slate-950 text-white px-4 py-6 flex flex-col">
      <div className="max-w-md w-full mx-auto flex-1 flex flex-col gap-4">
        <header className="space-y-1">
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-sky-400 flex items-center gap-1.5">
            <Smartphone size={14} /> DeInventory · iPhone upload
          </p>
          <h1 className="text-2xl font-black tracking-tight">
            {session?.itemName || 'Add photos'}
          </h1>
          <p className="text-sm text-slate-400 font-medium">
            Pick from your full Photos library. They appear instantly in Listing Studio on your PC.
          </p>
        </header>

        {loading && (
          <div className="flex-1 flex items-center justify-center text-slate-400">
            <Loader2 className="animate-spin" size={28} />
          </div>
        )}

        {error && (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100 font-medium">
            {error}
          </div>
        )}

        {!loading && session && session.status === 'active' && Date.now() <= session.expiresAtMs && (
          <>
            <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
              <p className="text-xs text-slate-300 font-semibold">
                {session.uploadedUrls.length + doneCount}/{session.maxPhotos} photos on this link
              </p>
              <label className="flex flex-col items-center justify-center gap-2 min-h-[160px] rounded-2xl border-2 border-dashed border-sky-400/50 bg-sky-500/10 px-4 py-8 cursor-pointer active:scale-[0.99] transition">
                {uploading ? (
                  <Loader2 className="animate-spin text-sky-300" size={28} />
                ) : (
                  <ImagePlus className="text-sky-300" size={28} />
                )}
                <span className="text-sm font-black uppercase tracking-wide text-sky-100">
                  {uploading ? 'Uploading…' : 'Choose from Photos'}
                </span>
                <span className="text-[11px] text-slate-400 text-center">
                  Opens your iPhone photo library (Camera Roll, Albums…)
                </span>
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  disabled={uploading || remaining <= 0}
                  onChange={(e) => {
                    void handleFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
              <label className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-white text-slate-900 text-xs font-black uppercase tracking-wide cursor-pointer">
                <Upload size={14} />
                Take / pick more
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  className="hidden"
                  disabled={uploading || remaining <= 0}
                  onChange={(e) => {
                    void handleFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>

            {progress && (
              <p className="text-sm font-semibold text-emerald-300 flex items-center gap-1.5">
                <CheckCircle2 size={16} /> {progress}
              </p>
            )}

            <p className="text-[11px] text-slate-500 leading-relaxed">
              Keep this page open until uploads finish. You can close it when your PC shows the new
              photos.
            </p>
          </>
        )}
      </div>
    </div>
  );
};

export default PhonePhotoUploadPage;
