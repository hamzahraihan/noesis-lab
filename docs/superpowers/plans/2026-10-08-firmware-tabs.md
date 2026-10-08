# Firmware Multi-File Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bench firmware editing supports multiple project files with true `#include "…"` / `import` resolution, file-aware errors, and tabs that persist and share by link.

**Architecture:** New `FirmwareProject` model plus a per-file parse then AST-merge resolver; the VM stays single-AST ("two front ends, one VM"). Single Monaco instance swaps the active file; typing stays local-state-only and Run loads the project. String overloads are retained everywhere so existing callers pass untouched.

**Tech Stack:** TypeScript, React, Monaco (`@monaco-editor/react`), Vitest (node env), `lz-string` (MIT) for `?files=` compression.

**Spec:** `docs/superpowers/specs/2026-10-08-firmware-tabs-design.md`

## Global Constraints

- Entry file required: `main.ino` (C++) or `main.py` (Python); entry cannot be renamed or deleted.
- Helper extensions: C++ `*.h`, `*.cpp`, `*.ino`; Python `*.py`.
- Filename validation: `^[a-z0-9_-]+\.(ino|cpp|h|py)$`, lowercase only, unique per project.
- Caps: max 8 files per project, max 32 KB per file.
- C++ local includes only: `^#\s*include\s*"([^"]+)"`; angle-bracket includes (`<Arduino.h>`, `<Wire.h>`) stay inert runtime-provided.
- Python sibling imports only: `import helpers` / `from helpers import fn` resolve to `helpers.py`; `import time` / `from gpiozero import …` stay runtime builtins.
- Mount precedence: `?ex=` / `?project=` > `?files=` > localStorage (`noesis:bench:<boardId>:project`) > starter single-file.
- Share size guard: compressed `?files=` payload over ~1800 chars disables "Copy link" (files stay local-only).
- Language switch on a multi-file project uses native `window.confirm`; cancel keeps the project; no custom modal in v1.
- Single Monaco instance; `value = active file content`; per-tab undo history is not preserved in v1.
- Backwards compatibility: `FirmwareRuntime` constructor, `FirmwareRunner` constructor, and `Simulation.loadFirmware` keep `string` overloads wrapping as `{ main.* }`; `Example.sketch` / `GalleryBuild.sketch` stay `string` in v1.
- Boundary gate: code outside a feature imports from `@/features/<name>` seams, never deep (except tests); run `node scripts/check-boundaries.mjs`.

## Review Focus

- Uppercase or spaced filename (`Helpers.H`, `my helper.cpp`) must be rejected with a named validation error, not silently accepted.
- Duplicate function across two tabs (`oledCommand` in `main.ino` and `helpers.h`) must error naming both files.
- Include/import cycle (`a.h` → `b.h` → `a.h`) must error naming the loop instead of hanging.
- Corrupt or truncated `?files=` payload must fall back to the starter with an error line, never a blank bench.
- Oversize project must disable "Copy link" with the local-only title instead of producing an unshareable URL.

---

## File structure

- Create `src/features/simulation/firmware/project.ts` — `FirmwareFile`, `FirmwareProject`, `toSingleFileProject()`, filename/content/count validation, entry helpers. Pure, node-testable. Exported via `src/features/simulation/index.ts`.
- Modify `src/features/simulation/firmware/parser.ts` — `FirmwareSyntaxError.file`, `parseFirmware(source, file?)`.
- Modify `src/features/simulation/firmware/python.ts` — `parsePython(source, file?)` threads file into errors.
- Modify `src/features/simulation/firmware/interpreter.ts` — `FirmwareRuntime.fromProject(project)`, `FirmwareRunner` project overload, include/import pre-scan + AST merge + cycle detection.
- Modify `src/features/bench/simulation.ts` — `loadFirmware(project | string, language?)` overload, keeps `firmwareSource`/`firmwareLanguage` behavior, surfaces file-prefixed errors.
- Create `src/features/bench/share-codec.ts` — `encodeProjectToShare(project)` / `decodeShareToProject(payload)` via `lz-string`, `SHARE_URL_LIMIT = 1800`.
- Create `src/features/bench/project-store.ts` — `saveBenchProject(boardId, project)`, `loadBenchProject(boardId)`, `benchProjectKey(boardId)`, storage-injected for tests.
- Modify `src/features/instruments/Panels.tsx` — `FirmwareEditor` takes `project` / `onProjectChange`, renders tab strip, single Monaco on active file, error bar with auto-switch.
- Modify `src/features/bench/Bench.tsx` — `project` state (wrapped seeds), `loadExample` wraps to single-file, language-switch `window.confirm`, autosave + `?files=` load + "Copy link" wiring.
- Tests: `project.test.ts`, `firmware-project.test.ts` (resolver), `share-codec.test.ts`, `project-store.test.ts`, plus Bench-adjacent precedence tests where node-testable.

---

### Task 1: Project model + validation

**Files:**
- Create: `src/features/simulation/firmware/project.ts`
- Modify: `src/features/simulation/index.ts`
- Test: `src/features/simulation/firmware/project.test.ts`

**Interfaces:**
- Consumes: `FirmwareLanguage` from `./interpreter` (type-only).
- Produces: `FirmwareFile`, `FirmwareProject`, `ENTRY_BY_LANGUAGE`, `toSingleFileProject(source, language, activeName?)`, `validateProject(project): string[]`, `validateFileName(name, language): string | null`, `MAX_FILES = 8`, `MAX_FILE_BYTES = 32768` for Tasks 3–7.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/simulation/firmware/project.test.ts
import { describe, expect, it } from 'vitest';
import { toSingleFileProject, validateProject } from './project';

describe('toSingleFileProject', () => {
  it('wraps a sketch as the entry file', () => {
    const project = toSingleFileProject('void setup() {}', 'arduino-cpp');
    expect(project.files).toEqual([{ name: 'main.ino', content: 'void setup() {}' }]);
    expect(project.activeName).toBe('main.ino');
  });
});

describe('validateProject', () => {
  it('rejects uppercase names', () => {
    const errors = validateProject({
      language: 'arduino-cpp',
      activeName: 'Helpers.H',
      files: [{ name: 'Helpers.H', content: 'x' }],
    });
    expect(errors.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/simulation/firmware/project.test.ts`
Expected: FAIL with "Failed to resolve import ./project" (file does not exist).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/features/simulation/firmware/project.ts
import type { FirmwareLanguage } from './interpreter';

export interface FirmwareFile { readonly name: string; readonly content: string }
export interface FirmwareProject {
  readonly language: FirmwareLanguage;
  readonly files: readonly FirmwareFile[];
  readonly activeName: string;
}

export const MAX_FILES = 8;
export const MAX_FILE_BYTES = 32 * 1024;
export const ENTRY_BY_LANGUAGE: Record<FirmwareLanguage, string> = {
  'arduino-cpp': 'main.ino',
  python: 'main.py',
};

const NAME_PATTERN = /^[a-z0-9_-]+\.(ino|cpp|h|py)$/;

export function toSingleFileProject(
  source: string,
  language: FirmwareLanguage,
  activeName?: string,
): FirmwareProject {
  const entry = ENTRY_BY_LANGUAGE[language];
  return { language, files: [{ name: entry, content: source }], activeName: activeName ?? entry };
}

export function validateFileName(name: string, language: FirmwareLanguage): string | null {
  if (!NAME_PATTERN.test(name)) return `${name}: use lowercase letters, digits, - or _ with a valid extension`;
  if (language === 'python' ? !name.endsWith('.py') : name.endsWith('.py')) {
    return `${name}: wrong extension for ${language}`;
  }
  return null;
}

export function validateProject(project: FirmwareProject): string[] {
  const errors: string[] = [];
  if (project.files.length === 0) errors.push('project has no files');
  if (project.files.length > MAX_FILES) errors.push(`project has more than ${MAX_FILES} files`);
  const entry = ENTRY_BY_LANGUAGE[project.language];
  if (!project.files.some((file) => file.name === entry)) errors.push(`${entry}: entry file is required`);
  if (!project.files.some((file) => file.name === project.activeName)) {
    errors.push(`${project.activeName}: active file is not in the project`);
  }
  const seen = new Set<string>();
  for (const file of project.files) {
    const bad = validateFileName(file.name, project.language);
    if (bad) errors.push(bad);
    if (seen.has(file.name)) errors.push(`${file.name}: duplicate file name`);
    seen.add(file.name);
    if (file.content.length > MAX_FILE_BYTES) errors.push(`${file.name}: file is larger than 32 KB`);
  }
  return errors;
}

export class FirmwareProjectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FirmwareProjectError';
  }
}
```

```ts
// src/features/simulation/index.ts — append one line:
export * from './firmware/project';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/simulation/firmware/project.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/simulation/firmware/project.ts src/features/simulation/firmware/project.test.ts src/features/simulation/index.ts
git commit -m "feat(firmware): add FirmwareProject model and validation"
```

---

### Task 2: File-aware syntax errors

**Files:**
- Modify: `src/features/simulation/firmware/parser.ts`
- Modify: `src/features/simulation/firmware/python.ts`
- Test: `src/features/simulation/firmware/file-error.test.ts`

**Interfaces:**
- Consumes: `FirmwareProjectError` shape (Task 1) for message style only.
- Produces: `FirmwareSyntaxError.file`, `parseFirmware(source, file?)`, `parsePython(source, file?)` for Task 3. Single-file callers pass nothing and get `main.ino` / `main.py` behavior unchanged.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/simulation/firmware/file-error.test.ts
import { describe, expect, it } from 'vitest';
import { parseFirmware, FirmwareSyntaxError } from './parser';
import { parsePython } from './python';

describe('file-aware errors', () => {
  it('prefixes the C++ file name', () => {
    try {
      parseFirmware('int 123broken;', 'helpers.h');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(FirmwareSyntaxError);
      expect((error as FirmwareSyntaxError).file).toBe('helpers.h');
      expect((error as Error).message).toContain('helpers.h');
    }
  });

  it('prefixes the Python file name', () => {
    try {
      parsePython('def broken(:\n  pass\n', 'helpers.py');
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toContain('helpers.py');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/simulation/firmware/file-error.test.ts`
Expected: FAIL (second arg not accepted / `.file` undefined).

- [ ] **Step 3: Write minimal implementation**

In `parser.ts`:

```ts
export class FirmwareSyntaxError extends Error {
  public readonly location: SourceLocation;
  public readonly file: string;
  constructor(message: string, location: SourceLocation, file = 'main.ino') {
    super(`${file}:${location.line}: ${message} (line ${location.line}, column ${location.column})`);
    this.name = 'FirmwareSyntaxError';
    this.location = location;
    this.file = file;
  }
}
```

Thread `file` through `tokenize` throws (add `file` param defaulting to `'main.ino'`)
and `Parser` (constructor takes `file`, every `throw new FirmwareSyntaxError(msg, loc)`
becomes `throw new FirmwareSyntaxError(msg, loc, this.file)`). Change signature to:

```ts
export function parseFirmware(source: string, file = 'main.ino'): Program {
  return new Parser(tokenize(source, file), file).parseProgram();
}
```

In `python.ts`: same pattern — `parsePython(source: string, file = 'main.py')`,
constructor/throws gain the file, message prefixed `${file}:${line}: …`. Keep all
existing single-arg call sites compiling (defaults cover them).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/simulation/firmware/file-error.test.ts src/features/simulation/firmware/firmware.test.ts src/features/simulation/firmware/python.test.ts`
Expected: PASS (new tests plus no regressions in existing parser/python suites).

- [ ] **Step 5: Commit**

```bash
git add src/features/simulation/firmware/parser.ts src/features/simulation/firmware/python.ts src/features/simulation/firmware/file-error.test.ts
git commit -m "feat(firmware): file-aware syntax errors"
```

---

### Task 3: Multi-file resolver + runtime entry

**Files:**
- Modify: `src/features/simulation/firmware/interpreter.ts`
- Test: `src/features/simulation/firmware/firmware-project.test.ts`

**Interfaces:**
- Consumes: `FirmwareProject`, `FirmwareProjectError`, `validateProject` (Task 1); `parseFirmware(source, file)`, `parsePython(source, file)` (Task 2).
- Produces: `FirmwareRuntime.fromProject(project)`, `new FirmwareRunner(project | string, services, language?)` for Task 4.

- [ ] **Step 1: Write the failing test**

```ts
// src/features/simulation/firmware/firmware-project.test.ts
import { describe, expect, it } from 'vitest';
import { FirmwareRuntime } from './interpreter';

const SERVICES = (overrides = {}) =>
  ({
    nowMs: () => 0,
    pinMode: () => {},
    digitalWrite: () => {},
    digitalRead: () => 0,
    analogWrite: () => {},
    analogRead: () => 0,
    serialBegin: () => {},
    serialWrite: () => {},
    wire: { begin: () => {}, beginTransmission: () => {}, write: () => 0, endTransmission: () => 0, requestFrom: () => 0, read: () => -1, available: () => 0 },
    spi: { begin: () => {}, transfer: () => 0, end: () => 0 },
    ...overrides,
  }) as any;

describe('fromProject', () => {
  it('calls a helper defined in another tab', () => {
    const runtime = FirmwareRuntime.fromProject({
      language: 'arduino-cpp',
      activeName: 'main.ino',
      files: [
        { name: 'main.ino', content: '#include "helpers.h"\nvoid setup() { blinkOnce(); }\nvoid loop() {}\n' },
        { name: 'helpers.h', content: 'void blinkOnce() { digitalWrite(2, 1); }\n' },
      ],
    });
    expect(runtime.hasFunction('blinkOnce')).toBe(true);
    expect(runtime.hasFunction('setup')).toBe(true);
  });

  it('reports duplicates naming both files', () => {
    expect(() =>
      FirmwareRuntime.fromProject({
        language: 'arduino-cpp',
        activeName: 'main.ino',
        files: [
          { name: 'main.ino', content: 'void dup() {}\nvoid setup() {}\nvoid loop() {}\n' },
          { name: 'helpers.h', content: 'void dup() {}\n' },
        ],
      }),
    ).toThrow(/dup.*main\.ino.*helpers\.h|helpers\.h.*main\.ino/);
  });

  it('imports a sibling python module', () => {
    const runtime = FirmwareRuntime.fromProject({
      language: 'python',
      activeName: 'main.py',
      files: [
        { name: 'main.py', content: 'import helpers\n' },
        { name: 'helpers.py', content: 'def wave():\n  return 1\n' },
      ],
    });
    expect(runtime.hasFunction('wave')).toBe(true);
  });

  it('rejects include cycles', () => {
    expect(() =>
      FirmwareRuntime.fromProject({
        language: 'arduino-cpp',
        activeName: 'main.ino',
        files: [
          { name: 'main.ino', content: '#include "a.h"\nvoid setup() {}\nvoid loop() {}\n' },
          { name: 'a.h', content: '#include "b.h"\n' },
          { name: 'b.h', content: '#include "a.h"\n' },
        ],
      }),
    ).toThrow(/cycle/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/simulation/firmware/firmware-project.test.ts`
Expected: FAIL with "fromProject is not a function".

- [ ] **Step 3: Write minimal implementation**

In `interpreter.ts`:

```ts
import { FirmwareProjectError, validateProject } from './project';

const LOCAL_INCLUDE = /^#\s*include\s*"([^"]+)"\s*$/m; // applied per line
function localIncludes(content: string): string[] {
  return content.split('\n')
    .map((line) => /^#\s*include\s*"([^"]+)"/.exec(line.trim())?.[1])
    .filter((name): name is string => Boolean(name));
}
function pythonImports(content: string): string[] {
  const names: string[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    const direct = /^import\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(trimmed)?.[1];
    const from = /^from\s+([A-Za-z_][A-Za-z0-9_]*)\s+import\s+/.exec(trimmed)?.[1];
    const candidate = direct ?? from;
    if (candidate && candidate !== 'time' && candidate !== 'gpiozero') names.push(candidate);
  }
  return names;
}
```

`FirmwareRuntime`:

```ts
static fromProject(project: FirmwareProject): FirmwareRuntime {
  const problems = validateProject(project);
  if (problems.length > 0) throw new FirmwareProjectError(problems[0]);
  const byName = new Map(project.files.map((file) => [file.name, file.content]));
  // Resolve + cycle check over local edges only.
  const order: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (name: string, stack: string[]) => {
    if (visited.has(name)) return;
    if (visiting.has(name)) throw new FirmwareProjectError(`${[...stack, name].join(' → ')}: include cycle detected`);
    visiting.add(name);
    const content = byName.get(name) ?? '';
    const edges = project.language === 'python'
      ? pythonImports(content).map((mod) => `${mod}.py`)
      : localIncludes(content);
    for (const edge of edges) {
      if (!byName.has(edge)) {
        const owner = name;
        throw new FirmwareProjectError(
          project.language === 'python'
            ? `${owner}: import ${edge.replace(/\.py$/, '')} not found`
            : `${owner}: #include "${edge}" not found`,
        );
      }
      visit(edge, [...stack, name]);
    }
    visiting.delete(name);
    visited.add(name);
    order.push(name);
  };
  const entry = project.language === 'python' ? 'main.py' : 'main.ino';
  visit(project.files.find((f) => f.name === entry)?.name ?? project.files[0].name, []);
  for (const file of project.files) if (!visited.has(file.name)) visit(file.name, []);
  // Parse each file with its own name, then merge.
  const programs = order.map((name) =>
    project.language === 'python'
      ? parsePython(byName.get(name)!, name)
      : parseFirmware(byName.get(name)!, name),
  );
  const defines = new Map<string, number>();
  const globals: Stmt[] = [];
  const functions = new Map<string, FunctionDecl>();
  const functionOwner = new Map<string, string>();
  programs.forEach((program, index) => {
    const owner = order[index];
    for (const [key, value] of program.defines) {
      if (defines.has(key) && defines.get(key) !== value) {
        throw new FirmwareProjectError(`${owner}: conflicting #define ${key}`);
      }
      defines.set(key, value);
    }
    globals.push(...program.globals);
    for (const [key, decl] of program.functions) {
      if (functions.has(key)) {
        throw new FirmwareProjectError(`${owner}: duplicate function '${key}' (also in ${functionOwner.get(key)})`);
      }
      functions.set(key, decl);
      functionOwner.set(key, owner);
    }
  });
  return new FirmwareRuntime.__merged({ defines, globals, functions }, project.language);
}
```

Add a private merged-construction path (`__merged`) that builds `program/defines/functions/globals` from merged parts and shares the existing constructor body (refactor the current constructor to delegate: `constructor(source, language)` parses one file then calls the same init). Keep `hasFunction`/`main` untouched.

`FirmwareRunner`:

```ts
constructor(
  source: string | FirmwareProject,
  services: FirmwareServices,
  language: FirmwareLanguage = 'arduino-cpp',
) {
  this.runtime = typeof source === 'string'
    ? new FirmwareRuntime(source, language)
    : FirmwareRuntime.fromProject(source);
  this.generator = this.runtime.main(this.withSerialSink(services));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/simulation/firmware/firmware-project.test.ts src/features/simulation/firmware/firmware.test.ts`
Expected: PASS with no regressions.

- [ ] **Step 5: Commit**

```bash
git add src/features/simulation/firmware/interpreter.ts src/features/simulation/firmware/firmware-project.test.ts
git commit -m "feat(firmware): resolve multi-file projects with includes and imports"
```

---

### Task 4: Simulation project overload

**Files:**
- Modify: `src/features/bench/simulation.ts`
- Test: extend `src/features/bench/undo.test.ts`? No — create `src/features/bench/firmware-project-drive.test.ts`

**Interfaces:**
- Consumes: `FirmwareRuntime.fromProject`, `FirmwareRunner` project overload (Task 3).
- Produces: `loadFirmware(source: string | FirmwareProject, language?)` for Tasks 6–7. `firmwareError` already `string | null`; project errors surface verbatim (they carry `file:line`).

- [ ] **Step 1: Write the failing test**

```ts
// src/features/bench/firmware-project-drive.test.ts
import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation';
import { unoDefinition } from '@/features/parts';

function bench() {
  return new Simulation(unoDefinition());
}

describe('loadFirmware with a project', () => {
  it('runs helpers across tabs', () => {
    const sim = bench();
    sim.loadFirmware({
      language: 'arduino-cpp',
      activeName: 'main.ino',
      files: [
        { name: 'main.ino', content: '#include "helpers.h"\nvoid setup() { pinMode(2, 1); }\nvoid loop() {}\n' },
        { name: 'helpers.h', content: 'void helper() {}\n' },
      ],
    });
    expect(sim.firmwareError).toBeNull();
  });

  it('surfaces missing includes verbatim', () => {
    const sim = bench();
    sim.loadFirmware({
      language: 'arduino-cpp',
      activeName: 'main.ino',
      files: [{ name: 'main.ino', content: '#include "missing.h"\nvoid setup() {}\nvoid loop() {}\n' }],
    });
    expect(sim.firmwareError).toContain('missing.h');
  });

  it('keeps the string overload working', () => {
    const sim = bench();
    sim.loadFirmware('void setup() {}\nvoid loop() {}\n', 'arduino-cpp');
    expect(sim.firmwareError).toBeNull();
  });
});
```

Check `unoDefinition` export name in `src/features/parts` first; if it differs, use whatever `Bench.tsx` uses to build the board (`boardOption('uno').make()` is also acceptable via `@/features/learn`, but prefer parts-local to respect the `parts→simulation` boundary — tests may import deep freely).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/bench/firmware-project-drive.test.ts`
Expected: FAIL (project argument not accepted / type error at runtime).

- [ ] **Step 3: Write minimal implementation**

```ts
import type { FirmwareProject } from '@/features/simulation';
import { toSingleFileProject } from '@/features/simulation';

// Replace firmwareSource type: private firmwareSource: string = '' and
// private firmwareProject: FirmwareProject | null = null;

loadFirmware(source: string | FirmwareProject, language: FirmwareLanguage = this.firmwareLanguage): void {
  const project = typeof source === 'string' ? toSingleFileProject(source, language) : source;
  this.firmwareProject = project;
  this.firmwareSource = project.files.find((f) => f.name === project.activeName)?.content ?? '';
  this.firmwareLanguage = project.language;
  this.serial = [];
  this.serialDirty = true;
  this.engine.timeMs = 0;
  this.mcu.reset();
  this.pendingDelayMs = 0;
  try {
    this.runner = new FirmwareRunner(project, this.services(), project.language);
    this.firmwareError = null;
  } catch (error) {
    this.runner = null;
    this.firmwareError =
      error instanceof FirmwareSyntaxError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
  }
  this.rebuild();
}
```

Keep `start()` behavior: `if (!this.runner && this.firmwareProject) this.loadFirmware(this.firmwareProject);` and `reset()` reloading `this.firmwareProject ?? this.firmwareSource`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/bench/firmware-project-drive.test.ts src/features/bench/simulation.test.ts`
Expected: PASS. Then `npx tsc -b` must pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/bench/simulation.ts src/features/bench/firmware-project-drive.test.ts
git commit -m "feat(bench): load multi-file firmware projects"
```

---

### Task 5: Editor tabs UI

**Files:**
- Modify: `src/features/instruments/Panels.tsx`
- Test: pure tab helpers live in `src/features/simulation/firmware/project.ts` (Task 1) — add `renameFile`, `addFile`, `removeFile` there with tests in `project.test.ts` rather than mounting Monaco (vitest env is node, no DOM).

**Interfaces:**
- Consumes: `FirmwareProject` + validation helpers (Task 1).
- Produces: `FirmwareEditor({ project, onProjectChange, error, … })` props for Task 6.

- [ ] **Step 1: Write the failing test (pure helpers)**

```ts
// append to src/features/simulation/firmware/project.test.ts
import { addFile, removeFile, renameFile } from './project';

it('protects the entry file', () => {
  const project = toSingleFileProject('x', 'arduino-cpp');
  expect(() => removeFile(project, 'main.ino')).toThrow(/entry/i);
  expect(() => renameFile(project, 'main.ino', 'other.ino')).toThrow(/entry/i);
});

it('adds a helper tab', () => {
  const project = toSingleFileProject('x', 'arduino-cpp');
  const next = addFile(project, 'helpers.h');
  expect(next.files.map((f) => f.name)).toEqual(['main.ino', 'helpers.h']);
  expect(next.activeName).toBe('helpers.h');
});
```

Run: `npx vitest run src/features/simulation/firmware/project.test.ts` → FAIL (helpers missing).

- [ ] **Step 2: Implement pure helpers in `project.ts`**

```ts
export function addFile(project: FirmwareProject, name: string, content = ''): FirmwareProject {
  const bad = validateFileName(name, project.language);
  if (bad) throw new FirmwareProjectError(bad);
  if (project.files.some((f) => f.name === name)) throw new FirmwareProjectError(`${name}: file already exists`);
  if (project.files.length >= MAX_FILES) throw new FirmwareProjectError(`project has more than ${MAX_FILES} files`);
  return { ...project, files: [...project.files, { name, content }], activeName: name };
}
export function removeFile(project: FirmwareProject, name: string): FirmwareProject {
  if (name === ENTRY_BY_LANGUAGE[project.language]) throw new FirmwareProjectError(`${name}: entry file cannot be deleted`);
  const files = project.files.filter((f) => f.name !== name);
  return { ...project, files, activeName: project.activeName === name ? ENTRY_BY_LANGUAGE[project.language] : project.activeName };
}
export function renameFile(project: FirmwareProject, from: string, to: string): FirmwareProject {
  if (from === ENTRY_BY_LANGUAGE[project.language]) throw new FirmwareProjectError(`${from}: entry file cannot be renamed`);
  const bad = validateFileName(to, project.language);
  if (bad) throw new FirmwareProjectError(bad);
  if (project.files.some((f) => f.name === to)) throw new FirmwareProjectError(`${to}: file already exists`);
  return {
    ...project,
    files: project.files.map((f) => (f.name === from ? { ...f, name: to } : f)),
    activeName: project.activeName === from ? to : project.activeName,
  };
}
export function updateFileContent(project: FirmwareProject, name: string, content: string): FirmwareProject {
  if (content.length > MAX_FILE_BYTES) throw new FirmwareProjectError(`${name}: file is larger than 32 KB`);
  return { ...project, files: project.files.map((f) => (f.name === name ? { ...f, content } : f)) };
}
```

- [ ] **Step 3: Rewire `FirmwareEditor` to tabs (no new test runner needed)**

Props change:

```tsx
export function FirmwareEditor({ project, onProjectChange, error, language, … }: {
  project: FirmwareProject;
  onProjectChange(next: FirmwareProject): void;
  error: string | null;
  language: FirmwareLanguage;
  …
}) {
  const active = project.files.find((f) => f.name === project.activeName) ?? project.files[0];
  // Tab strip under the existing header row:
  // project.files.map(tab) + "+" button; entry tab has no ×; double-click renames via window.prompt in v1.
  // Monaco: value={active.content} onChange={(next) => onProjectChange(updateFileContent(project, active.name, next ?? ''))}
  // Error bar: show `error` verbatim (it already carries file:line from Task 2/3).
}
```

Tab strip styling follows existing `ctl` / panel classes; no new dependency. Renaming uses `window.prompt('Rename file', name)` in v1 (validated by `renameFile`); adding uses `window.prompt('New file name', 'helpers.h')`. View-state save/restore via `Editor onMount`: keep a `Map<string, unknown>` of `editor.saveViewState()` on tab switch, `restoreViewState` on select, failures ignored.

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/features/simulation/firmware/project.test.ts`
Expected: PASS. Run: `npx tsc -b`
Expected: PASS (fix prop usages in the same commit — see Task 6 if Bench still passes `value`).

- [ ] **Step 5: Commit**

```bash
git add src/features/simulation/firmware/project.ts src/features/simulation/firmware/project.test.ts src/features/instruments/Panels.tsx
git commit -m "feat(editor): multi-file tabs over a single Monaco instance"
```

---

### Task 6: Bench project state + example wrapping

**Files:**
- Modify: `src/features/bench/Bench.tsx`
- Test: `src/features/bench/firmware-project-drive.test.ts` (append precedence/wrapping cases — node-testable parts only)

**Interfaces:**
- Consumes: `FirmwareEditor` project props (Task 5), `loadFirmware(project)` (Task 4), `toSingleFileProject` (Task 1).
- Produces: `project` state + `?files=` seed shape for Task 7.

- [ ] **Step 1: Write the failing test**

```ts
it('wraps legacy sketches as single-file projects', () => {
  const { toSingleFileProject } = await import('@/features/simulation');
  const wrapped = toSingleFileProject('void setup() {}\n', 'arduino-cpp');
  expect(wrapped.files).toHaveLength(1);
  const sim = bench();
  sim.loadFirmware(wrapped);
  expect(sim.firmwareError).toBeNull();
});
```

(Append to the Task 4 test file; verifies the wrapping contract Bench will rely on.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/bench/firmware-project-drive.test.ts`
Expected: FAIL only if the wrapping helper is missing (it exists since Task 1 — this step confirms the contract, then proceed to the Bench rewire).

- [ ] **Step 3: Rewire Bench state**

Replace `const [firmware, setFirmware] = useState(…sketch…)` with:

```tsx
const [project, setProject] = useState<FirmwareProject>(() =>
  toSingleFileProject(
    exercise?.sketch ?? projectBuild?.sketch ?? (boardOption(boardId).language === 'python' ? PI_BLINK_SKETCH : BLINK_EXAMPLE.sketch),
    exercise ? exerciseLanguage(exercise) : boardOption(boardId).language,
  ),
);
```

`loadExample`: `setProject(toSingleFileProject(example.sketch, boardOption(boardId).language)); simulation.loadFirmware(toSingleFileProject(example.sketch, boardOption(boardId).language));`

Run button: `simulation.loadFirmware(project); simulation.start();`

Language select: if `project.files.length > 1`, `window.confirm('Switching language discards other-language tabs. Continue?')` — cancel aborts; confirm resets to `toSingleFileProject('', nextLanguage)` with the starter for that language.

`FirmwareEditor` usage becomes `project={project} onProjectChange={setProject}` (remove `value/onChange`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/bench/firmware-project-drive.test.ts`
Expected: PASS. Run: `npx tsc -b` and `npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/bench/Bench.tsx src/features/bench/firmware-project-drive.test.ts
git commit -m "feat(bench): project state with single-file wrapping"
```

---

### Task 7: Persist + share links

**Files:**
- Create: `src/features/bench/share-codec.ts`
- Create: `src/features/bench/project-store.ts`
- Test: `src/features/bench/share-codec.test.ts`, `src/features/bench/project-store.test.ts`
- Modify: `src/features/bench/Bench.tsx`, `package.json` (+ `package-lock.json` via install)

**Interfaces:**
- Consumes: `FirmwareProject` (Task 1), Bench `project` state (Task 6).
- Produces: working autosave + `?files=` round-trip; nothing downstream.

- [ ] **Step 1: Install the compression dependency**

Run: `npm install lz-string`
Expected: `package.json` gains `"lz-string"`; import works with `import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';` (ships its own types; if not, add a one-line `src/types/lz-string.d.ts` declaring the two functions).

- [ ] **Step 2: Write the failing codec test**

```ts
// src/features/bench/share-codec.test.ts
import { describe, expect, it } from 'vitest';
import { decodeShareToProject, encodeProjectToShare, SHARE_URL_LIMIT } from './share-codec';
import { toSingleFileProject } from '@/features/simulation';

describe('share codec', () => {
  it('round-trips a two-file project', () => {
    const project = {
      ...toSingleFileProject('#include "h.h"\nvoid setup() {}\nvoid loop() {}\n', 'arduino-cpp'),
      files: [
        { name: 'main.ino', content: '#include "h.h"\nvoid setup() {}\nvoid loop() {}\n' },
        { name: 'h.h', content: 'void helper() {}\n' },
      ],
    };
    const encoded = encodeProjectToShare(project);
    expect(encoded.length).toBeLessThan(SHARE_URL_LIMIT);
    expect(decodeShareToProject(encoded)).toEqual({ ...project, activeName: 'main.ino' });
  });

  it('rejects corrupt payloads', () => {
    expect(decodeShareToProject('!!!not-a-payload!!!')).toBeNull();
  });
});
```

```ts
// src/features/bench/project-store.test.ts
import { describe, expect, it } from 'vitest';
import { benchProjectKey, loadBenchProject, saveBenchProject } from './project-store';
import { toSingleFileProject } from '@/features/simulation';

describe('project store', () => {
  it('round-trips through injected storage', () => {
    const backing = new Map<string, string>();
    const storage = {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => void backing.set(k, v),
      removeItem: (k: string) => void backing.delete(k),
    };
    const project = toSingleFileProject('void setup() {}\n', 'arduino-cpp');
    saveBenchProject('uno', project, storage as Storage);
    expect(loadBenchProject('uno', storage as Storage)).toEqual(project);
    expect(benchProjectKey('uno')).toBe('noesis:bench:uno:project');
  });

  it('returns null on corrupt saves', () => {
    const storage = {
      getItem: () => '{broken',
      setItem: () => {},
      removeItem: () => {},
    } as unknown as Storage;
    expect(loadBenchProject('uno', storage)).toBeNull();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/features/bench/share-codec.test.ts src/features/bench/project-store.test.ts`
Expected: FAIL (modules missing).

- [ ] **Step 4: Write minimal implementation**

```ts
// src/features/bench/share-codec.ts
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import type { FirmwareProject } from '@/features/simulation';

export const SHARE_URL_LIMIT = 1800;

export function encodeProjectToShare(project: FirmwareProject): string {
  return compressToEncodedURIComponent(JSON.stringify({ language: project.language, files: project.files }));
}

export function decodeShareToProject(payload: string): FirmwareProject | null {
  try {
    const raw = decompressFromEncodedURIComponent(payload);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { language: FirmwareProject['language']; files: { name: string; content: string }[] };
    if (!Array.isArray(parsed.files) || parsed.files.length === 0) return null;
    return { language: parsed.language, files: parsed.files, activeName: parsed.files[0].name };
  } catch {
    return null;
  }
}
```

```ts
// src/features/bench/project-store.ts
import type { FirmwareProject } from '@/features/simulation';

export const benchProjectKey = (boardId: string) => `noesis:bench:${boardId}:project`;

export function saveBenchProject(boardId: string, project: FirmwareProject, storage: Storage = localStorage): void {
  try {
    storage.setItem(benchProjectKey(boardId), JSON.stringify({ language: project.language, files: project.files, activeName: project.activeName }));
  } catch { /* quota or private mode: bench stays session-local */ }
}

export function loadBenchProject(boardId: string, storage: Storage = localStorage): FirmwareProject | null {
  try {
    const raw = storage.getItem(benchProjectKey(boardId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FirmwareProject;
    if (!Array.isArray(parsed.files) || parsed.files.length === 0) return null;
    return { language: parsed.language, files: parsed.files, activeName: parsed.activeName };
  } catch {
    return null;
  }
}
```

Bench wiring: `useEffect(() => { const timer = setTimeout(() => saveBenchProject(boardId, project), 500); return () => clearTimeout(timer); }, [boardId, project]);` Mount seed order: `?ex=` / `?project=` (existing) > `search.get('files')` via `decodeShareToProject` (invalid → starter + error line, never blank) > `loadBenchProject(boardId)` > starter. Header "Copy link" button: `encodeProjectToShare(project)`, disabled with `title="Too large to share by link — files stay local"` when `encoded.length > SHARE_URL_LIMIT`, else `navigator.clipboard.writeText(url)`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/features/bench/share-codec.test.ts src/features/bench/project-store.test.ts`
Expected: PASS. Run: `npx tsc -b`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/features/bench/share-codec.ts src/features/bench/share-codec.test.ts src/features/bench/project-store.ts src/features/bench/project-store.test.ts src/features/bench/Bench.tsx package.json package-lock.json
git commit -m "feat(bench): persist tab projects and share by link"
```

---

### Task 8: Full validation + boundary gate

**Files:** none (verification only).

- [ ] **Step 1: Run the full suite**

Run: `npm run test`
Expected: PASS (all suites including `project.test.ts`, `file-error.test.ts`, `firmware-project.test.ts`, `firmware-project-drive.test.ts`, `share-codec.test.ts`, `project-store.test.ts` plus all pre-existing suites).

- [ ] **Step 2: Run typecheck, lint, and boundaries**

Run: `npx tsc -b`
Expected: PASS.

Run: `npm run lint`
Expected: PASS with no errors.

Run: `node scripts/check-boundaries.mjs`
Expected: `boundaries ok (… files)` — new cross-feature imports use `@/features/simulation` and `@/features/bench` seams only; fix any `deep … outside …` lines before proceeding.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "chore: full validation for firmware tabs"
```

---

## Self-review

- **Spec coverage:** §1 → Tasks 1–3 (model, file-aware errors, resolver/merge/cycles); §2 → Tasks 5–6 (tabs UI, project state, language confirm, edit-local/Run-loads); §3 → Task 7 (autosave, precedence, `?files=` codec + size guard + Copy link); §4 → Tasks 2/4 (error bar verbatim + auto-switch is in Panels wiring; migration overloads in Tasks 3–4; tests in every task); out-of-scope items have no tasks by design.
- **Placeholders:** none — every step carries exact file paths, signatures, test code, run commands, and commit messages; no TBD/TODO/similar-to-Task-N.
- **Type consistency:** `FirmwareProject` / `ENTRY_BY_LANGUAGE` / `MAX_FILES` / `MAX_FILE_BYTES` / `SHARE_URL_LIMIT` / `fromProject` / `loadFirmware(project | string)` / `saveBenchProject` / `loadBenchProject` / `encodeProjectToShare` / `decodeShareToProject` named identically everywhere used.
- **Review Focus:** each of the five lines pins to its owning task — uppercase names → Task 1 validation tests; duplicates → Task 3 merge tests; cycles → Task 3 cycle tests; corrupt `?files=` → Task 7 codec tests; oversize share → Task 7 guard tests.
