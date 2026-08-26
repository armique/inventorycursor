import { mergeEbayTxReports } from '../utils/ebayTransactionReport';
import { todayLocalDateKey } from '../utils/calendarDate';
import {
  buildEbayTxReportListCsv,
  EBAY_ABRECHNUNG_BACKUP_FILE_NAME,
  saveEbayTxCsvBackupToProject,
} from '../utils/ebayTxReportCsvExport';
import {
  loadEbayTransactionLibrary,
  loadEbayTxLabelOverrides,
} from './ebayTransactionReportStore';

const LAST_RUN_KEY = 'ebay-tx-daily-export-day-v1';

export type EbayTxDailyExportResult =
  | { ran: false; reason: 'already-today' | 'empty' | 'dev-only' | 'offline' }
  | { ran: true; fileName: string; rowCount: number; bytes: number; coverage: string };

function isDevServer(): boolean {
  return import.meta.env.DEV;
}

export async function runEbayTxDailyCsvExport(options?: {
  force?: boolean;
  day?: string;
}): Promise<EbayTxDailyExportResult> {
  if (!isDevServer()) {
    return { ran: false, reason: 'dev-only' };
  }

  const day = options?.day || todayLocalDateKey();
  if (!options?.force) {
    try {
      if (localStorage.getItem(LAST_RUN_KEY) === day) {
        return { ran: false, reason: 'already-today' };
      }
    } catch {
      /* ignore */
    }
  }

  const [library, labelOverrides] = await Promise.all([
    loadEbayTransactionLibrary(),
    loadEbayTxLabelOverrides(),
  ]);
  const { rowCount, coverage } = buildEbayTxReportListCsv(library.reports, labelOverrides);
  if (!rowCount) {
    return { ran: false, reason: 'empty' };
  }

  const merged = mergeEbayTxReports(library.reports);
  const rows = (merged?.rows || []).filter((row) => row.source !== 'inventory');
  const result = await saveEbayTxCsvBackupToProject(rows, labelOverrides, { coverage });
  if (result.saved === false) {
    if (result.reason === 'dev-only') return { ran: false, reason: 'dev-only' };
    if (result.reason === 'empty') return { ran: false, reason: 'empty' };
    return { ran: false, reason: 'offline' };
  }

  try {
    localStorage.setItem(LAST_RUN_KEY, day);
  } catch {
    /* ignore */
  }
  return {
    ran: true,
    fileName: EBAY_ABRECHNUNG_BACKUP_FILE_NAME,
    rowCount: result.rowCount,
    bytes: result.bytes ?? 0,
    coverage,
  };
}

let exportTimer: ReturnType<typeof setTimeout> | null = null;

/** Debounced export — refreshes today's CSV after imports / label edits. */
export function scheduleEbayTxDailyCsvExport(options?: { force?: boolean; delayMs?: number }) {
  if (!isDevServer()) return;
  if (exportTimer) clearTimeout(exportTimer);
  exportTimer = setTimeout(() => {
    exportTimer = null;
    void runEbayTxDailyCsvExport({ force: options?.force ?? true });
  }, options?.delayMs ?? 1200);
}
