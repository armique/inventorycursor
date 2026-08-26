const STORAGE_KEY = 'order_matcher_ignored_v1';

function readSet(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((k): k is string => typeof k === 'string' && k.length > 0));
  } catch {
    return new Set();
  }
}

function writeSet(keys: Set<string>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...keys]));
}

export function getOrderMatcherIgnoredKeys(): Set<string> {
  return readSet();
}

export function isOrderMatcherIgnored(key: string): boolean {
  return readSet().has(key);
}

export function ignoreOrderMatcherKey(key: string): void {
  const next = readSet();
  next.add(key);
  writeSet(next);
}

export function unignoreOrderMatcherKey(key: string): void {
  const next = readSet();
  next.delete(key);
  writeSet(next);
}

export function clearOrderMatcherIgnored(): void {
  localStorage.removeItem(STORAGE_KEY);
}
