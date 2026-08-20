/**
 * Fail fast on JSX/TS syntax errors before Vite (same class of failure as Vercel deploys).
 * Run: npx tsx scripts/verify-tsx-parse.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

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

const root = process.cwd();
const files = walk(root);

const errors: string[] = [];
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(root, file).replace(/\\/g, '/');
  const result = ts.transpileModule(src, {
    fileName: rel,
    reportDiagnostics: true,
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  });
  for (const d of result.diagnostics || []) {
    if (d.category !== ts.DiagnosticCategory.Error) continue;
    const pos =
      typeof d.start === 'number' && d.file
        ? d.file.getLineAndCharacterOfPosition(d.start)
        : null;
    const loc = pos ? `${rel}:${pos.line + 1}:${pos.character + 1}` : rel;
    errors.push(`${loc} ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
  }
}

if (errors.length > 0) {
  console.error(errors.join('\n'));
  process.exit(1);
}

console.log(`verify-tsx-parse: ok (${files.length} files)`);
