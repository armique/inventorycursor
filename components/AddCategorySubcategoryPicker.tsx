import React, { useEffect, useMemo } from 'react';
import { Plus } from 'lucide-react';
import { AddOptionTile } from './addFlowShared';
import { getCategoryIcon } from './categoryIcons';

export type CategorySelection = {
  category: string;
  subCategory: string;
};

type Props = {
  /** Live category tree from settings (add/edit/remove reflected immediately). */
  categories: Record<string, string[]>;
  category: string;
  subCategory: string;
  onChange: (next: CategorySelection) => void;
  /** Optional “+” to create a category in settings. */
  onAddCategory?: () => void;
  size?: 'md' | 'sm';
  /** Fired after a subcategory tile is chosen (e.g. New Asset advances to details). */
  onSubcategorySelected?: (sub: string) => void;
  className?: string;
  categoryHeading?: string;
  subcategoryHeading?: string;
};

/**
 * Shared category → subcategory tile picker (New Asset / Bulk / any add flow).
 * Always reads from the `categories` prop so Settings changes apply everywhere.
 */
export function AddCategorySubcategoryPicker({
  categories,
  category,
  subCategory,
  onChange,
  onAddCategory,
  size = 'md',
  onSubcategorySelected,
  className = '',
  categoryHeading = 'Category',
  subcategoryHeading = 'Subcategory',
}: Props) {
  const categoryKeys = useMemo(() => Object.keys(categories || {}), [categories]);
  const subKeys = useMemo(
    () => (category && categories[category] ? categories[category] : []),
    [categories, category]
  );

  // If Settings remove/rename the current selection, fall back cleanly.
  useEffect(() => {
    if (!categoryKeys.length) return;
    if (category && !categories[category]) {
      onChange({ category: '', subCategory: '' });
      return;
    }
    if (category && subCategory && !(categories[category] || []).includes(subCategory)) {
      onChange({ category, subCategory: '' });
    }
    // Parent onChange is often inline; only react to tree/selection changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [categories, categoryKeys, category, subCategory]);

  const tileSize = size === 'sm' ? 'sm' : 'md';
  const iconSize = size === 'sm' ? 18 : 22;
  const gridClass =
    size === 'sm'
      ? 'grid grid-cols-3 sm:grid-cols-4 gap-1'
      : 'grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-1 sm:gap-2';

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="flex items-center justify-between gap-2 px-1">
        <h3 className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
          {categoryHeading}
        </h3>
        {onAddCategory && (
          <button
            type="button"
            onClick={onAddCategory}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 bg-white text-[10px] font-black uppercase tracking-wider text-slate-600 hover:border-slate-400"
            title="Add category in settings"
          >
            <Plus size={12} />
            Add
          </button>
        )}
      </div>

      {categoryKeys.length === 0 ? (
        <p className="text-xs font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
          No categories yet — add some in Settings.
        </p>
      ) : (
        <div className={gridClass}>
          {categoryKeys.map((cat) => {
            const Icon = getCategoryIcon(cat);
            const selected = category === cat;
            return (
              <AddOptionTile
                key={cat}
                size={tileSize}
                label={cat}
                icon={<Icon size={iconSize} strokeWidth={1.75} />}
                selected={selected}
                dimmed={Boolean(category) && !selected}
                onClick={() => onChange({ category: cat, subCategory: '' })}
              />
            );
          })}
        </div>
      )}

      {category ? (
        <div className="space-y-3 pt-3 border-t border-slate-100">
          <h3 className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400 px-1">
            {subcategoryHeading}
          </h3>
          {subKeys.length === 0 ? (
            <p className="text-xs font-semibold text-slate-500 px-1">
              No subcategories for “{category}”. Add one in Settings, or continue with the category only.
            </p>
          ) : (
            <div className={gridClass}>
              {subKeys.map((sub) => {
                const Icon = getCategoryIcon(sub);
                const selected = subCategory === sub;
                return (
                  <AddOptionTile
                    key={sub}
                    size="sm"
                    label={sub}
                    icon={<Icon size={18} strokeWidth={1.75} />}
                    selected={selected}
                    dimmed={Boolean(subCategory) && !selected}
                    onClick={() => {
                      onChange({ category, subCategory: sub });
                      onSubcategorySelected?.(sub);
                    }}
                  />
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** First available category/sub from the live settings tree. */
export function firstCategorySelection(
  categories: Record<string, string[]>
): CategorySelection {
  const keys = Object.keys(categories || {});
  if (!keys.length) return { category: '', subCategory: '' };
  const category = keys[0];
  const subCategory = (categories[category] || [])[0] || '';
  return { category, subCategory };
}

/**
 * Resolve a hardware-DB type into a category/sub that exists in Settings.
 */
export function resolveCategoryFromHardwareType(
  hwType: string,
  categories: Record<string, string[]>
): CategorySelection {
  const type = String(hwType || '').trim();
  const fallback = firstCategorySelection(categories);

  const typeAliases: Record<string, string[]> = {
    GPU: ['Graphics Cards', 'GPU'],
    CPU: ['Processors', 'CPU'],
    Motherboard: ['Motherboards', 'Motherboard'],
    RAM: ['RAM'],
    Storage: ['Storage (SSD/HDD)', 'Storage', 'SSD', 'HDD'],
    PSU: ['Power Supplies', 'PSU'],
    Case: ['Cases', 'Case'],
    Cooling: ['Cooling'],
  };

  const wantedSubs = [
    type,
    ...(typeAliases[type] || []),
  ].map((s) => s.toLowerCase());

  for (const [cat, subs] of Object.entries(categories || {})) {
    for (const sub of subs) {
      if (wantedSubs.includes(sub.toLowerCase())) {
        return { category: cat, subCategory: sub };
      }
    }
    if (wantedSubs.includes(cat.toLowerCase())) {
      return { category: cat, subCategory: (subs || [])[0] || '' };
    }
  }

  // Prefer Components when present for PC parts.
  if (categories.Components) {
    return {
      category: 'Components',
      subCategory: categories.Components[0] || '',
    };
  }

  return fallback;
}

export default AddCategorySubcategoryPicker;
