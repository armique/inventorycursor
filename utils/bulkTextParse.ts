/**
 * Helpers for bulk paste: defect keywords (multilingual) and "N working, M defekt" splits.
 */

const DEFECT_KEYWORD_RE =
  /defekt\w*|defectiv\w*|\bdefect\w*\b|not\s+working|does\s+not\s+work|doesn'?t\s+work|не\s*работа\w*|неисправ\w*|kaputt|\bbroken\b|for\s*parts|ersatzteile|без\s*функц\w*|не\s*працю\w*|non\s*fonction\w*|d[eé]fectueux|defectuos[oa]|guasto|non\s*funzion/i;

const WORKING_WORD =
  'working|ok|good|works?|funktion(?:iert|ieren)?|arbeit(?:et|en)?|работа(?:ют|ет)?|працю(?:є|ють)?|fonctionne(?:nt)?|funziona(?:nte)?';
const DEFECT_WORD =
  'defekt\\w*|defect\\w*|broken|kaputt|не\\s*работа\\w*|неисправ\\w*|not\\s*working|for\\s*parts|ersatzteile|не\\s*працю\\w*|non\\s*fonction\\w*|d[eé]fectueux|defectuos[oa]|guasto';

const SPLIT_WORKING_FIRST = new RegExp(
  `(\\d+)\\s*(?:${WORKING_WORD})\\s*[,;/&+]?\\s*(\\d+)\\s*(?:${DEFECT_WORD})`,
  'i'
);
const SPLIT_DEFECT_FIRST = new RegExp(
  `(\\d+)\\s*(?:${DEFECT_WORD})\\s*[,;/&+]?\\s*(\\d+)\\s*(?:${WORKING_WORD})`,
  'i'
);

const CONDITION_PAREN_RE = new RegExp(
  `\\(\\s*\\d+\\s*(?:${WORKING_WORD}|${DEFECT_WORD})[^)]*\\)`,
  'gi'
);

export function lineHasDefectKeyword(text: string): boolean {
  return DEFECT_KEYWORD_RE.test(text || '');
}

export function parseWorkingDefectSplit(
  text: string
): { working: number; defective: number } | null {
  const raw = (text || '').trim();
  if (!raw) return null;

  let m = raw.match(SPLIT_WORKING_FIRST);
  if (m) {
    return {
      working: Math.max(0, parseInt(m[1]!, 10) || 0),
      defective: Math.max(0, parseInt(m[2]!, 10) || 0),
    };
  }

  m = raw.match(SPLIT_DEFECT_FIRST);
  if (m) {
    return {
      defective: Math.max(0, parseInt(m[1]!, 10) || 0),
      working: Math.max(0, parseInt(m[2]!, 10) || 0),
    };
  }

  return null;
}

/** Remove "(2 working, 2 defekt)"-style notes from a product name. */
export function stripConditionAnnotations(name: string): string {
  return (name || '')
    .replace(CONDITION_PAREN_RE, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+,/g, ',')
    .trim();
}

/**
 * Decide how many working vs defective rows to create for a purchase quantity.
 * When split numbers don't cover qty, leftover rows are treated as working
 * unless the line only has a general defect keyword (no split).
 */
export function resolveDefectCounts(
  quantity: number,
  text: string,
  aiIsDefective?: boolean
): { working: number; defective: number } {
  const qty = Math.max(1, Math.floor(quantity) || 1);
  const split = parseWorkingDefectSplit(text);

  if (split) {
    let defective = Math.min(qty, split.defective);
    let working = Math.min(qty - defective, split.working);
    const leftover = qty - working - defective;
    if (leftover > 0) working += leftover;
    return { working, defective };
  }

  const allDefective = !!aiIsDefective || lineHasDefectKeyword(text);
  return allDefective ? { working: 0, defective: qty } : { working: qty, defective: 0 };
}

export function formatDefectSplitNote(working: number, defective: number): string {
  if (defective <= 0 && working <= 0) return '';
  if (defective > 0 && working > 0) return `${working} working, ${defective} defekt`;
  if (defective > 0) return `${defective} defekt`;
  return '';
}
