import React, { useRef, useState } from 'react';
import { Loader2, Sparkles, Upload } from 'lucide-react';
import {
  parseEbayOrderFromImageInput,
  type ParsedEbayOrderScreenshot,
} from '../services/ebayOrderScreenshotAI';

interface Props {
  disabled?: boolean;
  onParsed: (data: ParsedEbayOrderScreenshot) => void;
  className?: string;
}

/** Compact eBay order screenshot parser for inline rows (Store Pull sold detection, etc.). */
const EbayOrderScreenshotInline: React.FC<Props> = ({ disabled, onParsed, className = '' }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState('');
  const [loadedFromFile, setLoadedFromFile] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFile = (file: File) => {
    if (file.size > 6 * 1024 * 1024) {
      setError('Max 6MB.');
      return;
    }
    if (!file.type.startsWith('image/')) {
      setError('Image file required.');
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      setSource(reader.result as string);
      setLoadedFromFile(true);
      setError(null);
    };
    reader.readAsDataURL(file);
  };

  const handleParse = async () => {
    const src = source.trim();
    if (!src) {
      setError('Upload or paste image URL.');
      return;
    }
    setParsing(true);
    setError(null);
    try {
      const data = await parseEbayOrderFromImageInput(src);
      onParsed(data);
    } catch (e: unknown) {
      setError((e as Error)?.message || 'Parse failed');
    } finally {
      setParsing(false);
    }
  };

  return (
    <div className={`flex flex-wrap items-center gap-1.5 min-w-0 ${className}`}>
      <input
        type="text"
        disabled={disabled || parsing}
        placeholder="Imgur / image URL"
        value={loadedFromFile ? '' : source}
        onChange={(e) => {
          setSource(e.target.value);
          setLoadedFromFile(false);
          setError(null);
        }}
        className="flex-1 min-w-[120px] max-w-[200px] px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-[11px] font-medium outline-none focus:border-indigo-400 disabled:opacity-50"
      />
      <label
        className={`inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border border-slate-200 bg-white text-[9px] font-black uppercase text-slate-600 cursor-pointer hover:bg-slate-50 ${
          disabled || parsing ? 'opacity-50 pointer-events-none' : ''
        }`}
      >
        <Upload size={11} />
        Upload
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          disabled={disabled || parsing}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) loadFile(file);
            e.target.value = '';
          }}
        />
      </label>
      <button
        type="button"
        disabled={disabled || parsing || !source.trim()}
        onClick={() => void handleParse()}
        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-600 text-white text-[9px] font-black uppercase hover:bg-indigo-700 disabled:opacity-50"
      >
        {parsing ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
        {parsing ? '…' : 'Parse order'}
      </button>
      {loadedFromFile && !error && (
        <span className="text-[9px] text-slate-400">File ready</span>
      )}
      {error && <span className="text-[9px] font-bold text-red-600 w-full">{error}</span>}
    </div>
  );
};

export default EbayOrderScreenshotInline;
