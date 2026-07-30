/**
 * Dealwatch API bridge for Vercel (ESM — package.json has "type": "module").
 * vercel.json maps /api/dealwatch/(.*) → /api/dealwatch?__path=$1
 */

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function rewriteDealwatchUrl(req) {
  const raw = String(req.url || '/api/dealwatch');
  const u = new URL(raw, 'http://local');
  let sub = u.searchParams.get('__path') || '';
  if (!sub) {
    const m = raw.match(/^\/api\/dealwatch\/?(.*?)(?:\?|$)/);
    if (m) sub = m[1] || '';
  }
  const qs = new URLSearchParams(u.searchParams);
  qs.delete('__path');
  const q = qs.toString();
  const cleanSub = String(sub).replace(/^\/+/, '');
  req.url = `/api${cleanSub ? `/${cleanSub}` : ''}${q ? `?${q}` : ''}`;
}

export default async function handler(req, res) {
  rewriteDealwatchUrl(req);

  try {
    const runtime = require(path.join(__dirname, '..', 'dealwatch-runtime', 'server.js'));
    await runtime.handleDealwatchRequest(req, res);
  } catch (error) {
    console.error('[api/dealwatch]', error);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({
        error: error instanceof Error ? error.message : 'Dealwatch server error',
      }));
    }
  }
}

export const config = {
  maxDuration: 60,
  // Ensure seed + specs ship with the serverless function (fs reads are not auto-traced).
  includeFiles: [
    'dealwatch-runtime/data/**',
    'dealwatch-runtime/server.js',
    'public/dealwatch/store.json',
  ],
};
