/**
 * Conservative local guard for the Cloud Storage Always Free operation pool.
 *
 * New `*.firebasestorage.app` buckets use Google Cloud Storage quotas. The
 * no-cost Class A allowance is 5,000 operations per month in eligible US
 * regions. Reserve most of that pool for a second device and untracked service
 * operations by allowing this device 2,000 uploads per Pacific month.
 */
const STORAGE_UPLOADS_KEY = 'deinv_storage_uploads_v1';
export const STORAGE_CLIENT_MONTHLY_UPLOAD_BUDGET = 2_000;

type MonthUploads = { month: string; uploads: number };

function pacificMonthKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value || '1970';
  const month = parts.find((part) => part.type === 'month')?.value || '01';
  return `${year}-${month}`;
}

function readUploads(): MonthUploads {
  const month = pacificMonthKey();
  try {
    const raw = localStorage.getItem(STORAGE_UPLOADS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as MonthUploads;
      if (parsed?.month === month) {
        return { month, uploads: Math.max(0, Number(parsed.uploads) || 0) };
      }
    }
  } catch {
    /* Browser storage unavailable; individual uploads can still continue. */
  }
  return { month, uploads: 0 };
}

export function assertStorageUploadBudget(uploads = 1): void {
  const requested = Math.max(0, Math.floor(uploads));
  const current = readUploads();
  if (current.uploads + requested <= STORAGE_CLIENT_MONTHLY_UPLOAD_BUDGET) return;

  const error = new Error(
    'Firebase Storage free-tier safety limit reached on this device. ' +
      'New uploads are paused until the monthly quota resets.'
  ) as Error & { code?: string };
  error.code = 'storage/client-free-tier-budget';
  throw error;
}

export function recordStorageUploads(uploads = 1): void {
  const requested = Math.max(0, Math.floor(uploads));
  if (!requested) return;
  const current = readUploads();
  current.uploads += requested;
  try {
    localStorage.setItem(STORAGE_UPLOADS_KEY, JSON.stringify(current));
  } catch {
    /* Ignore telemetry failure. */
  }
}
