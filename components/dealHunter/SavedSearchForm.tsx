import React from 'react';
import { Link as LinkIcon } from 'lucide-react';
import type { DealSearchPlatform } from '../../services/geminiService';
import {
  DEAL_CONDITION_OPTIONS,
  type DealItemCondition,
  toggleCondition,
} from '../../services/dealSearchConditions';

export interface SavedSearchFormValues {
  query: string;
  maxPrice: string;
  customUrl: string;
  platform: DealSearchPlatform;
  excludeVB: boolean;
  excludeTausch: boolean;
  plz: string;
  enablePriceAlert: boolean;
  itemConditions: DealItemCondition[];
}

export const EMPTY_SEARCH_FORM: SavedSearchFormValues = {
  query: '',
  maxPrice: '',
  customUrl: '',
  platform: 'kleinanzeigen',
  excludeVB: true,
  excludeTausch: true,
  plz: '',
  enablePriceAlert: false,
  itemConditions: [],
};

const PLATFORM_OPTIONS: { id: DealSearchPlatform; label: string }[] = [
  { id: 'kleinanzeigen', label: 'Kleinanzeigen' },
  { id: 'ebay', label: 'eBay' },
  { id: 'both', label: 'Both' },
];

interface Props {
  values: SavedSearchFormValues;
  onChange: (patch: Partial<SavedSearchFormValues>) => void;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  compact?: boolean;
  submitLabel?: string;
  lang?: 'de' | 'en';
}

const SavedSearchForm: React.FC<Props> = ({
  values,
  onChange,
  onSubmit,
  onCancel,
  compact = false,
  submitLabel = 'Save',
  lang = 'de',
}) => (
  <form
    onSubmit={onSubmit}
    className={`bg-white border border-emerald-200 shadow-sm space-y-3 animate-in slide-in-from-left-4 shrink-0 ${
      compact ? 'p-4 rounded-xl max-h-[55vh] overflow-y-auto custom-scrollbar' : 'p-5 rounded-[2rem] space-y-4'
    }`}
  >
    <div>
      <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Search Term</label>
      <input
        autoFocus
        className={`w-full bg-slate-50 border border-slate-200 font-bold text-sm outline-none focus:border-emerald-500 ${
          compact ? 'px-3 py-2 rounded-lg' : 'px-4 py-3 rounded-xl'
        }`}
        placeholder="e.g. RTX 4070"
        value={values.query}
        onChange={(e) => onChange({ query: e.target.value })}
      />
    </div>

    <div className={compact ? '' : 'flex gap-2'}>
      <div className="flex-1">
        <label className="text-[10px] font-black uppercase text-slate-400 ml-1">
          {compact ? 'Max €' : 'Max Price (€)'}
        </label>
        <input
          type="number"
          className={`w-full bg-slate-50 border border-slate-200 font-bold text-sm outline-none focus:border-emerald-500 ${
            compact ? 'px-3 py-2 rounded-lg' : 'px-4 py-3 rounded-xl'
          }`}
          placeholder="Any"
          value={values.maxPrice}
          onChange={(e) => onChange({ maxPrice: e.target.value })}
        />
      </div>
    </div>

    {!compact && (
      <div>
        <label className="text-[10px] font-black uppercase text-slate-400 ml-1 flex items-center gap-1">
          <LinkIcon size={10} /> Custom URL (Optional)
        </label>
        <input
          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-[10px] outline-none focus:border-emerald-500 text-slate-600"
          placeholder="https://www.kleinanzeigen.de/..."
          value={values.customUrl}
          onChange={(e) => onChange({ customUrl: e.target.value })}
        />
        <p className="text-[9px] text-slate-400 mt-1 ml-1">Use a pre-filtered URL for best results.</p>
      </div>
    )}

    <div>
      <label className="text-[10px] font-black uppercase text-slate-400 ml-1">Platforms</label>
      <div className={`flex gap-1 mt-1 ${compact ? '' : 'gap-1.5'}`}>
        {PLATFORM_OPTIONS.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange({ platform: opt.id })}
            className={`flex-1 font-black uppercase border transition-all ${
              compact ? 'py-2 rounded-lg text-[9px]' : 'py-2.5 rounded-xl text-[10px] tracking-wide'
            } ${
              values.platform === opt.id
                ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                : 'bg-slate-50 text-slate-500 border-slate-200 hover:border-emerald-200'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>

    <div>
      <label className="text-[10px] font-black uppercase text-slate-400 ml-1">
        {lang === 'en' ? 'Item condition (eBay.de)' : 'Zustand (wie eBay.de)'}
      </label>
      <p className="text-[9px] text-slate-400 ml-1 mb-2">
        {lang === 'en' ? 'Optional — filters eBay links & results' : 'Optional — filtert eBay-Links & Treffer'}
      </p>
      <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto custom-scrollbar pr-1">
        {DEAL_CONDITION_OPTIONS.map((opt) => {
          const active = values.itemConditions.includes(opt.id);
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => onChange({ itemConditions: toggleCondition(values.itemConditions, opt.id) })}
              className={`px-2.5 py-1.5 rounded-lg text-[10px] font-bold border transition-all ${
                active
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'bg-slate-50 text-slate-600 border-slate-200 hover:border-indigo-200'
              }`}
            >
              {lang === 'en' ? opt.labelEn : opt.labelDe}
            </button>
          );
        })}
      </div>
    </div>

    <div className={`grid grid-cols-2 gap-2 font-bold text-slate-600 ${compact ? 'text-[11px]' : 'text-xs'}`}>
      <label className="flex items-center gap-1.5">
        <input
          type="checkbox"
          checked={values.excludeVB}
          onChange={(e) => onChange({ excludeVB: e.target.checked })}
          className="accent-emerald-500"
        />
        {compact ? 'No VB' : 'Exclude VB'}
      </label>
      <label className="flex items-center gap-1.5">
        <input
          type="checkbox"
          checked={values.excludeTausch}
          onChange={(e) => onChange({ excludeTausch: e.target.checked })}
          className="accent-emerald-500"
        />
        {compact ? 'No Tausch' : 'Exclude Tausch'}
      </label>
    </div>

    {!compact && (
      <>
        <div>
          <label className="text-[10px] font-black uppercase text-slate-400 ml-1">PLZ filter</label>
          <input
            className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm"
            placeholder="e.g. 10115"
            value={values.plz}
            onChange={(e) => onChange({ plz: e.target.value })}
          />
        </div>
        <label className="flex items-center gap-2 text-xs font-bold text-slate-600">
          <input
            type="checkbox"
            checked={values.enablePriceAlert}
            onChange={(e) => onChange({ enablePriceAlert: e.target.checked })}
            className="accent-emerald-500"
          />
          Notify when deals found
        </label>
      </>
    )}

    <div className={`flex gap-2 ${compact ? 'pt-1' : 'pt-2'}`}>
      <button
        type="button"
        onClick={onCancel}
        className={`flex-1 bg-slate-100 text-slate-500 font-bold text-xs ${compact ? 'py-2 rounded-lg' : 'py-3 rounded-xl'}`}
      >
        Cancel
      </button>
      <button
        type="submit"
        className={`flex-1 bg-emerald-600 text-white font-bold text-xs ${compact ? 'py-2 rounded-lg' : 'py-3 rounded-xl shadow-md'}`}
      >
        {submitLabel}
      </button>
    </div>
  </form>
);

export default SavedSearchForm;

export function formValuesFromSearch(search: {
  query: string;
  maxPrice?: number;
  customUrl?: string;
  platform?: DealSearchPlatform;
  includeEbay?: boolean;
  excludeVB?: boolean;
  excludeTausch?: boolean;
  plz?: string;
  enablePriceAlert?: boolean;
  itemConditions?: DealItemCondition[];
}): SavedSearchFormValues {
  const platform =
    search.platform ?? (search.includeEbay === false ? 'kleinanzeigen' : search.includeEbay ? 'both' : 'kleinanzeigen');
  return {
    query: search.query,
    maxPrice: search.maxPrice && search.maxPrice > 0 ? String(search.maxPrice) : '',
    customUrl: search.customUrl || '',
    platform,
    excludeVB: search.excludeVB !== false,
    excludeTausch: search.excludeTausch !== false,
    plz: search.plz || '',
    enablePriceAlert: !!search.enablePriceAlert,
    itemConditions: search.itemConditions || [],
  };
}

export function buildSearchFromForm(
  values: SavedSearchFormValues,
  existing?: { id: string; results: unknown[]; newResultCount: number; lastRun?: string }
) {
  return {
    id: existing?.id ?? `search-${Date.now()}`,
    query: values.query.trim(),
    maxPrice: parseFloat(values.maxPrice) || 0,
    platform: values.platform,
    includeEbay: values.platform !== 'kleinanzeigen',
    customUrl: values.customUrl.trim(),
    excludeVB: values.excludeVB,
    excludeTausch: values.excludeTausch,
    plz: values.plz.trim(),
    enablePriceAlert: values.enablePriceAlert,
    itemConditions: values.itemConditions.length ? values.itemConditions : undefined,
    results: existing?.results ?? [],
    newResultCount: existing?.newResultCount ?? 0,
    lastRun: existing?.lastRun,
  };
}
