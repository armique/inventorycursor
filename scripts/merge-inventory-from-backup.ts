/**
 * CLI for surgical inventory restore — see utils/mergeInventoryFromBackup.ts
 *
 *   npx tsx scripts/merge-inventory-from-backup.ts --backup data/restore-reference-GG.json --current path/to/current-export.json
 *   npx tsx scripts/merge-inventory-from-backup.ts ... --apply --out data/merged-current.json
 */

import fs from 'node:fs';
import path from 'node:path';
import type { InventoryItem } from '../types';
import {
  mergeInventoryFromBackup,
  type MergeOptions,
} from '../utils/mergeInventoryFromBackup';

type Envelope = { wrapped: boolean; raw: unknown; inventory: InventoryItem[] };

function loadInventoryFile(file: string): Envelope {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (Array.isArray(raw)) {
    return { wrapped: false, raw, inventory: raw as InventoryItem[] };
  }
  if (raw && Array.isArray(raw.inventory)) {
    return { wrapped: true, raw, inventory: raw.inventory as InventoryItem[] };
  }
  throw new Error(
    `File ${file} is neither an InventoryItem[] array nor an app export with an "inventory" array.`,
  );
}

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const nxt = argv[i + 1];
    if (nxt && !nxt.startsWith('--')) {
      args[key] = nxt;
      i++;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function fmt(v: unknown): string {
  if (Array.isArray(v)) return `[${v.length} ids]`;
  if (v === undefined) return '∅';
  return String(v);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const backupPath = (args.backup as string) || 'data/restore-reference-GG.json';
  const currentPath = args.current as string | undefined;
  const apply = Boolean(args.apply);
  const limit = args.limit ? Number(args.limit) : 40;

  const opts: MergeOptions = {
    patchNames: Boolean(args['patch-names']),
    forcePrices: Boolean(args['force-prices']),
    patchChildStatus: !args['no-child-status'],
  };

  if (!fs.existsSync(backupPath)) {
    console.error(`Backup not found: ${backupPath}`);
    process.exit(1);
  }

  if (!currentPath) {
    console.log(
      [
        'No --current supplied.',
        '',
        'Export current inventory first: Settings › Download backup JSON',
        '',
        `  npx tsx scripts/merge-inventory-from-backup.ts --backup ${backupPath} --current path/to/current-export.json`,
        '',
        'Add --apply to write a merged file for re-import.',
      ].join('\n'),
    );
    process.exit(0);
  }

  const backupEnv = loadInventoryFile(backupPath);
  const currentEnv = loadInventoryFile(currentPath);

  const { merged, report } = mergeInventoryFromBackup(
    currentEnv.inventory,
    backupEnv.inventory,
    opts,
  );

  console.log('='.repeat(70));
  console.log('SURGICAL INVENTORY MERGE — ' + (apply ? 'APPLY' : 'DRY-RUN'));
  console.log('='.repeat(70));
  console.log(`backup file      : ${backupPath} (${report.backupCount} items)`);
  console.log(`current file     : ${currentPath} (${report.currentCount} items)`);
  console.log(`matched by id    : ${report.matchedById}`);
  console.log(`backup-only      : ${report.backupOnlySkipped} (NOT added)`);
  console.log(`current-only     : ${report.currentOnlyUntouched} (left unchanged)`);
  console.log('-'.repeat(70));
  console.log(`items changed    : ${report.itemsChanged}`);
  console.log(`field changes    : ${report.fieldChanges}`);
  console.log(`  by category    : ${JSON.stringify(report.changesByCategory)}`);
  console.log(`  by field       : ${JSON.stringify(report.changesByField)}`);
  console.log(`abrechnung guard : ${report.skippedAbrechnungPrice} rows kept current prices`);
  console.log('-'.repeat(70));
  console.log(`sample changes (first ${Math.min(limit, report.changes.length)} of ${report.changes.length}):`);
  for (const c of report.changes.slice(0, limit)) {
    console.log(
      `  [${c.category}] ${c.id}  ${c.field}: ${fmt(c.from)} -> ${fmt(c.to)}   (${c.name})`,
    );
  }

  if (!apply) {
    console.log('-'.repeat(70));
    console.log('DRY-RUN: nothing written. Re-run with --apply to produce a merged file.');
    return;
  }

  const outPath =
    (args.out as string) ||
    `data/merged-inventory-${new Date().toISOString().slice(0, 10)}.json`;

  const outData = currentEnv.wrapped
    ? { ...(currentEnv.raw as Record<string, unknown>), inventory: merged }
    : merged;

  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(outData, null, 2), 'utf8');

  const diffPath = outPath.replace(/\.json$/i, '') + '.diff.json';
  fs.writeFileSync(
    diffPath,
    JSON.stringify({ generatedAt: new Date().toISOString(), backupPath, currentPath, options: opts, report }, null, 2),
    'utf8',
  );

  console.log('-'.repeat(70));
  console.log(`APPLIED. Merged inventory -> ${outPath}`);
  console.log(`Change log               -> ${diffPath}`);
}

main();
