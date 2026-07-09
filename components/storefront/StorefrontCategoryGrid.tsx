import React from 'react';
import { ChevronRight } from 'lucide-react';
import type { StorefrontTexts } from './storefrontTexts';
import { getCategoryIcon } from '../categoryIcons';

interface CategoryEntry {
  name: string;
  count: number;
}

interface Props {
  texts: StorefrontTexts;
  darkMode: boolean;
  categories: CategoryEntry[];
  onSelect: (category: string) => void;
  headingOverride?: string;
  subheadingOverride?: string;
}

const StorefrontCategoryGrid: React.FC<Props> = ({ texts, darkMode, categories, onSelect, headingOverride, subheadingOverride }) => {
  if (categories.length === 0) return null;

  return (
    <section className="mx-auto max-w-7xl w-full px-4 sm:px-6 py-14 sm:py-20">
      <div className="text-center mb-10">
        <h2 className={`text-2xl sm:text-3xl font-bold tracking-tight ${darkMode ? 'text-white' : 'text-zinc-900'}`}>
          {headingOverride || texts.categoriesHeading}
        </h2>
        <p className={`mt-2 text-sm ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>{subheadingOverride || texts.categoriesSub}</p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
        {categories.map(({ name, count }) => {
          const Icon = getCategoryIcon(name);
          return (
            <button
              key={name}
              type="button"
              onClick={() => onSelect(name)}
              className={`group text-left rounded-2xl p-6 min-h-[170px] flex flex-col gap-3 transition-transform duration-200 ${
                darkMode
                  ? 'bg-zinc-900 hover:-translate-y-1'
                  : 'bg-[#f5f5f7] hover:-translate-y-1'
              }`}
            >
              <Icon size={40} strokeWidth={1.5} className={darkMode ? 'text-brand-400' : 'text-brand-600'} />
              <h3 className={`font-semibold text-lg ${darkMode ? 'text-white' : 'text-zinc-900'}`}>{name}</h3>
              <p className={`text-xs flex-1 ${darkMode ? 'text-zinc-500' : 'text-zinc-500'}`}>
                {count} {texts.itemsCount}
              </p>
              <span className={`inline-flex items-center gap-1 text-sm font-medium ${darkMode ? 'text-brand-400' : 'text-brand-600'}`}>
                {texts.shopNow}
                <ChevronRight size={14} className="transition-transform group-hover:translate-x-0.5" />
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
};

export default StorefrontCategoryGrid;
