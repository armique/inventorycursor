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
}

const StorefrontTrustRow: React.FC<Props> = ({ darkMode, items }) => {
  if (items.length === 0) return null;

  return (
    <section className={`border-t ${darkMode ? 'border-zinc-800' : 'border-zinc-200/80'}`}>
      <div className="mx-auto max-w-7xl w-full px-4 sm:px-6 py-12 grid grid-cols-2 lg:grid-cols-4 gap-8 text-center">
        {items.map((item) => {
          const Icon = TRUST_ICONS[item.icon] || ShieldCheck;
          return (
            <div key={item.id}>
              <div className={`w-11 h-11 rounded-xl mx-auto mb-3 flex items-center justify-center ${
                darkMode ? 'bg-brand-500/15 text-brand-400' : 'bg-brand-50 text-brand-600'
              }`}>
                <Icon size={20} />
              </div>
              <h4 className={`text-sm font-bold ${darkMode ? 'text-white' : 'text-zinc-900'}`}>{item.title}</h4>
              <p className={`text-xs mt-1.5 leading-relaxed ${darkMode ? 'text-zinc-500' : 'text-zinc-500'}`}>{item.description}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
};

export default StorefrontTrustRow;
