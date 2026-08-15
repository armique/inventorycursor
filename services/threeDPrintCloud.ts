import {
  loadFilamentStockFull,
  replaceFilamentStock,
  type FilamentStockState,
} from './filamentStock';
import {
  loadThreeDPrintSettings,
  normalizeThreeDPrintSettings,
  saveThreeDPrintSettings,
  type ThreeDPrintCalculatorSettings,
} from './threeDPrintDefaults';

export const THREE_D_PRINT_CLOUD_KEY = 'three_d_print_cloud_v1';

export type ThreeDPrintCloudState = {
  calculator: ThreeDPrintCalculatorSettings;
  filamentStock: FilamentStockState;
  updatedAt: string;
};

function emptyCloud(): ThreeDPrintCloudState {
  return {
    calculator: normalizeThreeDPrintSettings(undefined),
    filamentStock: { spools: [], updatedAt: new Date().toISOString() },
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeThreeDPrintCloud(raw: unknown): ThreeDPrintCloudState {
  if (!raw || typeof raw !== 'object') return emptyCloud();
  const row = raw as Partial<ThreeDPrintCloudState>;
  const filamentStock: FilamentStockState = {
    spools: Array.isArray(row.filamentStock?.spools) ? row.filamentStock.spools : [],
    updatedAt: row.filamentStock?.updatedAt || row.updatedAt || new Date().toISOString(),
  };
  return {
    calculator: normalizeThreeDPrintSettings(row.calculator),
    filamentStock,
    updatedAt: typeof row.updatedAt === 'string' && row.updatedAt ? row.updatedAt : new Date().toISOString(),
  };
}

export function composeThreeDPrintCloudFromLocal(): ThreeDPrintCloudState {
  try {
    const raw = localStorage.getItem(THREE_D_PRINT_CLOUD_KEY);
    if (raw) return normalizeThreeDPrintCloud(JSON.parse(raw));
  } catch {
    /* ignore */
  }
  return {
    calculator: loadThreeDPrintSettings(),
    filamentStock: loadFilamentStockFull(),
    updatedAt: new Date().toISOString(),
  };
}

export function persistThreeDPrintCloudState(state: ThreeDPrintCloudState): ThreeDPrintCloudState {
  const next = normalizeThreeDPrintCloud({
    ...state,
    updatedAt: state.updatedAt || new Date().toISOString(),
  });
  try {
    localStorage.setItem(THREE_D_PRINT_CLOUD_KEY, JSON.stringify(next));
  } catch {
    /* quota */
  }
  saveThreeDPrintSettings(next.calculator, { silent: true });
  replaceFilamentStock(next.filamentStock);
  return next;
}

export function snapshotThreeDPrintCloudNow(): ThreeDPrintCloudState {
  const next: ThreeDPrintCloudState = {
    calculator: loadThreeDPrintSettings(),
    filamentStock: loadFilamentStockFull(),
    updatedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(THREE_D_PRINT_CLOUD_KEY, JSON.stringify(next));
  } catch {
    /* quota */
  }
  return next;
}

export function mergeThreeDPrintCloud(
  remote: unknown,
  local: ThreeDPrintCloudState,
): { state: ThreeDPrintCloudState; localNewer: boolean } {
  if (remote == null) return { state: local, localNewer: true };
  const rem = normalizeThreeDPrintCloud(remote);
  if (rem.updatedAt && local.updatedAt && rem.updatedAt < local.updatedAt) {
    return { state: local, localNewer: true };
  }
  return { state: rem, localNewer: false };
}
