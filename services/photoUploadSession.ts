/**
 * Phone → PC photo bridge sessions via Supabase.
 */

import {
  getCurrentUser,
  getSupabase,
  isCloudEnabled,
  signInWithGoogle,
} from './supabaseService';
import { createPhotoUploadToken } from '../utils/photoUploadToken';

export const PHOTO_UPLOAD_SESSIONS = 'photo_upload_sessions';
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

export function buildPhoneUploadUrl(token: string, origin = window.location.origin): string {
  return `${origin.replace(/\/$/, '')}/upload/${encodeURIComponent(token)}`;
}

export async function createPhotoUploadSession(params: {
  itemId: string;
  itemName: string;
  maxPhotos?: number;
  ttlMs?: number;
}): Promise<PhotoUploadSession> {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase is not configured.');

  const user = await getCurrentUser();
  if (!user) throw new Error('Sign in with Google first.');

  const token = createPhotoUploadToken();
  const now = Date.now();
  const expiresAtMs = now + (params.ttlMs ?? PHOTO_UPLOAD_TTL_MS);
  const maxPhotos = Math.min(
    PHOTO_UPLOAD_MAX,
    Math.max(1, Math.floor(params.maxPhotos ?? PHOTO_UPLOAD_MAX))
  );

  const session: PhotoUploadSession = {
    token,
    ownerUid: user.id,
    itemId: String(params.itemId),
    itemName: (params.itemName || 'Item').slice(0, 120),
    status: 'active',
    maxPhotos,
    uploadedUrls: [],
    createdAtMs: now,
    expiresAtMs,
  };

  await sb.from('photo_upload_sessions').upsert({
    token: session.token,
    owner_uid: session.ownerUid,
    item_id: session.itemId,
    item_name: session.itemName,
    status: session.status,
    max_photos: session.maxPhotos,
    uploaded_urls: session.uploadedUrls,
    created_at_ms: session.createdAtMs,
    expires_at_ms: session.expiresAtMs,
    updated_at: new Date().toISOString(),
  });

  return session;
}

export async function fetchPhotoUploadSession(token: string): Promise<PhotoUploadSession | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.from('photo_upload_sessions').select('*').eq('token', token).maybeSingle();
  if (!data) return null;
  return normalizeSession(token, data);
}

export function subscribePhotoUploadSession(
  token: string,
  onChange: (session: PhotoUploadSession | null) => void
): () => void {
  const sb = getSupabase();
  if (!sb) {
    onChange(null);
    return () => {};
  }

  void fetchPhotoUploadSession(token).then(onChange);

  const channel = sb
    .channel(`public:photo_upload_sessions:${token}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'photo_upload_sessions', filter: `token=eq.${token}` }, () => {
      void fetchPhotoUploadSession(token).then(onChange);
    })
    .subscribe();

  return () => {
    void sb.removeChannel(channel);
  };
}

export async function revokePhotoUploadSession(token: string): Promise<void> {
  const sb = getSupabase();
  if (!sb) return;
  await sb.from('photo_upload_sessions').update({ status: 'revoked' }).eq('token', token);
}

export async function ensureGoogleUploadAuth(): Promise<void> {
  const user = await getCurrentUser();
  if (user) return;
  await signInWithGoogle();
}

export async function uploadPhonePhotoToSession(
  token: string,
  file: File | Blob,
  fileName?: string
): Promise<string> {
  const sb = getSupabase();
  if (!sb) throw new Error('Supabase is not configured.');

  const user = await getCurrentUser();
  if (!user) throw new Error('Sign in with Google first.');

  const session = await fetchPhotoUploadSession(token);
  if (!session) throw new Error('Upload link not found.');
  if (session.status !== 'active') throw new Error('This upload link was closed.');
  if (Date.now() > session.expiresAtMs) throw new Error('This upload link expired.');
  if (session.uploadedUrls.length >= session.maxPhotos) {
    throw new Error(`Limit reached (${session.maxPhotos} photos).`);
  }

  const name = (fileName || `iphone-${Date.now()}.jpg`).replace(/[^a-zA-Z0-9.\-_]/g, '_');
  const path = `${user.id}/${session.itemId}/phone-bridge/${Date.now()}-${name}`;

  const { error } = await sb.storage.from('inventory-images').upload(path, file, {
    upsert: true,
    contentType: file.type || 'image/jpeg',
  });
  if (error) throw error;

  const { data: { publicUrl } } = sb.storage.from('inventory-images').getPublicUrl(path);
  const nextUrls = [...session.uploadedUrls, publicUrl].slice(0, session.maxPhotos);

  await sb.from('photo_upload_sessions').update({
    uploaded_urls: nextUrls,
    updated_at: new Date().toISOString(),
  }).eq('token', token);

  return publicUrl;
}

function normalizeSession(token: string, data: Record<string, unknown>): PhotoUploadSession {
  const expiresAtMs = Number(data.expires_at_ms || data.expiresAtMs) || Date.now();
  let status = (data.status as PhotoUploadSessionStatus) || 'active';
  if (status === 'active' && Date.now() > expiresAtMs) status = 'expired';
  return {
    token,
    ownerUid: String(data.owner_uid || data.ownerUid || ''),
    itemId: String(data.item_id || data.itemId || ''),
    itemName: String(data.item_name || data.itemName || 'Item'),
    status,
    maxPhotos: Number(data.max_photos || data.maxPhotos) || PHOTO_UPLOAD_MAX,
    uploadedUrls: Array.isArray(data.uploaded_urls || data.uploadedUrls)
      ? ((data.uploaded_urls || data.uploadedUrls) as string[]).filter((u) => typeof u === 'string')
      : [],
    createdAtMs: Number(data.created_at_ms || data.createdAtMs) || Date.now(),
    expiresAtMs,
  };
}
