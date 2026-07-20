import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { CheckCircle2, ImagePlus, Loader2, Smartphone, Upload } from 'lucide-react';
import {
  ensureGoogleUploadAuth,
  fetchPhotoUploadSession,
  uploadPhonePhotoToSession,
  type PhotoUploadSession,
} from '../services/photoUploadSession';
import { getCurrentUser } from '../services/firebaseService';
import { compressImageFileToBlob, fileExtensionForImageBlob, INVENTORY_PHOTO_STORAGE_OPTIONS } from '../utils/imageCompress';

const PhonePhotoUploadPage: React.FC = () => {
  const { token = '' } = useParams<{ token: string }>();
  const [session, setSession] = useState<PhotoUploadSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [needGoogle, setNeedGoogle] = useState(false);
  const [doneCount, setDoneCount] = useState(0);

  const loadSession = async () => {
    const user = getCurrentUser();
    if (!user || user.isAnonymous) {
      setNeedGoogle(true);
      setSession(null);
      setError('Sign in with the same Google account you use on the PC.');
      return;
    }
    const s = await fetchPhotoUploadSession(token);
    if (!s) {
      setError(
        'Upload link not found for this Google account. Use the same account as on your PC, and keep the QR panel open.'
      );
      setSession(null);
      return;
    }
    if (s.status !== 'active' || Date.now() > s.expiresAtMs) {
      setError('This upload link expired or was closed on the PC.');
      setSession(s);
      return;
    }
    setNeedGoogle(false);
    setError(null);
    setSession(s);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const user = getCurrentUser();
        if (!user || user.isAnonymous) {
          if (!cancelled) {
            setNeedGoogle(true);
            setError('Sign in with the same Google account you use on the PC.');
          }
          return;
        }
        if (!cancelled) await loadSession();
      } catch (e) {
        if (!cancelled) {
          setNeedGoogle(true);
          setError(e instanceof Error ? e.message : 'Could not open upload link');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const signInWithGoogle = async () => {
    setLoading(true);
    setError(null);
    try {
      await ensureGoogleUploadAuth();
      setNeedGoogle(false);
      await loadSession();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Google sign-in failed');
      setNeedGoogle(true);
    } finally {
      setLoading(false);
    }
  };

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
        const ext = fileExtensionForImageBlob(blob);
        await uploadPhonePhotoToSession(token, blob, file.name.replace(/\.\w+$/, `.${ext}`));
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

  const canUpload =
    !!session && session.status === 'active' && Date.now() <= session.expiresAtMs && !needGoogle;

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
            Sign in with the same Google account as your PC, then pick from Photos.
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

        {(needGoogle || (!loading && !session && !canUpload)) && (
          <button
            type="button"
            onClick={() => void signInWithGoogle()}
            className="w-full py-3.5 rounded-2xl bg-white text-slate-900 text-sm font-black"
          >
            Continue with Google
          </button>
        )}

        {!loading && canUpload && (
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
                  Opens your iPhone photo library
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
          </>
        )}
      </div>
    </div>
  );
};

export default PhonePhotoUploadPage;
