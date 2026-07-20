/**
 * Phone → PC photo bridge sessions.
 * Desktop (signed-in owner) creates a short-lived session; phone opens /upload/:token,
 * signs in anonymously, uploads into photo-inbox/{token}/, and appends URLs to the session.
 */

import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage';
import { signInAnonymously, signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import {
  getCurrentUser,
  getFirebaseContext,
  isCloudEnabled,
} from './firebaseService';
import { createPhotoUploadToken } from '../utils/photoUploadToken';

export const PHOTO_UPLOAD_SESSIONS = 'photoUploadSessions';
export const PHOTO_UPLOAD_TTL_MS = 25 * 60 * 1000;
export const PHOTO_UPLOAD_MAX = 12;

export type PhotoUploadSessionStatus = 'active' | 'revoked' | 'expired';

export interface PhotoUploadSession {
  token: string;
  ownerUid: string;
  itemId: string;
  itemName: string;
  status: PhotoUploadSessionStatus;
  maxPhotos: number;
  uploadedUrls: string[];
  createdAtMs: number;
  expiresAtMs: number;
}

function requireCtx() {
  const ctx = getFirebaseContext();
  if (!ctx) throw new Error('Cloud is not configured.');
  return ctx;
}

export function buildPhoneUploadUrl(token: string, origin = window.location.origin): string {
  return `${origin.replace(/\/$/, '')}/upload/${encodeURIComponent(token)}`;
}

export async function createPhotoUploadSession(params: {
  itemId: string;
  itemName: string;
  maxPhotos?: number;
  ttlMs?: number;
}): Promise<PhotoUploadSession> {
  if (!isCloudEnabled()) throw new Error('Sign in to cloud backup to use iPhone upload.');
  const user = getCurrentUser();
  if (!user) throw new Error('Sign in with Google first.');

  const token = createPhotoUploadToken();
  const now = Date.now();
  const expiresAtMs = now + (params.ttlMs ?? PHOTO_UPLOAD_TTL_MS);
  const maxPhotos = Math.min(PHOTO_UPLOAD_MAX, Math.max(1, Math.floor(params.maxPhotos ?? PHOTO_UPLOAD_MAX)));

  const session: PhotoUploadSession = {
    token,
    ownerUid: user.uid,
    itemId: String(params.itemId),
    itemName: (params.itemName || 'Item').slice(0, 120),
    status: 'active',
    maxPhotos,
    uploadedUrls: [],
    createdAtMs: now,
    expiresAtMs,
  };

  const ctx = requireCtx();
  await setDoc(doc(ctx.db, PHOTO_UPLOAD_SESSIONS, token), {
    token: session.token,
    ownerUid: session.ownerUid,
    itemId: session.itemId,
    itemName: session.itemName,
    status: session.status,
    maxPhotos: session.maxPhotos,
    uploadedUrls: session.uploadedUrls,
    createdAtMs: session.createdAtMs,
    expiresAtMs: session.expiresAtMs,
    createdAt: serverTimestamp(),
    expiresAt: new Date(expiresAtMs),
  });

  return session;
}

export async function fetchPhotoUploadSession(token: string): Promise<PhotoUploadSession | null> {
  const ctx = requireCtx();
  const snap = await getDoc(doc(ctx.db, PHOTO_UPLOAD_SESSIONS, token));
  if (!snap.exists()) return null;
  return normalizeSession(token, snap.data() as Record<string, unknown>);
}

export function subscribePhotoUploadSession(
  token: string,
  onChange: (session: PhotoUploadSession | null) => void
): Unsubscribe {
  const ctx = requireCtx();
  return onSnapshot(
    doc(ctx.db, PHOTO_UPLOAD_SESSIONS, token),
    (snap) => {
      if (!snap.exists()) {
        onChange(null);
        return;
      }
      onChange(normalizeSession(token, snap.data() as Record<string, unknown>));
    },
    () => onChange(null)
  );
}

export async function revokePhotoUploadSession(token: string): Promise<void> {
  const user = getCurrentUser();
  if (!user) return;
  const ctx = requireCtx();
  const ref = doc(ctx.db, PHOTO_UPLOAD_SESSIONS, token);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  const data = snap.data() as { ownerUid?: string };
  if (data.ownerUid !== user.uid) return;
  await updateDoc(ref, { status: 'revoked' });
}

/** Phone page: anonymous auth first; caller can fall back to Google if disabled. */
export async function ensureAnonymousUploadAuth(): Promise<void> {
  const ctx = requireCtx();
  if (ctx.auth.currentUser) return;
  await signInAnonymously(ctx.auth);
}

/** Phone page fallback when Anonymous is not enabled yet — same Google account as the panel. */
export async function ensureGoogleUploadAuth(): Promise<void> {
  const ctx = requireCtx();
  if (ctx.auth.currentUser && !ctx.auth.currentUser.isAnonymous) return;
  const provider = new GoogleAuthProvider();
  await signInWithPopup(ctx.auth, provider);
}

export function isAnonymousAuthDisabledError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || '');
  const code = (err as { code?: string })?.code || '';
  return (
    code.includes('operation-not-allowed') ||
    code.includes('admin-restricted-operation') ||
    msg.includes('auth/operation-not-allowed') ||
    msg.includes('admin-restricted-operation') ||
    msg.includes('ADMIN_ONLY_OPERATION')
  );
}

export async function uploadPhonePhotoToSession(
  token: string,
  file: File | Blob,
  fileName?: string
): Promise<string> {
  await ensureAnonymousUploadAuth();
  const session = await fetchPhotoUploadSession(token);
  if (!session) throw new Error('Upload link not found.');
  if (session.status !== 'active') throw new Error('This upload link was closed.');
  if (Date.now() > session.expiresAtMs) throw new Error('This upload link expired.');
  if (session.uploadedUrls.length >= session.maxPhotos) {
    throw new Error(`Limit reached (${session.maxPhotos} photos).`);
  }

  const ctx = requireCtx();
  const name = (fileName || `iphone-${Date.now()}.jpg`).replace(/[^a-zA-Z0-9.\-_]/g, '_');
  const path = `photo-inbox/${token}/${Date.now()}-${name}`;
  const ref = storageRef(ctx.storage, path);
  const blob =
    file instanceof Blob
      ? file
      : new Blob([file], { type: (file as File).type || 'image/jpeg' });
  const snapshot = await uploadBytes(ref, blob, {
    contentType: blob.type || 'image/jpeg',
  });
  const url = await getDownloadURL(snapshot.ref);

  const nextUrls = [...session.uploadedUrls, url].slice(0, session.maxPhotos);
  await updateDoc(doc(ctx.db, PHOTO_UPLOAD_SESSIONS, token), {
    uploadedUrls: nextUrls,
    updatedAtMs: Date.now(),
  });
  return url;
}

function normalizeSession(token: string, data: Record<string, unknown>): PhotoUploadSession {
  const expiresAtMs =
    typeof data.expiresAtMs === 'number'
      ? data.expiresAtMs
      : data.expiresAt && typeof (data.expiresAt as { toMillis?: () => number }).toMillis === 'function'
        ? (data.expiresAt as { toMillis: () => number }).toMillis()
        : Date.now();
  let status = (data.status as PhotoUploadSessionStatus) || 'active';
  if (status === 'active' && Date.now() > expiresAtMs) status = 'expired';
  return {
    token,
    ownerUid: String(data.ownerUid || ''),
    itemId: String(data.itemId || ''),
    itemName: String(data.itemName || 'Item'),
    status,
    maxPhotos: Number(data.maxPhotos) || PHOTO_UPLOAD_MAX,
    uploadedUrls: Array.isArray(data.uploadedUrls)
      ? (data.uploadedUrls as string[]).filter((u) => typeof u === 'string')
      : [],
    createdAtMs: typeof data.createdAtMs === 'number' ? data.createdAtMs : Date.now(),
    expiresAtMs,
  };
}

/** Keep TypeScript happy if collection listing is needed later. */
export function photoUploadSessionsCollection() {
  return collection(requireCtx().db, PHOTO_UPLOAD_SESSIONS);
}
