import type { BusinessSettings } from '../types';

/** One-shot stamp so later Settings edits to bank / name / USt-IdNr are not overwritten. */
export const INVOICE_BUSINESS_PROFILE_KEY = 'invoice_business_profile_armen_n26_v2';

export const INVOICE_BUSINESS_PROFILE = {
  ownerName: 'Armen Abelian',
  companyName: 'Armen Abelian',
  bankName: 'N26 Bank',
  iban: 'DE71100110012286025860',
  bic: 'NTSBDEB1XXX',
  vatId: 'DE453378894',
} as const;

function compactUpper(value: string | undefined): string {
  return String(value || '').replace(/\s+/g, '').toUpperCase();
}

export function isInvoiceBusinessProfileDone(): boolean {
  try {
    return localStorage.getItem(INVOICE_BUSINESS_PROFILE_KEY) === 'done';
  } catch {
    return false;
  }
}

export function markInvoiceBusinessProfileDone(): void {
  try {
    localStorage.setItem(INVOICE_BUSINESS_PROFILE_KEY, 'done');
  } catch {
    /* ignore quota */
  }
}

export function applyInvoiceBusinessProfile(
  settings: BusinessSettings
): { settings: BusinessSettings; changed: boolean } {
  const next: BusinessSettings = {
    ...settings,
    ownerName: INVOICE_BUSINESS_PROFILE.ownerName,
    companyName: INVOICE_BUSINESS_PROFILE.companyName,
    bankName: INVOICE_BUSINESS_PROFILE.bankName,
    iban: INVOICE_BUSINESS_PROFILE.iban,
    bic: INVOICE_BUSINESS_PROFILE.bic,
    vatId: INVOICE_BUSINESS_PROFILE.vatId,
  };
  const changed =
    (settings.ownerName || '').trim() !== next.ownerName ||
    (settings.companyName || '').trim() !== next.companyName ||
    (settings.bankName || '').trim() !== next.bankName ||
    compactUpper(settings.iban) !== next.iban ||
    compactUpper(settings.bic) !== next.bic ||
    compactUpper(settings.vatId) !== next.vatId;
  return { settings: changed ? next : settings, changed };
}

/** Apply once until the stamp is marked done (after local match or first cloud overlay). */
export function stampInvoiceBusinessProfile(
  settings: BusinessSettings
): { settings: BusinessSettings; changed: boolean } {
  if (isInvoiceBusinessProfileDone()) {
    return { settings, changed: false };
  }
  return applyInvoiceBusinessProfile(settings);
}
