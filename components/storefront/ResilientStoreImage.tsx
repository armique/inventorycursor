import React, { useEffect, useMemo, useState } from 'react';
import { Package } from 'lucide-react';
import { isUsableProductImageUrl } from '../../services/storefrontImageUtils';
import { getCategoryImageUrl } from '../ItemThumbnail';

const ResilientStoreImage: React.FC<{
  urls: string[];
  index: number;
  alt: string;
  category?: string;
  subCategory?: string;
  className?: string;
  imgStyle?: React.CSSProperties;
}> = ({ urls, index, alt, category, subCategory, className, imgStyle }) => {
  const safeUrls = useMemo(() => urls.filter(isUsableProductImageUrl), [urls]);
  const primary = safeUrls.length ? safeUrls[Math.min(Math.max(0, index), safeUrls.length - 1)] : null;
  const catUrl = getCategoryImageUrl({ category, subCategory }) || undefined;
  const [stage, setStage] = useState<'primary' | 'category' | 'none'>('primary');

  useEffect(() => {
    setStage('primary');
  }, [primary, index]);

  const src = stage === 'primary' ? primary : stage === 'category' ? catUrl ?? null : null;

  if (!src) {
    return (
      <div className={`flex flex-col items-center justify-center gap-2 bg-zinc-100 text-zinc-400 min-h-[120px] ${className || ''}`}>
        <Package size={36} strokeWidth={1.25} className="opacity-40 shrink-0" aria-hidden />
        <span className="text-xs px-3 text-center line-clamp-3 font-medium text-zinc-500">{alt}</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      style={imgStyle}
      loading="lazy"
      decoding="async"
      onError={() => {
        if (stage === 'primary' && catUrl) setStage('category');
        else setStage('none');
      }}
    />
  );
};

export default ResilientStoreImage;
