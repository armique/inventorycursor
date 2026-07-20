/**
 * Phone → PC photo bridge sessions.
 *
 * Stored under users/{uid}/photoUploadSessions/{token} so existing Firestore rules apply
 * (same path family as inventory sync). Phone must sign in with the SAME Google account.
 * Photos upload to items/{uid}/{itemId}/… (existing Storage rules).
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
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
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

function sessionDocRef(uid: string, token: string) {
  const ctx = requireCtx();
  return doc(ctx.db, 'users', uid, PHOTO_UPLOAD_SESSIONS, token);
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
  if (user.isAnonymous) throw new Error('Sign in with Google (not anonymous) on the PC.');

  const token = createPhotoUploadToken();
  const now = Date.now();
  const expiresAtMs = now + (params.ttlMs ?? PHOTO_UPLOAD_TTL_MS);
  const maxPhotos = Math.min(
    PHOTO_UPLOAD_MAX,
    Math.max(1, Math.floor(params.maxPhotos ?? PHOTO_UPLOAD_MAX))
  );

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

  await setDoc(sessionDocRef(user.uid, token), {
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
  const user = getCurrentUser();
  if (!user || user.isAnonymous) {
    throw new Error('Sign in with the same Google account you use on the PC.');
  }
  const snap = await getDoc(sessionDocRef(user.uid, token));
  if (!snap.exists()) return null;
  return normalizeSession(token, snap.data() as Record<string, unknown>);
}

export function subscribePhotoUploadSession(
  token: string,
  onChange: (session: PhotoUploadSession | null) => void
): Unsubscribe {
  const user = getCurrentUser();
  if (!user || user.isAnonymous) {
    onChange(null);
    return () => {};
  }
  return onSnapshot(
    sessionDocRef(user.uid, token),
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
  if (!user || user.isAnonymous) return;
  const ref = sessionDocRef(user.uid, token);
  const snap = await getDoc(ref);
  if (!snap.exists()) return;
  await updateDoc(ref, { status: 'revoked' });
}

/** Phone page: must use the same Google account as the PC panel. */
export async function ensureGoogleUploadAuth(): Promise<void> {
  const ctx = requireCtx();
  if (ctx.auth.currentUser && !ctx.auth.currentUser.isAnonymous) return;
  const provider = new GoogleAuthProvider();
  await signInWithPopup(ctx.auth, provider);
}

export async function uploadPhonePhotoToSession(
  token: string,
  file: File | Blob,
  fileName?: string
): Promise<string> {
  const user = getCurrentUser();
  if (!user || user.isAnonymous) {
    throw new Error('Sign in with the same Google account you use on the PC.');
  }

  const session = await fetchPhotoUploadSession(token);
  if (!session) {
    throw new Error(
      'Upload link not found. Use the same Google account as on your PC, and make sure the QR session is still open.'
    );
  }
  if (session.status !== 'active') throw new Error('This upload link was closed.');
  if (Date.now() > session.expiresAtMs) throw new Error('This upload link expired.');
  if (session.uploadedUrls.length >= session.maxPhotos) {
    throw new Error(`Limit reached (${session.maxPhotos} photos).`);
  }

  const ctx = requireCtx();
  const name = (fileName || `iphone-${Date.now()}.jpg`).replace(/[^a-zA-Z0-9.\-_]/g, '_');
  // Use existing Storage rules: items/{uid}/{itemId}/…
  const path = `items/${user.uid}/${session.itemId}/phone-bridge/${Date.now()}-${name}`;
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
  await updateDoc(sessionDocRef(user.uid, token), {
    uploadedUrls: nextUrls,
    updatedAtMs: Date.now(),
  });
  return url;
}

function normalizeSession(token: string, data: Record<string, unknown>): PhotoUploadSession {
  const expiresAtMs =
    typeof data.expiresAtMs === 'number'
      ? data.expiresAtMs
      : data.expiresAt &&
          typeof (data.expiresAt as { toMillis?: () => number }).toMillis === 'function'
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

export function photoUploadSessionsCollection(uid?: string) {
  const user = getCurrentUser();
  const id = uid || user?.uid;
  if (!id) throw new Error('Not signed in');
  return collection(requireCtx().db, 'users', id, PHOTO_UPLOAD_SESSIONS);
}
