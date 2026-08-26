import { roundMoney } from '../services/financialAggregation';

export type DhlLabelPreset = {
  amountEur: number;
  name: string;
};

/** DHL DE online rates the seller actually buys on eBay (2025–2026). */
export const DHL_LABEL_PRESETS: DhlLabelPreset[] = [
  { amountEur: 4.19, name: 'Päckchen S' },
  { amountEur: 5.19, name: 'Päckchen M' },
  { amountEur: 6.19, name: 'Paket 2 kg' },
  { amountEur: 7.69, name: 'Paket 5 kg' },
  { amountEur: 10.49, name: 'Paket 10 kg' },
  { amountEur: 18.99, name: 'Paket 20 kg' },
  { amountEur: 23.99, name: 'Paket 31,5 kg' },
];

export function mergeDhlLabelPresets(extraAmounts: number[]): {
  presets: DhlLabelPreset[];
  extras: number[];
} {
  const known = new Set(DHL_LABEL_PRESETS.map((p) => p.amountEur));
  const extras = extraAmounts
    .map((raw) => roundMoney(Math.abs(raw)))
    .filter((amountEur) => amountEur >= 0.01 && !known.has(amountEur))
    .filter((amountEur, i, all) => all.indexOf(amountEur) === i)
    .sort((a, b) => a - b);
  return { presets: DHL_LABEL_PRESETS, extras };
}
