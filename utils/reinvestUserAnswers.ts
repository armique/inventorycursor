/**
 * Persist answers to Reinvent clarifying questions so we don't re-ask every visit.
 */
const STORAGE_KEY = 'reinvest_user_answers_v1';

export type ReinvestAnswerValue = string | boolean | number;

export type ReinvestUserAnswers = Record<string, ReinvestAnswerValue>;

export function loadReinvestUserAnswers(): ReinvestUserAnswers {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as ReinvestUserAnswers;
  } catch {
    return {};
  }
}

export function saveReinvestUserAnswer(id: string, value: ReinvestAnswerValue): ReinvestUserAnswers {
  const next = { ...loadReinvestUserAnswers(), [id]: value };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* quota */
  }
  return next;
}

export function clearReinvestUserAnswer(id: string): ReinvestUserAnswers {
  const next = { ...loadReinvestUserAnswers() };
  delete next[id];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* quota */
  }
  return next;
}
