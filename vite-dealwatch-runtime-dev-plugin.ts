import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { Plugin, Connect } from 'vite';

const require = createRequire(import.meta.url);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DEALWATCH_DIR = path.resolve(ROOT, 'dealwatch-runtime');
const PUBLIC_DEALWATCH_DIR = path.resolve(ROOT, 'public', 'dealwatch');

const STATIC_BLOCKLIST = new Set([
  'server.js',
  'package.json',
  '.env',
  '.env.example',
  '.gitignore',
]);

const STATIC_BLOCKED_PREFIXES = ['data/', 'scripts/', 'extension/', 'node_modules/', '.agents/', '.git/'];

/** UI files that must be reachable at /dealwatch/* even when the API server fails to boot. */
const PUBLIC_UI_FILES = [
  'index.html',
  'styles.css',
  'app.js',
  'explore.html',
  'explore.css',
  'explore.js',
  'compare.html',
  'compare.css',
  'compare.js',
];

function contentType(filePath: string): string {
  return (
    {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.ico': 'image/x-icon',
      '.map': 'application/json; charset=utf-8',
    }[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
  );
}

function isBlockedStatic(relPosix: string): boolean {
  const clean = relPosix.replace(/^\/+/, '');
  if (!clean || clean.includes('..')) return true;
  if (STATIC_BLOCKLIST.has(path.basename(clean))) return true;
  if (clean.startsWith('.')) return true;
  return STATIC_BLOCKED_PREFIXES.some((prefix) => clean === prefix.slice(0, -1) || clean.startsWith(prefix));
}

/** Keep public/dealwatch in sync so Vite/Vercel never SPA-fallback /dealwatch to the storefront. */
export function syncDealwatchPublicUi(): void {
  fs.mkdirSync(PUBLIC_DEALWATCH_DIR, { recursive: true });
  for (const file of PUBLIC_UI_FILES) {
    const src = path.join(DEALWATCH_DIR, file);
    if (!fs.existsSync(src)) continue;
    fs.copyFileSync(src, path.join(PUBLIC_DEALWATCH_DIR, file));
  }
}

function serveDealwatchFile(relPosix: string, res: ServerResponse): boolean {
  if (isBlockedStatic(relPosix)) {
    res.statusCode = 404;
    res.end('Not found');
    return true;
  }
  const filePath = path.resolve(DEALWATCH_DIR, relPosix);
  if (!filePath.startsWith(DEALWATCH_DIR + path.sep) && filePath !== DEALWATCH_DIR) {
    res.statusCode = 403;
    res.end('Forbidden');
    return true;
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.statusCode = 404;
    res.end('Not found');
    return true;
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', contentType(filePath));
  res.setHeader('Cache-Control', 'no-store');
  fs.createReadStream(filePath).pipe(res);
  return true;
}

function createDealwatchMiddleware(dealwatchRuntime: {
  handleDealwatchRequest: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
} | null): Connect.NextHandleFunction {
  return async (req, res, next) => {
    const rawUrl = req.url || '';
    const pathname = rawUrl.split('?')[0] || '';

    // Legacy aliases from the pre-rename paths.
    if (pathname === '/api/est' || pathname.startsWith('/api/est/')) {
      req.url = rawUrl.replace(/^\/api\/est(?=\/|\?|$)/, '/api/dealwatch');
    }

    const apiUrl = req.url || rawUrl;
    const apiPath = apiUrl.split('?')[0] || '';

    if (apiPath === '/api/dealwatch' || apiPath.startsWith('/api/dealwatch/')) {
      if (!dealwatchRuntime) {
        res.statusCode = 503;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'Dealwatch API unavailable. Check dealwatch-runtime/.env and restart npm run dev.' }));
        return;
      }
      const rewritten = apiUrl.replace(/^\/api\/dealwatch(?=\/|\?|$)/, '/api') || '/api';
      const originalUrl = req.url;
      req.url = rewritten;
      try {
        await dealwatchRuntime.handleDealwatchRequest(req, res);
      } catch (err) {
        console.error('[dealwatch] API error:', err);
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
        }
      } finally {
        req.url = originalUrl;
      }
      return;
    }

    if (pathname === '/market' || pathname.startsWith('/market/')) {
      res.statusCode = 302;
      res.setHeader('Location', pathname === '/market' ? '/dealwatch/' : `/dealwatch${pathname.slice('/market'.length)}`);
      res.end();
      return;
    }

    if (pathname === '/dealwatch' || pathname.startsWith('/dealwatch/')) {
      if (pathname === '/dealwatch') {
        res.statusCode = 302;
        res.setHeader('Location', '/dealwatch/');
        res.end();
        return;
      }

      let rel = decodeURIComponent(pathname.slice('/dealwatch'.length) || '/');
      if (rel === '/' || rel === '') rel = '/index.html';
      const relPosix = rel.replace(/\\/g, '/').replace(/^\/+/, '');
      serveDealwatchFile(relPosix, res);
      return;
    }

    next();
  };
}

/**
 * Serves Dealwatch runtime from the same Vite origin:
 * - UI at /dealwatch/* (always, even if API boot fails)
 * - APIs at /api/dealwatch/* (rewritten to /api/* for the existing handler)
 */
export function viteDealwatchRuntimeDevPlugin(): Plugin {
  return {
    name: 'vite-dealwatch-dev',
    buildStart() {
      syncDealwatchPublicUi();
    },
    configureServer(server) {
      syncDealwatchPublicUi();

      let dealwatchRuntime: {
        handleDealwatchRequest: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
        startDealwatchRuntime: () => void;
      } | null = null;

      try {
        dealwatchRuntime = require(path.join(DEALWATCH_DIR, 'server.js'));
        dealwatchRuntime.startDealwatchRuntime();
        console.log('[dealwatch] Mounted at /dealwatch and /api/dealwatch (same Vite process)');
      } catch (err) {
        console.error('[dealwatch] API failed to load — UI still served at /dealwatch/*', err);
      }

      // Register early so /dealwatch never falls through to the SPA → storefront catch-all.
      server.middlewares.use(createDealwatchMiddleware(dealwatchRuntime));
    },
    configurePreviewServer(server) {
      syncDealwatchPublicUi();
      let dealwatchRuntime: {
        handleDealwatchRequest: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
        startDealwatchRuntime: () => void;
      } | null = null;
      try {
        dealwatchRuntime = require(path.join(DEALWATCH_DIR, 'server.js'));
        dealwatchRuntime.startDealwatchRuntime();
      } catch (err) {
        console.error('[dealwatch] Preview API failed to load — UI still served', err);
      }
      server.middlewares.use(createDealwatchMiddleware(dealwatchRuntime));
    },
  };
}
