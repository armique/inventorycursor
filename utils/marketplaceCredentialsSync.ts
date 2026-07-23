import type { BusinessSettings } from '../types';
import { getEbayUsername, saveEbayConfig, getEbayToken } from '../services/ebayService';
import { loadKaProfileUrl, saveKaProfileUrl } from './listingPresence';

function readLocalEbayConfig(): { token: string; username: string } {
  try {
    const saved = localStorage.getItem('ebay_config');
    if (saved) {
      const parsed = JSON.parse(saved) as { token?: string; username?: string };
      return {
        token: (parsed.token || '').trim(),
        username: (parsed.username || '').trim().replace(/^@/, ''),
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
  const cloudKa = settings.kleinanzeigenProfileUrl?.trim() || '';
  const local = readLocalEbayConfig();

  const nextUser = cloudUser || local.username;
  const nextToken = cloudToken !== null && cloudToken !== '' ? cloudToken : local.token;

  if (cloudUser || (cloudToken !== null && cloudToken !== '')) {
    if (nextUser !== local.username || nextToken !== local.token) {
      saveEbayConfig({
        username: nextUser || undefined,
        token: nextToken,
      });
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
  if (!settings.kleinanzeigenProfileUrl?.trim() && localKa) {
    patch.kleinanzeigenProfileUrl = localKa;
    changed = true;
  }

  return changed ? { ...settings, ...patch } : settings;
}

/** Patch marketplace fields onto business settings (Settings save / Refresh). */
export function withMarketplaceCredentials(
  settings: BusinessSettings,
  patch: {
    ebaySellerUsername?: string;
    ebayOAuthToken?: string;
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
    ...(patch.kleinanzeigenProfileUrl !== undefined
      ? { kleinanzeigenProfileUrl: patch.kleinanzeigenProfileUrl.trim() }
      : {}),
  };
}
