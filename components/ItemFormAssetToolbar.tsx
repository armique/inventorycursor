import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  FileText,
  ImagePlus,
  Loader2,
  Package,
  Search,
  Shield,
  ShoppingBag,
  Sliders,
  StickyNote,
  TrendingUp,
  Type,
  Wand2,
  Wrench,
  BadgeCheck,
  RefreshCw,
} from 'lucide-react';
import type { InventoryItem } from '../types';
import {
  accessoryToggleLabel,
  accessoryToggleState,
  accessoryToggleTitle,
  accessoryTogglesForItem,
  cycleAccessoryTogglePatch,
  listingAccessoriesReady,
  type AccessoryToggleId,
  type AccessoryTriState,
} from '../utils/itemAccessoryToggles';
import { ADD_FLOW_INPUT, ADD_FLOW_LABEL } from './addFlowShared';
import type { ImageSearchProvider } from '../services/imageSearchService';
import type { SoldPriceSuggestion } from '../services/specsAI';
import { formatEUR } from '../utils/formatMoney';

export type BuyCondition = 'new' | 'used' | 'defective';

export function getBuyCondition(
  item: Pick<InventoryItem, 'isDefective' | 'storeBadge'>
): BuyCondition {
  if (item.isDefective) return 'defective';
  if (item.storeBadge === 'New') return 'new';
  return 'used';
}

export function cycleBuyConditionPatch(
  item: Pick<InventoryItem, 'isDefective' | 'storeBadge'>
): Partial<InventoryItem> {
  const cur = getBuyCondition(item);
  // Cycle: GEBRAUCHT (default) → DEFEKT → NEU → GEBRAUCHT
  if (cur === 'used') return { isDefective: true, storeBadge: 'none' };
  if (cur === 'defective') return { isDefective: false, storeBadge: 'New' };
  return { isDefective: false, storeBadge: 'none' };
}

function conditionMeta(c: BuyCondition): { label: string; title: string; icon: React.ReactNode } {
  if (c === 'new') {
    return {
      label: 'NEU',
      title: 'Zustand: Neu — click for Gebraucht',
      icon: <BadgeCheck size={15} strokeWidth={1.75} />,
    };
  }
  if (c === 'defective') {
    return {
      label: 'DEFEKT',
      title: 'Zustand: Defekt — click for Neu',
      icon: <Wrench size={15} strokeWidth={1.75} />,
    };
  }
  return {
    label: 'GEBRAUCHT',
    title: 'Zustand: Gebraucht (default) — click for Defekt',
    icon: <RefreshCw size={15} strokeWidth={1.75} />,
  };
}

function AccessoryGlyph({ id }: { id: AccessoryToggleId }) {
  if (id === 'ovp') return <Package size={15} strokeWidth={1.75} />;
  return <Shield size={15} strokeWidth={1.75} />;
}

type TileTone = AccessoryTriState | BuyCondition | 'neutral';

type TileProps = {
  selected?: boolean;
  disabled?: boolean;
  title: string;
  label: string;
  onClick: () => void;
  icon: React.ReactNode;
  /** OVP/IO tri-state or item condition (new / used / defective). */
  tone?: TileTone;
  /** Brief attention pulse after parse / note added. */
  flash?: boolean;
};

function IconTile({ selected, disabled, title, label, onClick, icon, tone = 'neutral', flash = false }: TileProps) {
  const toneBox =
    tone === 'present' || tone === 'new'
      ? 'border-emerald-600 bg-emerald-500 text-white shadow-sm shadow-emerald-500/40 ring-1 ring-emerald-600/50'
      : tone === 'missing' || tone === 'defective'
        ? 'border-red-600 bg-red-500 text-white shadow-sm shadow-red-500/40 ring-1 ring-red-600/50'
        : tone === 'unspecified'
          ? 'border-violet-600 bg-violet-500 text-white shadow-sm shadow-violet-500/45 ring-1 ring-violet-600/55'
          : tone === 'used'
            ? 'border-amber-800 bg-amber-700 text-white shadow-sm shadow-amber-700/45 ring-1 ring-amber-900/40'
            : selected || flash
              ? 'border-teal-500 bg-teal-50 text-teal-900 ring-1 ring-teal-300/80'
              : 'border-slate-200 text-slate-600 bg-white';
  const toneWrap =
    tone === 'present' || tone === 'new'
      ? 'bg-emerald-100/90'
      : tone === 'missing' || tone === 'defective'
        ? 'bg-red-100/90'
        : tone === 'unspecified'
          ? 'bg-violet-100/90'
          : tone === 'used'
            ? 'bg-amber-100/90'
            : flash
              ? 'bg-teal-100/90 ring-2 ring-teal-400/70 shadow-[0_0_0_3px_rgba(45,212,191,0.25)]'
              : selected
                ? 'bg-teal-50/90'
                : 'hover:bg-slate-100/80';
  const labelTone =
    tone === 'present' || tone === 'new'
      ? 'text-emerald-800'
      : tone === 'missing' || tone === 'defective'
        ? 'text-red-700'
        : tone === 'unspecified'
          ? 'text-violet-800'
          : tone === 'used'
            ? 'text-amber-900'
            : flash || selected
              ? 'text-teal-900'
              : 'text-slate-800';

  return (
    <button
      type="button"
      title={title}
      aria-pressed={selected || undefined}
      disabled={disabled}
      onClick={onClick}
      className={`group flex flex-col items-center justify-start text-center rounded-2xl transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20 gap-1 px-0.5 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed ${toneWrap}`}
    >
      <span
        className={`w-9 h-9 rounded-xl border shadow-[0_1px_0_rgba(15,23,42,0.04)] inline-flex items-center justify-center transition-transform group-hover:-translate-y-0.5 ${toneBox}`}
      >
        {icon}
      </span>
      <span className={`text-[9px] font-black leading-tight ${labelTone}`}>{label}</span>
    </button>
  );
}

type Props = {
  formData: InventoryItem;
  onPatch: (patch: Partial<InventoryItem>) => void;
  generatingTitle: boolean;
  generatingListing: boolean;
  generatingSpecs: boolean;
  aiPriceLoading: boolean;
  aiPriceHint: SoldPriceSuggestion | null;
  aiPriceError: string | null;
  onGenerateTitle: () => void;
  onGenerateListing: () => void;
  onParseSpecs: () => void;
  onFetchSoldHint: () => void;
  onApplySoldAvg?: () => void;
  photoSearching: boolean;
  ebayListingLoading: boolean;
  imageProviders: ImageSearchProvider[];
  selectedProvider: string;
  onSelectProvider: (name: string) => void;
  onFindPhotos: () => void;
  onEbayPhotos: () => void;
  onAiCard: () => void;
  onUploadFiles: (e: React.ChangeEvent<HTMLInputElement>) => void;
  nativePhoto?: boolean;
};

/**
 * Minimal icon strip for AI title/description, note, accessories, condition, and photos.
 */
const ItemFormAssetToolbar: React.FC<Props> = ({
  formData,
  onPatch,
  generatingTitle,
  generatingListing,
  generatingSpecs,
  aiPriceLoading,
  aiPriceHint,
  aiPriceError,
  onGenerateTitle,
  onGenerateListing,
  onParseSpecs,
  onFetchSoldHint,
  onApplySoldAvg,
  photoSearching,
  ebayListingLoading,
  imageProviders,
  selectedProvider,
  onSelectProvider,
  onFindPhotos,
  onEbayPhotos,
  onAiCard,
  onUploadFiles,
  nativePhoto,
}) => {
  const [noteOpen, setNoteOpen] = useState(Boolean((formData.aiDescriptionNote || '').trim()));
  const [specsFlash, setSpecsFlash] = useState(false);
  const [noteFlash, setNoteFlash] = useState(false);
  const [accDraft, setAccDraft] = useState<{ hasOVP?: boolean; hasIOShield?: boolean } | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const prevGeneratingSpecs = useRef(generatingSpecs);
  const prevNoteTrim = useRef((formData.aiDescriptionNote || '').trim());
  const specsFlashTimer = useRef<number | null>(null);
  const noteFlashTimer = useRef<number | null>(null);
  const accPendingRef = useRef<Partial<InventoryItem>>({});
  const accTimerRef = useRef<number | null>(null);
  const onPatchRef = useRef(onPatch);
  onPatchRef.current = onPatch;

  const formForAccessories = accDraft ? { ...formData, ...accDraft } : formData;
  const accessories = accessoryTogglesForItem(formForAccessories);
  const condition = getBuyCondition(formData);
  const cond = conditionMeta(condition);
  const noteFilled = Boolean((formData.aiDescriptionNote || '').trim());
  const hasSpecs = Object.keys(formData.specs || {}).length > 0;
  const accessoriesGate = listingAccessoriesReady(formForAccessories);
  const listingBlockedReason = !accessoriesGate.ok
    ? accessoriesGate.reason
    : !(formData.name || '').trim()
      ? 'Enter an item name first'
      : undefined;

  useEffect(() => {
    setAccDraft((prev) => {
      if (!prev) return null;
      const ovpOk = !('hasOVP' in prev) || formData.hasOVP === prev.hasOVP;
      const ioOk = !('hasIOShield' in prev) || formData.hasIOShield === prev.hasIOShield;
      return ovpOk && ioOk ? null : prev;
    });
  }, [formData.hasOVP, formData.hasIOShield]);

  const cycleAccessory = (id: AccessoryToggleId) => {
    const patch = cycleAccessoryTogglePatch(formForAccessories, id);
    setAccDraft((prev) => ({ ...(prev || {}), ...patch }));
    accPendingRef.current = { ...accPendingRef.current, ...patch };
    if (accTimerRef.current != null) window.clearTimeout(accTimerRef.current);
    accTimerRef.current = window.setTimeout(() => {
      accTimerRef.current = null;
      const pending = accPendingRef.current;
      accPendingRef.current = {};
      if (Object.keys(pending).length) onPatchRef.current(pending);
    }, 280);
  };

  const pulseSpecs = () => {
    if (specsFlashTimer.current != null) window.clearTimeout(specsFlashTimer.current);
    setSpecsFlash(true);
    specsFlashTimer.current = window.setTimeout(() => setSpecsFlash(false), 1800);
  };

  const pulseNote = () => {
    if (noteFlashTimer.current != null) window.clearTimeout(noteFlashTimer.current);
    setNoteFlash(true);
    noteFlashTimer.current = window.setTimeout(() => setNoteFlash(false), 1800);
  };

  useEffect(() => {
    return () => {
      if (specsFlashTimer.current != null) window.clearTimeout(specsFlashTimer.current);
      if (noteFlashTimer.current != null) window.clearTimeout(noteFlashTimer.current);
      if (accTimerRef.current != null) window.clearTimeout(accTimerRef.current);
      const pending = accPendingRef.current;
      if (Object.keys(pending).length) {
        accPendingRef.current = {};
        onPatchRef.current(pending);
      }
    };
  }, []);

  // Flash Specs when AI parse finishes with saved specs.
  useEffect(() => {
    if (prevGeneratingSpecs.current && !generatingSpecs && hasSpecs) {
      pulseSpecs();
    }
    prevGeneratingSpecs.current = generatingSpecs;
  }, [generatingSpecs, hasSpecs]);

  // Flash Note when seller note goes from empty → filled.
  useEffect(() => {
    const next = (formData.aiDescriptionNote || '').trim();
    const prev = prevNoteTrim.current;
    if (!prev && next) {
      setNoteOpen(true);
      pulseNote();
    }
    prevNoteTrim.current = next;
  }, [formData.aiDescriptionNote]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-0.5">
        <IconTile
          label="AI title"
          title="Clean inventory name (same AI title rules)"
          selected={false}
          disabled={generatingTitle || !(formData.name || '').trim()}
          onClick={onGenerateTitle}
          icon={generatingTitle ? <Loader2 size={15} className="animate-spin" /> : <Type size={15} strokeWidth={1.75} />}
        />
        <IconTile
          label="AI text"
          title={
            listingBlockedReason
              ? listingBlockedReason
              : noteFilled
                ? 'Generate marketplace title + DE description (uses note + OVP/IO)'
                : 'Generate marketplace title + DE description (uses OVP/IO)'
          }
          selected={Boolean(formData.marketDescription?.trim())}
          disabled={Boolean(generatingListing || listingBlockedReason)}
          onClick={onGenerateListing}
          icon={
            generatingListing ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <FileText size={15} strokeWidth={1.75} />
            )
          }
        />
        <IconTile
          label="Note"
          title="Seller note for AI description"
          selected={noteOpen || noteFilled}
          flash={noteFlash}
          onClick={() => setNoteOpen((v) => !v)}
          icon={<StickyNote size={15} strokeWidth={1.75} />}
        />
        <IconTile
          label="Specs"
          title="Parse tech specs with AI (saved silently — review later in inventory)"
          selected={hasSpecs || specsFlash}
          flash={specsFlash}
          disabled={generatingSpecs || !(formData.name || '').trim()}
          onClick={() => {
            pulseSpecs();
            onParseSpecs();
          }}
          icon={
            generatingSpecs ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Sliders size={15} strokeWidth={1.75} />
            )
          }
        />
        <IconTile
          label="Sold"
          title="AI eBay sold price hint"
          selected={Boolean(aiPriceHint)}
          disabled={aiPriceLoading || !(formData.name || '').trim()}
          onClick={onFetchSoldHint}
          icon={
            aiPriceLoading ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <TrendingUp size={15} strokeWidth={1.75} />
            )
          }
        />

        {accessories.map((id) => {
          const state = accessoryToggleState(formForAccessories, id);
          return (
            <IconTile
              key={id}
              label={accessoryToggleLabel(id)}
              title={accessoryToggleTitle(id, state)}
              tone={state}
              selected={state === 'present'}
              onClick={() => cycleAccessory(id)}
              icon={<AccessoryGlyph id={id} />}
            />
          );
        })}

        <IconTile
          label={cond.label}
          title={cond.title}
          tone={condition}
          onClick={() => onPatch(cycleBuyConditionPatch(formData))}
          icon={cond.icon}
        />

        <span className="w-px h-10 bg-slate-200 mx-1 self-center" aria-hidden />

        {nativePhoto ? (
          <>
            <IconTile
              label="Camera"
              title="Take photo"
              onClick={() => cameraRef.current?.click()}
              icon={<Camera size={15} strokeWidth={1.75} />}
            />
            <IconTile
              label="Library"
              title="Pick from library"
              onClick={() => libraryRef.current?.click()}
              icon={<ImagePlus size={15} strokeWidth={1.75} />}
            />
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onUploadFiles} />
            <input ref={libraryRef} type="file" accept="image/*" multiple className="hidden" onChange={onUploadFiles} />
          </>
        ) : (
          <IconTile
            label="Photo"
            title="Add photos"
            onClick={() => fileRef.current?.click()}
            icon={<ImagePlus size={15} strokeWidth={1.75} />}
          />
        )}
        <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={onUploadFiles} />

        <IconTile
          label="Find"
          title="Search product photos"
          disabled={photoSearching || !formData.name}
          onClick={onFindPhotos}
          icon={
            photoSearching ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Search size={15} strokeWidth={1.75} />
            )
          }
        />
        <IconTile
          label="eBay"
          title="Photos from my eBay listings"
          disabled={ebayListingLoading || !formData.name}
          onClick={onEbayPhotos}
          icon={
            ebayListingLoading ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <ShoppingBag size={15} strokeWidth={1.75} />
            )
          }
        />
        <IconTile
          label="AI card"
          title={
            listingBlockedReason
              ? listingBlockedReason
              : 'Generate AI product card (uses OVP/IO)'
          }
          disabled={Boolean(listingBlockedReason)}
          onClick={onAiCard}
          icon={<Wand2 size={15} strokeWidth={1.75} />}
        />
      </div>

      {(aiPriceHint || aiPriceError) && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] font-bold text-slate-600 px-1">
          {aiPriceHint && (
            <>
              <span>
                Sold hint €{formatEUR(aiPriceHint.priceLow)}–€{formatEUR(aiPriceHint.priceHigh)} (avg €
                {formatEUR(aiPriceHint.priceAverage)})
              </span>
              {onApplySoldAvg && (
                <button
                  type="button"
                  onClick={onApplySoldAvg}
                  className="text-[10px] font-black uppercase tracking-wider text-slate-900 hover:underline"
                >
                  Apply avg
                </button>
              )}
            </>
          )}
          {aiPriceError && <span className="text-red-600">{aiPriceError}</span>}
        </div>
      )}

      {imageProviders.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className={`${ADD_FLOW_LABEL} mr-1`}>Providers</span>
          <button
            type="button"
            onClick={() => onSelectProvider('')}
            className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider border transition-colors ${
              selectedProvider === ''
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
            }`}
          >
            Auto
          </button>
          {imageProviders.map((p) => (
            <button
              key={p.name}
              type="button"
              disabled={!p.configured}
              onClick={() => onSelectProvider(p.name)}
              title={p.configured ? p.label : `${p.label} not configured`}
              className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider border transition-colors disabled:opacity-35 ${
                selectedProvider === p.name
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}

      {noteOpen && (
        <div
          className={`space-y-1.5 animate-in fade-in slide-in-from-top-1 rounded-xl transition-all duration-300 ${
            noteFlash ? 'ring-2 ring-teal-400/70 bg-teal-50/60 p-2 -mx-1 shadow-[0_0_0_3px_rgba(45,212,191,0.2)]' : ''
          }`}
        >
          <p className={ADD_FLOW_LABEL}>Note for AI description</p>
          <textarea
            className={`${ADD_FLOW_INPUT} min-h-[4.5rem] font-medium text-xs resize-y ${
              noteFlash ? 'border-teal-400 ring-1 ring-teal-300/80' : ''
            }`}
            placeholder="e.g. wifi antennas aren't original — AI rephrases this into the listing"
            value={formData.aiDescriptionNote || ''}
            maxLength={200}
            onChange={(e) => onPatch({ aiDescriptionNote: e.target.value })}
          />
          <p className="text-[10px] text-slate-400 font-medium">
            Used when you tap AI text. Not pasted verbatim.
          </p>
        </div>
      )}
    </div>
  );
};

export default ItemFormAssetToolbar;
