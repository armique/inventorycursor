import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Sparkles,
  CheckCircle2,
  Loader2,
  ChevronDown,
  AlertCircle,
  Check,
  Zap,
  Info,
} from 'lucide-react';
import { InventoryItem } from '../types';
import { suggestCategoryForItem, CategorySuggestionResult } from '../services/categorySuggestionAI';
import { getSpecsAIProvider } from '../services/specsAI';

const BATCH_SIZE = 12;
const DELAY_BETWEEN_BATCHES_MS = 60_000;   // 1 minute between batches to avoid rate limits
const RETRY_AFTER_RATE_LIMIT_MS = 120_000; // 2 minutes wait then retry if we hit the limit

interface Props {
  items: InventoryItem[];
  categories: Record<string, string[]>;
  categoryFields: Record<string, string[]>;
  onUpdate: (items: InventoryItem[]) => void;
  onUpdateCategoryStructure: (cats: Record<string, string[]>) => void;
  onUpdateCategoryFields: (fields: Record<string, string[]>) => void;
  onAddCategory: (category: string, subcategory?: string) => void;
}

const CategorySuggestionsPage: React.FC<Props> = ({
  items,
  categories,
  categoryFields,
  onUpdate,
  onUpdateCategoryStructure,
  onUpdateCategoryFields,
  onAddCategory,
}) => {
  const [filterCategory, setFilterCategory] = useState<string>('Unknown');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [suggestions, setSuggestions] = useState<Record<string, CategorySuggestionResult>>({});
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [rateLimitWaiting, setRateLimitWaiting] = useState(false);
  const [waitSecondsLeft, setWaitSecondsLeft] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [applyingAll, setApplyingAll] = useState(false);
  const [manualSearch, setManualSearch] = useState<Record<string, string>>({});
  const [manualSelection, setManualSelection] = useState<Record<string, { category: string; subCategory: string }>>({});
  const [manualFocusId, setManualFocusId] = useState<string | null>(null);
  const manualBlurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (manualBlurTimeoutRef.current) clearTimeout(manualBlurTimeoutRef.current);
    };
  }, []);

  const categoryList = Object.keys(categories).length ? categories : { Components: ['Graphics Cards', 'Processors'], Misc: ['Other'], Unknown: [] };
  const filterOptions = ['Unknown', 'Misc', 'All', ...Object.keys(categoryList).filter((c) => c !== 'Unknown' && c !== 'Misc')];

  const manualOptionsList = React.useMemo(() => {
    const out: { category: string; subCategory: string; label: string }[] = [];
    Object.keys(categoryList).forEach((cat) => {
      (categoryList[cat] || []).forEach((sub) => {
        out.push({ category: cat, subCategory: sub, label: `${cat} / ${sub}` });
      });
    });
    return out;
  }, [categoryList]);

  const filteredItems =
    filterCategory === 'All'
      ? items
      : items.filter((i) =>
          filterCategory === 'Unknown'
            ? !i.category || i.category === '' || i.category === 'Unknown'
            : i.category === filterCategory
        );
  const itemList = filteredItems;

  const ensureCategoryAndFields = useCallback(
    (cat: string, sub: string, suggestedFields?: string[]) => {
      const nextCats = { ...categories };
      if (!nextCats[cat]) nextCats[cat] = [];
      if (!nextCats[cat].includes(sub)) nextCats[cat] = [...nextCats[cat], sub];
      if (JSON.stringify(nextCats) !== JSON.stringify(categories)) {
        onUpdateCategoryStructure(nextCats);
      } else if (!categories[cat]?.includes(sub)) {
        onAddCategory(cat, sub);
      }
      const key = `${cat}:${sub}`;
      if (suggestedFields && suggestedFields.length > 0) {
        const existing = categoryFields[key] || [];
        const merged = Array.from(new Set([...existing, ...suggestedFields]));
        if (merged.length !== existing.length) {
          onUpdateCategoryFields({ ...categoryFields, [key]: merged });
        }
      }
    },
    [categories, categoryFields, onUpdateCategoryStructure, onUpdateCategoryFields, onAddCategory]
  );

  const getTargetForItem = useCallback(
    (item: InventoryItem): { category: string; subCategory: string; suggestedFields?: string[] } | null => {
      const sel = manualSelection[item.id];
      if (sel?.category && sel?.subCategory) return { category: sel.category, subCategory: sel.subCategory };
      const s = suggestions[item.id];
      if (s) return { category: s.category, subCategory: s.subCategory, suggestedFields: s.suggestedFields };
      return null;
    },
    [manualSelection, suggestions]
  );

  const handleApply = useCallback(
    (item: InventoryItem) => {
      const target = getTargetForItem(item);
      if (!target) return;
      setApplyingId(item.id);
      setError(null);
      try {
        ensureCategoryAndFields(target.category, target.subCategory, target.suggestedFields);
        onUpdate([
          {
            ...item,
            category: target.category,
            subCategory: target.subCategory,
          },
        ]);
        setSuggestions((prev) => {
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
        setManualSearch((prev) => {
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
        setManualSelection((prev) => {
          const next = { ...prev };
          delete next[item.id];
          return next;
        });
      } catch (e: any) {
        setError(e?.message || 'Failed to apply');
      } finally {
        setApplyingId(null);
      }
    },
    [getTargetForItem, ensureCategoryAndFields, onUpdate]
  );

  const handleApplySelected = useCallback(async () => {
    const toApply = itemList.filter((i) => selectedIds.has(i.id) && getTargetForItem(i));
    if (toApply.length === 0) return;
    setApplyingAll(true);
    setError(null);
    const updated: InventoryItem[] = [];
    const cats = { ...categories };
    const fields = { ...categoryFields };
    for (const item of toApply) {
      const target = getTargetForItem(item);
      if (!target) continue;
      if (!cats[target.category]) cats[target.category] = [];
      if (!cats[target.category].includes(target.subCategory)) cats[target.category] = [...cats[target.category], target.subCategory];
      const key = `${target.category}:${target.subCategory}`;
      if (target.suggestedFields?.length) {
        const existing = fields[key] || [];
        fields[key] = Array.from(new Set([...existing, ...target.suggestedFields]));
      }
      updated.push({ ...item, category: target.category, subCategory: target.subCategory });
    }
    onUpdateCategoryStructure(cats);
    onUpdateCategoryFields(fields);
    onUpdate(updated);
    setSuggestions((prev) => {
      const next = { ...prev };
      toApply.forEach((i) => delete next[i.id]);
      return next;
    });
    setManualSearch((prev) => {
      const next = { ...prev };
      toApply.forEach((i) => delete next[i.id]);
      return next;
    });
    setManualSelection((prev) => {
      const next = { ...prev };
      toApply.forEach((i) => delete next[i.id]);
      return next;
    });
    setApplyingAll(false);
  }, [itemList, selectedIds, getTargetForItem, categories, categoryFields, onUpdate, onUpdateCategoryStructure, onUpdateCategoryFields]);

  const handleApplyAll = useCallback(async () => {
    const toApply = itemList.filter((i) => getTargetForItem(i));
    if (toApply.length === 0) return;
    setApplyingAll(true);
    setError(null);
    const updated: InventoryItem[] = [];
    const cats = { ...categories };
    const fields = { ...categoryFields };
    for (const item of toApply) {
      const target = getTargetForItem(item);
      if (!target) continue;
      if (!cats[target.category]) cats[target.category] = [];
      if (!cats[target.category].includes(target.subCategory)) cats[target.category] = [...cats[target.category], target.subCategory];
      const key = `${target.category}:${target.subCategory}`;
      if (target.suggestedFields?.length) {
        const existing = fields[key] || [];
        fields[key] = Array.from(new Set([...existing, ...target.suggestedFields]));
      }
      updated.push({ ...item, category: target.category, subCategory: target.subCategory });
    }
    onUpdateCategoryStructure(cats);
    onUpdateCategoryFields(fields);
    onUpdate(updated);
    setSuggestions((prev) => {
      const next = { ...prev };
      toApply.forEach((i) => delete next[i.id]);
      return next;
    });
    setManualSearch((prev) => {
      const next = { ...prev };
      toApply.forEach((i) => delete next[i.id]);
      return next;
    });
    setManualSelection((prev) => {
      const next = { ...prev };
      toApply.forEach((i) => delete next[i.id]);
      return next;
    });
    setApplyingAll(false);
  }, [itemList, getTargetForItem, categories, categoryFields, onUpdate, onUpdateCategoryStructure, onUpdateCategoryFields]);

  const runAnalysis = useCallback(async () => {
    const toAnalyze = selectedIds.size > 0 ? itemList.filter((i) => selectedIds.has(i.id)) : itemList;
    if (toAnalyze.length === 0) {
      setError('Select items or choose a category that has items.');
      return;
    }
    setAnalyzing(true);
    setError(null);
    setRateLimitWaiting(false);
    setWaitSecondsLeft(null);
    setProgress({ current: 0, total: toAnalyze.length });
    const waitWithCountdown = async (totalMs: number) => {
      const totalSec = Math.ceil(totalMs / 1000);
      for (let s = totalSec; s > 0; s--) {
        setWaitSecondsLeft(s);
        await new Promise((r) => setTimeout(r, 1000));
      }
      setWaitSecondsLeft(null);
    };
    const results: Record<string, CategorySuggestionResult> = {};
    for (let i = 0; i < toAnalyze.length; i += BATCH_SIZE) {
      const batch = toAnalyze.slice(i, i + BATCH_SIZE);
      const isRateLimitError = (e: unknown) => {
        const msg = (e as Error)?.message?.toLowerCase() ?? '';
        return /rate|limit|429|quota|too many|overloaded/i.test(msg);
      };
      let batchDone = false;
      let retryCount = 0;
      while (!batchDone) {
        try {
          const batchResults: Record<string, CategorySuggestionResult> = {};
          await Promise.all(
            batch.map(async (item) => {
              try {
                const s = await suggestCategoryForItem(item.name, item.category, item.subCategory);
                batchResults[item.id] = s;
              } catch (e) {
                if (isRateLimitError(e)) throw e;
                batchResults[item.id] = {
                  category: 'Misc',
                  subCategory: 'Other',
                  reason: (e as Error)?.message || 'AI error',
                };
              }
            })
          );
          Object.assign(results, batchResults);
          setSuggestions((prev) => ({ ...prev, ...batchResults }));
          setProgress((p) => ({ ...p, current: Math.min(i + BATCH_SIZE, toAnalyze.length) }));
          setRateLimitWaiting(false);
          batchDone = true;
        } catch (e) {
          retryCount += 1;
          setRateLimitWaiting(true);
          setError(`Rate limit hit. Waiting 2 min then retry #${retryCount}…`);
          await waitWithCountdown(RETRY_AFTER_RATE_LIMIT_MS);
        }
      }
      if (i + BATCH_SIZE < toAnalyze.length) {
        setRateLimitWaiting(true);
        setError('Pausing 1 min before next batch…');
        await waitWithCountdown(DELAY_BETWEEN_BATCHES_MS);
        setError(null);
        setRateLimitWaiting(false);
      }
    }
    setAnalyzing(false);
    setProgress({ current: 0, total: 0 });
    setRateLimitWaiting(false);
    setWaitSecondsLeft(null);
    setError(null);
  }, [itemList, selectedIds]);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectAll = () => {
    if (selectedIds.size >= itemList.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(itemList.map((i) => i.id)));
  };

  const provider = getSpecsAIProvider();
  const hasSuggestions = Object.keys(suggestions).length > 0;
  const canApplyCount = itemList.filter((i) => getTargetForItem(i)).length;
  const selectedCanApplyCount = itemList.filter((i) => selectedIds.has(i.id) && getTargetForItem(i)).length;

  return (
    <div className="max-w-[1400px] mx-auto pb-20 px-4 md:px-8 animate-in fade-in duration-300">
      <header className="mb-8 pt-6">
        <h1 className="text-3xl font-black text-slate-900 tracking-tight flex items-center gap-3">
          <Sparkles size={32} className="text-amber-500" />
          Category suggestions
        </h1>
        <p className="text-slate-500 mt-1">
          Use AI to suggest the right category and subcategory for items (e.g. in Unknown). Apply one by one or apply all.
        </p>
      </header>

      {!provider && (
        <div className="mb-6 p-4 rounded-2xl bg-amber-50 border border-amber-200 flex items-start gap-3">
          <AlertCircle size={20} className="text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold text-amber-900">No AI configured</p>
            <p className="text-sm text-amber-800 mt-1">
              Add <code className="bg-amber-100 px-1 rounded">VITE_GROQ_API_KEY</code> or <code className="bg-amber-100 px-1 rounded">VITE_OLLAMA_URL</code> to your <code className="bg-amber-100 px-1 rounded">.env</code> (same as for “Parse specs from web”). Groq free tier is generous for this.
            </p>
          </div>
        </div>
      )}

      <div className="mb-6 p-4 rounded-2xl bg-slate-50 border border-slate-200 flex items-start gap-3">
        <Info size={18} className="text-slate-500 shrink-0 mt-0.5" />
        <div className="text-sm text-slate-600">
          <strong>API usage:</strong> One request per item analyzed. We send items in small batches with a short delay to stay within rate limits (e.g. Groq). Analyze a category like “Unknown” in chunks if you have many items.
        </div>
      </div>

      <div className="flex flex-wrap gap-4 items-center mb-6">
        <div className="flex items-center gap-2">
          <label className="text-xs font-bold text-slate-500 uppercase">Items in category</label>
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-bold bg-white"
          >
            {filterOptions.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={selectAll}
          className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold bg-white hover:bg-slate-50"
        >
          {selectedIds.size >= itemList.length ? 'Deselect all' : 'Select all'} ({itemList.length})
        </button>
        <button
          type="button"
          onClick={runAnalysis}
          disabled={analyzing || !provider}
          className="px-5 py-2.5 rounded-xl bg-amber-500 text-white text-sm font-bold hover:bg-amber-600 disabled:opacity-50 flex items-center gap-2"
        >
          {analyzing ? (
            <>
              <Loader2 size={18} className={rateLimitWaiting ? '' : 'animate-spin'} />
              {rateLimitWaiting && waitSecondsLeft != null
                ? `Waiting ${Math.floor(waitSecondsLeft / 60)}:${String(waitSecondsLeft % 60).padStart(2, '0')}…`
                : rateLimitWaiting
                  ? `Waiting… ${progress.current}/${progress.total}`
                  : `Analyzing ${progress.current}/${progress.total}…`}
            </>
          ) : (
            <>
              <Zap size={18} />
              Analyze {selectedIds.size > 0 ? `${selectedIds.size} selected` : 'all in category'}
            </>
          )}
        </button>
        {(hasSuggestions || canApplyCount > 0) && (
          <>
            <button
              type="button"
              onClick={handleApplySelected}
              disabled={applyingAll || selectedCanApplyCount === 0}
              className="px-5 py-2.5 rounded-xl bg-emerald-500 text-white text-sm font-bold hover:bg-emerald-600 disabled:opacity-50 flex items-center gap-2"
            >
              {applyingAll ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
              Apply to selected ({selectedCanApplyCount})
            </button>
            <button
              type="button"
              onClick={handleApplyAll}
              disabled={applyingAll || canApplyCount === 0}
              className="px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2"
            >
              {applyingAll ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle2 size={18} />}
              Apply all ({canApplyCount})
            </button>
          </>
        )}
      </div>

      {error && (
        <div className="mb-4 p-4 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-900 flex items-center gap-3">
          <AlertCircle size={18} className="shrink-0" />
          <div>
            <p className="font-bold">{error}</p>
            {waitSecondsLeft != null && (
              <p className="mt-1 font-mono text-base text-amber-700">
                Time remaining: {Math.floor(waitSecondsLeft / 60)}:{String(waitSecondsLeft % 60).padStart(2, '0')}
              </p>
            )}
          </div>
        </div>
      )}

      <div className="bg-white rounded-[2rem] border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80">
                <th className="text-[10px] font-black uppercase text-slate-500 tracking-widest px-4 py-3 w-10">
                  <input
                    type="checkbox"
                    checked={selectedIds.size >= itemList.length && itemList.length > 0}
                    onChange={selectAll}
                    className="rounded border-slate-300"
                  />
                </th>
                <th className="text-[10px] font-black uppercase text-slate-500 tracking-widest px-4 py-3">Item</th>
                <th className="text-[10px] font-black uppercase text-slate-500 tracking-widest px-4 py-3">Current category</th>
                <th className="text-[10px] font-black uppercase text-slate-500 tracking-widest px-4 py-3">Suggested</th>
                <th className="text-[10px] font-black uppercase text-slate-500 tracking-widest px-4 py-3">Reason</th>
                <th className="text-[10px] font-black uppercase text-slate-500 tracking-widest px-4 py-3 min-w-[200px]">Manual</th>
                <th className="text-[10px] font-black uppercase text-slate-500 tracking-widest px-4 py-3 w-24">Action</th>
              </tr>
            </thead>
            <tbody>
              {itemList.map((item) => {
                const s = suggestions[item.id];
                const searchQuery = (manualSearch[item.id] ?? '').trim().toLowerCase();
                const displayValue = manualSearch[item.id] ?? (manualSelection[item.id] ? `${manualSelection[item.id].category} / ${manualSelection[item.id].subCategory}` : '');
                const filteredOptions = searchQuery
                  ? manualOptionsList.filter((o) => o.label.toLowerCase().includes(searchQuery))
                  : manualOptionsList;
                const target = getTargetForItem(item);
                const showSuggestions = manualFocusId === item.id && (searchQuery.length > 0 || manualOptionsList.length > 0);
                return (
                  <tr
                    key={item.id}
                    onClick={() => toggleSelect(item.id)}
                    className="border-b border-slate-100 hover:bg-slate-50/50 cursor-pointer"
                  >
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(item.id)}
                        onChange={() => toggleSelect(item.id)}
                        className="rounded border-slate-300"
                      />
                    </td>
                    <td className="px-4 py-3 font-medium text-slate-900 truncate max-w-[200px]" title={item.name}>
                      {item.name}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-600">
                      {item.category || '—'} / {item.subCategory || '—'}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {s ? (
                        <span className="font-bold text-slate-900">
                          {s.category} / {s.subCategory}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 max-w-[220px] truncate" title={s?.reason}>
                      {s?.reason || '—'}
                    </td>
                    <td className="px-4 py-3 align-top" onClick={(e) => e.stopPropagation()}>
                      <div className="relative min-w-[160px]">
                        <input
                          type="text"
                          placeholder="Search category / subcategory…"
                          value={displayValue}
                          onChange={(e) => setManualSearch((prev) => ({ ...prev, [item.id]: e.target.value }))}
                          onFocus={() => {
                            if (manualBlurTimeoutRef.current) {
                              clearTimeout(manualBlurTimeoutRef.current);
                              manualBlurTimeoutRef.current = null;
                            }
                            setManualFocusId(item.id);
                          }}
                          onBlur={() => {
                            manualBlurTimeoutRef.current = setTimeout(() => setManualFocusId(null), 150);
                          }}
                          className="w-full px-2 py-1.5 text-xs font-medium border border-slate-200 rounded-lg bg-white outline-none focus:border-blue-400"
                        />
                        {showSuggestions && filteredOptions.length > 0 && (
                          <ul className="absolute z-10 left-0 right-0 mt-0.5 py-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
                            {filteredOptions.slice(0, 10).map((opt) => (
                              <li
                                key={`${opt.category}-${opt.subCategory}`}
                                className="px-2 py-1.5 text-xs font-medium text-slate-800 hover:bg-blue-50 cursor-pointer"
                                onMouseDown={(e) => {
                                  e.preventDefault();
                                  setManualSelection((prev) => ({ ...prev, [item.id]: { category: opt.category, subCategory: opt.subCategory } }));
                                  setManualSearch((prev) => {
                                    const next = { ...prev };
                                    delete next[item.id];
                                    return next;
                                  });
                                  setManualFocusId(null);
                                }}
                              >
                                {opt.label}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      {target ? (
                        <button
                          type="button"
                          onClick={() => handleApply(item)}
                          disabled={applyingId !== null || applyingAll}
                          className="px-3 py-1.5 rounded-lg bg-emerald-100 text-emerald-800 text-xs font-bold hover:bg-emerald-200 disabled:opacity-50 flex items-center gap-1"
                        >
                          {applyingId === item.id ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                          Apply
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {itemList.length === 0 && (
          <div className="p-12 text-center text-slate-500 font-medium">
            No items in this category. Change the filter or add items to “Unknown” to analyze them.
          </div>
        )}
      </div>
    </div>
  );
};

export default CategorySuggestionsPage;
