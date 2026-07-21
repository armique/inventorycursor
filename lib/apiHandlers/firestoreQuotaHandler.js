/**
 * Optional Cloud Monitoring pull for Firestore daily free-tier ops.
 * Requires GOOGLE_SERVICE_ACCOUNT_JSON (or GOOGLE_SERVICE_ACCOUNT_PATH) on the server.
 */

import crypto from 'crypto';
import fs from 'fs';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function pacificDayKey(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/** Parse Cloud Monitoring timeSeries list into summed point values. */
function parseMonitoringTimeSeries(payload) {
  if (!payload || typeof payload !== 'object') return 0;
  const series = payload.timeSeries;
  if (!Array.isArray(series)) return 0;
  let sum = 0;
  for (const s of series) {
    const points = s?.points;
    if (!Array.isArray(points)) continue;
    for (const p of points) {
      const v = p?.value;
      if (!v) continue;
      if (v.int64Value != null) sum += Number(v.int64Value) || 0;
      else if (typeof v.doubleValue === 'number') sum += v.doubleValue;
    }
  }
  return sum;
}

function loadServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (raw) {
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON');
    }
  }
  const path =
    process.env.GOOGLE_SERVICE_ACCOUNT_PATH ||
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    '';
  if (path && fs.existsSync(path)) {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  }
  return null;
}

function base64url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/monitoring.read',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })
  );
  const unsigned = `${header}.${claim}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  signer.end();
  const sig = signer
    .sign(sa.private_key)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  const assertion = `${unsigned}.${sig}`;

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await res.json();
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || 'Failed to mint Monitoring access token');
  }
  return json.access_token;
}

function pacificMidnightUtcIso() {
  const day = pacificDayKey();
  return `${day}T08:00:00Z`;
}

async function queryMetric(accessToken, projectId, metricType) {
  const end = new Date();
  const start = new Date(pacificMidnightUtcIso());
  if (start.getTime() > end.getTime()) {
    start.setTime(end.getTime() - 24 * 60 * 60 * 1000);
  }
  const params = new URLSearchParams({
    filter: `metric.type="${metricType}"`,
    'interval.startTime': start.toISOString(),
    'interval.endTime': end.toISOString(),
    'aggregation.alignmentPeriod': '86400s',
    'aggregation.perSeriesAligner': 'ALIGN_SUM',
    'aggregation.crossSeriesReducer': 'REDUCE_SUM',
  });
  const url = `https://monitoring.googleapis.com/v3/projects/${encodeURIComponent(projectId)}/timeSeries?${params}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.error?.message || `Monitoring ${res.status}`;
    throw new Error(msg);
  }
  return {
    total: parseMonitoringTimeSeries(json),
    series: json,
  };
}

export async function handleFirestoreQuota(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const projectId =
    String(req.query?.projectId || '').trim() ||
    process.env.VERCEL_FIREBASE_PROJECT_ID ||
    process.env.FIREBASE_PROJECT_ID ||
    'inventorycursor-e9000';

  let sa;
  try {
    sa = loadServiceAccount();
  } catch (e) {
    return res.status(500).json({
      ok: false,
      projectId,
      error: e instanceof Error ? e.message : 'Invalid service account',
    });
  }

  if (!sa?.client_email || !sa?.private_key) {
    return res.status(200).json({
      ok: false,
      projectId,
      pacificDay: pacificDayKey(),
      configured: false,
      error:
        'Live Firestore ops require a Monitoring Viewer service account on the server.',
      freeTier: {
        storedBytes: 1 * 1024 * 1024 * 1024,
        readsPerDay: 50_000,
        writesPerDay: 20_000,
        deletesPerDay: 20_000,
      },
    });
  }

  try {
    const token = await getAccessToken(sa);
    const [reads, writes, deletes] = await Promise.all([
      queryMetric(token, projectId, 'firestore.googleapis.com/document/read_count'),
      queryMetric(token, projectId, 'firestore.googleapis.com/document/write_count'),
      queryMetric(token, projectId, 'firestore.googleapis.com/document/delete_count'),
    ]);

    return res.status(200).json({
      ok: true,
      configured: true,
      projectId,
      pacificDay: pacificDayKey(),
      reads: reads.total,
      writes: writes.total,
      deletes: deletes.total,
      freeTier: {
        storedBytes: 1 * 1024 * 1024 * 1024,
        readsPerDay: 50_000,
        writesPerDay: 20_000,
        deletesPerDay: 20_000,
      },
      readsSeries: reads.series,
      writesSeries: writes.series,
      deletesSeries: deletes.series,
    });
  } catch (e) {
    return res.status(200).json({
      ok: false,
      configured: true,
      projectId,
      pacificDay: pacificDayKey(),
      error: e instanceof Error ? e.message : 'Monitoring query failed',
    });
  }
}
