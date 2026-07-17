import { InventoryItem, ItemStatus } from '../types';
import { nameSimilarity } from './inventorySoldComps';

export type DuplicateAction = 'create_new' | 'use_template' | 'update_existing' | 'add_to_stock';

export interface DuplicateCandidate {
  item: InventoryItem;
  score: number;
  /** 0–100 display confidence */
  confidence: number;
  reason: string;
}

/**
 * Rank likely duplicates for the name being typed while adding a new item.
 * High score = likely the same product already in inventory.
 */
export function findDuplicateCandidates(
  items: InventoryItem[],
  name: string,
  excludeId?: string,
  limit = 5
): DuplicateCandidate[] {
  const q = name.trim();
  if (q.length < 3) return [];

  const qLower = q.toLowerCase();
  const activeStatuses = new Set([
    ItemStatus.IN_STOCK,
    ItemStatus.ORDERED,
    ItemStatus.IN_COMPOSITION,
  ]);

  return items
    .filter((i) => i.id !== excludeId && !i.isDraft && !i.isPC && !i.isBundle)
    .map((item) => {
      const exact = item.name.trim().toLowerCase() === qLower;
      const sim = nameSimilarity(q, item.name);
      let score = sim;
      if (exact) score = 1;
      else if (item.name.toLowerCase().includes(qLower) || qLower.includes(item.name.toLowerCase())) {
        score = Math.max(score, 0.72);
      }
      if (activeStatuses.has(item.status)) score += 0.05;
      if (item.quantity != null && item.quantity > 1) score += 0.02;

      let reason = 'Similar name';
      if (exact) reason = 'Exact name match';
      else if (score >= 0.75) reason = 'Very similar name';
      else if (item.subCategory) reason = `${item.subCategory} · similar name`;

      return {
        item,
        score,
        confidence: Math.round(Math.min(1, score) * 100),
        reason,
      };
    })
    .filter((x) => x.score >= 0.45)
    .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name))
    .slice(0, limit);
}
