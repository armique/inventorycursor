export type DealwatchVerdictKind = 'bought' | 'expensive' | 'fake' | 'gone';

export type DealwatchVerdict = {
  id: string;
  title: string;
  filter: string;
  verdict: DealwatchVerdictKind;
  askPrice?: number;
  createdAt: string;
};

const KEY = 'dealwatch_verdicts_v1';

export function loadDealwatchVerdicts(): DealwatchVerdict[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as DealwatchVerdict[]) : [];
    return Array.isArray(parsed) ? parsed.slice(0, 200) : [];
  } catch {
    return [];
  }
}

export function saveDealwatchVerdict(entry: Omit<DealwatchVerdict, 'id' | 'createdAt'>): DealwatchVerdict[] {
  const next: DealwatchVerdict = {
    ...entry,
    id: `dwv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: new Date().toISOString(),
  };
  const list = [next, ...loadDealwatchVerdicts()].slice(0, 200);
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* quota */
  }
  return list;
}

export type FilterHitRate = {
  filter: string;
  total: number;
  bought: number;
  skip: number;
  buyRate: number;
};

export function dealwatchFilterHitRates(list: DealwatchVerdict[]): FilterHitRate[] {
  const map = new Map<string, FilterHitRate>();
  for (const row of list) {
    const key = (row.filter || 'unlabeled').trim() || 'unlabeled';
    const cur = map.get(key) || { filter: key, total: 0, bought: 0, skip: 0, buyRate: 0 };
    cur.total += 1;
    if (row.verdict === 'bought') cur.bought += 1;
    else cur.skip += 1;
    map.set(key, cur);
  }
  return Array.from(map.values())
    .map((r) => ({ ...r, buyRate: r.total ? r.bought / r.total : 0 }))
    .sort((a, b) => b.total - a.total);
}
