/**
 * Firestore real-time sync for DeInventory Pro.
 *
 * Inventory/trash are sharded across multiple documents under `users/{uid}/syncPack/*`
 * so total data is not limited by Firestore’s ~1 MiB **per-document** cap. Legacy
 * `users/{uid}/inventory/data` is still read until the first sharded write migrates it.
 */

import { initializeApp, getApps, getApp, FirebaseApp } from "firebase/app";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  getDoc,
  setDoc,
  addDoc,
  updateDoc,
  collection,
  getDocs,
  writeBatch,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  Unsubscribe,
  Firestore,
  QuerySnapshot,
} from "firebase/firestore";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  signInWithCredential,
  getRedirectResult,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  inMemoryPersistence,
  connectAuthEmulator,
  User,
  Auth,
} from "firebase/auth";
import { connectFirestoreEmulator } from "firebase/firestore";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  listAll,
  deleteObject,
  connectStorageEmulator,
  type FirebaseStorage,
} from "firebase/storage";
import { yieldToMain } from "./backgroundPersistence";
import type { GeneratedProductCardEntry } from "../types";
import { recordFirestoreDeletes, recordFirestoreWrites } from "./firestoreOpsCounter";

// --- CONFIG ---

/** Built-in config so the app works without entering credentials each time. */
const DEFAULT_FIREBASE_CONFIG: FirebaseConfig = {
  apiKey: "AIzaSyA1KbcJ1oI0g7WBqplaiRoLttr4TkgR9XY",
  authDomain: "inventorycursor-e9000.firebaseapp.com",
  projectId: "inventorycursor-e9000",
  storageBucket: "inventorycursor-e9000.firebasestorage.app",
  messagingSenderId: "844355746831",
  appId: "1:844355746831:web:41b3829c7de55eeadd777a",
};

/** Firebase Hosting helper origin (proxied from the app domain for mobile redirect auth). */
export const FIREBASE_AUTH_HELPER_HOST = "inventorycursor-e9000.firebaseapp.com";

/**
 * Use the current app host as authDomain only when doing full-page redirect auth
 * AND `/__/auth` is proxied on that host. Default stays on *.firebaseapp.com —
 * custom authDomain was breaking post-login for GIS / popup sessions on Vercel.
 */
export function resolveAuthDomain(fallback = FIREBASE_AUTH_HELPER_HOST): string {
  return fallback || FIREBASE_AUTH_HELPER_HOST;
}

export interface FirebaseConfig {
  apiKey: string;
  authDomain?: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
}

export function getFirebaseConfig(): FirebaseConfig | null {
  try {
    const saved = localStorage.getItem("firebase_client_config");
    const base = saved
      ? (JSON.parse(saved) as FirebaseConfig)
      : DEFAULT_FIREBASE_CONFIG;
    if (!base?.apiKey || !base?.projectId) return DEFAULT_FIREBASE_CONFIG;
    return {
      ...base,
      // Always prefer same-origin authDomain when the host is proxied (see vercel.json / vite proxy).
      authDomain: resolveAuthDomain(base.authDomain || FIREBASE_AUTH_HELPER_HOST),
    };
  } catch {
    return {
      ...DEFAULT_FIREBASE_CONFIG,
      authDomain: resolveAuthDomain(DEFAULT_FIREBASE_CONFIG.authDomain),
    };
  }
}

export function saveFirebaseConfig(config: FirebaseConfig): void {
  localStorage.setItem("firebase_client_config", JSON.stringify(config));
  window.location.reload();
}

export function isCloudEnabled(): boolean {
  const c = getFirebaseConfig();
  return !!(c?.apiKey && c?.projectId);
}

export function setCloudEnabled(enabled: boolean): void {
  if (!enabled) {
    localStorage.removeItem("firebase_client_config");
    window.location.reload();
  }
}

// --- INIT ---

let app: FirebaseApp | null = null;
let db: Firestore | null = null;
let auth: Auth | null = null;
let storage: FirebaseStorage | null = null;
const authPersistenceSetup = new WeakMap<Auth, Promise<void>>();

/**
 * Prefer a durable session, but never make sign-in depend on browser storage.
 * Mobile private modes and full localStorage quotas can make Firebase's local
 * persistence throw QuotaExceededError. Session or memory persistence still
 * lets the user sign in and use the app.
 */
function ensureAuthPersistence(authInstance: Auth): Promise<void> {
  const existing = authPersistenceSetup.get(authInstance);
  if (existing) return existing;

  const setup = (async () => {
    try {
      await setPersistence(authInstance, browserLocalPersistence);
      return;
    } catch (err) {
      console.warn("[firebase] Local auth persistence unavailable; trying session storage.", err);
    }

    try {
      await setPersistence(authInstance, browserSessionPersistence);
      return;
    } catch (err) {
      console.warn("[firebase] Session auth persistence unavailable; using memory.", err);
    }

    await setPersistence(authInstance, inMemoryPersistence);
  })();
  authPersistenceSetup.set(authInstance, setup);
  return setup;
}

/**
 * True only for a local dev server started with VITE_FIREBASE_EMULATOR=1.
 * `import.meta.env.DEV` is statically false in a production build, so Vite drops
 * the emulator branch entirely — a deployed bundle can never point at localhost.
 */
export function isUsingFirebaseEmulator(): boolean {
  return Boolean(import.meta.env.DEV && import.meta.env.VITE_FIREBASE_EMULATOR);
}

function init(): { db: Firestore; auth: Auth; storage: FirebaseStorage } | null {
  if (db && auth && storage) return { db, auth, storage };

  const config = getFirebaseConfig();
  if (!config?.apiKey || !config?.projectId) return null;

  try {
    app = getApps().length ? getApp() : initializeApp(config);
    try {
      // Persist Firestore's local cache to IndexedDB so a reconnect (reopening the app,
      // switching tabs, coming back online) resumes from disk instead of re-reading every
      // synced collection from the server — the multi-device "always synced" goal burns
      // through the free-tier read quota fast without this. Falls back to memory-only
      // (previous behavior) when IndexedDB isn't available (e.g. some private-browsing modes).
      db = initializeFirestore(app, {
        localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      });
    } catch (persistErr) {
      console.warn("[firebase] Persistent local cache unavailable, falling back to memory-only:", persistErr);
      db = getFirestore(app);
    }
    auth = getAuth(app);
    // Persist Google session across Safari/Chrome restarts (phones). Without this, every
    // panel visit can look signed-out. Fall back safely when mobile storage is blocked/full.
    void ensureAuthPersistence(auth).catch((err) => {
      console.warn("[firebase] Auth persistence unavailable:", err);
    });
    // Force correct bucket (Firebase default is now .firebasestorage.app, not .appspot.com)
    const bucket = config.projectId === "inventorycursor-e9000"
      ? "inventorycursor-e9000.firebasestorage.app"
      : config.storageBucket;
    storage = bucket ? getStorage(app, bucket) : getStorage(app);

    if (isUsingFirebaseEmulator()) {
      // Must run before any read/write on each handle. The SDK throws if a handle
      // was already used against production, so this stays inside the same init().
      connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
      connectFirestoreEmulator(db, "127.0.0.1", 8080);
      connectStorageEmulator(storage, "127.0.0.1", 9199);
      console.info("[firebase] Using local emulators — no production data is touched.");
    }

    return db && auth && storage ? { db, auth, storage } : null;
  } catch (err) {
    console.error("Firebase init error:", err);
    return null;
  }
}

/** Shared Firebase handles for feature modules (photo upload sessions, etc.). */
export function getFirebaseContext(): { db: Firestore; auth: Auth; storage: FirebaseStorage } | null {
  return init();
}

// --- AUTH ---

export function getAuthErrorMessage(err: unknown): string {
  const code = (err as { code?: string })?.code || '';
  const message = (err as { message?: string })?.message || String(err);
  if (code === 'auth/unauthorized-domain') {
    const host = typeof window !== 'undefined' ? window.location.hostname : 'this domain';
    return `Sign-in blocked for ${host}. In Firebase Console → Authentication → Settings → Authorized domains, add ${host}.`;
  }
  if (code === 'auth/popup-blocked') {
    return 'Popup blocked by the browser. Trying redirect sign-in…';
  }
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return 'Sign-in popup was closed before completing.';
  }
  if (code === 'auth/network-request-failed') {
    return 'Network error during sign-in. Check your connection and try again.';
  }
  if (
    code === 'auth/quota-exceeded' ||
    (err as { name?: string })?.name === 'QuotaExceededError' ||
    /the quota has been exceeded|quotaexceedederror/i.test(message)
  ) {
    return 'This browser blocked the storage needed for Google sign-in. Close private browsing or free some browser storage, then try again.';
  }
  if (code === 'auth/too-many-requests') {
    return 'Too many sign-in attempts from this device. Wait a few minutes, then try again.';
  }
  if (
    /redirect_uri_mismatch/i.test(message) ||
    (/invalid.?request/i.test(message) && /redirect/i.test(message))
  ) {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'https://armiktech.com';
    return `Google rejected the sign-in return URL. In Google Cloud Console → APIs & Services → Credentials → your OAuth 2.0 Web client, add Authorized redirect URI: ${origin}/__/auth/handler`;
  }
  return message || 'Sign-in failed.';
}

/** sessionStorage key for post-OAuth return path (panel or phone upload). */
export const AUTH_RETURN_PATH_KEY = 'deinventory_auth_return';
/** Set before redirect so we can show an error if the return has no session. */
export const AUTH_REDIRECT_PENDING_KEY = 'deinventory_auth_redirect_pending';

/** Phones/tablets: Google popup auth is unreliable — use full-page redirect. */
export function prefersRedirectSignIn(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod|Android/i.test(ua)) return true;
  // iPadOS 13+ often reports as MacIntel with touch
  if (navigator.platform === 'MacIntel' && Number(navigator.maxTouchPoints || 0) > 1) return true;
  return false;
}

function rememberAuthReturnPath(explicit?: string): void {
  try {
    const path = (explicit || `${window.location.pathname}${window.location.search}${window.location.hash}`).trim();
    const safe =
      path.startsWith('/panel') || path.startsWith('/upload/')
        ? path
        : '/panel/dashboard';
    sessionStorage.setItem(AUTH_RETURN_PATH_KEY, safe);
  } catch {
    /* private mode */
  }
}

function markRedirectPending(): void {
  try {
    sessionStorage.setItem(AUTH_REDIRECT_PENDING_KEY, '1');
  } catch {
    /* ignore */
  }
}

export function consumeRedirectPending(): boolean {
  try {
    const pending = sessionStorage.getItem(AUTH_REDIRECT_PENDING_KEY) === '1';
    sessionStorage.removeItem(AUTH_REDIRECT_PENDING_KEY);
    return pending;
  } catch {
    return false;
  }
}

export function consumeAuthReturnPath(): string | null {
  try {
    const path = sessionStorage.getItem(AUTH_RETURN_PATH_KEY);
    sessionStorage.removeItem(AUTH_RETURN_PATH_KEY);
    if (path && (path.startsWith('/panel') || path.startsWith('/upload/'))) return path;
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Sign in with Google via popup. Returns the user when complete.
 */
export async function signInWithGooglePopup(): Promise<User> {
  const ctx = init();
  if (!ctx?.auth) throw new Error("Firebase not configured. Check Settings.");
  await ensureAuthPersistence(ctx.auth);
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(ctx.auth, provider);
  return result.user;
}

/** Fallback if Identity Toolkit is unreachable (must match Google Cloud → Web client). */
const GOOGLE_WEB_CLIENT_ID_FALLBACK =
  "844355746831-1ljb175ft765o296ujle2871hd1fv1cv.apps.googleusercontent.com";

let cachedGoogleWebClientId: string | null = null;

/** Resolve the Firebase-registered Google OAuth web client id (avoids hardcoded typos). */
export async function resolveGoogleWebClientId(): Promise<string> {
  if (cachedGoogleWebClientId) return cachedGoogleWebClientId;
  const config = getFirebaseConfig();
  const apiKey = config?.apiKey;
  if (!apiKey) return GOOGLE_WEB_CLIENT_ID_FALLBACK;

  try {
    const origin =
      typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : "https://armiktech.com";
    const res = await fetch(
      `https://www.googleapis.com/identitytoolkit/v3/relyingparty/createAuthUri?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: "google.com", continueUri: origin }),
      }
    );
    const data = (await res.json().catch(() => ({}))) as { authUri?: string };
    const match = String(data.authUri || "").match(/client_id=([^&]+)/i);
    if (match?.[1]) {
      cachedGoogleWebClientId = decodeURIComponent(match[1]);
      return cachedGoogleWebClientId;
    }
  } catch (err) {
    console.warn("[auth] Could not resolve Google client id from Firebase; using fallback.", err);
  }
  cachedGoogleWebClientId = GOOGLE_WEB_CLIENT_ID_FALLBACK;
  return cachedGoogleWebClientId;
}

/** @deprecated use resolveGoogleWebClientId() — kept for older imports */
export const GOOGLE_WEB_CLIENT_ID = GOOGLE_WEB_CLIENT_ID_FALLBACK;

type GisTokenClient = {
  requestAccessToken: (override?: { prompt?: string }) => void;
};

type GisId = {
  initialize: (config: {
    client_id: string;
    callback: (response: { credential: string }) => void;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
    context?: string;
    ux_mode?: 'popup' | 'redirect';
  }) => void;
  prompt: (momentListener?: (notification: {
    isNotDisplayed: () => boolean;
    isSkippedMoment: () => boolean;
    isDismissedMoment: () => boolean;
    getNotDisplayedReason?: () => string;
    getSkippedReason?: () => string;
  }) => void) => void;
  renderButton: (
    parent: HTMLElement,
    options: {
      type?: string;
      theme?: string;
      size?: string;
      text?: string;
      shape?: string;
      width?: number;
    }
  ) => void;
  cancel: () => void;
};

type GisOauth2 = {
  initTokenClient: (config: {
    client_id: string;
    scope: string;
    callback: (response: { access_token?: string; error?: string; error_description?: string }) => void;
    error_callback?: (err: { type?: string; message?: string }) => void;
  }) => GisTokenClient;
};

function getGisApi(): { id?: GisId; oauth2?: GisOauth2 } | null {
  const g = (window as unknown as { google?: { accounts?: { id?: GisId; oauth2?: GisOauth2 } } }).google;
  return g?.accounts ?? null;
}

function loadGoogleIdentityServices(): Promise<{ id?: GisId; oauth2?: GisOauth2 }> {
  const existing = getGisApi();
  if (existing?.id || existing?.oauth2) return Promise.resolve(existing);

  return new Promise((resolve, reject) => {
    const prev = document.querySelector<HTMLScriptElement>('script[data-gis="1"]');
    const done = () => {
      const api = getGisApi();
      if (api?.id || api?.oauth2) resolve(api!);
      else reject(new Error("Google sign-in script loaded but API is missing."));
    };
    if (prev) {
      prev.addEventListener("load", done);
      prev.addEventListener("error", () => reject(new Error("Failed to load Google sign-in script.")));
      // Script may already be loaded (index.html).
      if (getGisApi()?.id || getGisApi()?.oauth2) done();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.dataset.gis = "1";
    script.onload = done;
    script.onerror = () => reject(new Error("Failed to load Google sign-in script."));
    document.head.appendChild(script);
  });
}

function showGoogleButtonOverlay(): { host: HTMLElement; cleanup: () => void } {
  const host = document.createElement("div");
  host.setAttribute("data-gis-overlay", "1");
  host.style.cssText =
    "position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,0.55);padding:16px;";
  host.innerHTML = `
    <div style="background:#fff;border-radius:20px;padding:24px;max-width:360px;width:100%;text-align:center;font-family:system-ui,sans-serif;box-shadow:0 20px 50px rgba(0,0,0,.25)">
      <p style="margin:0 0 8px;font-weight:800;font-size:18px;color:#0f172a">Continue with Google</p>
      <p style="margin:0 0 20px;font-size:13px;font-weight:600;color:#64748b">Tap the button below to finish signing in.</p>
      <div data-gis-btn style="display:flex;justify-content:center;min-height:44px"></div>
      <button type="button" data-gis-cancel style="margin-top:16px;border:0;background:transparent;color:#64748b;font-weight:700;font-size:12px;cursor:pointer">Cancel</button>
    </div>
  `;
  document.body.appendChild(host);
  const cleanup = () => {
    host.remove();
  };
  return { host, cleanup };
}

/**
 * Mobile-safe Google sign-in via Google Identity Services (ID token → Firebase).
 * Prefers GIS ID credential; falls back to access-token client if needed.
 */
async function signInWithGoogleIdentityServices(auth: Auth): Promise<User> {
  const [gis, clientId] = await Promise.all([
    loadGoogleIdentityServices(),
    resolveGoogleWebClientId(),
  ]);

  // Preferred: ID token (JWT) from Google Identity Services.
  if (gis.id) {
    return new Promise<User>((resolve, reject) => {
      let settled = false;
      let cleanupOverlay: (() => void) | null = null;
      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        cleanupOverlay?.();
        try {
          gis.id?.cancel();
        } catch {
          /* ignore */
        }
        fn();
      };

      gis.id!.initialize({
        client_id: clientId,
        auto_select: false,
        cancel_on_tap_outside: true,
        callback: (response) => {
          void (async () => {
            try {
              if (!response?.credential) {
                finish(() => reject(new Error("Google did not return an ID token.")));
                return;
              }
              const credential = GoogleAuthProvider.credential(response.credential);
              const result = await signInWithCredential(auth, credential);
              finish(() => resolve(result.user));
            } catch (err) {
              finish(() => reject(err));
            }
          })();
        },
      });

      const showButtonFallback = () => {
        const { host, cleanup } = showGoogleButtonOverlay();
        cleanupOverlay = cleanup;
        const btnParent = host.querySelector<HTMLElement>("[data-gis-btn]");
        const cancelBtn = host.querySelector<HTMLButtonElement>("[data-gis-cancel]");
        cancelBtn?.addEventListener("click", () => {
          finish(() => reject(new Error("Google sign-in was cancelled.")));
        });
        if (btnParent) {
          gis.id!.renderButton(btnParent, {
            type: "standard",
            theme: "outline",
            size: "large",
            text: "signin_with",
            shape: "pill",
            width: 280,
          });
        }
      };

      try {
        gis.id!.prompt((notification) => {
          if (notification.isNotDisplayed() || notification.isSkippedMoment()) {
            showButtonFallback();
          }
        });
        // If prompt never shows a UI (some mobile browsers), ensure a button appears.
        window.setTimeout(() => {
          if (!settled && !cleanupOverlay) showButtonFallback();
        }, 1200);
      } catch {
        showButtonFallback();
      }
    });
  }

  // Fallback: access token client (older GIS path).
  if (!gis.oauth2) {
    throw new Error("Google sign-in is unavailable in this browser.");
  }
  return new Promise<User>((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    const client = gis.oauth2!.initTokenClient({
      client_id: clientId,
      scope: "openid email profile",
      callback: (response) => {
        void (async () => {
          try {
            if (response.error) {
              finish(() =>
                reject(
                  new Error(response.error_description || response.error || "Google sign-in was cancelled.")
                )
              );
              return;
            }
            if (!response.access_token) {
              finish(() => reject(new Error("Google did not return an access token.")));
              return;
            }
            const credential = GoogleAuthProvider.credential(null, response.access_token);
            const result = await signInWithCredential(auth, credential);
            finish(() => resolve(result.user));
          } catch (err) {
            finish(() => reject(err));
          }
        })();
      },
      error_callback: (err) => {
        finish(() => reject(new Error(err?.message || err?.type || "Google sign-in failed.")));
      },
    });
    try {
      client.requestAccessToken({ prompt: "select_account" });
    } catch (err) {
      finish(() => reject(err instanceof Error ? err : new Error(String(err))));
    }
  });
}

/**
 * Google sign-in through Firebase's provider flow on every device.
 *
 * Do not route phones through the GIS button/One Tap iframe: iOS WebKit can
 * throw QuotaExceededError inside that cross-origin flow even when this app's
 * own storage is available. Firebase popup avoids that iframe; redirect is a
 * last resort only when the browser refuses to open the popup.
 */
export async function signInWithGoogle(options?: { returnPath?: string }): Promise<User | null> {
  const ctx = init();
  if (!ctx?.auth) throw new Error("Firebase not configured. Check Settings.");
  await ensureAuthPersistence(ctx.auth);
  rememberAuthReturnPath(options?.returnPath);

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });

  if (isUsingFirebaseEmulator()) {
    markRedirectPending();
    await signInWithRedirect(ctx.auth, provider);
    return null;
  }

  try {
    const result = await signInWithPopup(ctx.auth, provider);
    return result.user;
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code || "";
    if (code === "auth/unauthorized-domain") throw err;
    if (code === "auth/popup-blocked") {
      markRedirectPending();
      await signInWithRedirect(ctx.auth, provider);
      return null;
    }
    throw err;
  }
}

/**
 * Emulator-only quick sign-in: no OAuth dance, no password that means anything.
 * The Auth Emulator accepts any password for email/password accounts and never talks
 * to real Google, so this just gives the local emulator user a stable identity to sign
 * back into. `isUsingFirebaseEmulator()` (checked here AND by the only caller, the
 * dev-only panel below) is compiled to `false` outside `vite --mode emulator`, so this
 * function — and the block that renders its button — never reach a production bundle.
 */
export async function signInEmulatorWithEmail(email: string): Promise<User> {
  if (!isUsingFirebaseEmulator()) {
    throw new Error("Emulator sign-in only works when running against the local Firebase emulator.");
  }
  const ctx = init();
  if (!ctx?.auth) throw new Error("Firebase not configured.");
  await ensureAuthPersistence(ctx.auth);
  const EMULATOR_PASSWORD = "emulator-local-only"; // meaningless outside the local emulator's throwaway store
  try {
    const result = await signInWithEmailAndPassword(ctx.auth, email, EMULATOR_PASSWORD);
    return result.user;
  } catch (err) {
    const code = (err as { code?: string })?.code || '';
    if (code === 'auth/user-not-found' || code === 'auth/invalid-credential' || code === 'auth/invalid-login-credentials') {
      const result = await createUserWithEmailAndPassword(ctx.auth, email, EMULATOR_PASSWORD);
      return result.user;
    }
    throw err;
  }
}

/**
 * Call once on app boot (any route) to finish a redirect sign-in flow.
 * Must run on `/` too — a misconfigured `/panel` → `/` redirect used to drop
 * OAuth returns on the storefront where PanelLayout never mounted.
 */
export async function completeGoogleRedirectSignIn(): Promise<User | null> {
  const ctx = init();
  if (!ctx?.auth) return null;
  try {
    await ensureAuthPersistence(ctx.auth);
    const result = await getRedirectResult(ctx.auth);
    return result?.user ?? null;
  } catch (err) {
    // GIS / popup sessions often have no redirect result. Never throw here —
    // an alert/crash after a successful Google sign-in is worse than ignoring.
    const code = (err as { code?: string })?.code || "";
    if (
      code === "auth/argument-error" ||
      code === "auth/no-auth-event" ||
      code === "auth/invalid-credential" ||
      /missing initial state|no redirect operation/i.test(String((err as { message?: string })?.message || err))
    ) {
      console.warn("Redirect sign-in: no pending redirect (safe to ignore after GIS/popup)", err);
      return null;
    }
    console.error("Redirect sign-in failed", err);
    // Still don't hard-crash the app shell — PanelLayout can sign in again.
    return null;
  }
}

export async function logOut(): Promise<void> {
  const ctx = init();
  if (ctx?.auth) await signOut(ctx.auth);
}

export function onAuthChange(callback: (user: User | null) => void): () => void {
  const ctx = init();
  if (!ctx?.auth) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(ctx.auth, callback);
}

export function getCurrentUser(): User | null {
  const ctx = init();
  return ctx?.auth?.currentUser ?? null;
}

// --- STORAGE HELPERS (item images) ---

/**
 * Upload a (already resized/compressed) image file for an inventory item to Firebase Storage
 * and return its public download URL. Optional onProgress(0-100) for UI.
 *
 * Path convention: items/{uid}/{itemId}/{timestamp}-{filename}
 */
export async function uploadItemImage(
  file: File,
  itemId: string,
  onProgress?: (percent: number) => void
): Promise<string> {
  const ctx = init();
  const user = ctx?.auth?.currentUser;
  if (!ctx?.storage || !user) {
    throw new Error("Not signed in or Firebase Storage not configured. Please sign in with Google first.");
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  const path = `items/${user.uid}/${itemId || "unknown"}/${Date.now()}-${safeName}`;
  const ref = storageRef(ctx.storage, path);

  const timeoutMs = 90_000; // 90s per image
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(
      "Upload timed out after 90s. Enable Storage in Firebase Console → Build → Storage, then set Rules to allow writes for signed-in users."
    )), timeoutMs)
  );

  try {
    // Simple upload (single PUT) to avoid resumable-upload CORS issues; progress not available
    if (onProgress) onProgress(10); // show we started
    const snapshot = await Promise.race([uploadBytes(ref, file), timeoutPromise]);
    if (onProgress) onProgress(90);
    const url = await Promise.race([getDownloadURL(snapshot.ref), timeoutPromise]);
    if (onProgress) onProgress(100);
    return url;
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (msg.includes("storage/unauthorized") || msg.includes("403") || msg.includes("does not have permission")) {
      throw new Error(
        "Firebase Storage permission denied. In Firebase Console go to Build → Storage → Rules (not Firestore) and set:\n" +
        "  allow read, write: if request.auth != null;\n" +
        "Then deploy rules and try uploading again."
      );
    }
    throw err;
  }
}

/** Upload a compressed JPEG/blob for an inventory item; returns a durable download URL. */
export async function uploadItemImageBlob(
  blob: Blob,
  itemId: string,
  fileName?: string
): Promise<string> {
  const name = (fileName || `photo-${Date.now()}.jpg`).replace(/[^a-zA-Z0-9.\-_]/g, "_");
  const file = new File([blob], name, { type: blob.type || "image/jpeg" });
  return uploadItemImage(file, itemId);
}

/**
 * Upload a high-quality AI product card blob.
 * Path: product-cards/{uid}/{itemId}/{timestamp}-{filename}
 */
export async function uploadProductCardBlob(
  blob: Blob,
  itemId: string,
  fileName?: string
): Promise<string> {
  const ctx = init();
  const user = ctx?.auth?.currentUser;
  if (!ctx?.storage || !user) {
    throw new Error("Not signed in or Firebase Storage not configured.");
  }
  const ext = (blob.type || "").includes("png") ? "png" : "jpg";
  const name = (fileName || `card-${Date.now()}.${ext}`).replace(/[^a-zA-Z0-9.\-_]/g, "_");
  const path = `product-cards/${user.uid}/${itemId || "shared"}/${Date.now()}-${name}`;
  const ref = storageRef(ctx.storage, path);
  const snapshot = await uploadBytes(ref, blob);
  return getDownloadURL(snapshot.ref);
}

/**
 * Upload an invoice / receipt file (image or PDF) for an expense to Firebase Storage
 * and return its public download URL. Optional onProgress(0-100) for UI.
 *
 * Path convention: expenses/{uid}/{expenseId}/{timestamp}-{filename}
 */
export async function uploadExpenseAttachment(
  file: File,
  expenseId: string,
  onProgress?: (percent: number) => void
): Promise<string> {
  const ctx = init();
  const user = ctx?.auth?.currentUser;
  if (!ctx?.storage || !user) {
    throw new Error("Not signed in or Firebase Storage not configured. Please sign in with Google first.");
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  const path = `expenses/${user.uid}/${expenseId || "generic"}/${Date.now()}-${safeName}`;
  const ref = storageRef(ctx.storage, path);

  const timeoutMs = 90_000; // 90s per file
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(
      "Upload timed out after 90s. Enable Storage in Firebase Console → Build → Storage, then set Rules to allow writes for signed-in users."
    )), timeoutMs)
  );

  try {
    if (onProgress) onProgress(10);
    const snapshot = await Promise.race([uploadBytes(ref, file), timeoutPromise]);
    if (onProgress) onProgress(90);
    const url = await Promise.race([getDownloadURL(snapshot.ref), timeoutPromise]);
    if (onProgress) onProgress(100);
    return url;
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (msg.includes("storage/unauthorized") || msg.includes("403") || msg.includes("does not have permission")) {
      throw new Error(
        "Firebase Storage permission denied. In Firebase Console go to Build → Storage → Rules (not Firestore) and set:\n" +
        "  allow read, write: if request.auth != null;\n" +
        "Then deploy rules and try uploading again."
      );
    }
    throw err;
  }
}

/**
 * Upload a proof file (chat screenshot, payment confirmation, receipt…) for one record.
 * Stored under the item tree so the existing `items/{uid}/**` Storage rule covers it.
 */
export async function uploadProofAttachment(
  file: Blob,
  recordId: string,
  fileName: string
): Promise<string> {
  const ctx = init();
  const user = ctx?.auth?.currentUser;
  if (!ctx?.storage || !user) {
    throw new Error("Not signed in or Firebase Storage not configured. Please sign in with Google first.");
  }
  const safeName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, "_") || "proof";
  const safeId = recordId.replace(/[^a-zA-Z0-9.\-_]/g, "_") || "generic";
  const path = `items/${user.uid}/${safeId}/proof/${Date.now()}-${safeName}`;
  const ref = storageRef(ctx.storage, path);

  const timeoutMs = 90_000;
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Proof upload timed out after 90s.")), timeoutMs)
  );
  const snapshot = await Promise.race([uploadBytes(ref, file), timeoutPromise]);
  return Promise.race([getDownloadURL(snapshot.ref), timeoutPromise]);
}

// --- DATA SHAPE (same as app payload) ---

export interface FirestoreInventoryPayload {
  inventory: unknown[];
  trash: unknown[];
  expenses: unknown[];
  recurringExpenses?: unknown[];
  categories?: Record<string, string[]>;
  categoryFields?: Record<string, string[]>;
  settings?: unknown;
  goals?: { monthly?: number };
  /** Dashboard widgets, tasks, time range (DeInventory panel). */
  dashboard?: unknown;
  /** Timestamped audit log (item/expense actions); merged per device like expenses. */
  actionHistory?: unknown[];
  /** Bulk Entry confirm sessions (including AI text parse). */
  bulkImports?: unknown[];
  updatedAt?: string;
  savedBy?: string;
}

/** Max JSON size per shard document (Firestore hard limit ~1 MiB per doc). */
const CHUNK_BODY_MAX = 680 * 1024;

const SYNC_PACK_COLLECTION = "syncPack";

/** Placeholder when large fields are omitted for document size (exported for merge logic). */
export const CLOUD_OMITTED_PLACEHOLDER = "[omitted for size]";

/** Top-level item fields that often hold base64 or huge URLs. */
const LARGE_ITEM_FIELDS = [
  "imageUrl",
  "receiptUrl",
  "kleinanzeigenChatImage",
  "kleinanzeigenBuyChatImage",
  "ebayOrderScreenshotUrl",
] as const;

/** Gallery / multi-image fields (were not trimmed before → common cause of sync failure). */
const LARGE_ITEM_STRING_ARRAYS = ["imageUrls", "storeGalleryUrls"] as const;

function sanitizeForFirestore(obj: unknown): unknown {
  if (obj === undefined) return null;
  if (obj === null) return null;
  if (typeof obj === "number" && (Number.isNaN(obj) || !Number.isFinite(obj))) return null;
  if (Array.isArray(obj)) return obj.map(sanitizeForFirestore);
  if (typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined) continue;
      out[k] = sanitizeForFirestore(v);
    }
    return out;
  }
  return obj;
}

function shouldOmitString(s: string, minLen: number): boolean {
  if (s.length >= minLen) return true;
  if (s.startsWith("data:") && s.length > 120) return true;
  return false;
}

/** Firebase Storage download URLs must never be stripped from Firestore sync. */
function isPersistedFirebaseStorageUrl(s: string): boolean {
  const t = s.trim();
  if (!t.startsWith("https://")) return false;
  if (!t.includes("firebasestorage.googleapis.com") && !t.includes("firebasestorage.app")) return false;
  return t.includes("/items%2F") || t.includes("/items/");
}

function shouldOmitImageFieldValue(s: string, minLen: number): boolean {
  if (isPersistedFirebaseStorageUrl(s)) return false;
  return shouldOmitString(s, minLen);
}

function trimItemForSize(item: unknown): unknown {
  if (!item || typeof item !== "object") return item;
  const o = { ...(item as Record<string, unknown>) };
  for (const key of LARGE_ITEM_FIELDS) {
    const v = o[key];
    if (typeof v === "string" && shouldOmitImageFieldValue(v, 400)) {
      o[key] = CLOUD_OMITTED_PLACEHOLDER;
    }
  }
  for (const arrKey of LARGE_ITEM_STRING_ARRAYS) {
    const arr = o[arrKey];
    if (Array.isArray(arr)) {
      o[arrKey] = arr.map((x) =>
        typeof x === "string" && shouldOmitImageFieldValue(x, 400) ? CLOUD_OMITTED_PLACEHOLDER : x
      );
    }
  }
  for (const textKey of [
    "storeDescription",
    "storeDescriptionEn",
    "storeMetaDescription",
    "marketTitle",
    "marketDescription",
  ] as const) {
    const v = o[textKey];
    if (typeof v === "string" && v.length > 8000) {
      o[textKey] = v.slice(0, 8000) + "...";
    }
  }
  if (typeof o.comment1 === "string" && o.comment1.length > 5000) o.comment1 = o.comment1.slice(0, 5000) + "...";
  if (typeof o.comment2 === "string" && o.comment2.length > 5000) o.comment2 = o.comment2.slice(0, 5000) + "...";
  return o;
}

function trimExpenseForSize(exp: unknown): unknown {
  if (!exp || typeof exp !== "object") return exp;
  const o = { ...(exp as Record<string, unknown>) };
  const url = o.attachmentUrl;
  if (typeof url === "string" && shouldOmitString(url, 400)) {
    o.attachmentUrl = CLOUD_OMITTED_PLACEHOLDER;
  }
  if (typeof o.description === "string" && o.description.length > 4000) {
    o.description = o.description.slice(0, 4000) + "...";
  }
  return o;
}

/**
 * Recursively replace oversized strings (and data: URLs) so nested specs / history cannot blow the 1 MiB doc cap.
 */
function deepTrimLargeStrings(value: unknown, maxLen: number): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (value.startsWith("data:") && value.length > 120) return CLOUD_OMITTED_PLACEHOLDER;
    if (value.length > maxLen) return CLOUD_OMITTED_PLACEHOLDER;
    return value;
  }
  if (Array.isArray(value)) return value.map((x) => deepTrimLargeStrings(x, maxLen));
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      out[k] = deepTrimLargeStrings(v, maxLen);
    }
    return out;
  }
  return value;
}

function jsonByteSize(obj: unknown): number {
  return new Blob([JSON.stringify(obj)]).size;
}

/** Split items into multiple arrays so each `{ items }` document stays under CHUNK_BODY_MAX. */
async function chunkItemsForFirestore(rawItems: unknown[]): Promise<unknown[][]> {
  const chunks: unknown[][] = [];
  let current: unknown[] = [];

  const wrapSize = (arr: unknown[]) => jsonByteSize({ items: arr });
  const YIELD_EVERY = 18;

  for (let index = 0; index < rawItems.length; index++) {
    const raw = rawItems[index];
    let item: unknown = trimItemForSize(sanitizeForFirestore(raw));
    let oneSize = jsonByteSize({ items: [item] });
    let guard = 0;
    const trimSteps = [96_000, 48_000, 16_000, 6000, 2500, 1000, 400, 200, 120];
    while (oneSize > CHUNK_BODY_MAX && guard < trimSteps.length) {
      item = deepTrimLargeStrings(item, trimSteps[guard++]);
      oneSize = jsonByteSize({ items: [item] });
    }
    if (oneSize > CHUNK_BODY_MAX) {
      throw new Error(
        "One row is too large for cloud sync even after shrinking. Remove embedded photos from that item or use image URLs instead of pasted images."
      );
    }

    if (current.length > 0 && wrapSize([...current, item]) > CHUNK_BODY_MAX) {
      chunks.push(current);
      current = [];
    }
    current.push(item);

    if (index > 0 && index % YIELD_EVERY === 0) {
      await yieldToMain();
    }
  }
  if (current.length) chunks.push(current);
  return chunks;
}

function buildCorePayloadForShard(data: FirestoreInventoryPayload): Record<string, unknown> {
  return {
    expenses: (data.expenses || []).map((e) => trimExpenseForSize(sanitizeForFirestore(e))),
    recurringExpenses: (data.recurringExpenses || []).map(sanitizeForFirestore),
    settings: data.settings != null ? sanitizeForFirestore(data.settings) : null,
    goals: data.goals ?? null,
    categories: data.categories ?? {},
    categoryFields: data.categoryFields ?? {},
    dashboard: data.dashboard != null ? sanitizeForFirestore(data.dashboard) : null,
    actionHistory: (data.actionHistory || []).map(sanitizeForFirestore),
    bulkImports: (data.bulkImports || []).map(sanitizeForFirestore),
  };
}

function shrinkCoreUntilUnder(core: Record<string, unknown>, maxBytes: number): Record<string, unknown> {
  let c = { ...core };
  let size = jsonByteSize(c);
  let rounds = 0;
  while (size > maxBytes && rounds < 40) {
    rounds++;
    const ah = c.actionHistory as unknown[] | undefined;
    const bi = c.bulkImports as unknown[] | undefined;
    if (Array.isArray(ah) && ah.length > 25) {
      c = { ...c, actionHistory: ah.slice(-Math.max(25, Math.floor(ah.length * 0.6))) };
    } else if (Array.isArray(bi) && bi.length > 0 && rounds > 8) {
      // Drop bulky chat screenshots from history rows before failing the whole sync pack.
      c = {
        ...c,
        bulkImports: bi.map((row) => {
          if (!row || typeof row !== 'object') return row;
          const rec = row as Record<string, unknown>;
          const img = rec.kleinanzeigenBuyChatImage;
          if (typeof img === 'string' && (img.startsWith('data:') || img.length > 800)) {
            const { kleinanzeigenBuyChatImage: _drop, ...rest } = rec;
            return rest;
          }
          return row;
        }),
      };
    } else {
      c = {
        ...c,
        dashboard: deepTrimLargeStrings(c.dashboard, 1200),
        expenses: Array.isArray(c.expenses)
          ? (c.expenses as unknown[]).map((e) => deepTrimLargeStrings(e, 3000))
          : c.expenses,
      };
    }
    size = jsonByteSize(c);
    if (rounds > 25 && Array.isArray(c.actionHistory)) {
      c = { ...c, actionHistory: (c.actionHistory as unknown[]).slice(-80) };
      size = jsonByteSize(c);
    }
    if (rounds > 30 && Array.isArray(c.bulkImports) && (c.bulkImports as unknown[]).length > 80) {
      c = { ...c, bulkImports: (c.bulkImports as unknown[]).slice(0, 80) };
      size = jsonByteSize(c);
    }
  }
  if (size > maxBytes) {
    throw new Error(
      "Cloud sync: combined settings, expenses, and history are still too large. Try clearing action history (Settings) or removing huge expense attachments."
    );
  }
  return c;
}

function assemblePayloadFromSyncSnapshot(snap: QuerySnapshot): FirestoreInventoryPayload | null {
  if (snap.empty) return null;
  const docs = snap.docs;
  const metaData = docs.find((d) => d.id === "meta")?.data() as Record<string, unknown> | undefined;
  const coreSnap = docs.find((d) => d.id === "core");
  if (!coreSnap) return null;

  const core = coreSnap.data() as Record<string, unknown>;
  const invParts: { n: number; items: unknown[] }[] = [];
  const trashParts: { n: number; items: unknown[] }[] = [];

  for (const d of docs) {
    const id = d.id;
    const row = d.data() as { items?: unknown[] };
    const im = /^i(\d+)$/.exec(id);
    if (im) invParts.push({ n: parseInt(im[1], 10), items: row.items || [] });
    const tm = /^t(\d+)$/.exec(id);
    if (tm) trashParts.push({ n: parseInt(tm[1], 10), items: row.items || [] });
  }
  invParts.sort((a, b) => a.n - b.n);
  trashParts.sort((a, b) => a.n - b.n);

  return {
    inventory: invParts.flatMap((p) => p.items),
    trash: trashParts.flatMap((p) => p.items),
    expenses: (core.expenses as unknown[]) || [],
    recurringExpenses: (core.recurringExpenses as unknown[]) || [],
    categories: (core.categories as Record<string, string[]>) || {},
    categoryFields: (core.categoryFields as Record<string, string[]>) || {},
    settings: core.settings,
    goals: core.goals as { monthly?: number } | undefined,
    dashboard: core.dashboard,
    actionHistory: (core.actionHistory as unknown[]) || [],
    bulkImports: (core.bulkImports as unknown[]) || [],
    updatedAt: metaData?.updatedAt as string | undefined,
    savedBy: metaData?.savedBy as string | undefined,
  };
}

function legacyInventoryDocRef(db: Firestore, uid: string) {
  return doc(db, "users", uid, "inventory", "data");
}

function syncPackCollectionRef(db: Firestore, uid: string) {
  return collection(db, "users", uid, SYNC_PACK_COLLECTION);
}

function remotePackHasInventory(snap: QuerySnapshot): boolean {
  for (const d of snap.docs) {
    if (d.id === 'meta') {
      const chunks = Number((d.data() as { inventoryChunks?: number }).inventoryChunks);
      if (Number.isFinite(chunks) && chunks > 0) return true;
    }
    if (/^i\d+$/.test(d.id)) {
      const items = (d.data() as { items?: unknown[] }).items;
      if (Array.isArray(items) && items.length > 0) return true;
    }
  }
  return false;
}

async function writeShardedSyncPack(
  db: Firestore,
  uid: string,
  data: FirestoreInventoryPayload,
  savedBy: string,
  options?: { allowEmptyOverwrite?: boolean }
): Promise<void> {
  await yieldToMain();
  const colRef = syncPackCollectionRef(db, uid);
  const legacyRef = legacyInventoryDocRef(db, uid);
  const nowIso = new Date().toISOString();

  const invChunks = await chunkItemsForFirestore(data.inventory || []);
  await yieldToMain();
  const trashChunks = await chunkItemsForFirestore(data.trash || []);
  await yieldToMain();
  const corePayload = shrinkCoreUntilUnder(buildCorePayloadForShard(data), CHUNK_BODY_MAX);

  const existingSnap = await getDocs(colRef);
  const incomingInventory = (data.inventory || []).length;
  if (
    incomingInventory === 0 &&
    !options?.allowEmptyOverwrite &&
    remotePackHasInventory(existingSnap)
  ) {
    throw new Error(
      'Refusing to overwrite cloud inventory with an empty device cache. Wait for sync to finish, or open Settings → Force push only if you intentionally cleared stock.'
    );
  }

  const extraDeletes: string[] = [];
  existingSnap.forEach((d) => {
    const id = d.id;
    if (id === "meta" || id === "core") return;
    const im = /^i(\d+)$/.exec(id);
    if (im && parseInt(im[1], 10) >= invChunks.length) extraDeletes.push(id);
    const tm = /^t(\d+)$/.exec(id);
    if (tm && parseInt(tm[1], 10) >= trashChunks.length) extraDeletes.push(id);
  });

  type BatchOp = (b: ReturnType<typeof writeBatch>) => void;
  const ops: BatchOp[] = [];

  ops.push((b) =>
    b.set(doc(colRef, "meta"), {
      schemaVersion: 2,
      inventoryChunks: invChunks.length,
      trashChunks: trashChunks.length,
      updatedAt: nowIso,
      savedBy,
    })
  );
  ops.push((b) => b.set(doc(colRef, "core"), corePayload));
  invChunks.forEach((items, i) => {
    ops.push((b) => b.set(doc(colRef, `i${i}`), { items }));
  });
  trashChunks.forEach((items, i) => {
    ops.push((b) => b.set(doc(colRef, `t${i}`), { items }));
  });
  extraDeletes.forEach((id) => {
    ops.push((b) => b.delete(doc(colRef, id)));
  });
  ops.push((b) => b.delete(legacyRef));

  const BATCH_MAX = 400;
  let batch = writeBatch(db);
  let count = 0;
  for (const op of ops) {
    op(batch);
    count++;
    if (count >= BATCH_MAX) {
      await batch.commit();
      batch = writeBatch(db);
      count = 0;
    }
  }
  if (count > 0) await batch.commit();

  // meta + core + inventory/trash shards count as writes; extras + legacy as deletes
  recordFirestoreWrites(2 + invChunks.length + trashChunks.length);
  recordFirestoreDeletes(extraDeletes.length + 1);
}

// --- REAL-TIME SUBSCRIBE ---

/**
 * Subscribe to sharded sync (`syncPack`) or fall back to legacy single doc until migrated.
 */
export function subscribeToData(
  uid: string,
  onData: (data: FirestoreInventoryPayload | null) => void
): Unsubscribe {
  const ctx = init();
  if (!ctx?.db) {
    onData(null);
    return () => {};
  }

  const db = ctx.db;
  const colRef = syncPackCollectionRef(db, uid);
  const legacyRef = legacyInventoryDocRef(db, uid);

  return onSnapshot(
    colRef,
    (snap) => {
      void (async () => {
        try {
          if (snap.empty) {
            const leg = await getDoc(legacyRef);
            onData(leg.exists() ? (leg.data() as FirestoreInventoryPayload) : null);
            return;
          }
          onData(assemblePayloadFromSyncSnapshot(snap));
        } catch (e) {
          console.error("Firestore sync assemble error:", e);
          onData(null);
        }
      })();
    },
    (err) => {
      console.error("Firestore snapshot error:", err);
      onData(null);
    }
  );
}

/**
 * One-time read (e.g. for boot before subscription is active). Prefer subscribeToData for real-time.
 * Throws on Firestore errors so callers do not treat a failed pull as “empty cloud”.
 */
export async function fetchFromCloud(): Promise<FirestoreInventoryPayload | null> {
  const ctx = init();
  const user = ctx?.auth?.currentUser;
  if (!ctx?.db || !user) return null;

  const colRef = syncPackCollectionRef(ctx.db, user.uid);
  const packSnap = await getDocs(colRef);
  if (!packSnap.empty) {
    return assemblePayloadFromSyncSnapshot(packSnap);
  }
  const leg = await getDoc(legacyInventoryDocRef(ctx.db, user.uid));
  return leg.exists() ? (leg.data() as FirestoreInventoryPayload) : null;
}

/**
 * Normalize Firebase/Firestore errors into a short user-facing message.
 */
function getSyncErrorMessage(err: unknown): string {
  if (!err || typeof err !== "object") return "Write failed";
  const e = err as { code?: string; message?: string };
  switch (e.code) {
    case "permission-denied":
      return "Permission denied. Check Firestore rules.";
    case "resource-exhausted":
      return "Quota exceeded. Wait a bit or check Firebase usage.";
    case "unauthenticated":
      return "Session expired. Sign in again.";
    case "invalid-argument":
      return "Data too large or invalid.";
    case "failed-precondition":
    case "aborted":
      return "Conflict. Try saving again.";
    default:
      return e.message && e.message.length < 80 ? e.message : (e.code || "Write failed");
  }
}

/**
 * Write current app state to Firestore. Call after local changes (debounced in app).
 * Other clients will receive the update via their onSnapshot listener.
 * Throws with a user-friendly message (see getSyncErrorMessage).
 *
 * By default refuses to replace a non-empty cloud inventory with an empty local
 * snapshot (common on a fresh phone before the cloud pull finishes).
 */
export async function writeToCloud(
  data: FirestoreInventoryPayload,
  options?: { allowEmptyOverwrite?: boolean }
): Promise<void> {
  const ctx = init();
  const user = ctx?.auth?.currentUser;
  if (!ctx?.db || !user) throw new Error("Not signed in");

  await yieldToMain();

  try {
    await writeShardedSyncPack(ctx.db, user.uid, data, user.email ?? user.uid, options);
  } catch (err) {
    const msg = err instanceof Error && err.message ? err.message : getSyncErrorMessage(err);
    const wrapped = new Error(msg) as Error & { cause?: unknown };
    wrapped.cause = err;
    throw wrapped;
  }
}

/** Expose for UI to show specific error reason. */
export { getSyncErrorMessage };

// --- STORE CATALOG (public read) ---

const STORE_CATALOG_COLLECTION = "storeCatalog";
const STORE_CATALOG_DOC_ID = "public";

export interface StoreCatalogPayload {
  items: { id: string; name: string; category: string; subCategory?: string; sellPrice?: number; storeSalePrice?: number; storeOnSale?: boolean; storeVisible?: boolean; imageUrl?: string; storeGalleryUrls?: string[]; storeDescription?: string; specs?: Record<string, string | number>; categoryFields?: string[]; badge?: 'New' | 'Price reduced'; storeMetaTitle?: string; storeMetaDescription?: string; storeDescriptionEn?: string; quantity?: number }[];
  updatedAt?: string;
}

/**
 * Subscribe to the public store catalog (no auth required). Used by the storefront page.
 */
export function subscribeToStoreCatalog(onData: (data: StoreCatalogPayload | null) => void): Unsubscribe {
  const ctx = init();
  if (!ctx?.db) {
    onData(null);
    return () => {};
  }
  const docRef = doc(ctx.db, STORE_CATALOG_COLLECTION, STORE_CATALOG_DOC_ID);
  return onSnapshot(
    docRef,
    (snap) => {
      onData(snap.exists() ? (snap.data() as StoreCatalogPayload) : null);
    },
    (err) => {
      console.error("Store catalog snapshot error:", err);
      // Do not call onData(null) here – keep showing last good data so items don't flash away
    }
  );
}

/** Remove undefined values (Firestore does not accept undefined). */
function stripUndefined<T>(obj: T): T {
  if (obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(stripUndefined) as T;
  if (obj !== null && typeof obj === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined) out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return obj;
}

/**
 * Write the public store catalog. Call when inventory changes (only store-visible items). Requires auth.
 */
export async function writeStoreCatalog(payload: StoreCatalogPayload): Promise<void> {
  const ctx = init();
  const user = ctx?.auth?.currentUser;
  if (!ctx?.db || !user) throw new Error("Not signed in");
  const docRef = doc(ctx.db, STORE_CATALOG_COLLECTION, STORE_CATALOG_DOC_ID);
  const data = stripUndefined({
    ...payload,
    updatedAt: new Date().toISOString(),
  });
  await setDoc(docRef, data);
}

// --- STOREFRONT CONFIG (public read) ---
// Powers the "Storefront Configurator" panel page: block order/visibility, editable
// section text, featured PC ads (with archive/restore), and trust-row items
// (with archive/restore). Mirrors the storeCatalog singleton-doc pattern.

const STOREFRONT_CONFIG_COLLECTION = "storefrontConfig";
const STOREFRONT_CONFIG_DOC_ID = "public";

export type StorefrontBlockId = 'hero' | 'categoryGrid' | 'promoAds' | 'bestSellers' | 'trustRow';

export interface StorefrontBlockConfig {
  id: StorefrontBlockId;
  visible: boolean;
  order: number;
}

export interface StorefrontPromoAd {
  id: string;
  name: string;
  specLine: string;
  price: number;
  imageUrl?: string;
  ctaLabel?: string;
  visible: boolean;
  archived: boolean;
}

export interface StorefrontTrustItem {
  id: string;
  icon: string;
  title: string;
  description: string;
  visible: boolean;
  archived: boolean;
}

export interface StorefrontConfig {
  blocks: StorefrontBlockConfig[];
  hero: { subtitle?: string; ctaLabel?: string; ctaSaleLabel?: string };
  categoryGrid: { heading?: string; subheading?: string };
  bestSellers: { heading?: string; subheading?: string };
  promoAds: StorefrontPromoAd[];
  trustItems: StorefrontTrustItem[];
  updatedAt?: string;
}

export const DEFAULT_STOREFRONT_CONFIG: StorefrontConfig = {
  blocks: [
    { id: 'hero', visible: true, order: 0 },
    { id: 'categoryGrid', visible: true, order: 1 },
    { id: 'promoAds', visible: true, order: 2 },
    { id: 'bestSellers', visible: true, order: 3 },
    { id: 'trustRow', visible: true, order: 4 },
  ],
  hero: {},
  categoryGrid: {},
  bestSellers: {},
  promoAds: [
    {
      id: 'default-promo',
      name: 'ArmikTech Ultra Gaming PC',
      specLine: 'Ryzen 9 · RTX 4080 · 32GB DDR5 · 2TB NVMe',
      price: 2499,
      ctaLabel: undefined,
      visible: true,
      archived: false,
    },
  ],
  trustItems: [
    { id: 'trust-checked', icon: 'ShieldCheck', title: '', description: '', visible: true, archived: false },
    { id: 'trust-direct', icon: 'MessageSquare', title: '', description: '', visible: true, archived: false },
    { id: 'trust-fair', icon: 'Tag', title: '', description: '', visible: true, archived: false },
    { id: 'trust-support', icon: 'LifeBuoy', title: '', description: '', visible: true, archived: false },
  ],
};

/**
 * Subscribe to the public storefront configurator settings (no auth required).
 * Used by the storefront page to render blocks in the admin-chosen order/visibility.
 */
export function subscribeToStorefrontConfig(
  onData: (data: StorefrontConfig | null, error?: Error) => void
): Unsubscribe {
  const ctx = init();
  if (!ctx?.db) {
    onData(null);
    return () => {};
  }
  const docRef = doc(ctx.db, STOREFRONT_CONFIG_COLLECTION, STOREFRONT_CONFIG_DOC_ID);
  return onSnapshot(
    docRef,
    (snap) => {
      onData(snap.exists() ? (snap.data() as StorefrontConfig) : null);
    },
    (err) => {
      console.error("Storefront config snapshot error:", err);
      // Unlike storeCatalog, this must still call back on error — otherwise a caller
      // waiting on the first snapshot (e.g. the configurator's loading state) would
      // hang forever if Firestore rules for this collection aren't deployed yet.
      onData(null, err instanceof Error ? err : new Error(String(err)));
    }
  );
}

/** Write the storefront configurator settings. Requires auth. */
export async function writeStorefrontConfig(payload: StorefrontConfig): Promise<void> {
  const ctx = init();
  const user = ctx?.auth?.currentUser;
  if (!ctx?.db || !user) throw new Error("Not signed in");
  const docRef = doc(ctx.db, STOREFRONT_CONFIG_COLLECTION, STOREFRONT_CONFIG_DOC_ID);
  const data = stripUndefined({
    ...payload,
    updatedAt: new Date().toISOString(),
  });
  await setDoc(docRef, data);
}

/**
 * Upload an image for a storefront configurator asset (e.g. a featured PC ad photo)
 * to Firebase Storage and return its public download URL. Requires auth.
 *
 * Path convention: storefrontAssets/{uid}/{assetId}/{timestamp}-{filename}
 */
export async function uploadStorefrontAsset(
  file: File,
  assetId: string,
  onProgress?: (percent: number) => void
): Promise<string> {
  const ctx = init();
  const user = ctx?.auth?.currentUser;
  if (!ctx?.storage || !user) {
    throw new Error("Not signed in or Firebase Storage not configured. Please sign in with Google first.");
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  const path = `storefrontAssets/${user.uid}/${assetId || "unknown"}/${Date.now()}-${safeName}`;
  const ref = storageRef(ctx.storage, path);

  const timeoutMs = 90_000;
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(
      "Upload timed out after 90s. Enable Storage in Firebase Console → Build → Storage, then set Rules to allow writes for signed-in users."
    )), timeoutMs)
  );

  try {
    if (onProgress) onProgress(10);
    const snapshot = await Promise.race([uploadBytes(ref, file), timeoutPromise]);
    if (onProgress) onProgress(90);
    const url = await Promise.race([getDownloadURL(snapshot.ref), timeoutPromise]);
    if (onProgress) onProgress(100);
    return url;
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (msg.includes("storage/unauthorized") || msg.includes("403") || msg.includes("does not have permission")) {
      throw new Error(
        "Firebase Storage permission denied. In Firebase Console go to Build → Storage → Rules (not Firestore) and set:\n" +
        "  allow read, write: if request.auth != null;\n" +
        "Then deploy rules and try uploading again."
      );
    }
    throw err;
  }
}

// --- STORE INQUIRIES ---

const STORE_INQUIRIES_COLLECTION = "storeInquiries";

export type StoreInquiryStatus = 'new' | 'answered' | 'done';

export interface StoreInquiryPayload {
  itemId: string;
  itemName: string;
  message: string;
  contactEmail?: string;
  contactPhone?: string;
  contactName?: string;
  createdAt: string;
  read?: boolean;
  status?: StoreInquiryStatus;
}

/**
 * Create an inquiry (no auth). Used by the storefront when a visitor sends a message.
 */
export async function createStoreInquiry(inquiry: Omit<StoreInquiryPayload, "createdAt" | "read">): Promise<string> {
  const ctx = init();
  if (!ctx?.db) throw new Error("Firebase not configured");
  const colRef = collection(ctx.db, STORE_INQUIRIES_COLLECTION);
  const docRef = await addDoc(colRef, {
    ...inquiry,
    createdAt: new Date().toISOString(),
    read: false,
    status: 'new',
  });
  return docRef.id;
}

/**
 * Subscribe to store inquiries (admin). Requires auth.
 */
export function subscribeToStoreInquiries(onData: (inquiries: (StoreInquiryPayload & { id: string })[]) => void): Unsubscribe {
  const ctx = init();
  if (!ctx?.db) {
    onData([]);
    return () => {};
  }
  const colRef = collection(ctx.db, STORE_INQUIRIES_COLLECTION);
  const q = query(colRef, orderBy("createdAt", "desc"));
  return onSnapshot(
    q,
    (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() } as StoreInquiryPayload & { id: string }));
      onData(list);
    },
    (err) => {
      console.error("Store inquiries snapshot error:", err);
      onData([]);
    }
  );
}

/**
 * Mark an inquiry as read. Requires auth.
 */
export async function markStoreInquiryRead(inquiryId: string, read: boolean): Promise<void> {
  const ctx = init();
  const user = ctx?.auth?.currentUser;
  if (!ctx?.db || !user) throw new Error("Not signed in");
  const docRef = doc(ctx.db, STORE_INQUIRIES_COLLECTION, inquiryId);
  await updateDoc(docRef, { read });
}

export async function updateStoreInquiryStatus(inquiryId: string, status: StoreInquiryStatus): Promise<void> {
  const ctx = init();
  const user = ctx?.auth?.currentUser;
  if (!ctx?.db || !user) throw new Error("Not signed in");
  const docRef = doc(ctx.db, STORE_INQUIRIES_COLLECTION, inquiryId);
  await updateDoc(docRef, { status });
}

// --- PRODUCT PHOTO CACHE ---
// Reuses the same real-world photo across every item that shares a product name, so "Find real
// photos" only needs to run once per distinct product (saves Custom Search API quota) and repeat
// items (e.g. 5x the same RAM stick) get a matching default photo automatically.
const PRODUCT_PHOTO_CACHE_COLLECTION = "productPhotoCache";

/** Firestore doc ids can't contain "/", so fold the product name into a safe, stable key. */
function productPhotoCacheKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\/#\[\]*]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 300);
}

/** Looks up a previously-saved real photo for this product name. Returns null if none cached. */
export async function getCachedProductPhoto(name: string): Promise<string | null> {
  const key = productPhotoCacheKey(name);
  const ctx = init();
  if (!key || !ctx?.db) return null;
  try {
    const snap = await getDoc(doc(ctx.db, PRODUCT_PHOTO_CACHE_COLLECTION, key));
    if (!snap.exists()) return null;
    const url = (snap.data() as { imageUrl?: string }).imageUrl;
    return typeof url === "string" && url ? url : null;
  } catch (e) {
    console.warn("getCachedProductPhoto failed:", e);
    return null;
  }
}

/** Saves the chosen real photo for this product name so future items with the same name reuse it. */
export async function setCachedProductPhoto(name: string, imageUrl: string): Promise<void> {
  const key = productPhotoCacheKey(name);
  const ctx = init();
  const user = ctx?.auth?.currentUser;
  if (!key || !imageUrl || !ctx?.db || !user) return;
  try {
    await setDoc(doc(ctx.db, PRODUCT_PHOTO_CACHE_COLLECTION, key), {
      imageUrl,
      productName: name,
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.warn("setCachedProductPhoto failed:", e);
  }
}

// --- EBAY ORDER INDEX (cached order history, cross-device) ---
// Durable mirror of services/ebayOrderIndex.ts's localStorage cache — one Firestore doc
// per order under the signed-in user, so a wiped browser / brand-new PC can re-hydrate the
// local cache instead of losing history and needing a full API re-backfill or CSV re-import.
// Kept loosely typed here (no import from services/ebayOrderIndex.ts) to avoid a circular
// dependency; the caller casts to/from its EbayOrderRecord shape.

const EBAY_ORDERS_COLLECTION = "ebayOrders";
const EBAY_ORDERS_META_DOC_ID = "_meta";

function sanitizeOrderDocId(orderId: string): string {
  const cleaned = orderId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 300);
  return cleaned || "unknown";
}

export interface EbayOrderCloudMeta {
  updatedAt?: string;
  count?: number;
  apiBackfill?: {
    fromDate: string;
    toDate: string;
    completedThroughDate?: string;
    lastRunAt: string;
    isComplete?: boolean;
  };
  csvImports?: { fileName: string; rowCount: number; orderCount: number; importedAt: string }[];
}

/** One-time fetch of every cached eBay order (+ meta) for this user. Returns null if signed out / cloud disabled. */
export async function fetchEbayOrdersFromCloud(): Promise<{ orders: Record<string, unknown>[]; meta: EbayOrderCloudMeta | null } | null> {
  const ctx = init();
  const user = ctx?.auth?.currentUser;
  if (!ctx?.db || !user) return null;
  try {
    const colRef = collection(ctx.db, "users", user.uid, EBAY_ORDERS_COLLECTION);
    const snap = await getDocs(colRef);
    const orders: Record<string, unknown>[] = [];
    let meta: EbayOrderCloudMeta | null = null;
    snap.forEach((d) => {
      if (d.id === EBAY_ORDERS_META_DOC_ID) {
        meta = d.data() as EbayOrderCloudMeta;
      } else {
        orders.push(d.data() as Record<string, unknown>);
      }
    });
    return { orders, meta };
  } catch (err) {
    console.error("fetchEbayOrdersFromCloud failed:", err);
    return null;
  }
}

/** Upload new/changed eBay orders (one doc per order, batched) and merge a meta patch. Requires auth. */
export async function writeEbayOrdersToCloud(
  orders: (Record<string, unknown> & { orderId: string })[],
  metaPatch?: EbayOrderCloudMeta
): Promise<void> {
  const ctx = init();
  const user = ctx?.auth?.currentUser;
  if (!ctx?.db || !user) throw new Error("Not signed in");
  const colRef = collection(ctx.db, "users", user.uid, EBAY_ORDERS_COLLECTION);

  const BATCH_MAX = 450;
  let batch = writeBatch(ctx.db);
  let count = 0;
  for (const order of orders) {
    const id = sanitizeOrderDocId(String(order.orderId));
    batch.set(doc(colRef, id), stripUndefined(order));
    count++;
    if (count >= BATCH_MAX) {
      await batch.commit();
      batch = writeBatch(ctx.db);
      count = 0;
    }
  }
  if (metaPatch) {
    batch.set(
      doc(colRef, EBAY_ORDERS_META_DOC_ID),
      stripUndefined({ ...metaPatch, updatedAt: new Date().toISOString() }),
      { merge: true }
    );
    count++;
  }
  if (count > 0) await batch.commit();
}

/** Delete every cached eBay order doc (and meta) for this user. Requires auth. */
export async function clearEbayOrdersCloud(): Promise<void> {
  const ctx = init();
  const user = ctx?.auth?.currentUser;
  if (!ctx?.db || !user) return;
  const colRef = collection(ctx.db, "users", user.uid, EBAY_ORDERS_COLLECTION);
  const snap = await getDocs(colRef);
  const BATCH_MAX = 450;
  let batch = writeBatch(ctx.db);
  let count = 0;
  for (const d of snap.docs) {
    batch.delete(d.ref);
    count++;
    if (count >= BATCH_MAX) {
      await batch.commit();
      batch = writeBatch(ctx.db);
      count = 0;
    }
  }
  if (count > 0) await batch.commit();
}

// --- BUY HELPER MARKET PRICE HISTORY (30-day eBay sold/live + Kleinanzeigen snapshots per tracked part) ---

const BUY_HELPER_PRICES_COLLECTION = "buyHelperPrices";

function sanitizeBuyHelperDocId(itemId: string): string {
  const cleaned = itemId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 300);
  return cleaned || "unknown";
}

/** One-time fetch of every stored Buy Helper price history, keyed by itemId. */
export async function fetchBuyHelperPricesFromCloud(): Promise<Record<string, unknown> | null> {
  const ctx = init();
  const user = ctx?.auth?.currentUser;
  if (!ctx?.db || !user) return null;
  try {
    const colRef = collection(ctx.db, "users", user.uid, BUY_HELPER_PRICES_COLLECTION);
    const snap = await getDocs(colRef);
    const out: Record<string, unknown> = {};
    snap.forEach((d) => {
      out[d.id] = d.data();
    });
    return out;
  } catch (err) {
    console.error("fetchBuyHelperPricesFromCloud failed:", err);
    return null;
  }
}

/** Upsert Buy Helper price histories (one doc per tracked item, batched). Requires auth. */
export async function writeBuyHelperPricesToCloud(
  histories: (Record<string, unknown> & { itemId: string })[]
): Promise<void> {
  const ctx = init();
  const user = ctx?.auth?.currentUser;
  if (!ctx?.db || !user) throw new Error("Not signed in");
  const colRef = collection(ctx.db, "users", user.uid, BUY_HELPER_PRICES_COLLECTION);

  const BATCH_MAX = 450;
  let batch = writeBatch(ctx.db);
  let count = 0;
  for (const history of histories) {
    batch.set(doc(colRef, sanitizeBuyHelperDocId(String(history.itemId))), stripUndefined(history));
    count++;
    if (count >= BATCH_MAX) {
      await batch.commit();
      batch = writeBatch(ctx.db);
      count = 0;
    }
  }
  if (count > 0) await batch.commit();
}

// --- REINVEST GAMIFICATION (bank ledger, quests, achievements) — one doc per user, pull-on-boot
// like buyHelperPrices, kept out of the syncPack blob since it changes on its own cadence. ---

const GAMIFICATION_COLLECTION = "gamification";
const GAMIFICATION_DOC_ID = "state";

/** One-time fetch of the gamification state doc. Returns null when signed out or never written. */
export async function fetchGamificationState(): Promise<Record<string, unknown> | null> {
  const ctx = init();
  const user = ctx?.auth?.currentUser;
  if (!ctx?.db || !user) return null;
  try {
    const snap = await getDoc(doc(ctx.db, "users", user.uid, GAMIFICATION_COLLECTION, GAMIFICATION_DOC_ID));
    return snap.exists() ? (snap.data() as Record<string, unknown>) : null;
  } catch (err) {
    console.error("fetchGamificationState failed:", err);
    return null;
  }
}

/** Upsert the gamification state doc. Requires auth. */
export async function writeGamificationState(state: Record<string, unknown>): Promise<void> {
  const ctx = init();
  const user = ctx?.auth?.currentUser;
  if (!ctx?.db || !user) throw new Error("Not signed in");
  await setDoc(
    doc(ctx.db, "users", user.uid, GAMIFICATION_COLLECTION, GAMIFICATION_DOC_ID),
    stripUndefined({ ...state, updatedAt: new Date().toISOString() }),
  );
}

// --- EBAY PURCHASE INDEX (buyer history archive, survives eBay's ~90-day API window) ---

const EBAY_PURCHASES_COLLECTION = "ebayPurchases";
const EBAY_PURCHASES_META_DOC_ID = "_meta";

function sanitizePurchaseDocId(lineKey: string): string {
  const cleaned = lineKey.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 300);
  return cleaned || "unknown";
}

export interface EbayPurchaseCloudMeta {
  updatedAt?: string;
  count?: number;
  apiBackfill?: {
    fromDate: string;
    toDate: string;
    completedThroughDate?: string;
    lastRunAt: string;
    fetched?: number;
  };
}

/** One-time fetch of every cached eBay purchase (+ meta). Returns null if signed out / cloud disabled. */
export async function fetchEbayPurchasesFromCloud(): Promise<{
  purchases: Record<string, unknown>[];
  meta: EbayPurchaseCloudMeta | null;
} | null> {
  const ctx = init();
  const user = ctx?.auth?.currentUser;
  if (!ctx?.db || !user) return null;
  try {
    const colRef = collection(ctx.db, "users", user.uid, EBAY_PURCHASES_COLLECTION);
    const snap = await getDocs(colRef);
    const purchases: Record<string, unknown>[] = [];
    let meta: EbayPurchaseCloudMeta | null = null;
    snap.forEach((d) => {
      if (d.id === EBAY_PURCHASES_META_DOC_ID) {
        meta = d.data() as EbayPurchaseCloudMeta;
      } else {
        purchases.push(d.data() as Record<string, unknown>);
      }
    });
    return { purchases, meta };
  } catch (err) {
    console.error("fetchEbayPurchasesFromCloud failed:", err);
    return null;
  }
}

/** Upload new/changed purchase lines (one doc per lineKey) and merge meta. */
export async function writeEbayPurchasesToCloud(
  purchases: (Record<string, unknown> & { lineKey: string })[],
  metaPatch?: EbayPurchaseCloudMeta
): Promise<void> {
  const ctx = init();
  const user = ctx?.auth?.currentUser;
  if (!ctx?.db || !user) throw new Error("Not signed in");
  const colRef = collection(ctx.db, "users", user.uid, EBAY_PURCHASES_COLLECTION);

  const BATCH_MAX = 450;
  let batch = writeBatch(ctx.db);
  let count = 0;
  for (const row of purchases) {
    const id = sanitizePurchaseDocId(String(row.lineKey));
    batch.set(doc(colRef, id), stripUndefined(row));
    count++;
    if (count >= BATCH_MAX) {
      await batch.commit();
      batch = writeBatch(ctx.db);
      count = 0;
    }
  }
  if (metaPatch) {
    batch.set(
      doc(colRef, EBAY_PURCHASES_META_DOC_ID),
      stripUndefined({ ...metaPatch, updatedAt: new Date().toISOString() }),
      { merge: true }
    );
    count++;
  }
  if (count > 0) await batch.commit();
}

/** Delete every cached eBay purchase doc (and meta) for this user. */
export async function clearEbayPurchasesCloud(): Promise<void> {
  const ctx = init();
  const user = ctx?.auth?.currentUser;
  if (!ctx?.db || !user) return;
  const colRef = collection(ctx.db, "users", user.uid, EBAY_PURCHASES_COLLECTION);
  const snap = await getDocs(colRef);
  const BATCH_MAX = 450;
  let batch = writeBatch(ctx.db);
  let count = 0;
  for (const d of snap.docs) {
    batch.delete(d.ref);
    count++;
    if (count >= BATCH_MAX) {
      await batch.commit();
      batch = writeBatch(ctx.db);
      count = 0;
    }
  }
  if (count > 0) await batch.commit();
}

// --- AI ACTION LOG (audit trail of assistant edits, one doc per action) ---

const AI_ACTIONS_COLLECTION = "aiActions";

function sanitizeAiActionDocId(id: string): string {
  const cleaned = id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 300);
  return cleaned || "unknown";
}

/**
 * One-time fetch of the archived AI action log. Deliberately not a live subscription:
 * it is only read when the "Done by AI" page opens, to keep Firestore reads low.
 */
export async function fetchAiActionsFromCloud(): Promise<Record<string, unknown>[] | null> {
  const ctx = init();
  const user = ctx?.auth?.currentUser;
  if (!ctx?.db || !user) return null;
  try {
    const colRef = collection(ctx.db, "users", user.uid, AI_ACTIONS_COLLECTION);
    const snap = await getDocs(colRef);
    const actions: Record<string, unknown>[] = [];
    snap.forEach((d) => actions.push(d.data() as Record<string, unknown>));
    return actions;
  } catch (err) {
    console.error("fetchAiActionsFromCloud failed:", err);
    return null;
  }
}

/** Upload new/changed AI actions (one doc per action id). */
export async function writeAiActionsToCloud(
  actions: (Record<string, unknown> & { id: string })[]
): Promise<void> {
  const ctx = init();
  const user = ctx?.auth?.currentUser;
  if (!ctx?.db || !user) throw new Error("Not signed in");
  const colRef = collection(ctx.db, "users", user.uid, AI_ACTIONS_COLLECTION);

  const BATCH_MAX = 450;
  let batch = writeBatch(ctx.db);
  let count = 0;
  for (const row of actions) {
    batch.set(doc(colRef, sanitizeAiActionDocId(String(row.id))), stripUndefined(row));
    count++;
    if (count >= BATCH_MAX) {
      await batch.commit();
      batch = writeBatch(ctx.db);
      count = 0;
    }
  }
  if (count > 0) await batch.commit();
}

/** Delete specific AI action docs (used when trimming the log). */
export async function deleteAiActionsFromCloud(ids: string[]): Promise<void> {
  const ctx = init();
  const user = ctx?.auth?.currentUser;
  if (!ctx?.db || !user || ids.length === 0) return;
  const colRef = collection(ctx.db, "users", user.uid, AI_ACTIONS_COLLECTION);
  const BATCH_MAX = 450;
  let batch = writeBatch(ctx.db);
  let count = 0;
  for (const id of ids) {
    batch.delete(doc(colRef, sanitizeAiActionDocId(id)));
    count++;
    if (count >= BATCH_MAX) {
      await batch.commit();
      batch = writeBatch(ctx.db);
      count = 0;
    }
  }
  if (count > 0) await batch.commit();
}

// --- PENDING TRANSACTIONS (non-eBay inbox deals: Kleinanzeigen buys/sells, manual) ---

const PENDING_TRANSACTIONS_COLLECTION = "pendingTransactions";

function sanitizePendingTxDocId(id: string): string {
  const cleaned = id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 300);
  return cleaned || "unknown";
}

export async function fetchPendingTransactionsFromCloud(): Promise<Record<string, unknown>[] | null> {
  const ctx = init();
  const user = ctx?.auth?.currentUser;
  if (!ctx?.db || !user) return null;
  try {
    const colRef = collection(ctx.db, "users", user.uid, PENDING_TRANSACTIONS_COLLECTION);
    const snap = await getDocs(colRef);
    const rows: Record<string, unknown>[] = [];
    snap.forEach((d) => rows.push(d.data() as Record<string, unknown>));
    return rows;
  } catch (err) {
    console.error("fetchPendingTransactionsFromCloud failed:", err);
    return null;
  }
}

export async function writePendingTransactionsToCloud(
  rows: (Record<string, unknown> & { id: string })[]
): Promise<void> {
  const ctx = init();
  const user = ctx?.auth?.currentUser;
  if (!ctx?.db || !user) throw new Error("Not signed in");
  const colRef = collection(ctx.db, "users", user.uid, PENDING_TRANSACTIONS_COLLECTION);

  const BATCH_MAX = 450;
  let batch = writeBatch(ctx.db);
  let count = 0;
  for (const row of rows) {
    batch.set(doc(colRef, sanitizePendingTxDocId(String(row.id))), stripUndefined(row));
    count++;
    if (count >= BATCH_MAX) {
      await batch.commit();
      batch = writeBatch(ctx.db);
      count = 0;
    }
  }
  if (count > 0) await batch.commit();
}

export async function deletePendingTransactionsFromCloud(ids: string[]): Promise<void> {
  const ctx = init();
  const user = ctx?.auth?.currentUser;
  if (!ctx?.db || !user || ids.length === 0) return;
  const colRef = collection(ctx.db, "users", user.uid, PENDING_TRANSACTIONS_COLLECTION);
  const batch = writeBatch(ctx.db);
  for (const id of ids.slice(0, 450)) {
    batch.delete(doc(colRef, sanitizePendingTxDocId(id)));
  }
  await batch.commit();
}

// --- EBAY ACTIVE LISTINGS (current store snapshot for sync/import/bundles) ---

const EBAY_ACTIVE_LISTINGS_COLLECTION = "ebayActiveListings";
const EBAY_ACTIVE_LISTINGS_META_DOC_ID = "_meta";

function sanitizeListingDocId(listingId: string): string {
  const cleaned = listingId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 300);
  return cleaned || "unknown";
}

export interface EbayActiveListingsCloudMeta {
  updatedAt?: string;
  count?: number;
  lastFetchedAt?: string;
  sellerUsername?: string;
}

/** Fetch cached active listings (+ meta). Returns null if signed out / cloud disabled. */
export async function fetchEbayActiveListingsFromCloud(): Promise<{
  listings: Record<string, unknown>[];
  meta: EbayActiveListingsCloudMeta | null;
} | null> {
  const ctx = init();
  const user = ctx?.auth?.currentUser;
  if (!ctx?.db || !user) return null;
  try {
    const colRef = collection(ctx.db, "users", user.uid, EBAY_ACTIVE_LISTINGS_COLLECTION);
    const snap = await getDocs(colRef);
    const listings: Record<string, unknown>[] = [];
    let meta: EbayActiveListingsCloudMeta | null = null;
    snap.forEach((d) => {
      if (d.id === EBAY_ACTIVE_LISTINGS_META_DOC_ID) {
        meta = d.data() as EbayActiveListingsCloudMeta;
      } else {
        listings.push(d.data() as Record<string, unknown>);
      }
    });
    return { listings, meta };
  } catch (err) {
    console.error("fetchEbayActiveListingsFromCloud failed:", err);
    return null;
  }
}

/**
 * Replace the cloud active-listing mirror: upsert current listings, delete stale docs, write meta.
 */
export async function writeEbayActiveListingsToCloud(
  listings: (Record<string, unknown> & { listingId: string })[],
  metaPatch?: EbayActiveListingsCloudMeta
): Promise<void> {
  const ctx = init();
  const user = ctx?.auth?.currentUser;
  if (!ctx?.db || !user) throw new Error("Not signed in");
  const colRef = collection(ctx.db, "users", user.uid, EBAY_ACTIVE_LISTINGS_COLLECTION);

  const keepIds = new Set(listings.map((l) => sanitizeListingDocId(String(l.listingId))));
  keepIds.add(EBAY_ACTIVE_LISTINGS_META_DOC_ID);

  const existing = await getDocs(colRef);
  const BATCH_MAX = 450;
  let batch = writeBatch(ctx.db);
  let count = 0;

  for (const d of existing.docs) {
    if (!keepIds.has(d.id)) {
      batch.delete(d.ref);
      count++;
      if (count >= BATCH_MAX) {
        await batch.commit();
        batch = writeBatch(ctx.db);
        count = 0;
      }
    }
  }

  for (const listing of listings) {
    const id = sanitizeListingDocId(String(listing.listingId));
    batch.set(doc(colRef, id), stripUndefined(listing));
    count++;
    if (count >= BATCH_MAX) {
      await batch.commit();
      batch = writeBatch(ctx.db);
      count = 0;
    }
  }

  if (metaPatch) {
    batch.set(
      doc(colRef, EBAY_ACTIVE_LISTINGS_META_DOC_ID),
      stripUndefined({ ...metaPatch, updatedAt: new Date().toISOString(), count: listings.length }),
      { merge: true }
    );
    count++;
  }
  if (count > 0) await batch.commit();
}

export async function clearEbayActiveListingsCloud(): Promise<void> {
  const ctx = init();
  const user = ctx?.auth?.currentUser;
  if (!ctx?.db || !user) return;
  const colRef = collection(ctx.db, "users", user.uid, EBAY_ACTIVE_LISTINGS_COLLECTION);
  const snap = await getDocs(colRef);
  const BATCH_MAX = 450;
  let batch = writeBatch(ctx.db);
  let count = 0;
  for (const d of snap.docs) {
    batch.delete(d.ref);
    count++;
    if (count >= BATCH_MAX) {
      await batch.commit();
      batch = writeBatch(ctx.db);
      count = 0;
    }
  }
  if (count > 0) await batch.commit();
}

// --- AI product card gallery (users/{uid}/productCardGallery/{id}) ---

const PRODUCT_CARD_GALLERY_COLLECTION = "productCardGallery";

export async function writeProductCardGalleryEntry(
  entry: GeneratedProductCardEntry
): Promise<void> {
  const ctx = init();
  const user = ctx?.auth?.currentUser;
  if (!ctx?.db || !user) throw new Error("Not signed in");
  // Never persist huge data URLs in Firestore — only durable URLs
  if (!entry.imageUrl || entry.imageUrl.startsWith("data:")) {
    throw new Error("Gallery cloud entry requires a Storage URL");
  }
  await setDoc(
    doc(ctx.db, "users", user.uid, PRODUCT_CARD_GALLERY_COLLECTION, entry.id),
    stripUndefined({ ...entry, updatedAt: new Date().toISOString() })
  );
}

export async function fetchProductCardGalleryEntries(
  itemId?: string
): Promise<GeneratedProductCardEntry[]> {
  const ctx = init();
  const user = ctx?.auth?.currentUser;
  if (!ctx?.db || !user) return [];
  try {
    const colRef = collection(ctx.db, "users", user.uid, PRODUCT_CARD_GALLERY_COLLECTION);
    const q = query(colRef, orderBy("createdAt", "desc"));
    const snap = await getDocs(q);
    const out: GeneratedProductCardEntry[] = [];
    snap.forEach((d) => {
      const data = d.data() as GeneratedProductCardEntry;
      const entry = { ...data, id: data.id || d.id };
      if (itemId && entry.itemId !== itemId) return;
      out.push(entry);
    });
    return out;
  } catch (err) {
    console.error("fetchProductCardGalleryEntries failed:", err);
    return [];
  }
}

export async function deleteProductCardGalleryEntry(id: string): Promise<void> {
  const ctx = init();
  const user = ctx?.auth?.currentUser;
  if (!ctx?.db || !user || !id) return;
  await deleteDoc(doc(ctx.db, "users", user.uid, PRODUCT_CARD_GALLERY_COLLECTION, id));
}

// --- AUTOMATED SNAPSHOT BACKUPS ---
// Stored in Firebase Storage (5 GB free), deliberately NOT Firestore: a daily full-inventory
// copy would burn document writes and stored-bytes against the much tighter Firestore free tier.

const BACKUP_PREFIX = "backups";

/** Upload one backup snapshot. `fileName` should already carry its date (see backupService). */
export async function uploadBackupSnapshot(fileName: string, blob: Blob): Promise<void> {
  const ctx = init();
  const user = ctx?.auth?.currentUser;
  if (!ctx?.storage || !user) throw new Error("Not signed in or Firebase Storage not configured.");
  const safe = fileName.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  await uploadBytes(storageRef(ctx.storage, `${BACKUP_PREFIX}/${user.uid}/${safe}`), blob);
}

/** File names of existing backups, newest-sorting last. Empty when signed out or none yet. */
export async function listBackupSnapshotNames(): Promise<string[]> {
  const ctx = init();
  const user = ctx?.auth?.currentUser;
  if (!ctx?.storage || !user) return [];
  try {
    const res = await listAll(storageRef(ctx.storage, `${BACKUP_PREFIX}/${user.uid}`));
    return res.items.map((i) => i.name).sort();
  } catch (err) {
    console.warn("listBackupSnapshotNames failed:", err);
    return [];
  }
}

export async function deleteBackupSnapshot(fileName: string): Promise<void> {
  const ctx = init();
  const user = ctx?.auth?.currentUser;
  if (!ctx?.storage || !user || !fileName) return;
  await deleteObject(storageRef(ctx.storage, `${BACKUP_PREFIX}/${user.uid}/${fileName}`));
}

/** Download URL for one backup, so the user can restore/inspect it manually. */
export async function getBackupSnapshotUrl(fileName: string): Promise<string | null> {
  const ctx = init();
  const user = ctx?.auth?.currentUser;
  if (!ctx?.storage || !user || !fileName) return null;
  try {
    return await getDownloadURL(storageRef(ctx.storage, `${BACKUP_PREFIX}/${user.uid}/${fileName}`));
  } catch (err) {
    console.warn("getBackupSnapshotUrl failed:", err);
    return null;
  }
}
