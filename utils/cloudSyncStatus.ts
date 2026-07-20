/**
 * Cloud sync badge copy — local edits are safe immediately; "Synced" only after cloud ack.
 */

export type CloudSyncStatus = 'idle' | 'pending' | 'syncing' | 'success' | 'error';

export type CloudSyncBadgeState = {
  status: CloudSyncStatus;
  message?: string;
  lastSynced?: Date | null;
};

export const SYNC_MSG_PENDING = 'Saved locally · syncing…';
export const SYNC_MSG_UPLOADING = 'Saving to cloud…';
export const SYNC_MSG_SYNCED = 'Synced';
export const SYNC_MSG_RETRYING = 'Saved locally · retrying…';
export const SYNC_MSG_ERROR = 'Sync failed — click to retry';

export function formatSyncedClock(date: Date | null | undefined): string {
  if (!date) return SYNC_MSG_SYNCED;
  try {
    return `Synced ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } catch {
    return SYNC_MSG_SYNCED;
  }
}

/** Short label for the floating sync badge (desktop + mobile). */
export function cloudSyncBadgeLabel(state: CloudSyncBadgeState): string {
  switch (state.status) {
    case 'pending':
      return state.message?.trim() || SYNC_MSG_PENDING;
    case 'syncing':
      return state.message?.trim() || SYNC_MSG_UPLOADING;
    case 'success':
      if (state.message?.trim() && state.message !== 'Live' && state.message !== 'Saved') {
        return state.message.trim();
      }
      return formatSyncedClock(state.lastSynced ?? null);
    case 'error':
      return state.message?.trim() || SYNC_MSG_ERROR;
    default:
      return '';
  }
}

/** Tooltip / title text for the badge. */
export function cloudSyncBadgeTitle(state: CloudSyncBadgeState): string | undefined {
  if (state.status === 'error') {
    return state.message?.trim() || SYNC_MSG_ERROR;
  }
  if (state.status === 'pending') {
    return 'Changes are on this device. Uploading to cloud shortly.';
  }
  if (state.status === 'syncing') {
    return 'Uploading inventory to cloud…';
  }
  if (state.lastSynced) {
    try {
      return `Last synced ${state.lastSynced.toLocaleTimeString()}`;
    } catch {
      return 'Cloud sync OK';
    }
  }
  return undefined;
}
