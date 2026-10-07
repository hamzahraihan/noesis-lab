// Boundary gate (Task 7): bare `@/features/<n>` anywhere; deep only same-feature,
// *.test.ts, or app/routes importing bench DOM modules; `import/export type`
// erased; no `@/ui`/`@/sim` or `../sim/`/`../ui/`; no bench|instruments→learn,
// parts→simulation, or shared→features value edges. Non-zero exit + file:line.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, normalize, resolve, sep } from 'node:path';
const src = fileURLToPath(new URL('../src/', import.meta.url));
const files = [];
const walk = (d) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = resolve(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(ts|tsx)$/.test(p)) files.push(p); } };
walk(src);
const feat = (f) => (f.split(sep).includes('features') ? f.match(/features[/\\]([^/\\]+)/)[1] : f.includes(`${sep}app${sep}`) ? '@app' : f.includes(`${sep}routes${sep}`) ? '@routes' : 'shared');
const badDir = (imp, tgt) => (imp === 'bench' || imp === 'instruments') && tgt === 'learn' || imp === 'parts' && tgt === 'simulation' || imp === 'shared' && tgt !== undefined;
const errors = [];
for (const f of files) {
  const code = readFileSync(f, 'utf8').replace(/(import|export)\s+type[\s\S]*?;/g, '');
  for (const m of code.matchAll(/(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]/g)) {
    const spec = m[1], line = code.slice(0, m.index).split('\n').length, at = `${f}:${line}`;
    if (spec.startsWith('@/ui') || spec.startsWith('@/sim/') || /(^|[./\\])\.\.[\\/]+(sim|ui)[\\/]/.test(spec)) { errors.push(`${at}: legacy ${spec}`); continue; }
    const deep = spec.match(/^@\/features\/([^/]+)\/(.+)$/), tgt = deep?.[1] ?? spec.match(/^@\/features\/([^/]+)$/)?.[1];
    if (tgt && !f.endsWith('.test.ts') && badDir(feat(f), tgt)) { errors.push(`${at}: ${feat(f)} → ${tgt} value edge (${spec})`); continue; }
    if (!deep) continue;
    const owner = feat(f), ok = owner === tgt || f.endsWith('.test.ts') || (owner === '@app' || owner === '@routes') && tgt === 'bench';
    if (!ok) errors.push(`${at}: deep ${spec} outside ${tgt}`);
  }
  for (const m of code.matchAll(/(?:import|export)[^'"]*?from\s*['"](\.[^'"]*)['"]/g)) {
    const abs = normalize(resolve(dirname(f), m[1])), line = code.slice(0, m.index).split('\n').length;
    if (abs.startsWith(src) && !abs.startsWith(resolve(src, 'features', feat(f))) && /features[/\\]|sim[/\\]?$|sim[/\\]|ui[/\\]?$|ui[/\\]/.test(abs.slice(src.length))) errors.push(`${f}:${line}: cross-feature relative ${m[1]}`);
  }
}
if (errors.length > 0) { console.error(errors.join('\n')); process.exit(1); }
console.log(`boundaries ok (${files.length} files)`);
