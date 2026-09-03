import type { BackupData } from './fullBackupExport';
import { defaultBackupFileName, downloadFullBackupJson } from './fullBackupExport';

const SESSION_FLAG = 'deinventory_close_backup_done_v1';

/** Once per browser session — avoid duplicate downloads when switching tabs. */
export function closeSessionBackupAlreadyRan(): boolean {
  try {
    return sessionStorage.getItem(SESSION_FLAG) === '1';
  } catch {
    return false;
  }
}

function markCloseSessionBackupRan(): void {
  try {
    sessionStorage.setItem(SESSION_FLAG, '1');
  } catch {
    /* ignore */
  }
}

/**
 * Download a timestamped JSON backup when the user closes the app.
 * In local dev, also writes a copy to `data/session-backups/` via the dev API.
 */
export async function runCloseSessionBackup(backup: BackupData): Promise<'ok' | 'skipped'> {
  if (closeSessionBackupAlreadyRan()) return 'skipped';

  const fileName = defaultBackupFileName(new Date(backup.exportedAt || Date.now()));
  downloadFullBackupJson(backup, { fileName });

  if (import.meta.env.DEV) {
    try {
      await fetch('/api/supabase-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'session-backup', fileName, backup }),
      });
    } catch {
      /* dev-only — download still succeeded */
    }
  }

  markCloseSessionBackupRan();
  return 'ok';
}
