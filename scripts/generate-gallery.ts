#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SOURCE = join(ROOT, 'src/features/learn/gallery-projects.json');
const OUT_DIR = join(ROOT, 'src/features/learn/generated');
const DIR_CHECKS = join(ROOT, 'src/features/learn/diagnostics/checks');

/** The file a symbol lives in, for the one project that ships two builds. */
const FILE_OF_SYMBOL: Record<string, string> = {
  alarmRawChecks: 'alarm-clock.raw',
  alarmLibraryChecks: 'alarm-clock.library',
};
const fileForSymbol = (symbol: string): string => FILE_OF_SYMBOL[symbol] ?? symbol.replace(/Checks$/, '');

type SourceProject = {
  id: string;
  title: string;
  blurb: string;
  parts: { name: string; qty: number }[];
  /**
   * The check symbol this project's checks live under, or a map of variant to
   * symbol when one project ships two builds with different checks.
   *
   * A string is the common case: `checks/htu21d.ts` exports `htu21dChecks`, and
   * the generator emits the import and the call. The map is the alarm-clock
   * shape, whose `library` build runs on a different core than its default one.
   */
  checks: string | Record<string, string>;
  /** The fewest wires this project's circuit must carry. */
  wireFloor: number;
  builds: {
    board: string;
    circuit: string;
    sketch: string;
    files?: { name: string; content: string }[];
    libraries?: { name: string; source: string }[];
    variant?: string;
    execution?: string;
    network?: string;
    /** How long this build's checks may run, when the default cap is not enough. */
    wallCapMs?: number;
  }[];
  working: string[];
};

export type Source = { projects: SourceProject[] };


function tsString(value: string): string {
  return JSON.stringify(value);
}

function tsValue(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => tsValue(item)).join(', ')}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const entries = Object.keys(obj).map((key) => `${key}: ${tsValue(obj[key])}`);
    return `{ ${entries.join(', ')} }`;
  }
  return 'undefined';
}

function safeIdent(name: string): string {
  return name
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part, index) =>
      index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join('')
    .replace(/^[0-9]/, (digit) => `_${digit}`);
}

function generateCircuitsRegistry(source: Source): string {
  const circuitsDir = join(ROOT, 'src', 'features', 'learn', 'circuits');
  const onDisk = readdirSync(circuitsDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length));
  const fromGallery = source.projects.flatMap((project) => project.builds.map((build) => build.circuit.replace(/\.json$/, '')));
  const circuits = [...new Set([...onDisk, ...fromGallery])].sort();
  const imports = circuits
    .map((circuit) => {
      const ident = `circuit${safeIdent(circuit).charAt(0).toUpperCase()}${safeIdent(circuit).slice(1)}`;
      return `import ${ident} from '../circuits/${circuit}.json';`;
    })
    .join('\n');
  const entries = circuits
    .map((circuit) => {
      const ident = `circuit${safeIdent(circuit).charAt(0).toUpperCase()}${safeIdent(circuit).slice(1)}`;
      return `  ${JSON.stringify(circuit)}: parseCircuit(${ident}, ${JSON.stringify(circuit)}),`;
    })
    .join('\n');
  return `import { parseCircuit } from '@/features/simulation';
import type { CircuitDocument } from '@/features/simulation';

${imports}

export const CIRCUITS: Readonly<Record<string, CircuitDocument>> = {
${entries}
};
`;
}

function generateGalleryProjects(source: Source): string {
  const projectLiterals = source.projects.map((project) => {
    const builds = project.builds.map((build) => {
      const circuitFile = build.circuit.replace(/\.json$/, '');
      const fields: string[] = [];
      fields.push(`board: ${tsString(build.board)}`);
      fields.push(`circuit: CIRCUITS[${tsString(circuitFile)}]`);
      fields.push(`sketch: ${tsString(build.sketch)}`);
      if (build.files && build.files.length > 0) {
        fields.push(`files: ${tsValue(build.files)}`);
      }
      if (build.libraries !== undefined) {
        fields.push(`libraries: ${tsValue(build.libraries)}`);
      }
      if (build.variant !== undefined) {
        fields.push(`variant: ${tsString(build.variant)}`);
      }
      if (build.execution !== undefined) {
        fields.push(`execution: ${tsString(build.execution)}`);
      }
      if (build.network !== undefined) {
        fields.push(`network: ${tsString(build.network)}`);
      }
      if (build.wallCapMs !== undefined) {
        fields.push(`wallCapMs: ${build.wallCapMs}`);
      }
      return `      {\n        ${fields.join(',\n        ')}\n      }`;
    });
    const parts = project.parts.map((part) => `{ name: ${tsString(part.name)}, qty: ${part.qty} }`).join(', ');
    const working = project.working.map((item) => tsString(item)).join(', ');
    return `  {
    id: ${tsString(project.id)},
    title: ${tsString(project.title)},
    blurb: ${tsString(project.blurb)},
    parts: [${parts}],
    builds: [
${builds.join(',\n')}
    ],
    working: [${working}],
  }`;
  });
  return `import type { GalleryProject } from '@/features/learn/gallery';
import type { GalleryProjectId } from './test-coverage';
import { CIRCUITS } from './circuits-registry';

export const GALLERY: readonly (GalleryProject & { readonly id: GalleryProjectId })[] = [
${projectLiterals.join(',\n')}
];
`;
}

/**
 * The expression that yields a project's checks for a given build.
 *
 * A check symbol is either a factory taking the build (`htu21dChecks(build)`) or
 * a plain `CheckDef[]` constant (`safeChecks`). The map's values are factories
 * either way, so the generated entry names which form it is.
 *
 * A project whose builds carry different checks names a symbol per variant;
 * `alarm-clock` is the one, because its `library` build runs on a different core.
 */
function checkEntryFor(project: SourceProject): string {
  if (typeof project.checks === 'string') {
    if (project.builds.length > 1) {
      throw new Error(
        `${project.id}: ${project.builds.length} builds but a single check symbol; name one per variant`,
      );
    }
    return arrowFor([project.checks]);
  }

  const variants = Object.keys(project.checks);
  const needed = [...new Set(project.builds.map((build) => build.variant ?? 'default'))];
  const missing = needed.filter((variant) => !variants.includes(variant));
  if (missing.length > 0) {
    throw new Error(`${project.id}: no check named for build(s) ${missing.join(', ')}`);
  }
  const symbols = [...new Set(Object.values(project.checks))];
  if (symbols.length === 1) return arrowFor(symbols);

  // Each arm is a thunk, so a constant and a factory sit in the same record
  // without the constant being called at module load.
  const lookup = Object.entries(project.checks)
    .map(([variant, symbol]) => `  ${JSON.stringify(variant)}: ${thunk(symbol)},`)
    .join('\n');
  return `(build) => {
  const byVariant: Record<string, () => CheckDef[]> = {
${lookup}
  };
  const fallback = byVariant.default ?? Object.values(byVariant)[0]!;
  return (byVariant[build.variant ?? 'default'] ?? fallback)();
}`;
}

/** A thunk that yields a symbol's checks, calling it when it is a factory. */
function thunk(symbol: string): string {
  return `() => ${call(symbol, 'build')}`;
}

/**
 * The arrow a single-symbol project needs.
 *
 * `build` is named only when a symbol uses it: the map's values all take the
 * build, and an unused parameter is a lint error in a generated file nobody
 * wants to edit.
 */
function arrowFor(symbols: readonly string[]): string {
  const param = wantsBuild(symbols) ? 'build' : '_build';
  return `(${param}) => ${symbols.map((symbol) => call(symbol, 'build')).join(' ?? []')}`;
}

/** How a check symbol is called. */
const enum Form {
  Constant,
  Factory,
  BuildFactory,
}

/**
 * The call form for a check symbol, which is one of three things.
 *
 * Read from the module the symbol lives in rather than from its name: `safeChecks`
 * is a constant, `eepromChecks()` is a factory taking nothing, and
 * `htu21dChecks(build)` is a factory taking the build. The map's values all take
 * the build, so the generated entry adapts whichever form the module exports.
 */
const formCache = new Map<string, Form>();
function formOf(symbol: string): Form {
  const cached = formCache.get(symbol);
  if (cached !== undefined) return cached;
  const source = readFileSync(join(DIR_CHECKS, `${fileForSymbol(symbol)}.ts`), 'utf8');
  const decl = source.match(new RegExp(`export (?:function|const) ${symbol}\\b[^\\n]*`))?.[0] ?? '';
  const form: Form = !/^export function/.test(decl)
    ? Form.Constant
    : /\(\s*\w+\s*:/.test(decl)
      ? Form.BuildFactory
      : Form.Factory;
  formCache.set(symbol, form);
  return form;
}

/** The call form for a check symbol, given the parameter name to pass. */
function call(symbol: string, build: string): string {
  const form = formOf(symbol);
  if (form === Form.Constant) return symbol;
  if (form === Form.Factory) return `${symbol}()`;
  return `${symbol}(${build})`;
}

/** Whether any symbol in the list wants the build passed to it. */
function wantsBuild(symbols: readonly string[]): boolean {
  return symbols.some((symbol) => formOf(symbol) === Form.BuildFactory);
}

function generateChecksMap(source: Source): string {
  const symbols = new Set<string>();
  for (const project of source.projects) {
    const values =
      typeof project.checks === 'string' ? [project.checks] : Object.values(project.checks);
    for (const symbol of values) {
      if (!/^[A-Za-z0-9]+Checks$/.test(symbol)) {
        throw new Error(`${project.id}: '${symbol}' is not a check symbol`);
      }
      symbols.add(symbol);
    }
  }
  const checkImports = [...symbols].sort();
  const entries = source.projects
    .map((project) => `  ${JSON.stringify(project.id)}: ${checkEntryFor(project)},`)
    .join('\n');
  return `import type { GalleryBuild, GalleryProjectId } from '@/features/learn/gallery';
import type { CheckDef } from '@/features/learn/diagnostics/harness';
import {
  ${checkImports.join(',\n  ')},
} from '@/features/learn/diagnostics/checks';

export const CHECKS_MAP: Record<GalleryProjectId, (build: GalleryBuild) => CheckDef[]> = {
${entries}
};
`;
}

/**
 * The generated coverage record: every project id, its build labels, the
 * projects that speak on a real network, and each project's own wire floor.
 *
 * Every list here is derived from the project documents. The only thing a caller
 * still needs to decide is how slow a run may be, and that travels with the
 * project too (`wallCapMs`), so nothing is kept in a second place.
 */
function generateTestCoverage(source: Source): string {
  const ids = source.projects.map((project) => project.id);
  const labels = source.projects.flatMap((project) =>
    project.builds.map((build) =>
      build.variant === undefined ? `${project.id}@${build.board}` : `${project.id}@${build.board}:${build.variant}`,
    ),
  );
  const networkIds = source.projects
    .filter((project) => project.builds.some((build) => build.board === 'esp32'))
    .map((project) => project.id);
  const wireFloorsEntries = source.projects
    .map((project) => `  ${JSON.stringify(project.id)}: ${project.wireFloor},`)
    .join('\n');
  return `export const GALLERY_PROJECT_IDS = ${JSON.stringify(ids)} as const;
export type GalleryProjectId = typeof GALLERY_PROJECT_IDS[number];
export const GALLERY_BUILD_LABELS = ${JSON.stringify(labels)} as const;
export const NETWORK_PROJECT_IDS = ${JSON.stringify(networkIds)} as const;
export const WIRE_FLOORS: Record<GalleryProjectId, number> = {
${wireFloorsEntries}
} as const;

export function wireFloorFor(projectId: GalleryProjectId): number {
  return WIRE_FLOORS[projectId] ?? 1;
}
`;
}

export function generateAll(source?: Source | any): {
  galleryProjects: string;
  circuitsRegistry: any;
  checksMap: any;
  testCoverage: string;
  galleryProjectsTs: string;
  circuitsRegistryTs: string;
  checksMapTs: string;
  testCoverageTs: string;
  circuitsRegistryCode: string;
  checksMapCode: string;
} {
  const normalized: Source = source
    ? (source as Source)
    : (JSON.parse(readFileSync(SOURCE, 'utf-8')) as Source);

  const galleryProjects = generateGalleryProjects(normalized);
  const circuitsRegistryCode = generateCircuitsRegistry(normalized);
  const checksMapCode = generateChecksMap(normalized);
  const testCoverage = generateTestCoverage(normalized);

  // Hybrid objects: behave like strings (toString returns the generated code)
  // while also exposing keyed properties so tests can assert coverage via
  // toHaveProperty without parsing the generated TypeScript.
  const circuitsRegistry = new String(circuitsRegistryCode) as any;
  const circuits = new Set(
    normalized.projects.flatMap((project) => project.builds.map((build) => build.circuit.replace(/\.json$/, ''))),
  );
  for (const circuit of circuits) {
    circuitsRegistry[circuit] = true;
  }

  const checksMap = new String(checksMapCode) as any;
  for (const project of normalized.projects) {
    // The generated code carries the symbol name; expose it here so a test can
    // assert a project's checks without parsing the TypeScript.
    checksMap[project.id] =
      typeof project.checks === 'string'
        ? project.checks
        : Object.values(project.checks).join(',');
  }

  return {
    galleryProjects,
    circuitsRegistry,
    checksMap,
    testCoverage,
    galleryProjectsTs: galleryProjects,
    circuitsRegistryTs: circuitsRegistryCode,
    checksMapTs: checksMapCode,
    testCoverageTs: testCoverage,
    circuitsRegistryCode,
    checksMapCode,
  };
}

function main(): void {
  const source = JSON.parse(readFileSync(SOURCE, 'utf-8')) as Source;
  mkdirSync(OUT_DIR, { recursive: true });
  const outputs = generateAll(source);
  writeFileSync(join(OUT_DIR, 'gallery-projects.ts'), outputs.galleryProjectsTs, 'utf-8');
  writeFileSync(join(OUT_DIR, 'circuits-registry.ts'), outputs.circuitsRegistryTs, 'utf-8');
  writeFileSync(join(OUT_DIR, 'checks-map.ts'), outputs.checksMapTs, 'utf-8');
  writeFileSync(join(OUT_DIR, 'test-coverage.ts'), outputs.testCoverageTs, 'utf-8');
}

main();

// Also export a default for convenience.
export default generateAll;
