import React from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  Banknote,
  CreditCard,
  Gavel,
  Gift,
  Globe,
  Handshake,
  Landmark,
  Megaphone,
  MoreHorizontal,
  ShoppingBag,
  ShoppingCart,
} from 'lucide-react';
import type { PaymentType, Platform } from '../types';
import type { ResolvedSalePlatform } from '../utils/salePlatform';
import { formatSalePlatformLabel } from '../utils/salePlatform';
import { isRealizedDisposal } from '../utils/itemDisposition';
import type { InventoryItem } from '../types';

type IconSize = number;

/** Fixed square footprint — border included via box-border so active/inactive stay identical size. */
export const PLATFORM_ICON_BOX =
  'inline-flex h-[1.625rem] w-[1.625rem] shrink-0 items-center justify-center rounded-md border box-border p-0';
const PLATFORM_ICON_SIZE = 13;

type PlatformVisual = {
  Icon: React.ComponentType<{
    size?: number;
    strokeWidth?: number;
    className?: string;
    'aria-hidden'?: boolean;
  }>;
  shortLabel: string;
  title: string;
  badge: string;
  muted: string;
};

const PLATFORM_STYLES: Record<Platform, PlatformVisual> = {
  'ebay.de': {
    Icon: Gavel,
    shortLabel: 'eBay',
    title: 'Sold on eBay',
    badge: 'bg-[#0064D2] text-white border-[#0054b3]',
    muted: 'bg-white text-[#0064D2] border-[#0064D2]/35 hover:bg-blue-50 hover:border-[#0064D2]/60',
  },
  'kleinanzeigen.de': {
    Icon: Megaphone,
    shortLabel: 'KA',
    title: 'Sold on Kleinanzeigen',
    badge: 'bg-[#1a7f4b] text-white border-[#156b3f]',
    muted: 'bg-white text-[#1a7f4b] border-[#1a7f4b]/35 hover:bg-emerald-50 hover:border-[#1a7f4b]/60',
  },
  'In Person': {
    Icon: Handshake,
    shortLabel: 'Pickup',
    title: 'Sold in person / pickup',
    badge: 'bg-slate-700 text-white border-slate-800',
    muted: 'bg-white text-slate-700 border-slate-400/50 hover:bg-slate-50 hover:border-slate-500/70',
  },
  Amazon: {
    Icon: ShoppingBag,
    shortLabel: 'Amz',
    title: 'Sold on Amazon',
    badge: 'bg-[#c7511f] text-white border-[#a3441a]',
    muted: 'bg-white text-[#c7511f] border-[#c7511f]/35 hover:bg-orange-50 hover:border-[#c7511f]/55',
  },
  Other: {
    Icon: Globe,
    shortLabel: 'Other',
    title: 'Sold elsewhere',
    badge: 'bg-violet-700 text-white border-violet-800',
    muted: 'bg-white text-violet-700 border-violet-400/45 hover:bg-violet-50 hover:border-violet-500/60',
  },
};

const SOLD_DATE_PLATFORMS: Platform[] = ['ebay.de', 'kleinanzeigen.de', 'In Person', 'Other'];
const PLATFORM_ORDER: Platform[] = SOLD_DATE_PLATFORMS;

function normalizePlatform(platform?: ResolvedSalePlatform | Platform | string | null): Platform | null {
  if (!platform || platform === 'unknown') return null;
  if (platform in PLATFORM_STYLES) return platform as Platform;
  return null;
}

export function salePlatformIconTitle(platform?: ResolvedSalePlatform | Platform | string | null): string {
  const normalized = normalizePlatform(platform);
  if (normalized) return PLATFORM_STYLES[normalized].title;
  return formatSalePlatformLabel(platform ?? 'unknown');
}

type SalePlatformIconProps = {
  platform?: ResolvedSalePlatform | Platform | string | null;
  size?: IconSize;
  strokeWidth?: number;
  className?: string;
  chip?: boolean;
  active?: boolean;
};

export function SalePlatformIcon({
  platform,
  size = PLATFORM_ICON_SIZE,
  strokeWidth = 2.5,
  className = '',
  chip = false,
  active = true,
}: SalePlatformIconProps) {
  const normalized = normalizePlatform(platform);
  if (!normalized) {
    return (
      <span
        className={`${PLATFORM_ICON_BOX} border-slate-300 bg-slate-100 text-slate-500 ${className}`}
        title={salePlatformIconTitle(platform)}
        aria-label={salePlatformIconTitle(platform)}
      >
        <Globe size={size} strokeWidth={strokeWidth} aria-hidden />
      </span>
    );
  }
  const { Icon, badge, muted, title } = PLATFORM_STYLES[normalized];
  if (chip) {
    return (
      <span
        className={`${PLATFORM_ICON_BOX} ${active ? badge : muted} ${className}`}
        title={title}
        aria-label={title}
      >
        <Icon size={size} strokeWidth={strokeWidth} aria-hidden />
      </span>
    );
  }
  return <Icon size={size} strokeWidth={strokeWidth} className={className} aria-hidden />;
}

type SalePlatformBadgeProps = {
  platform: Platform;
  className?: string;
  compact?: boolean;
};

export function SalePlatformBadge({ platform, className = '' }: SalePlatformBadgeProps) {
  const displayPlatform = platform === 'Amazon' ? 'Other' : platform;
  const { Icon, badge, title } = PLATFORM_STYLES[displayPlatform];
  return (
    <span
      title={title}
      aria-label={title}
      className={`${PLATFORM_ICON_BOX} ${badge} ${className}`.trim()}
    >
      <Icon size={PLATFORM_ICON_SIZE} strokeWidth={2.25} aria-hidden />
    </span>
  );
}

function PlatformIconChip({
  platform,
  active,
  onClick,
  title,
}: {
  platform: Platform;
  active: boolean;
  onClick?: () => void;
  title?: string;
}) {
  const { Icon, badge, muted, title: defaultTitle } = PLATFORM_STYLES[platform];
  const label = title || defaultTitle;
  const tone = active ? badge : `${muted} opacity-60 hover:opacity-100`;
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={active}
      onClick={active ? undefined : onClick}
      className={`${PLATFORM_ICON_BOX} ${tone} disabled:cursor-default`}
    >
      <Icon size={PLATFORM_ICON_SIZE} strokeWidth={2.25} aria-hidden />
    </button>
  );
}

type SalePlatformIconPickerProps = {
  value?: Platform | '';
  onPick: (platform: Platform) => void;
  dense?: boolean;
  variant?: 'quick' | 'full';
  className?: string;
};

export function SalePlatformIconPicker({
  onPick,
  variant = 'full',
  className = '',
}: SalePlatformIconPickerProps & { iconsOnly?: boolean }) {
  const options =
    variant === 'quick'
      ? (['ebay.de', 'kleinanzeigen.de', 'In Person'] as Platform[])
      : PLATFORM_ORDER;

  return (
    <div
      className={`flex flex-nowrap items-start justify-start gap-0.5 ${className}`}
      role="group"
      aria-label="Sale platform"
    >
      {options.map((platform) => (
        <PlatformIconChip key={platform} platform={platform} active={false} onClick={() => onPick(platform)} />
      ))}
    </div>
  );
}

/** Sold row: uniform square icon chips — active platform highlighted, same footprint always. */
export function SalePlatformSwitchRow({
  value,
  onPick,
  className = '',
}: {
  value: Platform;
  onPick: (platform: Platform) => void;
  className?: string;
}) {
  const displayValue = value === 'Amazon' ? 'Other' : value;
  return (
    <div
      className={`flex flex-nowrap items-start justify-start gap-0.5 ${className}`}
      role="group"
      aria-label="Sale platform"
    >
      {SOLD_DATE_PLATFORMS.map((platform) => (
        <PlatformIconChip
          key={platform}
          platform={platform}
          active={platform === displayValue}
          onClick={() => onPick(platform)}
        />
      ))}
    </div>
  );
}

const PAYMENT_CONFIG: Record<
  PaymentType,
  {
    Icon: React.ComponentType<{
      size?: number;
      strokeWidth?: number;
      className?: string;
      'aria-hidden'?: boolean;
    }>;
    className: string;
    shortLabel: string;
  }
> = {
  Cash: { Icon: Banknote, className: 'text-emerald-800 border-emerald-400 bg-emerald-100', shortLabel: 'Cash' },
  'Bank Transfer': { Icon: Landmark, className: 'text-sky-800 border-sky-400 bg-sky-100', shortLabel: 'Bank' },
  'ebay.de': { Icon: CreditCard, className: 'text-[#0064D2] border-blue-400 bg-blue-100', shortLabel: 'Card' },
  'Kleinanzeigen (Cash)': {
    Icon: Banknote,
    className: 'text-[#1a7f4b] border-emerald-400 bg-emerald-100',
    shortLabel: 'Cash',
  },
  'Kleinanzeigen (Direkt Kaufen)': {
    Icon: ShoppingCart,
    className: 'text-[#1a7f4b] border-emerald-500 bg-emerald-100',
    shortLabel: 'DK',
  },
  'Kleinanzeigen (Paypal)': {
    Icon: CreditCard,
    className: 'text-indigo-800 border-indigo-400 bg-indigo-100',
    shortLabel: 'PP',
  },
  'Kleinanzeigen (Wire Transfer)': {
    Icon: Landmark,
    className: 'text-sky-800 border-sky-400 bg-sky-100',
    shortLabel: 'Wire',
  },
  Paypal: { Icon: CreditCard, className: 'text-indigo-800 border-indigo-400 bg-indigo-100', shortLabel: 'PP' },
  Trade: { Icon: ArrowRightLeft, className: 'text-violet-800 border-violet-400 bg-violet-100', shortLabel: 'Trade' },
  Gift: { Icon: Gift, className: 'text-pink-800 border-pink-400 bg-pink-100', shortLabel: 'Gift' },
  Other: { Icon: MoreHorizontal, className: 'text-slate-700 border-slate-400 bg-slate-100', shortLabel: 'Other' },
};

type PaymentMethodIconProps = {
  paymentType: PaymentType;
  size?: IconSize;
  className?: string;
  iconOnly?: boolean;
};

export function PaymentMethodIcon({
  paymentType,
  size = PLATFORM_ICON_SIZE,
  className = '',
  iconOnly = false,
}: PaymentMethodIconProps) {
  const config = PAYMENT_CONFIG[paymentType] ?? PAYMENT_CONFIG.Other;
  const { Icon, className: tone, shortLabel } = config;
  return (
    <span
      className={`rounded-md border box-border ${tone} ${
        iconOnly ? PLATFORM_ICON_BOX : 'inline-flex items-center gap-px px-1 py-px'
      } ${className}`}
      title={paymentType}
      aria-label={paymentType}
    >
      <Icon size={size} strokeWidth={2.25} aria-hidden />
      {!iconOnly ? (
        <span className="text-[7px] font-black uppercase leading-none tracking-wide">{shortLabel}</span>
      ) : null}
    </span>
  );
}

type SalePlatformCellProps = {
  item: InventoryItem;
  missing: boolean;
  inferredPlatform: ResolvedSalePlatform | null;
  onPick: (platform: Platform) => void;
  className?: string;
};

/** Dedicated Platform column — badge, payment chip, or compact picker. */
export function SalePlatformCell({
  item,
  missing,
  inferredPlatform,
  onPick,
  className = '',
}: SalePlatformCellProps) {
  if (!isRealizedDisposal(item)) return null;

  return (
    <div
      className={`flex items-start justify-start gap-0.5 flex-nowrap min-w-0 pt-0.5 ${className}`.trim()}
      onClick={(e) => e.stopPropagation()}
    >
      {missing ? (
        <>
          <span title="Platform not set — pick where this was sold" className={`${PLATFORM_ICON_BOX} border-transparent bg-transparent`}>
            <AlertTriangle size={PLATFORM_ICON_SIZE} className="text-amber-500 shrink-0" aria-hidden />
          </span>
          <SalePlatformIconPicker dense variant="quick" iconsOnly onPick={onPick} />
          {inferredPlatform && inferredPlatform !== 'unknown' ? (
            <SalePlatformIcon platform={inferredPlatform} chip active={false} className="opacity-80" />
          ) : null}
        </>
      ) : item.platformSold ? (
        <>
          <SalePlatformSwitchRow value={item.platformSold} onPick={onPick} />
          {shouldShowPaymentMethodIcon(item.platformSold, item.paymentType) && item.paymentType ? (
            <PaymentMethodIcon paymentType={item.paymentType} iconOnly className="shrink-0" />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function shouldShowPaymentMethodIcon(platformSold?: Platform, paymentType?: PaymentType): boolean {
  if (!paymentType) return false;
  if (paymentType === 'ebay.de' && platformSold === 'ebay.de') return false;
  return true;
}
