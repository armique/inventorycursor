import React from 'react';
import {
  ChevronRight,
  Home,
  LayoutGrid,
  List,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import type { StorefrontTexts } from './storefrontTexts';
import type { FilterState, SortOption } from './storefrontUtils';

interface Props {
  texts: StorefrontTexts;
  darkMode: boolean;
  filters: FilterState;
  categories: string[];
  subCategories: string[];
  breadcrumbCounts: { total: number; inCategory: number; inSubCategory: number };
  onChange: (patch: Partial<FilterState>) => void;
  onClear: () => void;
  active: boolean;
  className?: string;
}

export const FilterFields: React.FC<Props> = ({
  texts,
  darkMode,
  filters,
  categories,
  subCategories,
  breadcrumbCounts,
  onChange,
  onClear,
  active,
}) => {
  const inputCls = `w-full py-2.5 px-3 rounded-xl text-sm font-medium outline-none transition-shadow focus:ring-2 focus:ring-brand-500/25 ${
    darkMode
      ? 'bg-zinc-900 border border-zinc-700 text-zinc-100 placeholder:text-zinc-500'
      : 'bg-zinc-50 border border-zinc-200 text-zinc-900 placeholder:text-zinc-400'
  }`;

  const labelCls = `text-[10px] font-bold uppercase tracking-wider mb-1.5 block ${darkMode ? 'text-zinc-500' : 'text-zinc-400'}`;

  return (
    <div className="space-y-5">
      <nav className="flex flex-wrap items-center gap-1 text-xs" aria-label="Breadcrumb">
        <button
          type="button"
          onClick={() => onChange({ categoryFilter: '', subCategoryFilter: '' })}
          className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 transition-colors ${
            filters.categoryFilter || filters.subCategoryFilter
              ? darkMode
                ? 'text-zinc-400 hover:text-white hover:bg-zinc-800'
                : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100'
              : darkMode
                ? 'text-zinc-200 font-semibold'
                : 'text-zinc-800 font-semibold'
          }`}
        >
          <Home size={12} />
          {texts.home}
          <span className="opacity-60">({breadcrumbCounts.total})</span>
        </button>
        {filters.categoryFilter && (
          <>
            <ChevronRight size={12} className="opacity-40" />
            <button
              type="button"
              onClick={() => onChange({ subCategoryFilter: '' })}
              className={`inline-flex items-center gap-1 rounded-lg px-2 py-1 transition-colors ${
                filters.subCategoryFilter
                  ? darkMode
                    ? 'text-zinc-400 hover:text-white'
                    : 'text-zinc-500 hover:text-zinc-900'
                  : darkMode
                    ? 'text-zinc-200 font-semibold'
                    : 'text-zinc-800 font-semibold'
              }`}
            >
              {filters.categoryFilter}
              <span className="opacity-60">({breadcrumbCounts.inCategory})</span>
            </button>
          </>
        )}
        {filters.categoryFilter && filters.subCategoryFilter && (
          <>
            <ChevronRight size={12} className="opacity-40" />
            <span className={`px-2 py-1 font-semibold ${darkMode ? 'text-zinc-200' : 'text-zinc-800'}`}>
              {filters.subCategoryFilter}
              <span className="opacity-60 font-normal ml-1">({breadcrumbCounts.inSubCategory})</span>
            </span>
          </>
        )}
      </nav>

      <div>
        <label className={labelCls}>{texts.category}</label>
        <select
          value={filters.categoryFilter}
          onChange={(e) => onChange({ categoryFilter: e.target.value, subCategoryFilter: '' })}
          className={inputCls}
        >
          <option value="">{texts.category}</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      {subCategories.length > 0 && (
        <div>
          <label className={labelCls}>{texts.subCategory}</label>
          <select
            value={filters.subCategoryFilter}
            onChange={(e) => onChange({ subCategoryFilter: e.target.value })}
            className={inputCls}
          >
            <option value="">{texts.subCategory}</option>
            {subCategories.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label className={labelCls}>{texts.price}</label>
        <div className="flex items-center gap-2">
          <input
            type="text"
            inputMode="decimal"
            value={filters.minPrice}
            onChange={(e) => onChange({ minPrice: e.target.value })}
            placeholder={texts.minPrice}
            className={`${inputCls} flex-1 min-w-0`}
          />
          <span className={darkMode ? 'text-zinc-600' : 'text-zinc-300'}>—</span>
          <input
            type="text"
            inputMode="decimal"
            value={filters.maxPrice}
            onChange={(e) => onChange({ maxPrice: e.target.value })}
            placeholder={texts.maxPrice}
            className={`${inputCls} flex-1 min-w-0`}
          />
        </div>
      </div>

      <div>
        <label className={labelCls}>{texts.sort}</label>
        <select
          value={filters.sortBy}
          onChange={(e) => onChange({ sortBy: e.target.value as SortOption })}
          className={inputCls}
        >
          <option value="default">{texts.sort}</option>
          <option value="priceAsc">{texts.priceLow}</option>
          <option value="priceDesc">{texts.priceHigh}</option>
          <option value="nameAsc">{texts.nameAz}</option>
        </select>
      </div>

      <div>
        <label className={labelCls}>View</label>
        <div className={`flex rounded-xl overflow-hidden border p-0.5 ${darkMode ? 'border-zinc-700 bg-zinc-900' : 'border-zinc-200 bg-zinc-50'}`}>
          <button
            type="button"
            onClick={() => onChange({ viewMode: 'grid' })}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-all ${
              filters.viewMode === 'grid'
                ? darkMode
                  ? 'bg-zinc-700 text-white'
                  : 'bg-white text-zinc-900 shadow-sm'
                : darkMode
                  ? 'text-zinc-500'
                  : 'text-zinc-500'
            }`}
          >
            <LayoutGrid size={14} /> Grid
          </button>
          <button
            type="button"
            onClick={() => onChange({ viewMode: 'list' })}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-all ${
              filters.viewMode === 'list'
                ? darkMode
                  ? 'bg-zinc-700 text-white'
                  : 'bg-white text-zinc-900 shadow-sm'
                : darkMode
                  ? 'text-zinc-500'
                  : 'text-zinc-500'
            }`}
          >
            <List size={14} /> List
          </button>
        </div>
      </div>

      {active && (
        <button
          type="button"
          onClick={onClear}
          className={`w-full py-2.5 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors ${
            darkMode
              ? 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
              : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800'
          }`}
        >
          <SlidersHorizontal size={14} />
          {texts.clearFilters}
        </button>
      )}
    </div>
  );
};

const StorefrontFiltersSidebar: React.FC<Props> = (props) => (
  <aside className={`sticky top-24 rounded-2xl border p-5 ${props.className || ''} ${
    props.darkMode ? 'bg-zinc-900/50 border-zinc-800' : 'bg-white border-zinc-200/80 shadow-card'
  }`}>
    <h2 className={`text-xs font-bold uppercase tracking-wider mb-4 flex items-center gap-2 ${props.darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>
      <SlidersHorizontal size={14} />
      {props.texts.filters}
    </h2>
    <FilterFields {...props} />
  </aside>
);

interface MobileProps extends Props {
  open: boolean;
  onClose: () => void;
}

export const StorefrontFiltersDrawer: React.FC<MobileProps> = ({ open, onClose, ...props }) => {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] lg:hidden">
      <div className="absolute inset-0 bg-zinc-900/50 backdrop-blur-sm" onClick={onClose} />
      <div
        className={`absolute bottom-0 left-0 right-0 max-h-[85vh] overflow-y-auto rounded-t-3xl border-t p-6 animate-in slide-in-from-bottom duration-200 ${
          props.darkMode ? 'bg-zinc-950 border-zinc-800' : 'bg-white border-zinc-200'
        }`}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className={`font-bold text-lg ${props.darkMode ? 'text-white' : 'text-zinc-900'}`}>
            {props.texts.filters}
          </h2>
          <button type="button" onClick={onClose} className={`p-2 rounded-xl ${props.darkMode ? 'hover:bg-zinc-800 text-zinc-400' : 'hover:bg-zinc-100 text-zinc-500'}`}>
            <X size={20} />
          </button>
        </div>
        <FilterFields {...props} />
      </div>
    </div>
  );
};

export default StorefrontFiltersSidebar;
