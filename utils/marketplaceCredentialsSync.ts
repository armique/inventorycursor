import type { BusinessSettings } from '../types';
import {
  getEbayUsername,
  saveEbayConfig,
  getEbayToken,
  getEbayConfig,
  hasEbayRefreshToken,
} from '../services/ebayService';
import { loadKaProfileUrl, saveKaProfileUrl } from './listingPresence';
import { getCurrentUser, getSupabase, isCloudEnabled } from '../services/supabaseService';

function readLocalEbayConfig(): {
  token: string;
  username: string;
  refreshToken?: string;
  expiresAt?: number;
  refreshExpiresAt?: number;
} {
  try {
    const saved = localStorage.getItem('ebay_config');
    if (saved) {
      const parsed = JSON.parse(saved) as {
        token?: string;
        username?: string;
        refreshToken?: string;
        expiresAt?: number;
        refreshExpiresAt?: number;
      };
      return {
        token: (parsed.token || '').trim(),
        username: (parsed.username || '').trim().replace(/^@/, ''),
        refreshToken: parsed.refreshToken?.trim() || undefined,
        expiresAt: parsed.expiresAt,
        refreshExpiresAt: parsed.refreshExpiresAt,
      };
    }
  } catch {
    /* ignore */
  }
  return { token: '', username: '' };
}

/** Write cloud business settings into this browser’s local marketplace keys. */
export function hydrateMarketplaceCredentialsFromSettings(settings: BusinessSettings): void {
  const cloudUser = settings.ebaySellerUsername?.trim().replace(/^@/, '') || '';
  const cloudToken = settings.ebayOAuthToken?.trim() ?? null;
  const cloudRefresh = settings.ebayOAuthRefreshToken?.trim() || '';
  const cloudKa = settings.kleinanzeigenProfileUrl?.trim() || '';
  const local = readLocalEbayConfig();

  const nextUser = cloudUser || local.username;
  const nextToken =
    cloudToken !== null && cloudToken !== '' ? cloudToken : local.token;
  const nextRefresh = cloudRefresh || local.refreshToken;

  if (cloudUser || (cloudToken !== null && cloudToken !== '') || cloudRefresh) {
    const changed =
      nextUser !== local.username ||
      nextToken !== local.token ||
      nextRefresh !== local.refreshToken ||
      (settings.ebayOAuthExpiresAt != null && settings.ebayOAuthExpiresAt !== local.expiresAt) ||
      (settings.ebayOAuthRefreshExpiresAt != null &&
        settings.ebayOAuthRefreshExpiresAt !== local.refreshExpiresAt);
    if (changed) {
      saveEbayConfig(
        {
          username: nextUser || undefined,
          token: nextToken,
          refreshToken: nextRefresh,
          expiresAt: settings.ebayOAuthExpiresAt ?? local.expiresAt,
          refreshExpiresAt: settings.ebayOAuthRefreshExpiresAt ?? local.refreshExpiresAt,
        },
        { silent: true }
      );
    }
  }

  if (cloudKa) {
    const localKa = loadKaProfileUrl();
    if (cloudKa !== localKa) saveKaProfileUrl(cloudKa);
  }
}

/**
 * Fill missing cloud fields from this browser’s localStorage (one-way migrate).
 * Returns same object reference if nothing changed.
 */
export function mergeLocalMarketplaceCredentialsIntoSettings(
  settings: BusinessSettings
): BusinessSettings {
  let changed = false;
  const patch: Partial<BusinessSettings> = {};
  const local = getEbayConfig();

  const localUser = getEbayUsername();
  const localToken = getEbayToken() || '';
  const localKa = loadKaProfileUrl();

  if (!settings.ebaySellerUsername?.trim() && localUser) {
    patch.ebaySellerUsername = localUser;
    changed = true;
  }
  if (!settings.ebayOAuthToken?.trim() && localToken) {
    patch.ebayOAuthToken = localToken;
    changed = true;
  }
  if (!settings.ebayOAuthRefreshToken?.trim() && local.refreshToken) {
    patch.ebayOAuthRefreshToken = local.refreshToken;
    changed = true;
  }
  if (settings.ebayOAuthExpiresAt == null && local.expiresAt != null) {
    patch.ebayOAuthExpiresAt = local.expiresAt;
    changed = true;
  }
  if (settings.ebayOAuthRefreshExpiresAt == null && local.refreshExpiresAt != null) {
    patch.ebayOAuthRefreshExpiresAt = local.refreshExpiresAt;
    changed = true;
  }
  if (!settings.kleinanzeigenProfileUrl?.trim() && localKa) {
    patch.kleinanzeigenProfileUrl = localKa;
    changed = true;
  }

  return changed ? { ...settings, ...patch } : settings;
}

/** Patch marketplace fields onto business settings (Settings save / Refresh). */
export function withDealwatchplaceCredentials(
  settings: BusinessSettings,
  patch: {
    ebaySellerUsername?: string;
    ebayOAuthToken?: string;
    ebayOAuthRefreshToken?: string;
    ebayOAuthExpiresAt?: number;
    ebayOAuthRefreshExpiresAt?: number;
    kleinanzeigenProfileUrl?: string;
  }
): BusinessSettings {
  return {
    ...settings,
    ...(patch.ebaySellerUsername !== undefined
      ? { ebaySellerUsername: patch.ebaySellerUsername.trim().replace(/^@/, '') }
      : {}),
    ...(patch.ebayOAuthToken !== undefined
      ? { ebayOAuthToken: patch.ebayOAuthToken.trim() }
      : {}),
    ...(patch.ebayOAuthRefreshToken !== undefined
      ? { ebayOAuthRefreshToken: patch.ebayOAuthRefreshToken.trim() }
      : {}),
    ...(patch.ebayOAuthExpiresAt !== undefined
      ? { ebayOAuthExpiresAt: patch.ebayOAuthExpiresAt }
      : {}),
    ...(patch.ebayOAuthRefreshExpiresAt !== undefined
      ? { ebayOAuthRefreshExpiresAt: patch.ebayOAuthRefreshExpiresAt }
      : {}),
    ...(patch.kleinanzeigenProfileUrl !== undefined
      ? { kleinanzeigenProfileUrl: patch.kleinanzeigenProfileUrl.trim() }
      : {}),
  };
}

/** Snapshot current local eBay OAuth fields into business settings for cloud sync. */
export function withLocalEbayOAuthOnSettings(settings: BusinessSettings): BusinessSettings {
  const cfg = getEbayConfig();
  const patch: {
    ebaySellerUsername?: string;
    ebayOAuthToken?: string;
    ebayOAuthRefreshToken?: string;
    ebayOAuthExpiresAt?: number;
    ebayOAuthRefreshExpiresAt?: number;
  } = {};
  if (cfg.username?.trim()) patch.ebaySellerUsername = cfg.username;
  if (cfg.token?.trim()) patch.ebayOAuthToken = cfg.token;
  if (cfg.refreshToken?.trim()) patch.ebayOAuthRefreshToken = cfg.refreshToken;
  if (cfg.expiresAt) patch.ebayOAuthExpiresAt = cfg.expiresAt;
  if (cfg.refreshExpiresAt) patch.ebayOAuthRefreshExpiresAt = cfg.refreshExpiresAt;
  if (Object.keys(patch).length === 0) return settings;
  const next = withDealwatchplaceCredentials(settings, patch);
  if (
    next.ebaySellerUsername === settings.ebaySellerUsername &&
    next.ebayOAuthToken === settings.ebayOAuthToken &&
    next.ebayOAuthRefreshToken === settings.ebayOAuthRefreshToken &&
    next.ebayOAuthExpiresAt === settings.ebayOAuthExpiresAt &&
    next.ebayOAuthRefreshExpiresAt === settings.ebayOAuthRefreshExpiresAt
  ) {
    return settings;
  }
  return next;
}

/** Pull eBay OAuth from Supabase when local dev has no refresh token (e.g. after Connect on production RuName). */
export async function ensureMarketplaceCredentialsFromCloud(): Promise<void> {
  if (!isCloudEnabled() || hasEbayRefreshToken()) return;
  const user = await getCurrentUser();
  if (!user) return;
  const sb = getSupabase();
  if (!sb) return;
  const { data: prof, error } = await sb
    .from('user_profiles')
    .select(
      'ebay_oauth_refresh_token, ebay_oauth_token, ebay_oauth_expires_at, ebay_oauth_refresh_expires_at, ebay_seller_username, kleinanzeigen_profile_url'
    )
    .eq('id', user.id)
    .maybeSingle();
  if (error || !prof?.ebay_oauth_refresh_token?.trim()) return;
  hydrateMarketplaceCredentialsFromSettings({
    ebaySellerUsername: prof.ebay_seller_username || undefined,
    ebayOAuthToken: prof.ebay_oauth_token || undefined,
    ebayOAuthRefreshToken: prof.ebay_oauth_refresh_token || undefined,
    ebayOAuthExpiresAt: prof.ebay_oauth_expires_at ?? undefined,
    ebayOAuthRefreshExpiresAt: prof.ebay_oauth_refresh_expires_at ?? undefined,
    kleinanzeigenProfileUrl: prof.kleinanzeigen_profile_url || undefined,
  } as BusinessSettings);
}
