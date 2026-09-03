/** Canonical localhost origin for Supabase Google OAuth (must match Dashboard redirect URLs). */
export const DEV_OAUTH_ORIGIN = 'http://localhost:5173';

export function isLocalDevHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

/** True when running Vite locally but not on the canonical OAuth port. */
export function isLocalDevNonCanonicalOAuthPort(): boolean {
  if (typeof window === 'undefined') return false;
  const { hostname, port, protocol } = window.location;
  if (protocol !== 'http:' || !isLocalDevHost(hostname)) return false;
  return `${window.location.protocol}//${window.location.host}` !== DEV_OAUTH_ORIGIN;
}

/**
 * Supabase only redirects OAuth back to URLs on its allowlist. Local dev must use
 * http://localhost:5173 (see docs/SYNC_SETUP.md). Production uses the current origin.
 */
export function resolveOAuthRedirectUrl(returnPath: string): string {
  const path = returnPath.startsWith('/') ? returnPath : `/${returnPath}`;
  if (typeof window === 'undefined') return `${DEV_OAUTH_ORIGIN}${path}`;

  const { hostname, protocol } = window.location;
  if (protocol === 'http:' && isLocalDevHost(hostname)) {
    return `${DEV_OAUTH_ORIGIN}${path}`;
  }
  return `${window.location.origin}${path}`;
}
