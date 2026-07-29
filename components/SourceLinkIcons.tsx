/**
 * Clickable "where did this come from" links — chat, order/listing, counterparty profile.
 *
 * Only links that actually resolve are rendered; there is no placeholder for a missing
 * one. Every link opens in a new tab with `noopener` so the panel is never navigated away
 * from mid-review.
 */

import React from 'react';
import { ExternalLink, MessageSquare, Receipt, User } from 'lucide-react';
import type { ResolvedSourceLink, ResolvedSourceLinks, SourceLinkKind } from '../utils/sourceLinks';

const ICONS: Record<SourceLinkKind, React.ComponentType<{ size?: number; className?: string }>> = {
  chat: MessageSquare,
  order: Receipt,
  profile: User,
};

const TONES: Record<SourceLinkKind, string> = {
  chat: 'border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100',
  order: 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100',
  profile: 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100',
};

interface SourceLinkIconsProps {
  links: ResolvedSourceLinks;
  /** `chip` shows the label, `icon` is icon-only for dense table cells. */
  variant?: 'chip' | 'icon';
  className?: string;
}

/** Row of source links for a detail card. */
const SourceLinkIcons: React.FC<SourceLinkIconsProps> = ({ links, variant = 'chip', className = '' }) => {
  if (links.list.length === 0) return null;
  return (
    <div className={`flex flex-wrap items-center gap-1 ${className}`}>
      {links.list.map((l) => (
        <SourceLinkButton key={l.kind} link={l} variant={variant} />
      ))}
    </div>
  );
};

export const SourceLinkButton: React.FC<{
  link: ResolvedSourceLink;
  variant?: 'chip' | 'icon';
}> = ({ link, variant = 'chip' }) => {
  const Icon = ICONS[link.kind];
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      title={`${link.title} ↗`}
      onClick={(e) => e.stopPropagation()}
      className={`inline-flex items-center gap-1 rounded-lg border font-black uppercase tracking-wide transition-colors ${
        TONES[link.kind]
      } ${variant === 'icon' ? 'p-1.5' : 'px-2 py-1 text-[10px]'}`}
    >
      <Icon size={variant === 'icon' ? 13 : 11} />
      {variant === 'chip' && (
        <>
          {link.label}
          <ExternalLink size={9} className="opacity-60" />
        </>
      )}
    </a>
  );
};

/**
 * Single compact link for a table ACTIONS cell — the one-click jump to the chat, which is
 * the whole point. Falls back to the order link when no chat is known.
 */
export const PrimarySourceLinkButton: React.FC<{ links: ResolvedSourceLinks }> = ({ links }) => {
  const primary = links.chat || links.order || links.profile;
  if (!primary) return null;
  return <SourceLinkButton link={primary} variant="icon" />;
};

export default SourceLinkIcons;
