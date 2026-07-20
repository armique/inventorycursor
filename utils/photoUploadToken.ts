/** Cryptographically strong tokens for phone photo-upload sessions. */

export function createPhotoUploadToken(bytes = 18): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  // URL-safe base64 without padding
  let s = '';
  for (let i = 0; i < arr.length; i++) s += String.fromCharCode(arr[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
