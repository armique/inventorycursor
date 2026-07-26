import React from 'react';
import { ShieldCheck } from 'lucide-react';
import { TRUST_ICONS } from './trustIcons';

export interface TrustRowItem {
  id: string;
  icon: string;
  title: string;
  description: string;
}

interface Props {
  darkMode: boolean;
  items: TrustRowItem[];
  /** Live facts from inventory (stock count, region). */
  liveFacts?: { inStockCount?: number; regionLabel?: string };
}

const StorefrontTrustRow: React.FC<Props> = ({ darkMode, items, liveFacts }) => {
  if (items.length === 0 && !liveFacts?.inStockCount) return null;

  const factCards: TrustRowItem[] = [];
  if (liveFacts?.inStockCount != null && liveFacts.inStockCount > 0) {
    factCards.push({
      id: 'live-stock',
      icon: 'BadgeCheck',
      title: `${liveFacts.inStockCount}+ Artikel`,
      description: liveFacts.regionLabel
        ? `Aktuell auf Lager · ${liveFacts.regionLabel}`
        : 'Aktuell geprüft und auf Lager',
    });
  }

  const all = [...factCards, ...items].slice(0, 4);

  return (
    <section className={`border-y ${darkMode ? 'border-zinc-800' : 'border-zinc-200'}`}>
      <div className="mx-auto grid max-w-[1400px] grid-cols-1 divide-y sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
        {all.map((item, index) => {
          const Icon = TRUST_ICONS[item.icon] || ShieldCheck;
          return (
            <div
              key={item.id}
              className={`px-6 py-10 sm:px-8 ${darkMode ? 'divide-zinc-800' : 'divide-zinc-200'}`}
              style={{
                animationDelay: `${index * 90}ms`,
              }}
            >
              <Icon
                size={20}
                strokeWidth={1.75}
                className={darkMode ? 'text-brand-400' : 'text-brand-600'}
              />
              <h4 className={`mt-4 font-display text-sm font-semibold tracking-tight ${darkMode ? 'text-white' : 'text-zinc-900'}`}>
                {item.title}
              </h4>
              <p className={`mt-2 max-w-[28ch] text-xs leading-relaxed ${darkMode ? 'text-zinc-500' : 'text-zinc-500'}`}>
                {item.description}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
};

export default StorefrontTrustRow;
