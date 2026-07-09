import React, { useState } from 'react';
import { InventoryItem } from '../types';
import { CATEGORY_IMAGES } from '../services/hardwareDB';
import { getCategoryIconForItem, type IconComponent } from './categoryIcons';

function getIconForItem(item: { category?: string; subCategory?: string }): IconComponent {
  return getCategoryIconForItem(item);
}

/** Returns a placeholder image URL for the item (subcategory/category) or null if none. */
export function getCategoryImageUrl(item: { category?: string; subCategory?: string }): string | null {
  const sub = item.subCategory?.trim();
  const cat = item.category?.trim();
  if (sub && CATEGORY_IMAGES[sub]) return CATEGORY_IMAGES[sub];
  if (cat && CATEGORY_IMAGES[cat]) return CATEGORY_IMAGES[cat];
  return null;
}

interface ItemThumbnailProps {
  item: InventoryItem;
  className?: string;
  size?: number;
  /** If true, use category image URL when no item.imageUrl (SVG placeholders). If false, use icon only when no image. */
  useCategoryImage?: boolean;
}

/**
 * Renders item thumbnail: item.imageUrl if set, else category/subcategory image (if useCategoryImage)
 * or a minimalistic Lucide icon so we never show 2-letter avatars.
 */
const ItemThumbnail: React.FC<ItemThumbnailProps> = ({
  item,
  className = 'w-12 h-12 rounded-xl object-cover shadow-sm border border-slate-100',
  size = 48,
  useCategoryImage = false,
}) => {
  const [imageError, setImageError] = useState(false);
  const imgSrc = !imageError
    ? item.imageUrl || item.imageUrls?.[0] || (useCategoryImage ? getCategoryImageUrl(item) : null) || undefined
    : undefined;
  const Icon = getIconForItem(item);

  if (imgSrc) {
    return (
      <img
        src={imgSrc}
        alt=""
        className={className}
        onError={() => setImageError(true)}
      />
    );
  }

  return (
    <div
      className={`rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500 shrink-0 ${className}`}
    >
      <Icon size={Math.round(size * 0.5)} strokeWidth={2} />
    </div>
  );
};

/** Icon-only block for when you only have category/subcategory (e.g. draft items). */
export function CategoryIconBox({
  category,
  subCategory,
  className = 'w-10 h-10 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500 shrink-0',
  size = 20,
}: {
  category?: string;
  subCategory?: string;
  className?: string;
  size?: number;
}) {
  const Icon = getIconForItem({ category, subCategory });
  return (
    <div className={className}>
      <Icon size={size} strokeWidth={2} />
    </div>
  );
}

export default ItemThumbnail;
export { getIconForItem };
