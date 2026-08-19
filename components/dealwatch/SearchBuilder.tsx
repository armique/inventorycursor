import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Search, X } from 'lucide-react';
import type { DealwatchMarketplace } from '../../services/dealwatchApi';
import {
  KA_RADIUS_OPTIONS,
  MAX_SPEC_PILLS,
  PRICE_QUICK_CHIPS,
  PRICE_SLIDER_MAX,
  addBuilderCategory,
  addBuilderFacet,
  compileSearchBuilder,
  findBuilderCategory,
  removeBuilderCategory,
  removeBuilderFacet,
  renameBuilderCategory,
  renameBuilderFacet,
  snapKaRadius,
  specBrand,
  type BuilderLibrary,
  type SearchBuilderDraft,
} from '../../utils/dealwatchSearchBuilder';

type AddingKind = 'category' | 'facet' | null;
type Brand = 'intel' | 'amd' | null;

const SHAPE = 'rounded-none';

function brandClass(brand: Brand, selected: boolean): string {
  if (brand === 'intel') {
    return selected
      ? 'bg-sky-700 text-white border-sky-700'
      : 'bg-sky-50 text-sky-800 border-sky-300 hover:border-sky-500';
  }
  if (brand === 'amd') {
    return selected
      ? 'bg-orange-600 text-white border-orange-600'
      : 'bg-orange-50 text-orange-800 border-orange-300 hover:border-orange-500';
  }
  return selected
    ? 'bg-slate-900 text-white border-slate-900'
    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400';
}

function Pill({
  label,
  selected,
  editMode,
  disabled,
  brand = null,
  onToggle,
  onRemove,
  onRename,
}: {
  label: string;
  selected: boolean;
  editMode: boolean;
  disabled?: boolean;
  brand?: Brand;
  onToggle: () => void;
  onRemove: () => void;
  onRename: (label: string) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [text, setText] = useState(label);

  useEffect(() => {
    setText(label);
  }, [label]);

  if (renaming) {
    return (
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          onRename(text);
          setRenaming(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onRename(text);
            setRenaming(false);
          }
          if (e.key === 'Escape') setRenaming(false);
        }}
        className={`px-2.5 py-1 ${SHAPE} border border-slate-400 text-[11px] font-semibold w-28 outline-none`}
      />
    );
  }

  return (
    <span
      className={`inline-flex items-center ${SHAPE} border text-[11px] font-semibold transition-colors ${brandClass(
        brand,
        selected
      )} ${disabled && !selected ? 'opacity-40' : ''}`}
    >
      <button
        type="button"
        disabled={disabled && !selected}
        onClick={() => {
          if (editMode) setRenaming(true);
          else onToggle();
        }}
        className="px-2.5 py-1"
      >
        {label}
      </button>
      {editMode && (
        <button
          type="button"
          aria-label={`Remove ${label}`}
          onClick={onRemove}
          className={`pr-1.5 -ml-1 ${selected ? 'text-white/80 hover:text-white' : 'text-slate-400 hover:text-rose-600'}`}
        >
          <X size={11} />
        </button>
      )}
    </span>
  );
}

function AddPill({
  active,
  onStart,
  onSubmit,
  onCancel,
}: {
  active: boolean;
  onStart: () => void;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState('');
  if (!active) {
    return (
      <button
        type="button"
        onClick={onStart}
        className={`inline-flex items-center gap-0.5 px-2.5 py-1 ${SHAPE} border border-dashed border-slate-300 text-[11px] font-semibold text-slate-500 hover:border-slate-500`}
      >
        <Plus size={11} /> Add
      </button>
    );
  }
  return (
    <input
      autoFocus
      value={value}
      placeholder="Name"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        if (value.trim()) onSubmit(value);
        else onCancel();
        setValue('');
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (value.trim()) onSubmit(value);
          else onCancel();
          setValue('');
        }
        if (e.key === 'Escape') {
          onCancel();
          setValue('');
        }
      }}
      className={`px-2.5 py-1 ${SHAPE} border border-slate-400 text-[11px] font-semibold w-28 outline-none`}
    />
  );
}

function FromToRange({
  min,
  max,
  from,
  to,
  onFrom,
  onTo,
}: {
  min: number;
  max: number;
  from: number;
  to: number;
  onFrom: (value: number) => void;
  onTo: (value: number) => void;
}) {
  const span = Math.max(1, max - min);
  const fromPct = ((Math.min(from, max) - min) / span) * 100;
  const toPct = ((Math.min(to, max) - min) / span) * 100;
  const lo = Math.min(fromPct, toPct);
  const hi = Math.max(fromPct, toPct);

  return (
    <div className="price-from-to relative h-7">
      <div className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 bg-slate-200" />
      <div
        className="absolute top-1/2 h-1 -translate-y-1/2 bg-slate-900"
        style={{ left: `${lo}%`, width: `${Math.max(0, hi - lo)}%` }}
      />
      <input
        type="range"
        min={min}
        max={max}
        value={Math.min(Math.max(from, min), max)}
        aria-label="Price from"
        style={{ zIndex: from > (min + max) / 2 ? 5 : 3 }}
        onChange={(e) => {
          const next = Number(e.target.value) || min;
          onFrom(Math.min(next, to));
        }}
      />
      <input
        type="range"
        min={min}
        max={max}
        value={Math.min(Math.max(to, min), max)}
        aria-label="Price to"
        style={{ zIndex: to < (min + max) / 2 ? 5 : 4 }}
        onChange={(e) => {
          const next = Number(e.target.value) || min;
          onTo(Math.max(next, from));
        }}
      />
    </div>
  );
}

type Props = {
  draft: SearchBuilderDraft;
  library: BuilderLibrary;
  dirty: boolean;
  scanning?: boolean;
  canSave?: boolean;
  onChange: (draft: SearchBuilderDraft) => void;
  onLibraryChange: (library: BuilderLibrary) => void;
  onScan: () => void;
  onSaveChanges: () => void;
  onSaveAsNew: () => void;
};

const SearchBuilder: React.FC<Props> = ({
  draft,
  library,
  dirty,
  scanning,
  canSave,
  onChange,
  onLibraryChange,
  onScan,
  onSaveChanges,
  onSaveAsNew,
}) => {
  const [editMode, setEditMode] = useState(false);
  const [adding, setAdding] = useState<AddingKind>(null);
  const category = findBuilderCategory(library, draft.categoryId) || library.categories[0];
  const compiled = useMemo(() => compileSearchBuilder(draft, library), [draft, library]);
  const specAtCap = draft.facetIds.length >= MAX_SPEC_PILLS;
  const colorSockets = category?.id === 'motherboard' || category?.id === 'cpu';

  const patch = (partial: Partial<SearchBuilderDraft>) => onChange({ ...draft, ...partial });

  const setMarketplace = (marketplace: DealwatchMarketplace) => {
    patch({
      marketplace,
      radiusKm: marketplace === 'kleinanzeigen' ? draft.radiusKm : 0,
    });
  };

  const selectCategory = (id: string) => {
    if (draft.categoryId === id) return;
    patch({ categoryId: id, facetIds: [] });
  };

  const toggleFacet = (id: string) => {
    if (draft.facetIds.includes(id)) {
      patch({ facetIds: draft.facetIds.filter((f) => f !== id) });
      return;
    }
    if (specAtCap) return;
    patch({ facetIds: [...draft.facetIds, id] });
  };

  const setFrom = (minPrice: number) => {
    const next = Math.max(1, minPrice);
    patch({ minPrice: next, maxPrice: Math.max(next, draft.maxPrice) });
  };

  const setTo = (maxPrice: number) => {
    const next = Math.max(1, maxPrice);
    patch({ maxPrice: Math.max(draft.minPrice, next) });
  };

  return (
    <div className="space-y-2.5">
      <style>{`
        .price-from-to input[type='range'] {
          position: absolute;
          left: 0;
          right: 0;
          top: 0;
          width: 100%;
          height: 28px;
          margin: 0;
          background: none;
          pointer-events: none;
          appearance: none;
          -webkit-appearance: none;
        }
        .price-from-to input[type='range']::-webkit-slider-thumb {
          pointer-events: auto;
          appearance: none;
          -webkit-appearance: none;
          width: 12px;
          height: 18px;
          border: 1px solid #0f172a;
          border-radius: 0;
          background: #0f172a;
          cursor: pointer;
        }
        .square-range {
          appearance: none;
          -webkit-appearance: none;
          background: transparent;
          height: 28px;
        }
        .square-range::-webkit-slider-runnable-track {
          height: 4px;
          background: #e2e8f0;
        }
        .square-range::-moz-range-track {
          height: 4px;
          background: #e2e8f0;
        }
        .square-range::-webkit-slider-thumb {
          appearance: none;
          -webkit-appearance: none;
          width: 12px;
          height: 18px;
          margin-top: -7px;
          border: 1px solid #0f172a;
          border-radius: 0;
          background: #0f172a;
          cursor: pointer;
        }
        .square-range::-moz-range-thumb {
          width: 12px;
          height: 18px;
          border: 1px solid #0f172a;
          border-radius: 0;
          background: #0f172a;
          cursor: pointer;
        }
        .price-from-to input[type='range']::-moz-range-thumb {
          pointer-events: auto;
          width: 12px;
          height: 18px;
          border: 1px solid #0f172a;
          background: #0f172a;
          border-radius: 0;
          cursor: pointer;
        }
        .price-from-to input[type='range']::-webkit-slider-runnable-track {
          height: 4px;
          background: transparent;
        }
        .price-from-to input[type='range']::-moz-range-track {
          height: 4px;
          background: transparent;
        }
      `}</style>
      <div className="flex flex-wrap items-center gap-1.5">
        <div className={`flex ${SHAPE} border border-slate-200 p-0.5 bg-slate-50`}>
          {(['ebay', 'kleinanzeigen'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMarketplace(m)}
              className={`px-2.5 py-1.5 ${SHAPE} text-[10px] font-black uppercase tracking-wider ${
                draft.marketplace === m ? 'bg-slate-900 text-white' : 'text-slate-600'
              }`}
            >
              {m === 'ebay' ? 'eBay.de' : 'KA'}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            setEditMode((v) => !v);
            setAdding(null);
          }}
          className={`px-2 py-1.5 ${SHAPE} border text-[10px] font-black uppercase tracking-wider ${
            editMode ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-500'
          }`}
        >
          Edit tags
        </button>
        <span className="text-[10px] font-semibold text-slate-400 truncate ml-auto">{compiled.name}</span>
      </div>

      <div className="flex flex-wrap gap-1.5 items-center">
        {(library.categories || []).map((cat) => (
          <Pill
            key={cat.id}
            label={cat.label}
            selected={cat.id === draft.categoryId}
            editMode={editMode}
            onToggle={() => selectCategory(cat.id)}
            onRemove={() => {
              const nextLib = removeBuilderCategory(library, cat.id);
              onLibraryChange(nextLib);
              if (draft.categoryId === cat.id) {
                patch({ categoryId: nextLib.categories[0]?.id || '', facetIds: [] });
              }
            }}
            onRename={(label) => onLibraryChange(renameBuilderCategory(library, cat.id, label))}
          />
        ))}
        {editMode && (
          <AddPill
            active={adding === 'category'}
            onStart={() => setAdding('category')}
            onCancel={() => setAdding(null)}
            onSubmit={(label) => {
              onLibraryChange(addBuilderCategory(library, label));
              setAdding(null);
            }}
          />
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 items-center">
        {(category?.facets || []).map((facet) => {
          const selected = draft.facetIds.includes(facet.id);
          return (
            <Pill
              key={facet.id}
              label={facet.label}
              selected={selected}
              editMode={editMode}
              brand={colorSockets ? specBrand(facet.label) : null}
              disabled={!selected && specAtCap}
              onToggle={() => toggleFacet(facet.id)}
              onRemove={() => {
                onLibraryChange(removeBuilderFacet(library, category.id, facet.id));
                patch({ facetIds: draft.facetIds.filter((id) => id !== facet.id) });
              }}
              onRename={(label) => onLibraryChange(renameBuilderFacet(library, category.id, facet.id, label))}
            />
          );
        })}
        {editMode && category && (
          <AddPill
            active={adding === 'facet'}
            onStart={() => setAdding('facet')}
            onCancel={() => setAdding(null)}
            onSubmit={(label) => {
              onLibraryChange(addBuilderFacet(library, category.id, label));
              setAdding(null);
            }}
          />
        )}
        {specAtCap && (
          <span className="text-[10px] font-semibold text-slate-400">Max {MAX_SPEC_PILLS} specs</span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Price</span>
            <span className="text-[11px] font-bold tabular-nums text-slate-700">
              from €{draft.minPrice} to €{draft.maxPrice}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              value={draft.minPrice}
              onChange={(e) => setFrom(Number(e.target.value) || 1)}
              className={`w-14 ${SHAPE} border border-slate-200 px-1.5 py-1 text-xs font-semibold`}
              aria-label="From €"
            />
            <div className="flex-1 min-w-0">
              <FromToRange
                min={1}
                max={PRICE_SLIDER_MAX}
                from={Math.min(draft.minPrice, PRICE_SLIDER_MAX)}
                to={Math.min(draft.maxPrice, PRICE_SLIDER_MAX)}
                onFrom={setFrom}
                onTo={setTo}
              />
            </div>
            <input
              type="number"
              min={1}
              value={draft.maxPrice}
              onChange={(e) => setTo(Number(e.target.value) || 1)}
              className={`w-14 ${SHAPE} border border-slate-200 px-1.5 py-1 text-xs font-semibold`}
              aria-label="To €"
            />
          </div>
          <div className="flex gap-1.5 mt-1.5 items-center">
            {PRICE_QUICK_CHIPS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setTo(n)}
                className={`px-2 py-1 ${SHAPE} border text-[10px] font-bold ${
                  draft.maxPrice === n ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-500'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className={draft.marketplace === 'kleinanzeigen' ? '' : 'opacity-40 pointer-events-none'}>
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Distance</span>
            <span className="text-[11px] font-bold tabular-nums text-slate-700">
              {draft.marketplace !== 'kleinanzeigen'
                ? 'KA only'
                : draft.radiusKm > 0
                  ? `${draft.radiusKm} km`
                  : 'Any'}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={KA_RADIUS_OPTIONS.length - 1}
            value={Math.max(0, KA_RADIUS_OPTIONS.indexOf(snapKaRadius(draft.radiusKm)))}
            onChange={(e) => patch({ radiusKm: KA_RADIUS_OPTIONS[Number(e.target.value)] || 0 })}
            className="square-range w-full"
          />
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {[0, 10, 20, 30, 60, 100].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => patch({ radiusKm: n })}
                className={`px-2 py-1 ${SHAPE} border text-[10px] font-bold ${
                  snapKaRadius(draft.radiusKm) === n
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 text-slate-500'
                }`}
              >
                {n === 0 ? 'Any' : `${n}km`}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 items-center">
        <button
          type="button"
          disabled={scanning || !compiled.search}
          onClick={onScan}
          className={`inline-flex items-center gap-1.5 px-3 py-2 ${SHAPE} bg-slate-900 text-white text-xs font-black uppercase tracking-wider disabled:opacity-50`}
        >
          {scanning ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          Scan
        </button>
        <button
          type="button"
          disabled={scanning || !canSave || !dirty}
          onClick={onSaveChanges}
          className={`inline-flex items-center gap-1.5 px-3 py-2 ${SHAPE} border border-slate-200 bg-white text-xs font-black uppercase tracking-wider text-slate-700 disabled:opacity-40`}
        >
          Save changes
        </button>
        <button
          type="button"
          disabled={scanning || !compiled.search}
          onClick={onSaveAsNew}
          className={`inline-flex items-center gap-1.5 px-3 py-2 ${SHAPE} border border-slate-200 bg-white text-xs font-black uppercase tracking-wider text-slate-700 disabled:opacity-50`}
        >
          Save as new
        </button>
        {dirty && <span className="text-[10px] font-bold text-amber-700">Unsaved</span>}
      </div>
    </div>
  );
};

export default SearchBuilder;
