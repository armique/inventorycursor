/**
 * Shared CDP helpers for Seller Hub scrape — never touch the user's foreground login tabs.
 */
import { chromium } from 'playwright';
import { CDP_URL } from './chrome-cdp.mjs';
import { EBAY_SELLER_HUB_ORDERS_URL } from '../lib/ebaySellerHubPayout.js';

export { CDP_URL };

export function isLoginUrl(url) {
  const u = String(url || '');
  return /accounts\.google\.com|signin\.ebay\.(de|com)|\/signin/i.test(u);
}

export function isHubOrdersUrl(url) {
  return /ebay\.(de|com)\/sh\/ord/i.test(String(url || ''));
}

export async function connectHubBrowser(cdpUrl = CDP_URL) {
  try {
    return await chromium.connectOverCDP(cdpUrl);
  } catch {
    return null;
  }
}

export async function inspectHubBrowser(browser) {
  const ctx = browser.contexts()[0];
  if (!ctx) {
    return { loginInProgress: false, hubReady: false, cdpAvailable: true, tabs: [] };
  }
  const tabs = [];
  let loginInProgress = false;
  let hubReady = false;
  for (const p of ctx.pages()) {
    if (p.isClosed()) continue;
    try {
      const url = p.url();
      tabs.push(url);
      if (isLoginUrl(url)) loginInProgress = true;
      if (isHubOrdersUrl(url) && !isLoginUrl(url)) hubReady = true;
    } catch {
      /* tab mid-navigation */
    }
  }
  return { loginInProgress, hubReady, cdpAvailable: true, tabs };
}

export async function runHubPreflight(cdpUrl = CDP_URL) {
  const browser = await connectHubBrowser(cdpUrl);
  if (!browser) {
    return {
      ok: false,
      code: 'cdp_unavailable',
      cdpAvailable: false,
      loginInProgress: false,
      hubReady: false,
      tabs: [],
      openUrl: EBAY_SELLER_HUB_ORDERS_URL,
      hint: 'Double-click Inventory Pro on your Desktop to start Chrome with Hub sync.',
    };
  }
  try {
    const info = await inspectHubBrowser(browser);
    return {
      ok: true,
      code: info.loginInProgress ? 'ebay_login_in_progress' : undefined,
      ...info,
      openUrl: EBAY_SELLER_HUB_ORDERS_URL,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

/** Dedicated background tab for scraping — does not reuse or navigate user tabs. */
export async function createBackgroundScrapePage(browser, ctx) {
  const session = await browser.newBrowserCDPSession();
  try {
    const pagePromise = ctx.waitForEvent('page', { timeout: 10000 });
    await session.send('Target.createTarget', {
      url: 'about:blank',
      background: true,
    });
    const page = await pagePromise;
    return { page, owned: true };
  } catch {
    const page = await ctx.newPage();
    return { page, owned: true };
  } finally {
    await session.detach().catch(() => {});
  }
}

function urlRoughMatch(a, b) {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.hostname === ub.hostname && ua.pathname.replace(/\/$/, '') === ub.pathname.replace(/\/$/, '');
  } catch {
    return String(a || '').includes(String(b || ''));
  }
}

/**
 * Open a URL in the debug Chrome window without spawning a second browser process.
 * Prefer background tabs so login flows in the foreground are not interrupted.
 */
export async function openCdpTab(url, { background = true, cdpUrl = CDP_URL } = {}) {
  const browser = await connectHubBrowser(cdpUrl);
  if (!browser) return { ok: false, reason: 'cdp_unavailable' };
  const ctx = browser.contexts()[0];
  if (!ctx) {
    await browser.close().catch(() => {});
    return { ok: false, reason: 'no_context' };
  }

  try {
    for (const p of ctx.pages()) {
      if (p.isClosed()) continue;
      try {
        if (urlRoughMatch(p.url(), url)) {
          return { ok: true, reused: true };
        }
      } catch {
        /* ignore */
      }
    }

    if (background) {
      const session = await browser.newBrowserCDPSession();
      try {
        const pagePromise = ctx.waitForEvent('page', { timeout: 10000 });
        await session.send('Target.createTarget', { url, background: true });
        await pagePromise;
      } finally {
        await session.detach().catch(() => {});
      }
    } else {
      const page = await ctx.newPage();
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
    }
    return { ok: true, reused: false };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  } finally {
    await browser.close().catch(() => {});
  }
}
