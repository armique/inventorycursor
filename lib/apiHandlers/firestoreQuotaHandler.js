/**
 * Optional Cloud Monitoring pull for Firestore daily free-tier ops.
 * Requires GOOGLE_SERVICE_ACCOUNT_JSON (or GOOGLE_SERVICE_ACCOUNT_PATH) on the server.
 */

import { loadServiceAccount, getGoogleAccessToken } from './googleServiceAccount.js';

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
    const token = await getGoogleAccessToken(sa, 'https://www.googleapis.com/auth/monitoring.read');
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
