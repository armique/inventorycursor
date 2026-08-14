import React, { useState } from 'react';
import { ChevronDown, Settings2, Zap } from 'lucide-react';
import {
  FILAMENT_COLOR_OPTIONS,
  type FilamentMaterialEntry,
  type QuantityDiscountTier,
  type ThreeDPrintCalculatorSettings,
} from '../services/threeDPrintDefaults';
import type { ThreeDPrintCalculatorResult } from '../utils/threeDPrintCalculator';
import { formatPrintTimeDisplay } from '../utils/threeDPrintCalculator';

const INPUT =
  'w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm';
const LABEL = 'block text-xs font-black uppercase tracking-widest text-slate-500 mb-1';
const ADMIN_LABEL = 'block text-xs font-bold text-slate-600 mb-1';

type Props = {
  isAdmin: boolean;
  settings: ThreeDPrintCalculatorSettings;
  onSettingsChange: (next: ThreeDPrintCalculatorSettings) => void;
  weightG: number;
  printTimeHours: number;
  quantity: number;
  materialKey: string;
  color: string;
  filamentPricePerKg: number;
  onWeightGChange: (v: number) => void;
  onPrintTimeHoursChange: (v: number) => void;
  onQuantityChange: (v: number) => void;
  onMaterialKeyChange: (v: string) => void;
  onColorChange: (v: string) => void;
  onFilamentPriceChange: (v: number) => void;
  quote: ThreeDPrintCalculatorResult;
  spoolSelect?: React.ReactNode;
};

function TierRow({
  tier,
  index,
  onChange,
  onRemove,
}: {
  tier: QuantityDiscountTier;
  index: number;
  onChange: (index: number, patch: Partial<QuantityDiscountTier>) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
      <label className="text-[11px] font-semibold text-slate-500">
        From
        <input
          type="number"
          min={1}
          value={tier.minQty}
          onChange={(e) => onChange(index, { minQty: Math.max(1, parseInt(e.target.value, 10) || 1) })}
          className="mt-1 w-full px-2 py-1.5 rounded-lg border border-slate-200 text-sm"
        />
      </label>
      <label className="text-[11px] font-semibold text-slate-500">
        To
        <input
          type="number"
          min={tier.minQty}
          placeholder="∞"
          value={tier.maxQty ?? ''}
          onChange={(e) => {
            const raw = e.target.value.trim();
            onChange(index, {
              maxQty: raw === '' ? null : Math.max(tier.minQty, parseInt(raw, 10) || tier.minQty),
            });
          }}
          className="mt-1 w-full px-2 py-1.5 rounded-lg border border-slate-200 text-sm"
        />
      </label>
      <label className="text-[11px] font-semibold text-slate-500">
        Discount %
        <input
          type="number"
          min={0}
          max={100}
          step={0.5}
          value={tier.discountPct}
          onChange={(e) =>
            onChange(index, { discountPct: Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)) })
          }
          className="mt-1 w-full px-2 py-1.5 rounded-lg border border-slate-200 text-sm"
        />
      </label>
      <button
        type="button"
        onClick={() => onRemove(index)}
        className="px-2 py-1.5 rounded-lg border border-slate-200 text-[11px] font-bold text-slate-500 hover:bg-slate-50"
      >
        Remove
      </button>
    </div>
  );
}

export const ThreeDPrintCalculatorPanel: React.FC<Props> = ({
  isAdmin,
  settings,
  onSettingsChange,
  weightG,
  printTimeHours,
  quantity,
  materialKey,
  color,
  filamentPricePerKg,
  onWeightGChange,
  onPrintTimeHoursChange,
  onQuantityChange,
  onMaterialKeyChange,
  onColorChange,
  onFilamentPriceChange,
  quote,
  spoolSelect,
}) => {
  const [adminOpen, setAdminOpen] = useState(isAdmin);

  const patchSettings = (patch: Partial<ThreeDPrintCalculatorSettings>) => {
    onSettingsChange({ ...settings, ...patch });
  };

  const patchTier = (index: number, patch: Partial<QuantityDiscountTier>) => {
    const tiers = settings.quantityDiscountTiers.map((t, i) => (i === index ? { ...t, ...patch } : t));
    patchSettings({ quantityDiscountTiers: tiers });
  };

  const materials: FilamentMaterialEntry[] =
    settings.materials.length > 0 ? settings.materials : [{ key: 'PLA', label: 'PLA', pricePerKg: 13 }];

  return (
    <div className="bg-white rounded-3xl border border-slate-200 p-6 shadow-sm space-y-6">
      <h2 className="text-lg font-black text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-3">
        <Zap size={18} className="text-yellow-500" />
        3D-Druck Kalkulator
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={LABEL}>Model weight (g)</label>
          <input
            type="number"
            min={0}
            step={0.1}
            value={weightG}
            onChange={(e) => onWeightGChange(Math.max(0, parseFloat(e.target.value) || 0))}
            className={INPUT}
            placeholder="100"
          />
          {quote.errors.weightG && (
            <p className="mt-1 text-[11px] font-semibold text-red-600">{quote.errors.weightG}</p>
          )}
        </div>

        <div>
          <label className={LABEL}>Print time (hours)</label>
          <input
            type="number"
            min={0}
            step={0.01}
            value={printTimeHours}
            onChange={(e) => onPrintTimeHoursChange(Math.max(0, parseFloat(e.target.value) || 0))}
            className={INPUT}
            placeholder="4"
          />
          <p className="mt-1 text-[11px] font-semibold text-slate-500">
            {formatPrintTimeDisplay(printTimeHours)}
          </p>
          {quote.errors.printTimeHours && (
            <p className="mt-0.5 text-[11px] font-semibold text-red-600">{quote.errors.printTimeHours}</p>
          )}
        </div>

        <div>
          <label className={LABEL}>Quantity</label>
          <input
            type="number"
            min={1}
            step={1}
            value={quantity}
            onChange={(e) => onQuantityChange(Math.max(1, parseInt(e.target.value, 10) || 1))}
            className={INPUT}
          />
          {quote.errors.quantity && (
            <p className="mt-1 text-[11px] font-semibold text-red-600">{quote.errors.quantity}</p>
          )}
        </div>

        <div>
          <label className={LABEL}>Material</label>
          <select
            value={materialKey}
            onChange={(e) => onMaterialKeyChange(e.target.value)}
            className={`${INPUT} font-semibold`}
          >
            {materials.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        <div className="sm:col-span-2">
          <label className={LABEL}>Color</label>
          <div className="flex flex-wrap gap-2">
            {FILAMENT_COLOR_OPTIONS.map((c) => {
              const selected = color === c;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => onColorChange(c)}
                  className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-bold transition-colors ${
                    selected
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                  }`}
                >
                  <span
                    className={`w-3 h-3 rounded-full border ${
                      c === 'Black' ? 'bg-slate-900 border-slate-700' : 'bg-white border-slate-300'
                    }`}
                    aria-hidden
                  />
                  {c}
                </button>
              );
            })}
          </div>
        </div>

        {spoolSelect}

        {isAdmin && (
          <div>
            <label className={LABEL}>Filament price (€ / kg)</label>
            <input
              type="number"
              min={0}
              step={0.01}
              value={filamentPricePerKg}
              onChange={(e) => onFilamentPriceChange(Math.max(0, parseFloat(e.target.value) || 0))}
              className={INPUT}
            />
            {quote.errors.filamentPricePerKg && (
              <p className="mt-1 text-[11px] font-semibold text-red-600">{quote.errors.filamentPricePerKg}</p>
            )}
          </div>
        )}
      </div>

      {isAdmin && (
        <div className="rounded-2xl border border-slate-200 overflow-hidden">
          <button
            type="button"
            onClick={() => setAdminOpen((v) => !v)}
            className="w-full flex items-center justify-between gap-2 px-4 py-3 bg-slate-50 text-left"
          >
            <span className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest text-slate-600">
              <Settings2 size={14} />
              Admin calculator settings
            </span>
            <ChevronDown size={16} className={`text-slate-500 transition-transform ${adminOpen ? 'rotate-180' : ''}`} />
          </button>
          {adminOpen && (
            <div className="p-4 space-y-4 border-t border-slate-200 bg-white">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={ADMIN_LABEL}>Electricity (€ / kWh)</label>
                  <input
                    type="number"
                    min={0}
                    step={0.001}
                    value={settings.electricityPricePerKwh}
                    onChange={(e) =>
                      patchSettings({ electricityPricePerKwh: Math.max(0, parseFloat(e.target.value) || 0) })
                    }
                    className={INPUT}
                  />
                </div>
                <div>
                  <label className={ADMIN_LABEL}>Printer power (W)</label>
                  <input
                    type="number"
                    min={1}
                    value={settings.printerPowerW}
                    onChange={(e) =>
                      patchSettings({ printerPowerW: Math.max(1, parseInt(e.target.value, 10) || 1) })
                    }
                    className={INPUT}
                  />
                </div>
                <div>
                  <label className={ADMIN_LABEL}>Printer cost (€)</label>
                  <input
                    type="number"
                    min={0}
                    value={settings.printerCost}
                    onChange={(e) => patchSettings({ printerCost: Math.max(0, parseFloat(e.target.value) || 0) })}
                    className={INPUT}
                  />
                </div>
                <div>
                  <label className={ADMIN_LABEL}>Printer lifetime (print hours)</label>
                  <input
                    type="number"
                    min={1}
                    value={settings.printerLifetimeHours}
                    onChange={(e) =>
                      patchSettings({ printerLifetimeHours: Math.max(1, parseInt(e.target.value, 10) || 1) })
                    }
                    className={INPUT}
                  />
                </div>
                <div>
                  <label className={ADMIN_LABEL}>Additional cost per part (€)</label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={settings.additionalCostPerPart}
                    onChange={(e) =>
                      patchSettings({ additionalCostPerPart: Math.max(0, parseFloat(e.target.value) || 0) })
                    }
                    className={INPUT}
                  />
                </div>
                <div>
                  <label className={ADMIN_LABEL}>Waste / failure allowance (%)</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={settings.wastePct}
                    onChange={(e) =>
                      patchSettings({ wastePct: Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)) })
                    }
                    className={INPUT}
                  />
                </div>
                <div>
                  <label className={ADMIN_LABEL}>Profit markup (%)</label>
                  <input
                    type="number"
                    min={0}
                    max={500}
                    value={settings.profitMarkupPct}
                    onChange={(e) =>
                      patchSettings({ profitMarkupPct: Math.min(500, Math.max(0, parseFloat(e.target.value) || 0)) })
                    }
                    className={INPUT}
                  />
                </div>
                <div>
                  <label className={ADMIN_LABEL}>Minimum order price (€)</label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={settings.minimumOrderPrice}
                    onChange={(e) =>
                      patchSettings({ minimumOrderPrice: Math.max(0, parseFloat(e.target.value) || 0) })
                    }
                    className={INPUT}
                  />
                </div>
              </div>

              <div className="space-y-3 pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-black uppercase tracking-widest text-slate-500">Quantity discount</span>
                  <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-600">
                    <input
                      type="checkbox"
                      checked={settings.quantityDiscountEnabled}
                      onChange={(e) => patchSettings({ quantityDiscountEnabled: e.target.checked })}
                      className="rounded text-brand-600"
                    />
                    Enabled
                  </label>
                </div>
                <div className="space-y-2">
                  {settings.quantityDiscountTiers.map((tier, index) => (
                    <TierRow
                      key={`${tier.minQty}-${index}`}
                      tier={tier}
                      index={index}
                      onChange={patchTier}
                      onRemove={(i) => {
                        const next = settings.quantityDiscountTiers.filter((_, j) => j !== i);
                        patchSettings({
                          quantityDiscountTiers:
                            next.length > 0 ? next : [{ minQty: 1, maxQty: null, discountPct: 0 }],
                        });
                      }}
                    />
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() =>
                    patchSettings({
                      quantityDiscountTiers: [
                        ...settings.quantityDiscountTiers,
                        { minQty: 1, maxQty: null, discountPct: 0 },
                      ],
                    })
                  }
                  className="text-[11px] font-bold text-brand-600 hover:underline"
                >
                  + Add tier
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ThreeDPrintCalculatorPanel;
