/**
 * Detect suspicious Reinvest signals and turn them into clarifying questions.
 * Pure over inventory + analysis — answers filter which questions still show.
 */
import type { InventoryItem } from '../types';
import { isRealizedDisposal } from './itemDisposition';
import { getParentContainer, roundMoney } from '../services/financialAggregation';
import type { AnchorBundleGroup, ReinvestData, ReinvestGroup } from './reinvestAnalysis';
import type { CategoryBudgetsResult } from './categoryBudgets';
import type { ReinvestUserAnswers } from './reinvestUserAnswers';

export type SuspicionKind =
  | 'negative_vs_visible'
  | 'thin_sample_hot'
  | 'stale_kit_split'
  | 'mixed_condition'
  | 'budget_asymmetry'
  | 'unattributed_pc';

export type ReinvestSuspicion = {
  id: string;
  kind: SuspicionKind;
  title: string;
  body: string;
  /** Suggested actions the UI can offer as buttons. */
  options: Array<{ id: string; label: string }>;
  /** Related group / category key for deep-links. */
  relatedKey?: string;
};

function groupList(data: ReinvestData): Array<ReinvestGroup | AnchorBundleGroup> {
  return [...data.variants, ...data.bundles];
}

export function detectReinvestSuspicions(params: {
  items: InventoryItem[];
  data: ReinvestData;
  budgets: CategoryBudgetsResult;
  answers: ReinvestUserAnswers;
}): ReinvestSuspicion[] {
  const { items, data, budgets, answers } = params;
  const out: ReinvestSuspicion[] = [];
  const answered = (id: string) => answers[id] != null;

  for (const g of groupList(data)) {
    if (g.kind === 'hypothesis') continue;

    // Strong pocket loss while many sample ids look like kit parts → ask about split / equal-split.
    if (
      g.allInclAvgProfit <= -50 &&
      g.soldCount >= 2 &&
      g.attributedFromKitCount >= Math.ceil(g.soldCount / 2)
    ) {
      const id = `neg_kit:${g.key}`;
      if (!answered(id)) {
        out.push({
          id,
          kind: 'negative_vs_visible',
          title: `${g.label} looks −€${Math.abs(Math.round(g.allInclAvgProfit))} on average`,
          body: 'Many of these sales came from sold PCs/bundles. Visible standalone margins can still look fine while kit splits are wrong or equal-split.',
          options: [
            { id: 'recalc', label: 'I should resplit those PCs' },
            { id: 'trust', label: 'Numbers are real — skip buying' },
            { id: 'ignore', label: 'Ignore for now' },
          ],
          relatedKey: g.key,
        });
      }
    }

    // Thin sample + huge €/day → treat as hypothesis unless user confirms more history.
    if (g.soldCount > 0 && g.soldCount <= 2 && g.profitPerDay >= 15 && g.verdict === 'restock') {
      const id = `thin:${g.key}`;
      if (!answered(id)) {
        out.push({
          id,
          kind: 'thin_sample_hot',
          title: `${g.label}: only ${g.soldCount} sale${g.soldCount === 1 ? '' : 's'} but ~€${g.profitPerDay.toFixed(0)}/day`,
          body: 'Too little history to trust as a restock signal. Did you sell more of these outside the app?',
          options: [
            { id: 'more_history', label: 'I have more sales — keep suggesting' },
            { id: 'hypothesis', label: 'Treat as weak idea only' },
            { id: 'ignore', label: 'Ignore for now' },
          ],
          relatedKey: g.key,
        });
      }
    }

    // Kit parts where buy >> attributed sell
    if (g.attributedFromKitCount > 0 && g.avgBuyPrice > 0 && g.allInclAvgProfit < -g.avgBuyPrice * 0.4) {
      const id = `stale_split:${g.key}`;
      if (!answered(id) && !answered(`neg_kit:${g.key}`)) {
        out.push({
          id,
          kind: 'stale_kit_split',
          title: `${g.label}: buy cost dwarfs attributed sell`,
          body: 'Part sell prices inside sold PCs may be outdated (or never recalculated). Resplit before trusting this skip/restock call.',
          options: [
            { id: 'recalc', label: 'Recalculate component prices' },
            { id: 'trust', label: 'Keep as-is' },
            { id: 'ignore', label: 'Ignore for now' },
          ],
          relatedKey: g.key,
        });
      }
    }
  }

  // Mixed defective / no-photo in a restock group's sample
  for (const g of data.variants) {
    if (g.verdict !== 'restock' || g.sampleItemIds.length < 2) continue;
    const samples = g.sampleItemIds
      .map((id) => items.find((i) => i.id === id))
      .filter((i): i is InventoryItem => !!i);
    const defective = samples.filter((i) => i.isDefective).length;
    if (defective >= 1 && defective < samples.length) {
      const id = `mixed_def:${g.key}`;
      if (!answered(id)) {
        out.push({
          id,
          kind: 'mixed_condition',
          title: `${g.label} mixes good and defective stock`,
          body: 'Average profit may be pulled down by defective units. Exclude them from the advice?',
          options: [
            { id: 'exclude_defective', label: 'Exclude defective from advice' },
            { id: 'include_all', label: 'Keep all sales' },
            { id: 'ignore', label: 'Ignore for now' },
          ],
          relatedKey: g.key,
        });
      }
    }
  }

  // Category budget deep red while that category has positive pocket avg on variants
  for (const b of budgets.budgets) {
    if (b.key === 'other' || b.budget >= -100) continue;
    const variants = data.variants.filter(
      (g) => g.key.startsWith(`${b.key}:`) || g.category.toLowerCase().includes(b.label.toLowerCase()),
    );
    const avgPocket = variants.length
      ? variants.reduce((s, g) => s + g.allInclAvgProfit, 0) / variants.length
      : 0;
    if (avgPocket > 10) {
      const id = `budget_asym:${b.key}`;
      if (!answered(id)) {
        out.push({
          id,
          kind: 'budget_asymmetry',
          title: `${b.label} cash box is ${formatSigned(b.budget)} but part margins look fine`,
          body: 'Usually means you bought parts into PCs, and the PC sale was counted as Other (or not split across parts).',
          options: [
            { id: 'recalc_pcs', label: 'Split sold PC prices across parts' },
            { id: 'understood', label: 'Got it — cash box ≠ margin' },
            { id: 'ignore', label: 'Ignore for now' },
          ],
          relatedKey: b.key,
        });
      }
    }
  }

  if (budgets.unattributedPcCount > 0 && budgets.unattributedPcSold > 0) {
    const id = 'unattributed_pcs';
    if (!answered(id)) {
      out.push({
        id,
        kind: 'unattributed_pc',
        title: `${budgets.unattributedPcCount} sold PC(s) without part prices (€${budgets.unattributedPcSold.toFixed(0)})`,
        body: 'That money sits in Other. Split component prices so GPU/CPU budgets stay honest.',
        options: [
          { id: 'recalc_pcs', label: 'I will resplit them' },
          { id: 'later', label: 'Remind me later' },
          { id: 'ignore', label: 'Leave in Other' },
        ],
      });
    }
  }

  // Stale kit: composition child buy >> sell under sold parent
  let staleKits = 0;
  for (const item of items) {
    if (item.isPC || item.isBundle) continue;
    const parent = getParentContainer(item, items);
    if (!parent || !isRealizedDisposal(parent)) continue;
    const buy = Number(item.buyPrice) || 0;
    const sell = Number(item.sellPrice) || 0;
    if (buy > 80 && sell > 0 && sell < buy * 0.35) staleKits += 1;
  }
  if (staleKits >= 3) {
    const id = 'stale_kits_global';
    if (!answered(id)) {
      out.push({
        id,
        kind: 'stale_kit_split',
        title: `${staleKits} kit parts look under-priced vs cost`,
        body: 'Sold PCs still have parts with sell far below buy. Recalculate component prices on those builds.',
        options: [
          { id: 'recalc', label: 'Recalculate on Inventory' },
          { id: 'ignore', label: 'Ignore for now' },
        ],
      });
    }
  }

  return out.slice(0, 12);
}

function formatSigned(n: number): string {
  const r = roundMoney(n);
  return r > 0 ? `+€${r}` : r < 0 ? `−€${Math.abs(r)}` : '€0';
}

/** Apply answer effects to filter/adjust restock recommendations. */
export function applySuspicionAnswersToGroups(
  groups: Array<ReinvestGroup | AnchorBundleGroup>,
  answers: ReinvestUserAnswers,
): Array<ReinvestGroup | AnchorBundleGroup> {
  return groups.map((g) => {
    const thin = answers[`thin:${g.key}`];
    if (thin === 'hypothesis' && g.verdict === 'restock') {
      return { ...g, verdict: 'stocked' as const, reasonNote: (g.reasonNote ? g.reasonNote + ' ' : '') + 'Marked weak (thin history).' };
    }
    const neg = answers[`neg_kit:${g.key}`] || answers[`stale_split:${g.key}`];
    if (neg === 'trust' && g.allInclAvgProfit <= 0) {
      return { ...g, verdict: 'skip' as const, skipReason: g.skipReason || 'You confirmed the loss signal.' };
    }
    return g;
  });
}
