import type { DashboardPreferences, DashboardTask } from '../types';
import { DEFAULT_DASHBOARD_WIDGET_IDS } from './constants';

const DEFAULT_TASKS: DashboardTask[] = [
  { id: '1', text: 'Check eBay for new deals', completed: false },
  { id: '2', text: 'Update sold listings', completed: true },
];

export function getDefaultDashboardPreferences(): DashboardPreferences {
  return {
    widgets: [...DEFAULT_DASHBOARD_WIDGET_IDS],
    tasks: DEFAULT_TASKS.map((t) => ({ ...t })),
    timeFilter: 'ALL',
    customStart: '',
    customEnd: '',
  };
}

/** Normalize unknown JSON from Firestore or backup. */
export function normalizeDashboardPreferences(raw: unknown): DashboardPreferences {
  const d = getDefaultDashboardPreferences();
  if (!raw || typeof raw !== 'object') return d;
  const o = raw as Record<string, unknown>;

  if (Array.isArray(o.widgets)) {
    const valid = o.widgets.filter((id): id is string => typeof id === 'string' && DEFAULT_DASHBOARD_WIDGET_IDS.includes(id as (typeof DEFAULT_DASHBOARD_WIDGET_IDS)[number]));
    const missing = DEFAULT_DASHBOARD_WIDGET_IDS.filter((id) => !valid.includes(id));
    d.widgets = [...valid, ...missing];
  }

  if (Array.isArray(o.tasks)) {
    const tasks: DashboardTask[] = [];
    for (const t of o.tasks) {
      if (!t || typeof t !== 'object') continue;
      const x = t as Record<string, unknown>;
      if (typeof x.id !== 'string' || typeof x.text !== 'string') continue;
      tasks.push({
        id: x.id,
        text: x.text,
        completed: Boolean(x.completed),
      });
    }
    if (tasks.length) d.tasks = tasks;
  }

  if (typeof o.timeFilter === 'string') d.timeFilter = o.timeFilter;
  if (typeof o.customStart === 'string') d.customStart = o.customStart;
  if (typeof o.customEnd === 'string') d.customEnd = o.customEnd;

  return d;
}

export function loadDashboardPreferencesFromLocalStorage(): DashboardPreferences {
  let widgets = [...DEFAULT_DASHBOARD_WIDGET_IDS];
  const savedW = localStorage.getItem('dashboard_widgets');
  if (savedW) {
    try {
      const parsed = JSON.parse(savedW) as string[];
      if (Array.isArray(parsed)) {
        const valid = parsed.filter((id): id is string =>
          typeof id === 'string' && DEFAULT_DASHBOARD_WIDGET_IDS.includes(id as (typeof DEFAULT_DASHBOARD_WIDGET_IDS)[number])
        );
        const missing = DEFAULT_DASHBOARD_WIDGET_IDS.filter((id) => !valid.includes(id));
        widgets = [...valid, ...missing];
      }
    } catch {
      /* keep default */
    }
  }

  let tasks = getDefaultDashboardPreferences().tasks;
  const savedT = localStorage.getItem('dashboard_tasks');
  if (savedT) {
    try {
      const parsed = JSON.parse(savedT) as DashboardTask[];
      if (Array.isArray(parsed) && parsed.length) {
        tasks = parsed
          .filter((t) => t && typeof t.id === 'string' && typeof t.text === 'string')
          .map((t) => ({ ...t, completed: Boolean(t.completed) }));
      }
    } catch {
      /* keep default */
    }
  }

  const timeFilter = localStorage.getItem('dashboard_time_filter') || 'ALL';
  const customStart = localStorage.getItem('dashboard_custom_start') || '';
  const customEnd = localStorage.getItem('dashboard_custom_end') || '';

  return { widgets, tasks, timeFilter, customStart, customEnd };
}

export function persistDashboardPreferencesToLocalStorage(p: DashboardPreferences): void {
  localStorage.setItem('dashboard_widgets', JSON.stringify(p.widgets));
  localStorage.setItem('dashboard_tasks', JSON.stringify(p.tasks));
  localStorage.setItem('dashboard_time_filter', p.timeFilter);
  localStorage.setItem('dashboard_custom_start', p.customStart);
  localStorage.setItem('dashboard_custom_end', p.customEnd);
}
