/**
 * Dev-only: list and serve bundled eBay Abrechnung CSVs from data/ebay-abrechnung/.
 * GET /api/ebay-abrechnung-csvs — { files: [{ name, size }] }
 * GET /api/ebay-abrechnung-csvs?file=Transaction-....csv — raw CSV text
 */
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isEbayTransactionReportText } from '../utils/ebayTransactionReport';

type ApiRequest = IncomingMessage & { query?: Record<string, string | string[]> };
type ApiResponse = ServerResponse & {
  status?: (code: number) => ApiResponse;
  json?: (data: unknown) => void;
};

const CSV_DIR = path.join(process.cwd(), 'data', 'ebay-abrechnung');

function enhanceResponse(res: ServerResponse): ApiResponse {
  const apiRes = res as ApiResponse;
  if (apiRes.status) return apiRes;
  apiRes.status = function status(code: number) {
    apiRes.statusCode = code;
    return apiRes;
  };
  apiRes.json = function json(data: unknown) {
    if (!apiRes.headersSent) {
      apiRes.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    apiRes.end(JSON.stringify(data));
  };
  return apiRes;
}

export default async function handler(req: ApiRequest, res: ServerResponse): Promise<void> {
  const apiRes = enhanceResponse(res);
  if (req.method !== 'GET') {
    apiRes.status?.(405);
    apiRes.end('Method not allowed');
    return;
  }

  const fileParam = req.query?.file;
  const fileName = typeof fileParam === 'string' ? fileParam : '';

  if (!fs.existsSync(CSV_DIR)) {
    apiRes.status?.(404);
    apiRes.json?.({ error: 'data/ebay-abrechnung not found', files: [] });
    return;
  }

  const entries = fs
    .readdirSync(CSV_DIR)
    .filter((name) => name.toLowerCase().endsWith('.csv'))
    .filter((name) => isEbayTransactionReportText(fs.readFileSync(path.join(CSV_DIR, name), 'utf8')))
    .map((name) => {
      const stat = fs.statSync(path.join(CSV_DIR, name));
      return { name, size: stat.size };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  if (!fileName) {
    apiRes.status?.(200);
    apiRes.json?.({ files: entries });
    return;
  }

  if (!entries.some((entry) => entry.name === fileName)) {
    apiRes.status?.(404);
    apiRes.json?.({ error: 'CSV not found' });
    return;
  }

  const text = fs.readFileSync(path.join(CSV_DIR, fileName), 'utf8');
  apiRes.status?.(200);
  apiRes.setHeader('Content-Type', 'text/csv; charset=utf-8');
  apiRes.end(text);
}
