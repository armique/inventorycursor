/**
 * Daily cron: snapshot the account's Firestore inventory sync-pack and commit it as a
 * dated JSON file to a private GitHub backup repo. See docs/daily-backup-setup.md for
 * the one-time account setup this depends on (service account role, GitHub repo + token,
 * Vercel env vars) — none of that can be done from inside this codebase.
 */

import { loadServiceAccount, getGoogleAccessToken } from './googleServiceAccount.js';

const FIRESTORE_SCOPE = 'https://www.googleapis.com/auth/datastore.readonly';

function firestoreDocUrl(projectId, uid, docId) {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/users/${encodeURIComponent(uid)}/syncPack/${encodeURIComponent(docId)}`;
}

/** Firestore REST documents wrap every value as {stringValue,integerValue,mapValue,...} — unwrap to plain JSON. */
function firestoreValueToPlain(v) {
  if (v == null) return null;
  if ('nullValue' in v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('mapValue' in v) return firestoreFieldsToPlain(v.mapValue?.fields || {});
  if ('arrayValue' in v) return (v.arrayValue?.values || []).map(firestoreValueToPlain);
  if ('timestampValue' in v) return v.timestampValue;
  return null;
}

function firestoreFieldsToPlain(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = firestoreValueToPlain(v);
  return out;
}

async function getFirestoreDoc(token, projectId, uid, docId) {
  const res = await fetch(firestoreDocUrl(projectId, uid, docId), {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message || `Firestore ${docId} fetch failed (${res.status})`);
  return firestoreFieldsToPlain(json.fields || {});
}

/** Reassembles the sharded syncPack (meta + core + i0../t0..) back into one plain snapshot. */
async function fetchInventorySnapshot(sa, projectId, uid) {
  const token = await getGoogleAccessToken(sa, FIRESTORE_SCOPE);
  const meta = await getFirestoreDoc(token, projectId, uid, 'meta');
  if (!meta) throw new Error('No syncPack/meta document found for this UID — has this account ever synced to the cloud?');
  const core = (await getFirestoreDoc(token, projectId, uid, 'core')) || {};

  const inventoryChunks = Number(meta.inventoryChunks) || 0;
  const trashChunks = Number(meta.trashChunks) || 0;

  const items = [];
  for (let i = 0; i < inventoryChunks; i++) {
    const shard = await getFirestoreDoc(token, projectId, uid, `i${i}`);
    if (shard?.items) items.push(...shard.items);
  }
  const trash = [];
  for (let i = 0; i < trashChunks; i++) {
    const shard = await getFirestoreDoc(token, projectId, uid, `t${i}`);
    if (shard?.items) trash.push(...shard.items);
  }

  return {
    inventory: items,
    trash,
    expenses: core.expenses || [],
    recurringExpenses: core.recurringExpenses || [],
    businessSettings: core.businessSettings || null,
    categories: core.categories || null,
    categoryFields: core.categoryFields || null,
    actionHistory: core.actionHistory || [],
    bulkImports: core.bulkImports || [],
    meta: { updatedAt: meta.updatedAt, schemaVersion: meta.schemaVersion, snapshotAt: new Date().toISOString() },
  };
}

async function commitToGitHub(token, repo, filePath, jsonContent, message) {
  const apiUrl = `https://api.github.com/repos/${repo}/contents/${filePath}`;
  const content = Buffer.from(jsonContent, 'utf8').toString('base64');
  const res = await fetch(apiUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message, content }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.message || `GitHub commit failed (${res.status})`);
  return json;
}

export async function handleDailyBackup(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'GET only' });
  }

  // Vercel Cron automatically sends `Authorization: Bearer $CRON_SECRET` on its own
  // requests when the CRON_SECRET env var is set — reject anything else so a random
  // request to this URL can't trigger a backup (or spend the Firestore/GitHub calls).
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers?.authorization || '';
    if (auth !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
  }

  const uid = process.env.BACKUP_FIRESTORE_UID;
  const githubToken = process.env.GITHUB_BACKUP_TOKEN;
  const githubRepo = process.env.GITHUB_BACKUP_REPO;
  const projectId =
    process.env.VERCEL_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || 'inventorycursor-e9000';

  if (!uid || !githubToken || !githubRepo) {
    return res.status(500).json({
      ok: false,
      error: 'Daily backup not configured — missing BACKUP_FIRESTORE_UID, GITHUB_BACKUP_TOKEN, or GITHUB_BACKUP_REPO.',
    });
  }

  let sa;
  try {
    sa = loadServiceAccount();
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
  if (!sa?.client_email || !sa?.private_key) {
    return res.status(500).json({ ok: false, error: 'GOOGLE_SERVICE_ACCOUNT_JSON not configured.' });
  }

  try {
    const snapshot = await fetchInventorySnapshot(sa, projectId, uid);
    const now = new Date();
    const stamp = now.toISOString().replace(/:/g, '-').replace(/\..+/, 'Z');
    const dayKey = now.toISOString().slice(0, 10);
    const filePath = `backups/${dayKey}/inventory-${stamp}.json`;
    const json = JSON.stringify(snapshot, null, 2);

    const result = await commitToGitHub(
      githubToken,
      githubRepo,
      filePath,
      json,
      `Inventory backup ${stamp} · ${snapshot.inventory.length} items, ${snapshot.trash.length} trashed`
    );

    return res.status(200).json({
      ok: true,
      filePath,
      itemCount: snapshot.inventory.length,
      trashCount: snapshot.trash.length,
      commitSha: result?.commit?.sha,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e instanceof Error ? e.message : 'Backup failed' });
  }
}
