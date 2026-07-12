import React, { useCallback, useEffect, useState } from 'react';
import { ArrowRight, Loader2, Sparkles, Undo2 } from 'lucide-react';
import { enhanceProductPhoto, listPhotoEnhanceProviders, type EnhanceProviderInfo } from '../services/productPhotoEnhance';

interface Props {
  sourceUrl: string | null;
  onEnhanced: (dataUrl: string, meta: { provider: string; note?: string }) => void;
  autoEnhance?: boolean;
  className?: string;
}

const ProductPhotoEnhancePanel: React.FC<Props> = ({
  sourceUrl,
  onEnhanced,
  autoEnhance = true,
  className = '',
}) => {
  const [providers, setProviders] = useState<EnhanceProviderInfo[]>([]);
  const [original, setOriginal] = useState<string | null>(null);
  const [enhanced, setEnhanced] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [meta, setMeta] = useState<{ provider: string; note?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [useEnhanced, setUseEnhanced] = useState(true);

  useEffect(() => {
    void listPhotoEnhanceProviders().then(setProviders);
  }, []);

  const runEnhance = useCallback(async (url: string) => {
    setLoading(true);
    setError(null);
    setOriginal(url);
    try {
      const result = await enhanceProductPhoto(url);
      setEnhanced(result.dataUrl);
      setMeta({ provider: result.provider, note: result.note });
      if (useEnhanced) {
        onEnhanced(result.dataUrl, { provider: result.provider, note: result.note });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Enhance failed');
    } finally {
      setLoading(false);
    }
  }, [onEnhanced, useEnhanced]);

  useEffect(() => {
    if (!sourceUrl) {
      setOriginal(null);
      setEnhanced(null);
      setMeta(null);
      return;
    }
    if (autoEnhance) {
      void runEnhance(sourceUrl);
    } else {
      setOriginal(sourceUrl);
      onEnhanced(sourceUrl, { provider: 'Original' });
    }
  }, [sourceUrl, autoEnhance]); // eslint-disable-line react-hooks/exhaustive-deps -- run on source change only

  const pickOriginal = () => {
    if (!original) return;
    setUseEnhanced(false);
    onEnhanced(original, { provider: 'Original' });
  };

  const pickEnhanced = () => {
    if (!enhanced) return;
    setUseEnhanced(true);
    onEnhanced(enhanced, meta || { provider: 'Enhanced' });
  };

  if (!sourceUrl) return null;

  return (
    <div className={`rounded-xl border border-violet-200 bg-violet-50/50 p-3 space-y-3 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-black uppercase text-violet-800 flex items-center gap-1">
          <Sparkles size={12} /> Photo prep
        </p>
        <button
          type="button"
          disabled={loading || !sourceUrl}
          onClick={() => void runEnhance(sourceUrl)}
          className="text-[10px] font-black uppercase text-violet-700 hover:text-violet-900 disabled:opacity-50"
        >
          {loading ? 'Processing…' : 'Re-run'}
        </button>
      </div>

      <p className="text-[11px] text-violet-900/80 leading-snug">
        Removes background, cleans minor dust/glue on boxes, sharpens — product stays authentic.
      </p>

      {loading && (
        <div className="flex items-center gap-2 text-xs text-violet-700 py-4 justify-center">
          <Loader2 size={16} className="animate-spin" /> Enhancing photo…
        </div>
      )}

      {!loading && enhanced && original && (
        <div className="grid grid-cols-[1fr_auto_1fr] gap-2 items-center">
          <button type="button" onClick={pickOriginal} className={`rounded-lg overflow-hidden border-2 ${!useEnhanced ? 'border-violet-600 ring-2 ring-violet-200' : 'border-slate-200 opacity-80'}`}>
            <img src={original} alt="Original" className="w-full aspect-square object-cover" />
            <span className="block text-[9px] font-bold text-center py-1 bg-white">Original</span>
          </button>
          <ArrowRight size={16} className="text-violet-400" />
          <button type="button" onClick={pickEnhanced} className={`rounded-lg overflow-hidden border-2 ${useEnhanced ? 'border-violet-600 ring-2 ring-violet-200' : 'border-slate-200 opacity-80'}`}>
            <img src={enhanced} alt="Enhanced" className="w-full aspect-square object-cover" />
            <span className="block text-[9px] font-bold text-center py-1 bg-white">{meta?.provider || 'Enhanced'}</span>
          </button>
        </div>
      )}

      {meta?.note && !loading && (
        <p className="text-[10px] text-violet-700/90">{meta.note}</p>
      )}

      {error && (
        <p className="text-[11px] text-red-700 flex items-center gap-1">
          <Undo2 size={12} /> {error}
        </p>
      )}

      {providers.length > 0 && (
        <p className="text-[9px] text-violet-600/80">
          AI: {providers.map((p) => p.label).join(' · ')}
        </p>
      )}
    </div>
  );
};

export default ProductPhotoEnhancePanel;
