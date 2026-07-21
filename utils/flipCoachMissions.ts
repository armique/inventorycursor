/**
 * Flip Coach daily missions — interactive “do these 3 today” loop.
 * Progress is local (listed / skipped); missions are rebuilt from live stock.
 */

import type { InventoryItem } from '../types';
import {
  buildSellNowQueue,
  type FlipFeeSettings,
  type SellNowRow,
} from './flipCoach';

export const FLIP_MISSION_STORAGE_KEY = 'flip_coach_missions_v1';

export type MissionAction = 'listed' | 'skipped';

export type MissionLogEntry = {
  itemId: string;
  action: MissionAction;
  /** YYYY-MM-DD (local) */
  day: string;
  at: string;
  channel?: string;
};

export type DailyMission = SellNowRow & {
  missionId: string;
  done: boolean;
  action?: MissionAction;
};

export type MissionProgress = {
  day: string;
  completedToday: number;
  targetToday: number;
  weekCompleted: number;
  weekTarget: number;
  streakDays: number;
};

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Local calendar day key. */
export function localDayKey(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Monday-start ISO-ish week key for scoring. */
export function localWeekKey(d = new Date()): string {
  const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (day.getDay() + 6) % 7; // Mon=0
  day.setDate(day.getDate() - dow);
  return localDayKey(day);
}

export function loadMissionLog(): MissionLogEntry[] {
  try {
    const raw = localStorage.getItem(FLIP_MISSION_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => x && x.itemId && x.day) : [];
  } catch {
    return [];
  }
}

export function saveMissionLog(entries: MissionLogEntry[]): void {
  localStorage.setItem(FLIP_MISSION_STORAGE_KEY, JSON.stringify(entries.slice(0, 400)));
}

export function recordMissionAction(
  itemId: string,
  action: MissionAction,
  channel?: string
): MissionLogEntry[] {
  const day = localDayKey();
  const prev = loadMissionLog().filter((e) => !(e.itemId === itemId && e.day === day));
  const next = [
    { itemId, action, day, at: new Date().toISOString(), channel },
    ...prev,
  ];
  saveMissionLog(next);
  return next;
}

function daysInCurrentWeek(): string[] {
  const now = new Date();
  const dow = (now.getDay() + 6) % 7;
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dow);
  const out: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    out.push(localDayKey(d));
  }
  return out;
}

/** Consecutive days (ending today or yesterday) with ≥1 listed action. */
export function computeListStreak(log: MissionLogEntry[]): number {
  const listedDays = new Set(
    log.filter((e) => e.action === 'listed').map((e) => e.day)
  );
  let streak = 0;
  const cursor = new Date();
  // Allow streak to continue if today has no listing yet but yesterday did
  if (!listedDays.has(localDayKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }
  for (;;) {
    const key = localDayKey(cursor);
    if (!listedDays.has(key)) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
    if (streak > 60) break;
  }
  return streak;
}

export function getMissionProgress(log: MissionLogEntry[], targetToday = 3): MissionProgress {
  const day = localDayKey();
  const weekDays = new Set(daysInCurrentWeek());
  const completedToday = log.filter((e) => e.day === day && e.action === 'listed').length;
  const weekCompleted = log.filter(
    (e) => weekDays.has(e.day) && e.action === 'listed'
  ).length;
  return {
    day,
    completedToday,
    targetToday,
    weekCompleted,
    weekTarget: targetToday * 5, // aim for 5 active sell days
    streakDays: computeListStreak(log),
  };
}

/**
 * Build today's missions from sell queue, skipping items already listed/skipped today.
 */
export function buildDailyMissions(
  items: InventoryItem[],
  fees: FlipFeeSettings,
  log: MissionLogEntry[] = loadMissionLog(),
  limit = 3
): DailyMission[] {
  const day = localDayKey();
  const doneToday = new Map(
    log.filter((e) => e.day === day).map((e) => [e.itemId, e.action] as const)
  );
  const queue = buildSellNowQueue(items, fees, 40);
  const missions: DailyMission[] = [];

  for (const row of queue) {
    if (doneToday.has(row.item.id)) continue;
    missions.push({
      ...row,
      missionId: `${day}:${row.item.id}`,
      done: false,
    });
    if (missions.length >= limit) break;
  }

  // If fewer than limit available, show already-completed ones at the end for context
  if (missions.length < limit) {
    for (const row of queue) {
      const action = doneToday.get(row.item.id);
      if (!action) continue;
      missions.push({
        ...row,
        missionId: `${day}:${row.item.id}`,
        done: true,
        action,
      });
      if (missions.length >= limit) break;
    }
  }

  return missions;
}

export function channelLabel(
  channel: SellNowRow['preferredChannel']
): string {
  if (channel === 'kleinanzeigen.de') return 'Kleinanzeigen';
  if (channel === 'ebay.de') return 'eBay';
  return 'Klein or eBay';
}

/** Short reply scripts for practice / copy. */
export function getSellScripts(channel: SellNowRow['preferredChannel']): Array<{
  id: string;
  title: string;
  body: string;
}> {
  const klein = [
    {
      id: 'ka-first',
      title: 'First reply (Klein)',
      body: 'Hallo, ja noch da. Abholung heute/morgen möglich. Preis ist fest — gerne melden wann Sie kommen können.',
    },
    {
      id: 'ka-hold',
      title: 'Price hold',
      body: 'Danke für die Nachfrage. Unter dem Preis verkaufe ich nicht — bei Interesse gerne vorbeikommen.',
    },
    {
      id: 'ka-close',
      title: 'Closer',
      body: 'Letzter Preis für schnelle Abholung heute. Wenn es passt, schicken Sie mir bitte eine Uhrzeit.',
    },
  ];
  const ebay = [
    {
      id: 'ebay-title',
      title: 'Listing habit',
      body: 'Title = exact model first (e.g. ASUS Dual RTX 3060 12GB). Photos clear. Price from Flip Coach eBay list.',
    },
    {
      id: 'ebay-ads',
      title: 'Ads rule',
      body: 'Only promote if pocket profit still clears your minimum after ads %. Thin margin → Klein instead.',
    },
  ];
  if (channel === 'ebay.de') return ebay;
  if (channel === 'kleinanzeigen.de') return klein;
  return [...klein.slice(0, 2), ebay[0]];
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }
}
