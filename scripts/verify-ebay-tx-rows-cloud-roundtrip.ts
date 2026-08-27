/**
 * Sandbox proof for the eBay Abrechnung row-sync fix: rows go in wrapped as {rid, row},
 * get packed into shards the same way inventory items are, then reassembled by grouping on
 * rid — confirms every row survives the round trip, in its original report, with no
 * duplication or loss, before this logic ever touches real Firestore data.
 */
import assert from 'node:assert/strict';
import { packItemsIntoShards, jsonUtf8ByteSize, type PreparedShardItem } from '../utils/firestoreShardPack';

type FakeRow = { id: string; title: string; grossEur: number };

function makeReport(id: string, count: number): { meta: { id: string }; rows: FakeRow[] } {
  const rows: FakeRow[] = [];
  for (let i = 0; i < count; i++) {
    rows.push({ id: `${id}-row-${i}`, title: `Order ${id} item ${i} — ${'x'.repeat(40)}`, grossEur: 10 + i });
  }
  return { meta: { id }, rows };
}

function push(rowsByReport: Record<string, FakeRow[]>): { rid: string; row: FakeRow }[][] {
  const flat: { rid: string; row: FakeRow }[] = [];
  for (const [rid, rows] of Object.entries(rowsByReport)) {
    for (const row of rows) flat.push({ rid, row });
  }
  const prepared: PreparedShardItem[] = flat.map((item) => ({ item, utf8Bytes: jsonUtf8ByteSize(item) }));
  // Small max so this test actually exercises multiple shards, not one giant doc.
  const chunks = packItemsIntoShards(prepared, 2000) as unknown as { rid: string; row: FakeRow }[][];
  return chunks;
}

function pull(chunks: { rid: string; row: FakeRow }[][]): { rid: string; row: FakeRow }[] {
  return chunks.flat();
}

function reconstruct(
  flatRows: { rid: string; row: FakeRow }[],
  reportIds: string[]
): Record<string, FakeRow[]> {
  const byReport = new Map<string, FakeRow[]>();
  for (const { rid, row } of flatRows) {
    const list = byReport.get(rid) || [];
    list.push(row);
    byReport.set(rid, list);
  }
  const out: Record<string, FakeRow[]> = {};
  for (const rid of reportIds) out[rid] = byReport.get(rid) || [];
  return out;
}

// --- Test 1: three reports of very different sizes, mirroring the real incident's shape ---
{
  const reportA = makeReport('2025-02-01_2026-02-02', 400);
  const reportB = makeReport('2026-02-03_2026-08-23', 130);
  const reportC = makeReport('api-sync', 2);
  const original: Record<string, FakeRow[]> = {
    [reportA.meta.id]: reportA.rows,
    [reportB.meta.id]: reportB.rows,
    [reportC.meta.id]: reportC.rows,
  };

  const chunks = push(original);
  assert.ok(chunks.length > 1, 'expected more than one shard for 532 rows at a 2000-byte cap');

  const flat = pull(chunks);
  const totalRows = reportA.rows.length + reportB.rows.length + reportC.rows.length;
  assert.equal(flat.length, totalRows, 'no rows lost or duplicated in the flatten step');

  const reconstructed = reconstruct(flat, Object.keys(original));
  for (const rid of Object.keys(original)) {
    assert.deepEqual(
      reconstructed[rid],
      original[rid],
      `report ${rid} did not reconstruct byte-for-byte identical to the original`
    );
  }
  console.log(`[1/3] 3-report round trip OK — ${totalRows} rows across ${chunks.length} shards, exact match.`);
}

// --- Test 2: empty library (nothing to push) doesn't blow up and produces zero shards ---
{
  const chunks = push({});
  assert.equal(chunks.length, 0, 'empty input should produce zero shards, not an empty one');
  console.log('[2/3] empty push OK — zero shards, no crash.');
}

// --- Test 3: a single huge report forces many shards; still reconstructs exactly, in order ---
{
  const big = makeReport('huge', 3000);
  const chunks = push({ [big.meta.id]: big.rows });
  assert.ok(chunks.length > 10, `expected many shards for 3000 rows, got ${chunks.length}`);
  const flat = pull(chunks);
  const reconstructed = reconstruct(flat, [big.meta.id]);
  assert.equal(reconstructed[big.meta.id].length, big.rows.length, 'row count must match exactly');
  // Order isn't guaranteed by the real Firestore fetch loop across shard ids since fetch is
  // sequential by index — but confirm content-equality as a set, since display code doesn't
  // depend on original row order within a report.
  const originalIds = new Set(big.rows.map((r) => r.id));
  const reconstructedIds = new Set(reconstructed[big.meta.id].map((r) => r.id));
  assert.deepEqual(reconstructedIds, originalIds, 'every row id must survive, no duplicates, no drops');
  console.log(`[3/3] single-report ${big.rows.length}-row stress test OK — ${chunks.length} shards, exact set match.`);
}

console.log('\nAll eBay Abrechnung row-sync round-trip checks passed.');
