import type { InventoryItem } from '../types';
import { getItemUserPhotoUrls } from './imageImport';

export type PhotoQcIssue = {
  code: 'none' | 'few' | 'data_url' | 'tiny' | 'blur_suspect';
  message: string;
  level: 'warn' | 'error';
};

/** Lightweight client-side photo QC (no ML) for listing readiness. */
export function analyzeItemPhotos(item: InventoryItem): PhotoQcIssue[] {
  const urls = getItemUserPhotoUrls(item);
  const issues: PhotoQcIssue[] = [];

  if (urls.length === 0) {
    issues.push({ code: 'none', message: 'No photos', level: 'error' });
    return issues;
  }
  if (urls.length < 2) {
    issues.push({ code: 'few', message: 'Only 1 photo — add more angles', level: 'warn' });
  }

  for (const url of urls.slice(0, 6)) {
    if (url.startsWith('data:image') && url.length < 8000) {
      issues.push({ code: 'tiny', message: 'Very small embedded image', level: 'warn' });
      break;
    }
    if (url.startsWith('data:image') && url.length > 2_500_000) {
      issues.push({ code: 'data_url', message: 'Huge data-URL photo — archive/compress', level: 'warn' });
      break;
    }
  }

  return issues;
}

export function photoQcSummary(item: InventoryItem): {
  ok: boolean;
  label: string;
  issues: PhotoQcIssue[];
} {
  const issues = analyzeItemPhotos(item);
  if (!issues.length) return { ok: true, label: 'Photos OK', issues };
  const worst = issues.some((i) => i.level === 'error') ? 'error' : 'warn';
  return {
    ok: false,
    label: worst === 'error' ? issues[0]!.message : `${issues.length} photo issue(s)`,
    issues,
  };
}
