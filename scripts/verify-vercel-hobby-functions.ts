/**
 * Hobby plan: max 12 serverless functions (one per api/*.js).
 * Run: npx tsx scripts/verify-vercel-hobby-functions.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const HOBBY_MAX = 12;
const apiDir = path.join(process.cwd(), 'api');
const files = fs
  .readdirSync(apiDir)
  .filter((name) => /\.(js|mjs|ts)$/.test(name))
  .sort();

assert.ok(
  files.length <= HOBBY_MAX,
  `Vercel Hobby allows ${HOBBY_MAX} serverless functions; api/ has ${files.length}:\n${files.map((f) => `  ${f}`).join('\n')}`
);

console.log(`verify-vercel-hobby-functions: ok (${files.length}/${HOBBY_MAX})`);
