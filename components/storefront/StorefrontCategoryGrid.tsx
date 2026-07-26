import React from 'react';
import { ArrowUpRight } from 'lucide-react';
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

const StorefrontCategoryGrid: React.FC<Props> = ({
  texts,
  darkMode,
  categories,
  onSelect,
  headingOverride,
  subheadingOverride,
}) => {
  if (categories.length === 0) return null;

  return (
    <section className="mx-auto w-full max-w-[1400px] px-4 py-16 sm:px-6 sm:py-24">
      <div className="mb-10 grid gap-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] md:items-end">
        <h2 className={`font-display text-3xl font-semibold tracking-tight sm:text-4xl ${darkMode ? 'text-white' : 'text-zinc-900'}`}>
          {headingOverride || texts.categoriesHeading}
        </h2>
        <p className={`max-w-[42ch] text-sm leading-relaxed md:justify-self-end md:text-right ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>
          {subheadingOverride || texts.categoriesSub}
        </p>
      </div>

      <div
        className={`grid grid-cols-1 gap-px overflow-hidden rounded-2xl border sm:grid-cols-2 lg:grid-cols-[1.45fr_1fr_1fr] ${
          darkMode ? 'border-zinc-800 bg-zinc-800' : 'border-zinc-200 bg-zinc-200'
        }`}
      >
        {categories.map(({ name, count }, index) => {
          const Icon = getCategoryIcon(name);
          const featured = index === 0;
          return (
            <button
              key={name}
              type="button"
              onClick={() => onSelect(name)}
              style={{
                animationDelay: `${Math.min(index, 8) * 70}ms`,
                transitionTimingFunction: 'cubic-bezier(0.16, 1, 0.3, 1)',
              }}
              className={`group storefront-stagger flex min-h-[9.5rem] flex-col justify-between p-6 text-left transition-colors duration-300 ${
                featured ? 'sm:col-span-2 lg:col-span-1 lg:row-span-2 lg:min-h-[21rem]' : ''
              } ${darkMode ? 'bg-zinc-900 hover:bg-zinc-900/80' : 'bg-white hover:bg-zinc-50'}`}
            >
              <Icon
                size={featured ? 36 : 28}
                strokeWidth={1.5}
                className={`transition-transform duration-500 ease-out group-hover:-translate-y-0.5 ${
                  darkMode ? 'text-brand-400' : 'text-brand-600'
                }`}
              />
              <div>
                <h3
                  className={`font-display font-semibold tracking-tight ${
                    featured ? 'text-xl sm:text-2xl' : 'text-lg'
                  } ${darkMode ? 'text-white' : 'text-zinc-900'}`}
                >
                  {name}
                </h3>
                <p className={`mt-1 font-mono text-xs tabular-nums ${darkMode ? 'text-zinc-500' : 'text-zinc-500'}`}>
                  {count} {texts.itemsCount}
                </p>
                <span
                  className={`mt-4 inline-flex items-center gap-1 text-sm font-medium ${
                    darkMode ? 'text-zinc-300' : 'text-zinc-700'
                  }`}
                >
                  {texts.shopNow}
                  <ArrowUpRight
                    size={14}
                    className="transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5"
                  />
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
};

export default StorefrontCategoryGrid;
