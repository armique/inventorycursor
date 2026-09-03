import type { BusinessSettings, Expense, InventoryItem } from '../types';

type PanelSearchSnapshot = {
  items: InventoryItem[];
  expenses: Expense[];
  businessSettings: BusinessSettings;
};

const DEFAULT_BUSINESS_SETTINGS: BusinessSettings = {
  companyName: '',
  ownerName: '',
  address: '',
  phone: '',
  taxId: '',
  iban: '',
  bic: '',
  bankName: '',
  taxMode: 'SmallBusiness',
};

let snapshot: PanelSearchSnapshot = {
  items: [],
  expenses: [],
  businessSettings: DEFAULT_BUSINESS_SETTINGS,
};

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

/** Push latest inventory data for GlobalSearch without re-rendering the panel shell. */
export function publishPanelSearchData(next: Partial<PanelSearchSnapshot>): void {
  const merged = { ...snapshot, ...next };
  if (
    merged.items === snapshot.items &&
    merged.expenses === snapshot.expenses &&
    merged.businessSettings === snapshot.businessSettings
  ) {
    return;
  }
  snapshot = merged;
  emit();
}

export function subscribePanelSearchData(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

export function getPanelSearchSnapshot(): PanelSearchSnapshot {
  return snapshot;
}
