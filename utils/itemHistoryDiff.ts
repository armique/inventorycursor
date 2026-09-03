import type { InventoryItem, ActionHistoryEntry } from '../types';
import { ItemStatus } from '../types';
import { diffStates, getActiveOperation, stampOperationFields } from '../services/actionHistoryOps';

export type ItemHistoryActionType =
  | 'created'
  | 'buy_price_changed'
  | 'sell_price_changed'
  | 'status_changed'
  | 'bundle_created'
  | 'bundle_split'
  | 'added_to_bundle'
  | 'removed_from_bundle'
  | 'ebay_linked'
  | 'ebay_unlinked'
  | 'customer_set'
  | 'condition_changed'
  | 'photos_updated'
  | 'general_edit';

export interface ItemFieldDiff {
  field: string;
  from: any;
  to: any;
  label?: string;
}

export interface ItemHistoryEntry {
  id: string;
  timestamp: string;
  action: ItemHistoryActionType;
  title: string;
  details?: string;
  actor?: 'manual' | 'ai' | 'system';
  diffs?: ItemFieldDiff[];
}

function formatEur(n: number | undefined): string {
  if (n == null || isNaN(n)) return '€0.00';
  return `€${Number(n).toFixed(2)}`;
}

/**
 * Computes deep structured diff between oldItem and newItem
 */
export function computeItemHistoryDiff(
  oldItem: InventoryItem | undefined,
  newItem: InventoryItem,
  customActionNote?: { action?: string; details?: string }
): {
  historyEntry: ItemHistoryEntry;
  actionEntry: ActionHistoryEntry;
} {
  const now = new Date().toISOString();
  const diffs: ItemFieldDiff[] = [];
  let action: ItemHistoryActionType = 'general_edit';
  let title = customActionNote?.action || 'Item updated';
  const detailParts: string[] = [];

  if (customActionNote?.details) {
    detailParts.push(customActionNote.details);
  }

  // 1. Creation
  if (!oldItem) {
    action = 'created';
    title = 'Item created';
    const initDetails = `EK: ${formatEur(newItem.buyPrice)}, VK: ${formatEur(newItem.sellPrice)}, Status: ${newItem.status}`;
    const full = diffStates(null, {
      id: newItem.id,
      name: newItem.name,
      buyPrice: newItem.buyPrice,
      sellPrice: newItem.sellPrice,
      status: newItem.status,
      parentContainerId: newItem.parentContainerId ?? null,
      componentIds: newItem.componentIds || [],
    }, { fullSnapshot: true });
    return {
      historyEntry: {
        id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: now,
        action: 'created',
        title: 'Item created',
        details: initDetails,
        actor: 'manual',
      },
      actionEntry: stampOperationFields({
        id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: now,
        action: 'Item created',
        actionType: 'created',
        itemId: newItem.id,
        itemName: newItem.name || 'Unnamed item',
        details: initDetails,
        notes: initDetails,
        previousState: full.previous_state,
        newState: full.new_state,
        relatedItemIds: [],
      }),
    };
  }

  // 2. Buy Price Changes
  if (oldItem.buyPrice !== newItem.buyPrice) {
    const diff = Number(newItem.buyPrice || 0) - Number(oldItem.buyPrice || 0);
    const sign = diff >= 0 ? '+' : '';
    diffs.push({
      field: 'buyPrice',
      from: oldItem.buyPrice,
      to: newItem.buyPrice,
      label: `Buy Price: ${formatEur(oldItem.buyPrice)} → ${formatEur(newItem.buyPrice)} (${sign}${formatEur(diff)})`,
    });
    action = 'buy_price_changed';
    title = `Buy price changed: ${formatEur(oldItem.buyPrice)} → ${formatEur(newItem.buyPrice)}`;
    detailParts.push(`EK changed by ${sign}${formatEur(diff)}`);
  }

  // 3. Sell Price Changes
  if (oldItem.sellPrice !== newItem.sellPrice) {
    const diff = Number(newItem.sellPrice || 0) - Number(oldItem.sellPrice || 0);
    const sign = diff >= 0 ? '+' : '';
    diffs.push({
      field: 'sellPrice',
      from: oldItem.sellPrice,
      to: newItem.sellPrice,
      label: `Sell Price: ${formatEur(oldItem.sellPrice)} → ${formatEur(newItem.sellPrice)} (${sign}${formatEur(diff)})`,
    });
    if (action === 'general_edit') {
      action = 'sell_price_changed';
      title = `Sell price changed: ${formatEur(oldItem.sellPrice)} → ${formatEur(newItem.sellPrice)}`;
    }
    detailParts.push(`VK changed by ${sign}${formatEur(diff)}`);
  }

  // 4. Status Changes
  if (oldItem.status !== newItem.status) {
    diffs.push({
      field: 'status',
      from: oldItem.status,
      to: newItem.status,
      label: `Status: ${oldItem.status} → ${newItem.status}`,
    });
    action = 'status_changed';
    title = `Status changed: ${oldItem.status} → ${newItem.status}`;
    detailParts.push(`Status: ${oldItem.status} → ${newItem.status}`);
  }

  // 5. Bundle & Split Changes
  if (oldItem.parentContainerId !== newItem.parentContainerId) {
    if (newItem.parentContainerId) {
      action = 'added_to_bundle';
      title = 'Added to PC / Bundle';
      diffs.push({
        field: 'parentContainerId',
        from: oldItem.parentContainerId,
        to: newItem.parentContainerId,
        label: 'Added to bundle',
      });
      detailParts.push(`Parent container set to ${newItem.parentContainerId}`);
    } else {
      action = 'removed_from_bundle';
      title = 'Removed from Bundle / Returned to Stock';
      diffs.push({
        field: 'parentContainerId',
        from: oldItem.parentContainerId,
        to: undefined,
        label: 'Removed from bundle',
      });
      detailParts.push('Standalone stock item');
    }
  }

  if (oldItem.isBundle !== newItem.isBundle || oldItem.isPC !== newItem.isPC) {
    if (newItem.isBundle || newItem.isPC) {
      action = 'bundle_created';
      title = newItem.isPC ? 'Turned into PC Build' : 'Turned into Bundle';
      detailParts.push(`Components count: ${newItem.componentIds?.length || 0}`);
    }
  }

  // 6. eBay Order Linking
  if (oldItem.ebayOrderId !== newItem.ebayOrderId) {
    if (newItem.ebayOrderId) {
      action = 'ebay_linked';
      title = `Linked to eBay Order: ${newItem.ebayOrderId}`;
      diffs.push({
        field: 'ebayOrderId',
        from: oldItem.ebayOrderId,
        to: newItem.ebayOrderId,
        label: `eBay Order: ${newItem.ebayOrderId}`,
      });
      detailParts.push(`Order ID: ${newItem.ebayOrderId}`);
    } else {
      action = 'ebay_unlinked';
      title = `Unlinked from eBay Order (was ${oldItem.ebayOrderId})`;
      detailParts.push('Removed eBay order link');
    }
  }

  // 7. Customer assignment
  if (JSON.stringify(oldItem.customer) !== JSON.stringify(newItem.customer)) {
    if (newItem.customer?.name && newItem.customer.name !== oldItem.customer?.name) {
      action = 'customer_set';
      title = `Buyer assigned: ${newItem.customer.name}`;
      detailParts.push(`Customer: ${newItem.customer.name}`);
    }
  }

  // 8. OVP & Accessories Condition
  if (oldItem.hasOVP !== newItem.hasOVP) {
    diffs.push({
      field: 'hasOVP',
      from: oldItem.hasOVP,
      to: newItem.hasOVP,
      label: `OVP: ${oldItem.hasOVP ? 'Yes' : 'No'} → ${newItem.hasOVP ? 'Yes' : 'No'}`,
    });
    detailParts.push(`OVP: ${newItem.hasOVP ? 'Present' : 'Missing'}`);
  }
  if (oldItem.hasIOShield !== newItem.hasIOShield) {
    diffs.push({
      field: 'hasIOShield',
      from: oldItem.hasIOShield,
      to: newItem.hasIOShield,
      label: `IO Shield: ${oldItem.hasIOShield ? 'Yes' : 'No'} → ${newItem.hasIOShield ? 'Yes' : 'No'}`,
    });
    detailParts.push(`IO Shield: ${newItem.hasIOShield ? 'Present' : 'Missing'}`);
  }
  if (oldItem.isDefective !== newItem.isDefective) {
    action = 'condition_changed';
    title = newItem.isDefective ? 'Marked defective / for parts' : 'Cleared defective flag';
    diffs.push({
      field: 'isDefective',
      from: oldItem.isDefective,
      to: newItem.isDefective,
      label: `Defective: ${oldItem.isDefective ? 'Yes' : 'No'} → ${newItem.isDefective ? 'Yes' : 'No'}`,
    });
    detailParts.push(title);
  }

  // 9. Name or Category Edit
  if (oldItem.name !== newItem.name) {
    diffs.push({ field: 'name', from: oldItem.name, to: newItem.name });
    detailParts.push(`Renamed from "${oldItem.name}"`);
  }
  if (oldItem.category !== newItem.category || oldItem.subCategory !== newItem.subCategory) {
    diffs.push({
      field: 'category',
      from: `${oldItem.category}/${oldItem.subCategory || ''}`,
      to: `${newItem.category}/${newItem.subCategory || ''}`,
    });
    detailParts.push(`Category: ${newItem.category}${newItem.subCategory ? ` · ${newItem.subCategory}` : ''}`);
  }

  // 10. Notes / Comments
  if (oldItem.comment1 !== newItem.comment1 || oldItem.comment2 !== newItem.comment2) {
    detailParts.push('Notes updated');
  }

  const finalDetails = detailParts.join(' · ') || 'Details modified';
  const moneyDiff = diffStates(
    {
      buyPrice: oldItem.buyPrice,
      sellPrice: oldItem.sellPrice,
      status: oldItem.status,
      parentContainerId: oldItem.parentContainerId ?? null,
      componentIds: oldItem.componentIds || [],
      isDefective: Boolean(oldItem.isDefective),
      name: oldItem.name,
    },
    {
      buyPrice: newItem.buyPrice,
      sellPrice: newItem.sellPrice,
      status: newItem.status,
      parentContainerId: newItem.parentContainerId ?? null,
      componentIds: newItem.componentIds || [],
      isDefective: Boolean(newItem.isDefective),
      name: newItem.name,
    }
  );
  const op = getActiveOperation();

  return {
    historyEntry: {
      id: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: now,
      action,
      title: customActionNote?.action || title,
      details: finalDetails,
      actor: 'manual',
      diffs: diffs.length > 0 ? diffs : undefined,
    },
    actionEntry: stampOperationFields({
      id: `act-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: now,
      action: customActionNote?.action || title,
      actionType: action,
      itemId: newItem.id,
      itemName: newItem.name || 'Unnamed item',
      details: finalDetails,
      notes: finalDetails,
      previousState: moneyDiff.previous_state,
      newState: moneyDiff.new_state,
      relatedItemIds: [],
      operationId: op?.operationId,
      operationLabel: op?.operationLabel,
    }),
  };
}

/**
 * Appends a new history entry to the item's history array (capped at last 100 entries).
 */
export function appendItemHistoryEntry(
  item: InventoryItem,
  entry: ItemHistoryEntry
): InventoryItem {
  const existing = Array.isArray(item.history) ? item.history : [];
  return {
    ...item,
    history: [entry, ...existing].slice(0, 100),
  };
}
