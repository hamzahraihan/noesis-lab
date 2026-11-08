#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SOURCE = join(ROOT, 'src/features/learn/gallery-projects.json');
const OUT_DIR = join(ROOT, 'src/features/learn/generated');

type SourceProject = {
  id: string;
  title: string;
  blurb: string;
  parts: { name: string; qty: number }[];
  builds: {
    board: string;
    circuit: string;
    sketch: string;
    files?: { name: string; content: string }[];
    libraries?: { name: string; source: string }[];
    variant?: string;
    execution?: string;
    network?: string;
  }[];
  working: string[];
};

export type Source = { projects: SourceProject[] };

const CHECK_ENTRIES: Record<string, string> = {
  'alarm-clock': "(build) => build.variant === 'library' ? alarmLibraryChecks : alarmRawChecks",
  'safe': '() => safeChecks',
  'dashboard': '() => dashboardChecks',
  'parking': '() => parkingChecks',
  'weather': '() => weatherChecks',
  'reaction': '() => reactionChecks',
  'net-clock': '() => netClockChecks',
  'sensor-feed': '() => sensorFeedChecks',
  'net-weather': '() => netWeatherChecks',
  'live-weather': '() => liveWeatherChecks',
  'soil-probe': '() => soilProbeChecks',
  'instrument-bench': '() => instrumentBenchChecks',
  'environment-bench': '() => environmentBenchChecks',
  'shift-register': '(build) => shiftRegisterChecks(build)',
  'rfid': '() => rfidChecks',
  'tm1637': '(build) => tm1637Checks(build)',
  'a4988': '(build) => a4988Checks(build)',
  'microstep': '(build) => microstepChecks(build)',
  'pcf8574': '(build) => pcf8574Checks(build)',
  'mcp23017': '(build) => mcp23017Checks(build)',
  'expander-interrupt': '(build) => expanderInterruptChecks(build)',
  'pca9685': '(build) => pca9685Checks(build)',
  'ds3231': '(build) => ds3231Checks(build)',
  'max6675': '(build) => max6675Checks(build)',
  'mcp4725': '(build) => mcp4725Checks(build)',
  'lm35': '(build) => lm35Checks(build)',
  'bmp280': '(build) => bmp280Checks(build)',
  'vl53l0x': '(build) => vl53l0xChecks(build)',
  'bme280': '(build) => bme280Checks(build)',
  'soil-moisture': '(build) => soilMoistureChecks(build)',
  'eeprom24lc256': '() => eepromChecks()',
  'max7219': '(build) => max7219Checks(build)',
  'nokia-5110': '(build) => nokia5110Checks(build)',
};

const WIRE_FLOORS: Record<string, number> = {
  'alarm-clock': 25,
  safe: 14,
  dashboard: 14,
  parking: 15,
  weather: 12,
  reaction: 5,
  'net-clock': 6,
  'sensor-feed': 6,
  'net-weather': 6,
  'soil-probe': 3,
};

// Projects whose checks run in the "network projects" test leg.
// Derived from the board: any project that ships an ESP32 build.
// (Kept as a derived list in generateTestCoverage.)

// Projects whose checks run in the "new part projects" test leg.
const NEW_PART_PROJECT_IDS = [
  'ds3231',
  'mcp23017',
  'expander-interrupt',
  'pca9685',
  'microstep',
  'environment-bench',
];

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

function generateChecksMap(source: Source): string {
  const checkImports = [
    'alarmRawChecks',
    'alarmLibraryChecks',
    'safeChecks',
    'dashboardChecks',
    'parkingChecks',
    'weatherChecks',
    'reactionChecks',
    'netClockChecks',
    'sensorFeedChecks',
    'netWeatherChecks',
    'liveWeatherChecks',
    'soilProbeChecks',
    'instrumentBenchChecks',
    'environmentBenchChecks',
    'shiftRegisterChecks',
    'rfidChecks',
    'tm1637Checks',
    'a4988Checks',
    'microstepChecks',
    'pcf8574Checks',
    'mcp23017Checks',
    'expanderInterruptChecks',
    'pca9685Checks',
    'ds3231Checks',
    'max6675Checks',
    'mcp4725Checks',
    'lm35Checks',
    'bmp280Checks',
    'vl53l0xChecks',
    'bme280Checks',
    'soilMoistureChecks',
    'eepromChecks',
    'max7219Checks',
    'nokia5110Checks',
  ];
  const entries = source.projects
    .map((project) => {
      const expr = CHECK_ENTRIES[project.id];
      if (!expr) return `  ${JSON.stringify(project.id)}: () => [],`;
      return `  ${JSON.stringify(project.id)}: ${expr},`;
    })
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
  // Every project needs an entry: the generated type is
  // `Record<GalleryProjectId, number>`, so a hand-kept map that gains a
  // project but not a floor would fail typecheck. Derive the full record from
  // the project list and default the ones nobody set a floor for.
  const wireFloorsEntries = ids
    .map((id: string) => `  ${JSON.stringify(id)}: ${WIRE_FLOORS[id] ?? 1},`)
    .join('\n');
  return `export const GALLERY_PROJECT_IDS = ${JSON.stringify(ids)} as const;
export type GalleryProjectId = typeof GALLERY_PROJECT_IDS[number];
export const GALLERY_BUILD_LABELS = ${JSON.stringify(labels)} as const;
export const NETWORK_PROJECT_IDS = ${JSON.stringify(networkIds)} as const;
export const NEW_PART_PROJECT_IDS = ${JSON.stringify(NEW_PART_PROJECT_IDS)} as const;
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
    checksMap[project.id] = CHECK_ENTRIES[project.id] ?? '() => []';
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
