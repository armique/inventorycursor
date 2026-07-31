import React from 'react';
import {
  ArrowLeftRight,
  Banknote,
  Building2,
  CreditCard,
  Gift,
  Handshake,
  MessageSquare,
  MoreHorizontal,
  Package,
  ShoppingBag,
  Zap,
} from 'lucide-react';
import type { PaymentType, Platform } from '../types';
import {
  BUY_SOURCE_PLATFORMS,
  buyPaymentOptionsForPlatform,
  formatBuyPaymentLabel,
  formatBuyPaymentShort,
  formatPlatformBoughtLabel,
  formatPlatformBoughtShort,
} from '../utils/purchaseSource';
import { ADD_FLOW_LABEL, ADD_FLOW_INPUT } from './addFlowShared';

function PlatformGlyph({ platform, size = 16 }: { platform: Platform; size?: number }) {
  switch (platform) {
    case 'kleinanzeigen.de':
      return <MessageSquare size={size} strokeWidth={1.75} />;
    case 'ebay.de':
      return <ShoppingBag size={size} strokeWidth={1.75} />;
    case 'Amazon':
      return <Package size={size} strokeWidth={1.75} />;
    case 'In Person':
      return <Handshake size={size} strokeWidth={1.75} />;
    default:
      return <MoreHorizontal size={size} strokeWidth={1.75} />;
  }
}

function PaymentGlyph({ payment, size = 16 }: { payment: PaymentType; size?: number }) {
  switch (payment) {
    case 'Kleinanzeigen (Cash)':
    case 'Cash':
      return <Banknote size={size} strokeWidth={1.75} />;
    case 'Kleinanzeigen (Direkt Kaufen)':
      return <Zap size={size} strokeWidth={1.75} />;
    case 'Kleinanzeigen (Paypal)':
    case 'Paypal':
      return <CreditCard size={size} strokeWidth={1.75} />;
    case 'Kleinanzeigen (Wire Transfer)':
    case 'Bank Transfer':
      return <Building2 size={size} strokeWidth={1.75} />;
    case 'ebay.de':
      return <ShoppingBag size={size} strokeWidth={1.75} />;
    case 'Trade':
      return <ArrowLeftRight size={size} strokeWidth={1.75} />;
    case 'Gift':
      return <Gift size={size} strokeWidth={1.75} />;
    default:
      return <MoreHorizontal size={size} strokeWidth={1.75} />;
  }
}

type IconTileProps = {
  selected: boolean;
  title: string;
  label: string;
  size: 'sm' | 'md';
  onClick: () => void;
  icon: React.ReactNode;
};

function IconTile({ selected, title, label, size, onClick, icon }: IconTileProps) {
  const sm = size === 'sm';
  return (
    <button
      type="button"
      title={title}
      aria-pressed={selected}
      onClick={onClick}
      className={`group flex flex-col items-center justify-start text-center rounded-2xl transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20 ${
        sm ? 'gap-1 px-0.5 py-1.5' : 'gap-1.5 px-1 py-2.5'
      } ${selected ? 'bg-slate-100/90' : 'hover:bg-slate-100/80'}`}
    >
      <span
        className={`rounded-xl bg-white border shadow-[0_1px_0_rgba(15,23,42,0.04)] inline-flex items-center justify-center transition-transform group-hover:-translate-y-0.5 group-hover:border-slate-300 ${
          sm ? 'w-9 h-9' : 'w-11 h-11'
        } ${selected ? 'border-slate-900 text-slate-900' : 'border-slate-200 text-slate-600'}`}
      >
        {icon}
      </span>
      <span
        className={`font-bold leading-tight ${
          sm ? 'text-[9px] text-slate-800' : 'text-[10px] text-slate-900'
        }`}
      >
        {label}
      </span>
    </button>
  );
}

type PlatformPickerProps = {
  value: Platform;
  onChange: (platform: Platform) => void;
  size?: 'sm' | 'md';
  label?: string;
  className?: string;
  platforms?: Platform[];
};

/** Icon-above-label buy-source switcher. */
export function BuySourcePlatformPicker({
  value,
  onChange,
  size = 'md',
  label = 'Bought on',
  className = '',
  platforms = BUY_SOURCE_PLATFORMS,
}: PlatformPickerProps) {
  return (
    <div className={className}>
      {label ? <p className={`${ADD_FLOW_LABEL} mb-2`}>{label}</p> : null}
      <div className="grid grid-cols-5 gap-1">
        {platforms.map((platform) => (
          <IconTile
            key={platform}
            selected={value === platform}
            title={formatPlatformBoughtLabel(platform)}
            label={formatPlatformBoughtShort(platform)}
            size={size}
            onClick={() => onChange(platform)}
            icon={<PlatformGlyph platform={platform} size={size === 'sm' ? 15 : 17} />}
          />
        ))}
      </div>
    </div>
  );
}

type PaymentPickerProps = {
  platform: Platform;
  value: PaymentType;
  onChange: (payment: PaymentType) => void;
  size?: 'sm' | 'md';
  label?: string;
  className?: string;
};

/** Payment icons for the selected buy source (same tile language as platform). */
export function BuyPaymentTypePicker({
  platform,
  value,
  onChange,
  size = 'md',
  label = 'Paid with',
  className = '',
}: PaymentPickerProps) {
  const opts = buyPaymentOptionsForPlatform(platform);
  const list = value && !opts.includes(value) ? [value, ...opts] : opts;
  const cols = Math.min(Math.max(list.length, 2), 5);

  return (
    <div className={className}>
      {label ? <p className={`${ADD_FLOW_LABEL} mb-2`}>{label}</p> : null}
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {list.map((payment) => (
          <IconTile
            key={payment}
            selected={value === payment}
            title={formatBuyPaymentLabel(payment)}
            label={formatBuyPaymentShort(payment)}
            size={size}
            onClick={() => onChange(payment)}
            icon={<PaymentGlyph payment={payment} size={size === 'sm' ? 15 : 17} />}
          />
        ))}
      </div>
    </div>
  );
}

type SellerFieldProps = {
  value: string;
  onChange: (value: string) => void;
  platform: Platform;
  className?: string;
};

/** Seller / shop name — only relevant for marketplace sources. */
export function BuySourceSellerField({ value, onChange, platform, className = '' }: SellerFieldProps) {
  if (platform !== 'kleinanzeigen.de' && platform !== 'ebay.de') return null;
  return (
    <div className={className}>
      <label className={`${ADD_FLOW_LABEL} mb-2 block`}>
        {platform === 'kleinanzeigen.de' ? 'Seller name' : 'Seller / shop'}
      </label>
      <input
        className={ADD_FLOW_INPUT}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={
          platform === 'kleinanzeigen.de' ? 'Kleinanzeigen username' : 'eBay seller / shop'
        }
      />
    </div>
  );
}

export default BuySourcePlatformPicker;
export { PlatformGlyph, PaymentGlyph };
