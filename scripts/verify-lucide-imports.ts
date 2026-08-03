/**
 * Fail if a lucide-react icon is used in JSX without being imported in that file.
 * Run: npx tsx scripts/verify-lucide-imports.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

function walk(dir: string, out: string[] = []): string[] {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      ent.name === 'node_modules' ||
      ent.name === 'dist' ||
      ent.name === '.git' ||
      ent.name === 'dealwatch-runtime' ||
      ent.name === 'public'
    ) {
      continue;
    }
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (/\.(tsx|jsx)$/.test(ent.name)) out.push(p);
  }
  return out;
}

function parseLucideImports(src: string): Set<string> {
  const imported = new Set<string>();
  const importRe = /import\s*\{([^}]+)\}\s*from\s*['"]lucide-react['"]/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(src))) {
    for (const part of m[1].split(',')) {
      const bit = part.trim();
      if (!bit) continue;
      const asMatch = bit.match(/^(\w+)\s+as\s+(\w+)$/);
      if (asMatch) {
        imported.add(asMatch[1]!);
        imported.add(asMatch[2]!);
      } else imported.add(bit.replace(/\s+/g, ''));
    }
  }
  return imported;
}

const root = process.cwd();
const files = walk(root);

const allLucideNames = new Set<string>();
for (const file of files) {
  for (const name of parseLucideImports(fs.readFileSync(file, 'utf8'))) {
    allLucideNames.add(name);
  }
}

const missing: { file: string; icons: string[] }[] = [];

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const imported = parseLucideImports(src);

  // Strip TS generics / type args so useState<Check[]> does not look like <Check
  const withoutGenerics = src.replace(/<[A-Z][A-Za-z0-9_.|<>,\s?[\]-]*>/g, ' ');

  const localDefs = new Set<string>();
  const defRe = /(?:function|const|class|type|interface)\s+([A-Z][A-Za-z0-9]*)/g;
  let m: RegExpExecArray | null;
  while ((m = defRe.exec(src))) localDefs.add(m[1]!);

  const otherImported = new Set<string>();
  const otherImportRe =
    /import\s+(?:type\s+)?(?:([A-Za-z0-9_]+)|\{([^}]+)\})\s+from\s+['"][^'"]+['"]/g;
  while ((m = otherImportRe.exec(src))) {
    if (m[1]) otherImported.add(m[1]);
    if (m[2]) {
      for (const part of m[2].split(',')) {
        const bit = part.trim();
        if (!bit || bit.startsWith('type ')) continue;
        const asMatch = bit.match(/(?:type\s+)?(\w+)\s+as\s+(\w+)/);
        if (asMatch) {
          otherImported.add(asMatch[2]!);
          continue;
        }
        const plain = bit.match(/^(?:type\s+)?(\w+)$/);
        if (plain) otherImported.add(plain[1]!);
      }
    }
  }

  const missingHere = new Set<string>();
  // Real JSX tags only: <Icon or <Icon/
  const useRe = /<([A-Z][A-Za-z0-9]*)(?:\s|\/|>)/g;
  while ((m = useRe.exec(withoutGenerics))) {
    const name = m[1]!;
    if (!allLucideNames.has(name)) continue;
    if (imported.has(name)) continue;
    if (localDefs.has(name)) continue;
    if (otherImported.has(name)) continue;
    missingHere.add(name);
  }

  if (missingHere.size) {
    missing.push({
      file: path.relative(root, file).replace(/\\/g, '/'),
      icons: [...missingHere].sort(),
    });
  }
}

assert.equal(
  missing.length,
  0,
  `Missing lucide-react imports:\n${missing
    .map((h) => `  ${h.file}: ${h.icons.join(', ')}`)
    .join('\n')}`
);

console.log(`OK: lucide imports complete (${files.length} TSX files scanned)`);
