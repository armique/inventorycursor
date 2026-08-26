/** Shared typography for Buy / Sell / Hub / Margin inventory columns (+20% vs text-xs / 10px base). */

export const INV_MONEY_MAIN = 'text-[0.9rem] font-semibold tabular-nums leading-snug';



/** Buyer / order total received (Gesamtbetrag). */

export const INV_MONEY_RECEIVED =

  'text-[0.9rem] font-semibold tabular-nums leading-snug text-slate-900';



/** Bestelleinnahmen — matches Margin column (emerald / red / neutral). */

export const INV_MONEY_NET_POSITIVE =

  'text-[0.9rem] font-semibold tabular-nums leading-snug text-emerald-600';



export const INV_MONEY_NET_NEGATIVE =

  'text-[0.9rem] font-semibold tabular-nums leading-snug text-red-500';



export const INV_MONEY_NET_ZERO =

  'text-[0.9rem] font-semibold tabular-nums leading-snug text-slate-300';



/** @deprecated Use invMoneyNetClass — positive net only. */

export const INV_MONEY_NET = INV_MONEY_NET_POSITIVE;



export function invMoneyNetClass(netEur: number | null | undefined): string {

  if (netEur == null || !Number.isFinite(netEur)) return INV_MONEY_NET_ZERO;

  if (netEur < -0.001) return INV_MONEY_NET_NEGATIVE;

  if (netEur > 0.001) return INV_MONEY_NET_POSITIVE;

  return INV_MONEY_NET_ZERO;

}



/** Fee lines — each deduction type gets its own accent. */

export const INV_MONEY_DEDUCTION_SHIPPING =

  'text-xs font-semibold tabular-nums leading-tight text-orange-600';



export const INV_MONEY_DEDUCTION_EBAY =

  'text-xs font-semibold tabular-nums leading-tight text-amber-700';



export const INV_MONEY_DEDUCTION_AD =

  'text-xs font-semibold tabular-nums leading-tight text-violet-600';



export const INV_MONEY_DEDUCTION_OTHER =

  'text-xs font-semibold tabular-nums leading-tight text-rose-600';



export const INV_MONEY_DEDUCTION_REFUND =

  'text-xs font-semibold tabular-nums leading-tight text-red-500';



/** Generic deduction fallback (legacy). */

export const INV_MONEY_DEDUCTION = INV_MONEY_DEDUCTION_SHIPPING;



export const INV_MONEY_DEDUCTION_COUNT =

  'text-xs font-semibold tabular-nums leading-tight text-orange-500';



export const INV_MONEY_LEDGER =

  'flex w-full min-w-[5.5rem] max-w-[7rem] flex-col items-start gap-0.5';

