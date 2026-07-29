/**
 * AI attribution session.
 *
 * The panel cannot tell browser automation apart from the owner's own clicks — both go
 * through the same UI. So the assistant explicitly opens a session before it starts
 * editing and closes it afterwards; every write that lands in `handleUpdate` while a
 * session is open is attributed to the AI and diffed into the `ai_actions` log.
 *
 * Bridge for the assistant (see `installAiBridge`):
 *   window.deinventory.ai.beginSession({ context: 'Kleinanzeigen chat with Felix M., 23.07.2026' })
 *   … normal UI interactions …
 *   window.deinventory.ai.endSession()
 *
 * Safety rails: the session is persisted (automation may trigger full page loads) but
 * expires on its own after AI_SESSION_MAX_IDLE_MS, so a forgotten session can never
 * silently mislabel the owner's manual edits days later.
 */

const STORAGE_KEY = 'ai_session_v1';

/** A session with no activity for this long is treated as closed. */
export const AI_SESSION_MAX_IDLE_MS = 30 * 60 * 1000;

/** Fired whenever the session starts, stops, or its context changes. */
export const AI_SESSION_EVENT = 'ai-session-changed';

export interface AiSessionState {
  sessionId: string;
  /** Where the data came from — copied onto every action logged in this session. */
  context: string;
  startedAt: string;
  /** Touched on every logged action; drives idle expiry. */
  lastActivityAt: string;
  /** How many AI actions were logged so far in this session. */
  actionCount: number;
}

let memSession: AiSessionState | null = null;
let memLoaded = false;

function emitChange(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(AI_SESSION_EVENT));
}

function persist(session: AiSessionState | null): void {
  memSession = session;
  memLoaded = true;
  try {
    if (typeof localStorage === 'undefined') return;
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore quota / private-mode errors */
  }
}

function isExpired(session: AiSessionState): boolean {
  const last = Date.parse(session.lastActivityAt || session.startedAt);
  if (!Number.isFinite(last)) return true;
  return Date.now() - last > AI_SESSION_MAX_IDLE_MS;
}

function readStored(): AiSessionState | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AiSessionState>;
    if (!parsed?.sessionId || !parsed.startedAt) return null;
    return {
      sessionId: String(parsed.sessionId),
      context: String(parsed.context || ''),
      startedAt: String(parsed.startedAt),
      lastActivityAt: String(parsed.lastActivityAt || parsed.startedAt),
      actionCount: Number(parsed.actionCount) || 0,
    };
  } catch {
    return null;
  }
}

/** Current session, or null when the AI is not actively editing. */
export function getAiSession(): AiSessionState | null {
  if (!memLoaded) {
    memSession = readStored();
    memLoaded = true;
  }
  if (memSession && isExpired(memSession)) {
    persist(null);
    emitChange();
    return null;
  }
  return memSession;
}

/** True while writes should be attributed to the AI. */
export function isAiSessionActive(): boolean {
  return getAiSession() !== null;
}

/** Context string to stamp on actions logged right now (empty when no session). */
export function getAiSessionContext(): string {
  return getAiSession()?.context || '';
}

export interface BeginAiSessionOptions {
  /** Short note on where the data comes from — shown verbatim in the "Done by AI" feed. */
  context?: string;
}

export function beginAiSession(options?: BeginAiSessionOptions): AiSessionState {
  const now = new Date().toISOString();
  const existing = getAiSession();
  // Re-entering an open session just refreshes the context instead of splitting the run.
  const session: AiSessionState = existing
    ? {
        ...existing,
        context: options?.context ?? existing.context,
        lastActivityAt: now,
      }
    : {
        sessionId: `ais-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        context: options?.context || '',
        startedAt: now,
        lastActivityAt: now,
        actionCount: 0,
      };
  persist(session);
  emitChange();
  return session;
}

export function endAiSession(): void {
  if (!getAiSession()) return;
  persist(null);
  emitChange();
}

/** Update the source context mid-session (e.g. moving to a different chat). */
export function setAiSessionContext(context: string): void {
  const session = getAiSession();
  if (!session) return;
  persist({ ...session, context: context || '', lastActivityAt: new Date().toISOString() });
  emitChange();
}

/** Called by the action log after each recorded action — keeps the session alive. */
export function noteAiSessionActivity(count = 1): void {
  const session = getAiSession();
  if (!session) return;
  persist({
    ...session,
    lastActivityAt: new Date().toISOString(),
    actionCount: session.actionCount + count,
  });
  emitChange();
}

/**
 * Run `fn` attributed to the AI even when no session is open — used by programmatic
 * entry points. Restores the previous session state afterwards.
 */
export function withAiAttribution<T>(context: string, fn: () => T): T {
  const previous = getAiSession();
  beginAiSession({ context });
  try {
    return fn();
  } finally {
    if (!previous) endAiSession();
    else persist({ ...previous, lastActivityAt: new Date().toISOString() });
  }
}

export interface AiBridgeStatus {
  active: boolean;
  sessionId: string | null;
  context: string;
  startedAt: string | null;
  actionCount: number;
}

function status(): AiBridgeStatus {
  const session = getAiSession();
  return {
    active: Boolean(session),
    sessionId: session?.sessionId ?? null,
    context: session?.context || '',
    startedAt: session?.startedAt ?? null,
    actionCount: session?.actionCount ?? 0,
  };
}

/**
 * Expose the bridge on `window.deinventory.ai`. Called once from the panel shell.
 * Extra methods (item/inbox helpers) can be merged in by other modules via `extend`.
 */
export function installAiBridge(): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as { deinventory?: Record<string, unknown> };
  const root = (w.deinventory ||= {});
  const existing = (root.ai as Record<string, unknown>) || {};
  root.ai = {
    ...existing,
    version: 1,
    beginSession: (options?: BeginAiSessionOptions) => {
      beginAiSession(options);
      return status();
    },
    endSession: () => {
      endAiSession();
      return status();
    },
    setContext: (context: string) => {
      setAiSessionContext(context);
      return status();
    },
    isActive: () => isAiSessionActive(),
    status,
  };
}

/** Merge extra methods into window.deinventory.ai (used by the action log / inbox). */
export function extendAiBridge(methods: Record<string, unknown>): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as { deinventory?: Record<string, unknown> };
  const root = (w.deinventory ||= {});
  root.ai = { ...((root.ai as Record<string, unknown>) || {}), ...methods };
}
