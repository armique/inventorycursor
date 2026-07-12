import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import dotenv from 'dotenv';

type ApiRequest = IncomingMessage & {
  query?: Record<string, string | string[]>;
  body?: unknown;
};

type ApiResponse = ServerResponse & {
  status?: (code: number) => ApiResponse;
  json?: (data: unknown) => void;
};

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

function readRequestBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function loadHandler(pathname: string): Promise<{ handler: (req: ApiRequest, res: ApiResponse) => Promise<void>; route?: string } | null> {
  if (pathname === '/api/ebay' || pathname === '/api/ebay-order' || pathname === '/api/ebay-orders' || pathname === '/api/ebay-purchases' || pathname === '/api/ebay-listings') {
    const mod = await import('./api/ebay.js');
    const route =
      pathname === '/api/ebay-order'
        ? 'order'
        : pathname === '/api/ebay-orders'
          ? 'orders'
          : pathname === '/api/ebay-purchases'
            ? 'purchases'
          : pathname === '/api/ebay-listings'
            ? 'listings'
            : undefined;
    return { handler: mod.default, route };
  }
  if (pathname === '/api/images') {
    const mod = await import('./api/images.js');
    return { handler: mod.default };
  }
  if (pathname === '/api/gemini') {
    const mod = await import('./api/gemini.js');
    return { handler: mod.default };
  }
  return null;
}

/** Run Vercel-style /api handlers during `vite` dev (plain Vite does not serve /api). */
export function viteApiDevPlugin(): Plugin {
  return {
    name: 'vite-api-dev',
    configureServer(server) {
      dotenv.config({ path: '.env.local' });
      dotenv.config();

      server.middlewares.use(async (req, res, next) => {
        const rawUrl = req.url || '';
        if (!rawUrl.startsWith('/api/')) return next();

        try {
          const parsed = new URL(rawUrl, 'http://127.0.0.1');
          const loaded = await loadHandler(parsed.pathname);
          if (!loaded) return next();

          const apiReq = req as ApiRequest;
          const query = Object.fromEntries(parsed.searchParams.entries());
          if (loaded.route) query.route = loaded.route;
          apiReq.query = query;

          if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
            const raw = await readRequestBody(req);
            if (raw.trim()) {
              try {
                apiReq.body = JSON.parse(raw);
              } catch {
                apiReq.body = raw;
              }
            } else {
              apiReq.body = {};
            }
          }

          const apiRes = enhanceResponse(res);
          await loaded.handler(apiReq, apiRes);
        } catch (err) {
          console.error('[vite-api-dev]', err);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
          }
        }
      });
    },
  };
}
