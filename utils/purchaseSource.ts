import type { PaymentType, Platform } from '../types';

/** Platforms offered when logging a purchase source. */
export const BUY_SOURCE_PLATFORMS: Platform[] = [
  'kleinanzeigen.de',
  'ebay.de',
  'Amazon',
  'In Person',
  'Other',
];

/** Short label for inventory chips / cards. */
export function formatPlatformBoughtLabel(platform?: Platform | string | null): string {
  switch (platform) {
    case 'kleinanzeigen.de':
      return 'Kleinanzeigen';
    case 'ebay.de':
      return 'eBay';
    case 'In Person':
      return 'In person';
    case 'Amazon':
      return 'Amazon';
    case 'Other':
      return 'Other';
    default:
      return platform ? String(platform) : '';
  }
}

/** Compact chip / button label. */
export function formatPlatformBoughtShort(platform: Platform): string {
  switch (platform) {
    case 'kleinanzeigen.de':
      return 'KA';
    case 'ebay.de':
      return 'eBay';
    case 'In Person':
      return 'Person';
    case 'Amazon':
      return 'Amazon';
    case 'Other':
      return 'Other';
  }
}

/** Compact chip / button label for buy payment. */
export function formatBuyPaymentShort(payment: PaymentType): string {
  switch (payment) {
    case 'Kleinanzeigen (Cash)':
      return 'KA Cash';
    case 'Kleinanzeigen (Direkt Kaufen)':
      return 'Direkt';
    case 'Kleinanzeigen (Paypal)':
      return 'KA PayPal';
    case 'Kleinanzeigen (Wire Transfer)':
      return 'KA Wire';
    case 'ebay.de':
      return 'eBay';
    case 'Paypal':
      return 'PayPal';
    case 'Cash':
      return 'Cash';
    case 'Bank Transfer':
      return 'Wire';
    case 'Trade':
      return 'Trade';
    case 'Gift':
      return 'Gift';
    case 'Other':
      return 'Other';
    default:
      return String(payment);
  }
}

/** Full title for payment option tooltips. */
export function formatBuyPaymentLabel(payment: PaymentType): string {
  return payment;
}

/** Payment choices that make sense for the selected buy place. */
export function buyPaymentOptionsForPlatform(platform: Platform | undefined): PaymentType[] {
  switch (platform) {
    case 'kleinanzeigen.de':
      return [
        'Kleinanzeigen (Cash)',
        'Kleinanzeigen (Direkt Kaufen)',
        'Kleinanzeigen (Paypal)',
        'Kleinanzeigen (Wire Transfer)',
        'Other',
      ];
    case 'ebay.de':
      return ['ebay.de', 'Paypal', 'Bank Transfer', 'Other'];
    case 'Amazon':
      return ['Other', 'Paypal', 'Bank Transfer', 'Cash'];
    case 'In Person':
      return ['Cash', 'Paypal', 'Bank Transfer', 'Other'];
    case 'Other':
      return ['Cash', 'Paypal', 'Bank Transfer', 'Trade', 'Gift', 'Other'];
    default:
      return ['Cash', 'Paypal', 'Bank Transfer', 'Other'];
  }
}

/**
 * Keep buy payment aligned with purchase platform.
 * Fixes the common case where platform is Kleinanzeigen but payment stayed at bare "Cash"
 * (or "Paypal") instead of the Kleinanzeigen-specific option the user meant.
 */
export function normalizeBuyPaymentForPlatform(
  platform: Platform | undefined,
  payment: PaymentType | undefined
): PaymentType | undefined {
  if (!payment && !platform) return payment;
  const p = payment || 'Cash';

  if (platform === 'kleinanzeigen.de') {
    if (p === 'Paypal' || p === 'Kleinanzeigen (Paypal)') return 'Kleinanzeigen (Paypal)';
    if (p === 'Cash' || p === 'Kleinanzeigen (Cash)') return 'Kleinanzeigen (Cash)';
    if (p === 'Bank Transfer' || p === 'Kleinanzeigen (Wire Transfer)') {
      return 'Kleinanzeigen (Wire Transfer)';
    }
    if (p.startsWith('Kleinanzeigen')) return p;
    // Generic leftovers when buying on KA — prefer explicit KA Cash over bare Cash
    if (p === 'ebay.de') return 'Kleinanzeigen (Cash)';
    return p;
  }

  if (platform === 'ebay.de') {
    if (p === 'ebay.de' || p.startsWith('Kleinanzeigen') || p === 'Cash') return 'ebay.de';
    return p;
  }

  if (platform === 'In Person') {
    if (p.startsWith('Kleinanzeigen') || p === 'ebay.de') return 'Cash';
    return p;
  }

  return p;
}

/** Default payment when the user only picks a platform. */
export function defaultBuyPaymentForPlatform(platform: Platform): PaymentType {
  switch (platform) {
    case 'kleinanzeigen.de':
      return 'Kleinanzeigen (Paypal)';
    case 'ebay.de':
      return 'ebay.de';
    case 'In Person':
      return 'Cash';
    case 'Amazon':
      return 'Other';
    default:
      return 'Cash';
  }
}

/**
 * When platform changes: keep a compatible payment if possible, otherwise use platform default.
 * Bare Cash/Paypal under Kleinanzeigen are upgraded to the KA-specific variants.
 */
export function paymentAfterPlatformChange(
  platform: Platform,
  previousPayment: PaymentType | undefined
): PaymentType {
  if (!previousPayment) return defaultBuyPaymentForPlatform(platform);

  if (platform === 'kleinanzeigen.de') {
    if (previousPayment === 'Paypal' || previousPayment === 'Kleinanzeigen (Paypal)') {
      return 'Kleinanzeigen (Paypal)';
    }
    if (previousPayment === 'Kleinanzeigen (Cash)') return 'Kleinanzeigen (Cash)';
    if (previousPayment === 'Kleinanzeigen (Direkt Kaufen)') return 'Kleinanzeigen (Direkt Kaufen)';
    if (
      previousPayment === 'Bank Transfer' ||
      previousPayment === 'Kleinanzeigen (Wire Transfer)'
    ) {
      return 'Kleinanzeigen (Wire Transfer)';
    }
    // Bare Cash / eBay leftovers → KA Paypal (usual Friends & Family flow)
    if (previousPayment === 'Cash' || previousPayment === 'ebay.de' || previousPayment === 'Other') {
      return 'Kleinanzeigen (Paypal)';
    }
    if (previousPayment.startsWith('Kleinanzeigen')) return previousPayment;
  }

  if (platform === 'ebay.de') {
    if (
      previousPayment.startsWith('Kleinanzeigen') ||
      previousPayment === 'Cash' ||
      previousPayment === 'Paypal'
    ) {
      return 'ebay.de';
    }
  }

  return normalizeBuyPaymentForPlatform(platform, previousPayment) || defaultBuyPaymentForPlatform(platform);
}
