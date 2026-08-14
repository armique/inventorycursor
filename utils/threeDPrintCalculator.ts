import { roundMoney } from '../services/financialAggregation';
import type { QuantityDiscountTier, ThreeDPrintCalculatorSettings } from '../services/threeDPrintDefaults';

export type ThreeDPrintCalculatorInput = {
  weightG: number;
  printTimeHours: number;
  quantity: number;
  filamentPricePerKg: number;
};

export type ThreeDPrintCalculatorResult = {
  valid: boolean;
  errors: Partial<Record<'weightG' | 'printTimeHours' | 'quantity' | 'filamentPricePerKg', string>>;
  materialCost: number;
  wasteAmount: number;
  materialCostWithWaste: number;
  electricityCost: number;
  depreciationCost: number;
  additionalCost: number;
  productionCostPerPart: number;
  profitPerPart: number;
  pricePerPart: number;
  quantity: number;
  subtotalBeforeDiscount: number;
  discountPct: number;
  discountAmount: number;
  subtotalAfterDiscount: number;
  minimumOrderPrice: number;
  minimumOrderAdjustment: number;
  finalPrice: number;
  effectivePricePerPart: number;
  printTimeDisplay: string;
};

export function formatPrintTimeDisplay(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return '—';
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h <= 0) return `${m} min`;
  if (m <= 0) return `${h} h`;
  return `${h} h ${m} min`;
}

export function resolveQuantityDiscountPct(quantity: number, tiers: QuantityDiscountTier[]): number {
  if (quantity < 1) return 0;
  for (const tier of tiers) {
    const withinMin = quantity >= tier.minQty;
    const withinMax = tier.maxQty == null || quantity <= tier.maxQty;
    if (withinMin && withinMax) return tier.discountPct;
  }
  return 0;
}

function validateInput(input: ThreeDPrintCalculatorInput): ThreeDPrintCalculatorResult['errors'] {
  const errors: ThreeDPrintCalculatorResult['errors'] = {};
  if (!Number.isFinite(input.weightG) || input.weightG <= 0) {
    errors.weightG = 'Enter model weight greater than 0 g.';
  }
  if (!Number.isFinite(input.printTimeHours) || input.printTimeHours <= 0) {
    errors.printTimeHours = 'Enter print time greater than 0 hours.';
  }
  if (!Number.isFinite(input.quantity) || input.quantity < 1 || !Number.isInteger(input.quantity)) {
    errors.quantity = 'Quantity must be at least 1.';
  }
  if (!Number.isFinite(input.filamentPricePerKg) || input.filamentPricePerKg < 0) {
    errors.filamentPricePerKg = 'Filament price cannot be negative.';
  }
  return errors;
}

/**
 * Production cost = material (with waste) + electricity + depreciation + additional.
 * Retail price = production × (1 + markup), then quantity discount, then minimum order floor.
 */
export function calculateThreeDPrintQuote(
  input: ThreeDPrintCalculatorInput,
  settings: ThreeDPrintCalculatorSettings,
): ThreeDPrintCalculatorResult {
  const errors = validateInput(input);
  const invalid = Object.keys(errors).length > 0;

  const weightG = Math.max(0, input.weightG || 0);
  const printTimeHours = Math.max(0, input.printTimeHours || 0);
  const quantity = Math.max(1, Math.round(input.quantity || 1));
  const filamentPricePerKg = Math.max(0, input.filamentPricePerKg || 0);

  const materialCostPerGram = filamentPricePerKg / 1000;
  const materialCost = roundMoney(weightG * materialCostPerGram);
  const wasteRate = Math.min(1, Math.max(0, settings.wastePct / 100));
  const materialCostWithWaste = roundMoney(materialCost * (1 + wasteRate));
  const wasteAmount = roundMoney(materialCostWithWaste - materialCost);

  const electricityKwh = (printTimeHours * settings.printerPowerW) / 1000;
  const electricityCost = roundMoney(electricityKwh * settings.electricityPricePerKwh);

  const depreciationPerHour = settings.printerCost / Math.max(1, settings.printerLifetimeHours);
  const depreciationCost = roundMoney(printTimeHours * depreciationPerHour);

  const additionalCost = roundMoney(settings.additionalCostPerPart);

  const productionCostPerPart = roundMoney(
    materialCostWithWaste + electricityCost + depreciationCost + additionalCost,
  );

  const markupRate = settings.profitMarkupPct / 100;
  const profitPerPart = roundMoney(productionCostPerPart * markupRate);
  const pricePerPart = roundMoney(productionCostPerPart + profitPerPart);

  const subtotalBeforeDiscount = roundMoney(pricePerPart * quantity);

  const discountPct =
    settings.quantityDiscountEnabled
      ? resolveQuantityDiscountPct(quantity, settings.quantityDiscountTiers)
      : 0;
  const discountAmount = roundMoney(subtotalBeforeDiscount * (discountPct / 100));
  const subtotalAfterDiscount = roundMoney(subtotalBeforeDiscount - discountAmount);

  const minimumOrderPrice = roundMoney(settings.minimumOrderPrice);
  const finalPrice = roundMoney(Math.max(subtotalAfterDiscount, minimumOrderPrice));
  const minimumOrderAdjustment = roundMoney(Math.max(0, finalPrice - subtotalAfterDiscount));
  const effectivePricePerPart = quantity > 0 ? roundMoney(finalPrice / quantity) : finalPrice;

  return {
    valid: !invalid,
    errors,
    materialCost,
    wasteAmount,
    materialCostWithWaste,
    electricityCost,
    depreciationCost,
    additionalCost,
    productionCostPerPart,
    profitPerPart,
    pricePerPart,
    quantity,
    subtotalBeforeDiscount,
    discountPct,
    discountAmount,
    subtotalAfterDiscount,
    minimumOrderPrice,
    minimumOrderAdjustment,
    finalPrice,
    effectivePricePerPart,
    printTimeDisplay: formatPrintTimeDisplay(printTimeHours),
  };
}
