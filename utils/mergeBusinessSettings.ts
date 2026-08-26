import type { BusinessSettings } from '../types';

const STRING_KEYS: (keyof BusinessSettings)[] = [
  'companyName',
  'ownerName',
  'address',
  'phone',
  'taxId',
  'vatId',
  'iban',
  'bic',
  'bankName',
  'ebayPostalCode',
  'ebayPaypalEmail',
  'ebayReturnPolicy',
  'ebaySellerUsername',
  'ebayOAuthToken',
  'ebayOAuthRefreshToken',
  'kleinanzeigenProfileUrl',
];

function isBlank(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim() === '';
  return false;
}

/**
 * Cloud snapshots must not wipe a filled local business profile with empty fields.
 * Filled remote values still win (another device saved an update).
 */
export function mergeBusinessSettings(
  local: BusinessSettings,
  remote: Partial<BusinessSettings> | null | undefined
): { settings: BusinessSettings; keptLocalFilled: boolean } {
  const r = remote && typeof remote === 'object' ? remote : {};
  const out: BusinessSettings = { ...local };
  let keptLocalFilled = false;

  const keys = new Set<keyof BusinessSettings>([
    ...(Object.keys(local) as (keyof BusinessSettings)[]),
    ...(Object.keys(r) as (keyof BusinessSettings)[]),
  ]);

  for (const key of keys) {
    const lv = out[key];
    const rv = r[key];
    if (isBlank(rv)) {
      if (!isBlank(lv)) keptLocalFilled = true;
      continue;
    }
    (out as unknown as Record<string, unknown>)[key as string] = rv as unknown;
  }

  for (const key of STRING_KEYS) {
    if (!isBlank(local[key]) && isBlank(r[key])) keptLocalFilled = true;
  }

  return { settings: out, keptLocalFilled };
}
