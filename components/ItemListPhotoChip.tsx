import React from 'react';
import { Camera, ImageOff } from 'lucide-react';
import type { InventoryItem } from '../types';
import { getItemUserPhotoCount } from '../utils/imageImport';
import { getIconForItem } from './ItemThumbnail';

type Props = {
  item: InventoryItem;
  dense?: boolean;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
};

/** List-row photo slot — icon + count only (no image decode). Photos open in Add photos modal. */
const ItemListPhotoChip: React.FC<Props> = ({ item, dense = false, onClick, title }) => {
  const userPhotoCount = getItemUserPhotoCount(item);
  const hasUserPhotos = userPhotoCount > 0;
  const box = dense ? 'w-8 h-8' : 'w-9 h-9';
  const Icon = getIconForItem(item);
  const defaultTitle = hasUserPhotos
    ? `${userPhotoCount} photo${userPhotoCount === 1 ? '' : 's'} — click to add or view`
    : 'No photos — click to add';

  return (
    <div
      className={`relative shrink-0 self-start inline-block ${box} rounded-md cursor-pointer hover:opacity-90 transition-opacity ${
        hasUserPhotos
          ? 'ring-2 ring-emerald-500/45'
          : 'ring-1 ring-dashed ring-amber-400/80 bg-amber-50/40'
      }`}
      title={title ?? defaultTitle}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      <div
        className={`${box} rounded-md bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500 shrink-0`}
      >
        <Icon size={dense ? 14 : 16} strokeWidth={2} />
      </div>
      <span
        className={`absolute -bottom-0.5 -right-0.5 min-w-[14px] h-3.5 px-0.5 rounded-full flex items-center justify-center shadow-sm ${
          hasUserPhotos
            ? 'bg-emerald-600 text-white'
            : 'bg-amber-100 text-amber-700 border border-amber-300'
        }`}
        aria-hidden
      >
        {hasUserPhotos ? (
          userPhotoCount > 1 ? (
            <span className="text-[8px] font-black leading-none">{userPhotoCount}</span>
          ) : (
            <Camera size={8} strokeWidth={2.5} />
          )
        ) : (
          <ImageOff size={8} strokeWidth={2.5} />
        )}
      </span>
    </div>
  );
};

export default React.memo(ItemListPhotoChip);
