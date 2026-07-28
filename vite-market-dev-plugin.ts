import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const require = createRequire(import.meta.url);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MARKET_DIR = path.resolve(ROOT, 'market');

const STATIC_BLOCKLIST = new Set([
  'server.js',
  'package.json',
  '.env',
  '.env.example',
  '.gitignore',
]);

const STATIC_BLOCKED_PREFIXES = ['data/', 'scripts/', 'extension/', 'node_modules/', '.agents/', '.git/'];

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

/**
 * Serves market/ (former EST) from the same Vite origin:
 * - UI at /market/*
 * - APIs at /api/est/* (rewritten to /api/* for the existing handler)
 */
export function viteMarketDevPlugin(): Plugin {
  return {
    name: 'vite-market-dev',
    configureServer(server) {
      let market: {
        handleEstRequest: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
        startMarketRuntime: () => void;
      };

      try {
        market = require(path.join(MARKET_DIR, 'server.js'));
      } catch (err) {
        console.error('[market] Failed to load market/server.js', err);
        return;
      }

      market.startMarketRuntime();
      console.log('[market] Mounted at /market and /api/est (same Vite process)');

      server.middlewares.use(async (req, res, next) => {
        const rawUrl = req.url || '';
        const pathname = rawUrl.split('?')[0] || '';

        if (pathname === '/api/est' || pathname.startsWith('/api/est/')) {
          const rewritten = rawUrl.replace(/^\/api\/est(?=\/|\?|$)/, '/api') || '/api';
          const originalUrl = req.url;
          req.url = rewritten;
          try {
            await market.handleEstRequest(req, res);
          } catch (err) {
            console.error('[market] API error:', err);
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
          if (pathname === '/market') {
            res.statusCode = 302;
            res.setHeader('Location', '/market/');
            res.end();
            return;
          }

          let rel = decodeURIComponent(pathname.slice('/market'.length) || '/');
          if (rel === '/' || rel === '') rel = '/index.html';
          const relPosix = rel.replace(/\\/g, '/').replace(/^\/+/, '');
          if (isBlockedStatic(relPosix)) {
            res.statusCode = 404;
            res.end('Not found');
            return;
          }

          const filePath = path.resolve(MARKET_DIR, relPosix);
          if (!filePath.startsWith(MARKET_DIR + path.sep) && filePath !== MARKET_DIR) {
            res.statusCode = 403;
            res.end('Forbidden');
            return;
          }
          if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
            res.statusCode = 404;
            res.end('Not found');
            return;
          }

          res.statusCode = 200;
          res.setHeader('Content-Type', contentType(filePath));
          res.setHeader('Cache-Control', 'no-store');
          fs.createReadStream(filePath).pipe(res);
          return;
        }

        next();
      });
    },
  };
}
