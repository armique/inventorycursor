/** sessionStorage flag set before Google redirect; must match firebaseService.AUTH_REDIRECT_PENDING_KEY. */
export const AUTH_REDIRECT_PENDING_KEY = 'deinventory_auth_redirect_pending';

export function peekAuthRedirectPending(): boolean {
  try {
    return sessionStorage.getItem(AUTH_REDIRECT_PENDING_KEY) === '1';
  } catch {
    return false;
  }
}

/** True when this document should boot the admin panel instead of the public storefront. */
export function shouldBootPanel(pathname?: string): boolean {
  const path =
    pathname ??
    (typeof window !== 'undefined' ? window.location.pathname : '');
  if (path.startsWith('/panel') || path.startsWith('/upload/') || path.startsWith('/auth/')) {
    return true;
  }
  return peekAuthRedirectPending();
}
