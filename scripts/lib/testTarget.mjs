/**
 * Guard for anything that writes during development or testing.
 *
 * Today a test written against the live database changed 92 real sell prices,
 * because "just point it at the real data" was one env var away. This makes that
 * impossible by construction: a test-mode script cannot resolve a connection to
 * the production project, no matter how the environment is configured.
 *
 * Production is identified by its project ref, hardcoded here rather than read
 * from the environment — a guard you can disable by editing a .env file is not a
 * guard.
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

/** The live project. Nothing in test mode may ever address this. */
export const PRODUCTION_REF = 'lkmxlwpszekfuzqpqtrb';

function refOf(url) {
  const m = /https:\/\/([a-z0-9]+)\.supabase\.co/i.exec(url || '');
  return m ? m[1] : null;
}

/**
 * Resolve the TEST Supabase client. Throws if the configured target is
 * production, or if test credentials are missing — never silently falls back to
 * production, which is the failure mode that caused the damage.
 */
export function getTestClient() {
  const url = process.env.TEST_SUPABASE_URL;
  const key = process.env.TEST_SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      'Test credentials missing. Set TEST_SUPABASE_URL and TEST_SUPABASE_SERVICE_ROLE_KEY in .env.test.\n' +
        'Refusing to fall back to the production project.'
    );
  }

  const ref = refOf(url);
  if (!ref) {
    throw new Error(`TEST_SUPABASE_URL does not look like a Supabase URL: ${url}`);
  }
  if (ref === PRODUCTION_REF) {
    throw new Error(
      `REFUSING TO RUN: TEST_SUPABASE_URL points at the PRODUCTION project (${PRODUCTION_REF}).\n` +
        'Tests must never write to live business data.'
    );
  }

  // autoRefreshToken must be off for scripts. It starts an interval timer that
  // keeps the event loop alive; combined with process.exit() Node tears down a
  // live handle and aborts with 0xC0000409 on Windows *after* printing that
  // everything passed. A green test run that exits non-zero is the worst of both
  // worlds, so the timer never gets created.
  return {
    client: createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
    ref,
    url,
  };
}

/**
 * For read-only scripts that legitimately inspect production (backups, audits).
 * Separate function so the intent is explicit at the call site and can be
 * grepped for, rather than implied by which env var happened to be set.
 */
export function getProductionClientReadOnly() {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing production Supabase credentials.');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
