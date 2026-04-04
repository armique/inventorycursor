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
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  User,
  Auth,
} from "firebase/auth";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  type FirebaseStorage,
} from "firebase/storage";

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
    if (saved) return JSON.parse(saved) as FirebaseConfig;
    return DEFAULT_FIREBASE_CONFIG;
  } catch {
    return DEFAULT_FIREBASE_CONFIG;
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

function init(): { db: Firestore; auth: Auth; storage: FirebaseStorage } | null {
  if (db && auth && storage) return { db, auth, storage };

  const config = getFirebaseConfig();
  if (!config?.apiKey || !config?.projectId) return null;

  try {
    app = getApps().length ? getApp() : initializeApp(config);
    db = getFirestore(app);
    auth = getAuth(app);
    // Force correct bucket (Firebase default is now .firebasestorage.app, not .appspot.com)
    const bucket = config.projectId === "inventorycursor-e9000"
      ? "inventorycursor-e9000.firebasestorage.app"
      : config.storageBucket;
    storage = bucket ? getStorage(app, bucket) : getStorage(app);
    return db && auth && storage ? { db, auth, storage } : null;
  } catch (err) {
    console.error("Firebase init error:", err);
    return null;
  }
}

// --- AUTH ---

/**
 * Sign in with Google via popup. Returns the user when complete.
 */
export async function signInWithGooglePopup(): Promise<User> {
  const ctx = init();
  if (!ctx?.auth) throw new Error("Firebase not configured. Check Settings.");
  await setPersistence(ctx.auth, browserLocalPersistence);
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(ctx.auth, provider);
  return result.user;
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
  "marketDescription",
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

function trimItemForSize(item: unknown): unknown {
  if (!item || typeof item !== "object") return item;
  const o = { ...(item as Record<string, unknown>) };
  for (const key of LARGE_ITEM_FIELDS) {
    const v = o[key];
    if (typeof v === "string" && shouldOmitString(v, 400)) {
      o[key] = CLOUD_OMITTED_PLACEHOLDER;
    }
  }
  for (const arrKey of LARGE_ITEM_STRING_ARRAYS) {
    const arr = o[arrKey];
    if (Array.isArray(arr)) {
      o[arrKey] = arr.map((x) =>
        typeof x === "string" && shouldOmitString(x, 400) ? CLOUD_OMITTED_PLACEHOLDER : x
      );
    }
  }
  for (const textKey of [
    "storeDescription",
    "storeDescriptionEn",
    "storeMetaDescription",
    "marketTitle",
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
function chunkItemsForFirestore(rawItems: unknown[]): unknown[][] {
  const chunks: unknown[][] = [];
  let current: unknown[] = [];

  const wrapSize = (arr: unknown[]) => jsonByteSize({ items: arr });

  for (const raw of rawItems) {
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
  };
}

function shrinkCoreUntilUnder(core: Record<string, unknown>, maxBytes: number): Record<string, unknown> {
  let c = { ...core };
  let size = jsonByteSize(c);
  let rounds = 0;
  while (size > maxBytes && rounds < 40) {
    rounds++;
    const ah = c.actionHistory as unknown[] | undefined;
    if (Array.isArray(ah) && ah.length > 25) {
      c = { ...c, actionHistory: ah.slice(-Math.max(25, Math.floor(ah.length * 0.6))) };
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

async function writeShardedSyncPack(
  db: Firestore,
  uid: string,
  data: FirestoreInventoryPayload,
  savedBy: string
): Promise<void> {
  const colRef = syncPackCollectionRef(db, uid);
  const legacyRef = legacyInventoryDocRef(db, uid);
  const nowIso = new Date().toISOString();

  const invChunks = chunkItemsForFirestore(data.inventory || []);
  const trashChunks = chunkItemsForFirestore(data.trash || []);
  const corePayload = shrinkCoreUntilUnder(buildCorePayloadForShard(data), CHUNK_BODY_MAX);

  const existingSnap = await getDocs(colRef);
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
 */
export async function fetchFromCloud(): Promise<FirestoreInventoryPayload | null> {
  const ctx = init();
  const user = ctx?.auth?.currentUser;
  if (!ctx?.db || !user) return null;

  try {
    const colRef = syncPackCollectionRef(ctx.db, user.uid);
    const packSnap = await getDocs(colRef);
    if (!packSnap.empty) {
      return assemblePayloadFromSyncSnapshot(packSnap);
    }
    const leg = await getDoc(legacyInventoryDocRef(ctx.db, user.uid));
    return leg.exists() ? (leg.data() as FirestoreInventoryPayload) : null;
  } catch (err) {
    console.error("Firestore fetch error:", err);
    return null;
  }
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
 */
export async function writeToCloud(data: FirestoreInventoryPayload): Promise<void> {
  const ctx = init();
  const user = ctx?.auth?.currentUser;
  if (!ctx?.db || !user) throw new Error("Not signed in");

  try {
    await writeShardedSyncPack(ctx.db, user.uid, data, user.email ?? user.uid);
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
