# Feature-Based Architecture Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate `src/` from flat `sim/` + `ui/` folders to encapsulated `features/` modules behind `index.ts` public seams without breaking any build, typecheck, test, or lint.

**Architecture:** Keep the existing deep Module seam — `sim/` (pure, no React/DOM) underneath `ui/` (React shell over mutable `Simulation`) — and re-express it as `features/simulation` + `features/parts` underneath `features/bench`, `features/instruments`, `features/learn`, composed in `src/routes`. Each feature exposes only its `index.ts`; shared leaf code moves up to `src/utils`, `src/types`, `src/components`. Path alias `@/*` replaces `../../` everywhere.

**Tech Stack:** React 19.2.8, react-dom 19.2.8, react-router 8.4.0, TypeScript ~6.0.2, Vite 8.3.0, Vitest 5.0.3, Tailwind 4.3.3, Monaco 0.57.0, oxlint 1.81.0.

**Spec:** Inline refactor brief 2026-10-07 (this conversation): Directory Blueprint + Encapsulation Rules (public `index.ts`, no cross-feature deep imports, directional flow shared ← features ← pages) + phased execution (setup → one feature at a time → imports & cleanup).

## Global Constraints

- `moduleResolution: bundler`, `allowImportingTsExtensions: true`, `verbatimModuleSyntax: true`, `moduleDetection: force`, `noEmit: true`, `jsx: react-jsx` (from `tsconfig.app.json`).
- `erasableSyntaxOnly: true` — no enums, no parameter properties, no non-erasable syntax.
- `noUnusedLocals: true`, `noUnusedParameters: true` — re-export shims must not leave unused imports.
- `noFallthroughCasesInSwitch: true`.
- Engine tests run under node: `vitest.config.ts` `test.environment: node`, `test.include: ['src/**/*.test.ts']` — moved `*.test.ts` files must stay matched by that glob.
- `@` alias already resolves to `./src` in `vitest.config.ts` — `vite.config.ts` and `tsconfig.app.json` must be brought into agreement, not invented separately.
- No behavior changes: solver math, pin maps, firmware interpreter semantics, and route paths (`/`, `/learn`, `/learn/references`, `/learn/:id`, `/projects/:boardId`, `/bench`, `/bench/:boardId`) stay identical.
- One feature per task; never delete/move all files at once; every task ends green (`tsc -b`, `vitest run`, `oxlint`).

## Review Focus

- Deep import bypassing a feature seam (`@/features/bench/components/X` imported from outside `features/bench`) renders but violates encapsulation — expect `index.ts`-only imports outside the owning feature.
- Cross-feature import (`features/bench` importing from `features/learn`) compiles but creates a cycle — expect shared code to live in `src/components`, `src/hooks`, `src/utils`, or composition in `src/routes`.
- Alias divergence (vitest resolves `@` but vite or tsc does not) breaks dev/build while tests pass — expect all three resolvers to agree.
- Orphaned test co-located with moved source still importing `./old-path` passes typecheck but tests the wrong Module copy — expect test moved with its source in the same task.
- Windows-case-insensitive path (`@/Features/Bench`) passes locally and fails on Linux CI — expect all-lowercase `features/<name>` segments only.

---

## File Structure (target)

Before tasks, the decomposition that every task below implements. Each file has one responsibility; files that change together live together.

```text
src/
├── main.tsx                    # unchanged entry, imports app/App
├── index.css                   # unchanged global styles (stays; app/ does not duplicate it)
├── assets/                     # unchanged: hero.png, react.svg, vite.svg
├── app/
│   └── App.tsx                 # router table moved verbatim from src/App.tsx
├── components/                 # shared, domain-agnostic UI primitives only
│   └── index.ts                # (populated only if a genuinely shared primitive is found; otherwise stays absent)
├── hooks/                      # shared hooks only (useDebounce, useMediaQuery); created lazily
├── utils/
│   ├── format.ts               # moved from src/ui/format.ts (pure helpers, no sim/ui imports)
│   └── index.ts                # public seam: export * from './format'
├── types/
│   └── index.ts                # cross-cutting types only (re-exported from features, no new definitions unless needed)
├── features/
│   ├── simulation/             # pure engine Module: no react, no DOM. Deepest Module, most leverage.
│   │   ├── engine.ts           # from src/sim/engine.ts
│   │   ├── circuit.ts          # from src/sim/circuit.ts
│   │   ├── netlist.ts          # from src/sim/netlist.ts
│   │   ├── elements.ts         # from src/sim/elements.ts
│   │   ├── mcu.ts              # from src/sim/mcu.ts
│   │   ├── bench.ts            # from src/sim/bench.ts
│   │   ├── probe.ts, multimeter.ts, units.ts, matrix.ts, encoder.ts, relay.ts, remote.ts,
│   │   │   dialer.ts, sonar.ts, stepper.ts, sdcard.ts, pixels.ts, dht.ts, bus/, firmware/
│   │   └── index.ts            # public seam for solver/engine consumers
│   ├── parts/                  # catalogue Module: what can be placed, boards + definitions
│   │   ├── boards.ts, breadboard.ts, catalog.ts, catalogue.ts, passives.ts, modules.ts,
│   │   │   devices/, display/
│   │   └── index.ts
│   ├── bench/                  # workbench canvas Module: Bench, Workbench, Simulation facade + wiring geometry
│   │   ├── Bench.tsx, Workbench.tsx, simulation.ts, wire-route.ts, wire-colours.ts,
│   │   │   hit-test.ts, part-transform.ts, footprints.tsx, hardware.tsx, wokwi.ts,
│   │   │   wokwi-library.ts, ComponentBrowser.tsx, PartSearch.tsx, PartPreview.tsx,
│   │   │   WokwiFootprint.tsx, WokwiLibrary.tsx
│   │   └── index.ts
│   ├── instruments/            # Scope, Multimeter, LogicAnalyser, BusMonitor (+ Panels split, see Task 6)
│   │   ├── Scope.tsx, Multimeter.tsx, LogicAnalyser.tsx, BusMonitor.tsx, Panels.tsx
│   │   └── index.ts
│   └── learn/                  # exercises, gallery, projects, boardRegistry, examples, map-*, monaco-setup
│       ├── exercises.ts, exercises/, ExercisePages.tsx, ExerciseGuide.tsx, ExercisePreview.tsx,
│       │   exercise-preview-data.ts, gallery.ts, projects.ts, ProjectPages.tsx, HomePage.tsx,
│       │   boardRegistry.ts, examples.ts, glossary.ts, guide-dismissal.ts,
│       │   map-fetcher.ts, map-tiles.ts, monaco-setup.ts
│       └── index.ts
└── routes/                     # thin composition over features (no logic, only route elements)
    ├── HomeRoute.tsx           # re-exports HomePage from features/learn
    ├── BenchRoute.tsx          # re-exports Bench from features/bench
    ├── LearnRoutes.tsx         # re-exports ExercisePages from features/learn
    └── ProjectsRoute.tsx       # re-exports ProjectPages from features/learn
```

Seam discipline (from codebase-design): each `features/<name>/index.ts` is the external seam. Internal files may import each other freely (internal seams). Callers and tests cross only the external seam. Depth test: deleting `features/simulation` must break callers (it earns its keep); deleting a shim that only re-exports fails the deletion test and gets removed.

Trade-off recorded up front: `src/ui/Panels.tsx` currently bundles `FirmwareEditor`, `Inspector`, `SerialMonitor`, `StatusBar`. Splitting it across `features/bench`, `features/instruments`, and a new `features/firmware-editor` in this migration would triple the blast radius. The plan keeps `Panels.tsx` whole inside `features/instruments` (Task 6) and notes the split as follow-up. Same for `src/ui/simulation.ts` facade: it stays whole inside `features/bench` (Task 5) even though it touches engine + firmware + probes.

---

### Task 1: Aliases + skeleton + `app/` shell

**Files:**
- Modify: `tsconfig.app.json:1-26`
- Modify: `vite.config.ts:1-13`
- Modify: `src/App.tsx:1-55` (move, not copy)
- Create: `src/app/App.tsx`
- Create: `src/app/index.ts`
- Create: `src/routes/HomeRoute.tsx`, `src/routes/BenchRoute.tsx`, `src/routes/LearnRoutes.tsx`, `src/routes/ProjectsRoute.tsx` (thin shims, added in Task 7 — listed here so the seam is visible; NOT created in this task)
- Create: `src/utils/index.ts`, `src/types/index.ts`, `src/components/index.ts` (minimal seams only)
- Create: `src/features/simulation/index.ts`, `src/features/parts/index.ts`, `src/features/bench/index.ts`, `src/features/instruments/index.ts`, `src/features/learn/index.ts` (empty barrels with a comment pointing at the source of truth; populated in Tasks 3–7)

**Interfaces:**
- Consumes: existing `vitest.config.ts` alias `@ -> ./src` (already green).
- Produces: `import ... from '@/...'` resolvable by tsc + vite + vitest identically; `src/app/App.tsx` default export with identical route table.

- [ ] **Step 1: Write the failing check (alias agreement)**

```bash
grep -q '"@/\*"' tsconfig.app.json && grep -q 'alias' vite.config.ts && grep -q "'@'" vitest.config.ts && echo ALIASES_AGREE || (echo ALIASES_MISSING; exit 1)
```

- [ ] **Step 2: Run to verify it fails**

Run: `node -e "..."` (above)
Expected: FAIL / `ALIASES_MISSING` with exit 1 (today `tsconfig.app.json` has no `paths`, `vite.config.ts` has no `alias`).

- [ ] **Step 3: Minimal implementation — add `@` to tsc + vite, create skeleton seams**

`tsconfig.app.json` — add inside `compilerOptions`:

```json
"paths": { "@/*": ["./src/*"] }
```

(No `baseUrl`: TS 6 errors TS5101 on it; `paths` alone resolves identically.)

`vite.config.ts` — add alias (keeps vitest/vite in agreement):

```ts
import path from "node:path";
export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
```

Move (git mv, not copy) `src/App.tsx` → `src/app/App.tsx`, then rewrite its five relative imports to the alias form that the final tree uses (still pointing at the old locations in this task — no feature moves yet):

```tsx
import Bench from '@/ui/Bench';
import { HomePage } from '@/ui/HomePage';
import { ExercisesPage, ExercisePage, ReferencesPage } from '@/ui/ExercisePages';
import { ProjectPage } from '@/ui/ProjectPages';
import { DEFAULT_BOARD_ID } from '@/ui/boardRegistry';
```

Create `src/app/index.ts`:

```ts
export { default as App } from './App';
```

Update `src/main.tsx` line 4: `import App from './App.tsx'` → `import App from '@/app/App';`

Create five empty barrel seams (one per feature), e.g. `src/features/simulation/index.ts`:

```ts
// Public seam for features/simulation. Populated in Task 3.
// Code outside this folder must import from '@/features/simulation', never deep.
export {};
```

Same shape for `parts`, `bench`, `instruments`, `learn`. Plus `src/utils/index.ts`, `src/types/index.ts`, `src/components/index.ts` each containing only `export {};` with the same one-line comment in this task.

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsc -b --pretty false`
Expected: PASS (exit 0), and the alias check from Step 1 now prints `ALIASES_AGREE`.

Run: `npx vitest run 2>&1 | tail -n 5`
Expected: PASS — same pass count as before this task (no test files moved, so count is unchanged).

- [ ] **Step 5: Commit**

```bash
git add tsconfig.app.json vite.config.ts src/main.tsx src/app/App.tsx src/app/index.ts src/features/*/index.ts src/utils/index.ts src/types/index.ts src/components/index.ts
git commit -m "refactor: add @ alias (tsc+vite+vitest) and feature skeleton seams"
```

---

### Task 2: Shared leaf layers (`utils`, `types`)

**Files:**
- Move: `src/ui/format.ts` → `src/utils/format.ts`
- Modify: `src/utils/index.ts`
- Create: `src/types/index.ts` content (only if a genuinely cross-cutting type is found; otherwise keep `export {}` and document why)
- Modify: every importer of `../ui/format` / `./format` (find via grep, expected ~4–6 files: `Panels.tsx`, `gallery.ts`, `projects.ts`, `ExercisePreview.tsx` — confirm with grep in the step)

**Interfaces:**
- Consumes: `src/utils/format.ts` pure helpers (no `sim/` or `ui/` imports — verify by reading the file first).
- Produces: `import { ... } from '@/utils'` resolvable; old path `src/ui/format.ts` gone (no orphan).

- [ ] **Step 1: Write the failing test (boundary probe)**

```ts
// /tmp/boundary-probe.mjs — run with node; fails while any file outside
// src/utils imports the old deep path.
import { execSync } from 'node:child_process';
const hits = execSync('grep -rn "from [\'\\"].*ui/format[\\'\"]" src --include="*.ts" --include="*.tsx" || true').toString().trim();
console.log(hits === '' ? 'BOUNDARY_CLEAN' : 'BOUNDARY_DIRTY:\n' + hits);
process.exit(hits === '' ? 0 : 1);
```

- [ ] **Step 2: Run to verify it fails**

Run: `node /tmp/boundary-probe.mjs`
Expected: FAIL — lists current `ui/format` importers.

Also run impact radius first (refactor-safely preview, no edits yet):

Run: `grep -rn "from.*format" src --include="*.ts" --include="*.tsx"`
Expected: list of files Task 2 will touch — paste into the commit message.

- [ ] **Step 3: Minimal implementation (git mv + alias imports)**

```bash
git mv src/ui/format.ts src/utils/format.ts
```

`src/utils/index.ts`:

```ts
export * from './format';
```

Update each importer found by grep, e.g.:

```ts
// before
import { foo } from './format';
// after
import { foo } from '@/utils';
```

Delete nothing else. If `src/ui/format.ts` re-exports anything from `sim/`, stop — it is not shared-leaf and stays in its feature (record in commit, skip the move).

- [ ] **Step 4: Run to verify it passes**

Run: `node /tmp/boundary-probe.mjs`
Expected: `BOUNDARY_CLEAN`.

Run: `npx tsc -b --pretty false && npx vitest run 2>&1 | tail -n 5 && npx oxlint 2>&1 | tail -n 5`
Expected: all three PASS, test count unchanged.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: move format helpers to src/utils behind @/utils seam"
```

---

### Task 3: `features/simulation` (pure engine Module)

**Files:**
- Move (git mv, preserving history): `src/sim/bench.ts`, `boards.ts` (stays? NO — boards go to parts, see below), `circuit.ts`, `netlist.ts`, `elements.ts`, `mcu.ts`, `probe.ts`, `multimeter.ts`, `units.ts`, `matrix.ts`, `encoder.ts`, `relay.ts`, `remote.ts`, `dialer.ts`, `sonar.ts`, `stepper.ts`, `sdcard.ts`, `pixels.ts`, `dht.ts`, `bus/`, `firmware/` → `src/features/simulation/`
- Explicitly NOT moved here: `catalog.ts`, `catalogue.ts`, `breadboard.ts`, `passives.ts`, `modules.ts`, `devices/`, `display/` (those are Task 4, parts).
- Move with sources: co-located `*.test.ts` for every file above (e.g. `circuit.test.ts`, `engine.test.ts`, `firmware/*.test.ts`) — test stays beside its source so the `src/**/*.test.ts` glob keeps matching.
- Create: `src/features/simulation/index.ts` (real barrel, replaces the Task 1 stub)
- Modify: all importers (expected in `src/ui/simulation.ts`, `src/ui/*-simulation.test.ts`, `src/sim/*` internals) to `@/features/simulation`

**Interfaces:**
- Consumes: nothing from `ui/`, `features/bench`, `features/learn` (verify: `grep -rn "from.*ui/\|from.*features/" src/features/simulation --include="*.ts"` must be empty).
- Produces: `Engine`, `McuRuntime`, `buildNetlist`, `solveCircuit`, firmware `parseSketch`/`interpret` (exact names taken from current exports — barrel re-exports them verbatim, no renames):

```ts
// src/features/simulation/index.ts
export { Engine } from './engine';
export { solveCircuit } from './circuit';
export { buildNetlist } from './netlist';
export type { Netlist } from './netlist';
export { McuRuntime } from './mcu';
export type { Bench, PartInstance, Terminal, Wire } from './bench';
// … one line per moved module, mirroring its current export list exactly.
```

- [ ] **Step 1: Write the failing test (seam import check)**

```bash
grep -rn "from ['\"]@/features/simulation['\"]" src --include="*.ts" --include="*.tsx" | head -n 5; echo "---"; test $(grep -rn "from ['\"]@/features/simulation['\"]" src --include="*.ts" | wc -l) -gt 0 && echo SEAM_USED || (echo SEAM_UNUSED; exit 1)
```

- [ ] **Step 2: Run to verify it fails**

Run: above.
Expected: FAIL (`SEAM_UNUSED`) — barrel is still `export {}` and nobody imports it.

- [ ] **Step 3: Minimal implementation**

```bash
mkdir -p src/features/simulation/bus src/features/simulation/firmware
git mv src/sim/engine.ts src/features/simulation/engine.ts
git mv src/sim/circuit.ts src/features/simulation/circuit.ts
git mv src/sim/netlist.ts src/features/simulation/netlist.ts
git mv src/sim/elements.ts src/features/simulation/elements.ts
git mv src/sim/mcu.ts src/features/simulation/mcu.ts
git mv src/sim/bench.ts src/features/simulation/bench.ts
git mv src/sim/probe.ts src/features/simulation/probe.ts
git mv src/sim/multimeter.ts src/features/simulation/multimeter.ts
git mv src/sim/units.ts src/features/simulation/units.ts
git mv src/sim/matrix.ts src/features/simulation/matrix.ts
git mv src/sim/encoder.ts src/features/simulation/encoder.ts
git mv src/sim/relay.ts src/features/simulation/relay.ts
git mv src/sim/remote.ts src/features/simulation/remote.ts
git mv src/sim/dialer.ts src/features/simulation/dialer.ts
git mv src/sim/sonar.ts src/features/simulation/sonar.ts
git mv src/sim/stepper.ts src/features/simulation/stepper.ts
git mv src/sim/sdcard.ts src/features/simulation/sdcard.ts
git mv src/sim/pixels.ts src/features/simulation/pixels.ts
git mv src/sim/dht.ts src/features/simulation/dht.ts
git mv src/sim/bus/i2c.ts src/features/simulation/bus/i2c.ts
git mv src/sim/bus/spi.ts src/features/simulation/bus/spi.ts
git mv src/sim/bus/log.ts src/features/simulation/bus/log.ts
git mv src/sim/firmware/interpreter.ts src/features/simulation/firmware/interpreter.ts
git mv src/sim/firmware/parser.ts src/features/simulation/firmware/parser.ts
git mv src/sim/firmware/python.ts src/features/simulation/firmware/python.ts
# plus every co-located *.test.ts beside the files above, same destination
```

Then fix intra-feature relative imports mechanically (e.g. inside `engine.ts` `./circuit` still resolves — no change needed since siblings moved together). Only cross-boundary importers get rewritten to `@/features/simulation`. Write the barrel by copying each moved module's existing `export` names verbatim (no new names).

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsc -b --pretty false`
Expected: PASS.

Run: `npx vitest run src/features/simulation 2>&1 | tail -n 5`
Expected: PASS — engine/firmware suites green in their new home.

Run: `grep -rn "from.*['\"]\.\./sim/\|from.*['\"]\.\./\.\./sim/" src/features/simulation --include="*.ts" || echo NO_STALE_SIM_IMPORTS`
Expected: `NO_STALE_SIM_IMPORTS`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: extract features/simulation pure engine behind index.ts seam"
```

---

### Task 4: `features/parts` (catalogue Module)

**Files:**
- Move: `src/sim/catalog.ts`, `catalogue.ts`, `boards.ts`, `breadboard.ts`, `passives.ts`, `modules.ts`, `devices/`, `display/` → `src/features/parts/`
- Move with sources: `devices.test.ts`, `display/*.test.ts`, `modules.test.ts`, `boards.test.ts`
- Create: `src/features/parts/index.ts` (real barrel)
- Modify: importers in `features/simulation` (engine imports `display/part`, `devices/part`), `ui/*` (`boardRegistry.ts`, `examples.ts`, `Bench.tsx`) to `@/features/parts`

**Interfaces:**
- Consumes: `@/features/simulation` types only where the catalogue references engine types (no value imports from bench/learn).
- Produces:

```ts
// src/features/parts/index.ts
export { esp32DevKitV1, arduinoUnoR3, arduinoMega2560, arduinoNano, nanoRp2040Connect, franzininhoBoard, raspberryPi4 } from './boards';
export { breadboardDefinition } from './breadboard';
export { ledDefinition, resistorDefinition } from './passives';
export type { PartDefinition, PinSpec, BoardPin } from './catalog';
export type { CatalogueEntry } from './catalogue';
```

(Exact names verified against current files during implementation — barrel mirrors, never renames.)

- [ ] **Step 1: Write the failing test**

```bash
grep -rn "from ['\"]@/features/parts['\"]" src --include="*.ts" --include="*.tsx" | head -n 5; test $(grep -rn "from ['\"]@/features/parts['\"]" src --include="*.ts" --include="*.tsx" | wc -l) -gt 0 && echo SEAM_USED || (echo SEAM_UNUSED; exit 1)
```

- [ ] **Step 2: Run to verify it fails**

Expected: `SEAM_UNUSED`.

- [ ] **Step 3: Minimal implementation**

```bash
mkdir -p src/features/parts/devices src/features/parts/display
git mv src/sim/boards.ts src/features/parts/boards.ts
git mv src/sim/breadboard.ts src/features/parts/breadboard.ts
git mv src/sim/catalog.ts src/features/parts/catalog.ts
git mv src/sim/catalogue.ts src/features/parts/catalogue.ts
git mv src/sim/passives.ts src/features/parts/passives.ts
git mv src/sim/modules.ts src/features/parts/modules.ts
git mv src/sim/devices src/features/parts/devices
git mv src/sim/display src/features/parts/display
```

Rewrite cross-boundary importers to the seam; keep intra-feature relatives as-is. If `features/simulation/engine.ts` imports `../display/part`, it becomes `@/features/parts` (value) or `@/features/parts/display/part` only if the barrel cannot express it — prefer the barrel, record any exception in the commit.

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsc -b --pretty false && npx vitest run src/features/parts src/features/simulation 2>&1 | tail -n 5`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: extract features/parts catalogue behind index.ts seam"
```

---

### Task 5: `features/bench` (workbench canvas Module)

**Files:**
- Move: `src/ui/Bench.tsx`, `Workbench.tsx`, `simulation.ts`, `wire-route.ts`, `wire-colours.ts`, `hit-test.ts`, `part-transform.ts`, `footprints.tsx`, `hardware.tsx`, `wokwi.ts`, `wokwi-library.ts`, `ComponentBrowser.tsx`, `PartSearch.tsx`, `PartPreview.tsx`, `WokwiFootprint.tsx`, `WokwiLibrary.tsx` (+ co-located `*.test.ts`: `wire-route.test.ts`, `wire-bends.test.ts`, `wire-edit.test.ts`, `hit-test.test.ts`, `part-transform.test.ts`, `wokwi-library.test.ts`, `undo.test.ts`, simulation-adjacent `*-simulation.test.ts` stay with their source — if a simulation test exercises engine behavior it moves to `features/simulation` instead; decide per-file by reading its first import)
- Create: `src/features/bench/index.ts` exporting `Bench` (default as named too), `Workbench`, `Simulation`, wiring helpers needed by routes:

```ts
export { default as Bench } from './Bench';
export { Workbench } from './Workbench';
export { Simulation } from './simulation';
```

- Modify: `src/app/App.tsx` (Bench import → `@/features/bench`), `src/routes/BenchRoute.tsx` (new thin wrapper, see Task 7).

**Interfaces:**
- Consumes: `@/features/simulation`, `@/features/parts`, `@/utils`, `@/components` only. Must NOT import from `@/features/learn` or `@/features/instruments` (verify with grep in Step 4).
- Produces: `Bench`, `Workbench`, `Simulation` for routes.

- [ ] **Step 1: Write the failing test**

```bash
test $(grep -rn "from ['\"]@/features/bench['\"]" src --include="*.tsx" --include="*.ts" | wc -l) -gt 0 && echo SEAM_USED || (echo SEAM_UNUSED; exit 1)
```

- [ ] **Step 2: Run to verify it fails**

Expected: `SEAM_UNUSED`.

- [ ] **Step 3: Minimal implementation (git mv per file, then alias rewrite)**

Move files listed above with `git mv` one by one (preserves blame). Rewrite their internal cross-feature imports: `../sim/catalog` → `@/features/parts`, `../sim/engine` → `@/features/simulation`, `./wire-route` stays relative (same feature). Keep `Bench.tsx` default export; barrel re-exports it as named + default-compatible.

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsc -b --pretty false && npx vitest run src/features/bench 2>&1 | tail -n 5`
Expected: PASS.

Run: `grep -rn "from.*features/learn\|from.*features/instruments" src/features/bench --include="*.tsx" --include="*.ts" || echo NO_CROSS_FEATURE_IMPORTS`
Expected: `NO_CROSS_FEATURE_IMPORTS`.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: extract features/bench workbench behind index.ts seam"
```

---

### Task 6: `features/instruments`

**Files:**
- Move: `src/ui/Scope.tsx`, `Multimeter.tsx`, `LogicAnalyser.tsx`, `BusMonitor.tsx`, `Panels.tsx` (+ `scope.test.ts`, `multimeter.test.ts`, `probe.test.ts` if they test panels — co-locate with source)
- Create: `src/features/instruments/index.ts`:

```ts
export { ScopePanel } from './Scope';
export { MultimeterPanel } from './Multimeter';
export { LogicAnalyser } from './LogicAnalyser';
export { BusMonitor } from './BusMonitor';
export { FirmwareEditor, Inspector, SerialMonitor, StatusBar } from './Panels';
```

- Modify: `src/features/bench/Bench.tsx` imports of `./Scope`, `./Multimeter`, `./LogicAnalyser`, `./BusMonitor`, `./Panels` → `@/features/instruments`.

**Interfaces:**
- Consumes: `@/features/simulation` types (`BusEntry`, `Multimeter` reading) + `@/utils` only. No imports from bench/learn.
- Produces: the five panel components above.

- [ ] **Step 1: Write the failing test**

```bash
test $(grep -rn "from ['\"]@/features/instruments['\"]" src --include="*.tsx" | wc -l) -gt 0 && echo SEAM_USED || (echo SEAM_UNUSED; exit 1)
```

- [ ] **Step 2: Run to verify it fails**

Expected: `SEAM_UNUSED`.

- [ ] **Step 3: Minimal implementation**

`git mv` the five files, write the barrel with exact current export names (verify each file's `export function/export const` before writing — no renames), rewrite `Bench.tsx` panel imports to the seam.

- [ ] **Step 4: Run to verify it passes**

Run: `npx tsc -b --pretty false && npx vitest run src/features/instruments src/features/bench 2>&1 | tail -n 5 && npx oxlint 2>&1 | tail -n 3`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: extract features/instruments panels behind index.ts seam"
```

---

### Task 7: `features/learn` + `routes/` composition + encapsulation gate

**Files:**
- Move: `src/ui/exercises.ts`, `exercises/`, `ExercisePages.tsx`, `ExerciseGuide.tsx`, `ExercisePreview.tsx`, `exercise-preview-data.ts`, `gallery.ts`, `projects.ts`, `ProjectPages.tsx`, `HomePage.tsx`, `boardRegistry.ts`, `examples.ts`, `glossary.ts`, `guide-dismissal.ts`, `map-fetcher.ts`, `map-tiles.ts`, `monaco-setup.ts` (+ all co-located `*.test.ts`: `exercises.test.ts`, `gallery.test.ts`, `projects.test.ts`, `examples.test.ts`, `boardRegistry.test.ts`, `exercisePreview.test.ts`, `map-fetcher.test.ts`, `pacing.test.ts`, `solutions.test.ts`, `module-5-navigation.test.ts`, `raspberry-pi.test.ts`, `dht-simulation.test.ts` etc. — each moves with the source it imports first)
- Create: `src/features/learn/index.ts` exporting pages + data + registry helpers used by routes/bench:

```ts
export { HomePage } from './HomePage';
export { ExercisesPage, ExercisePage, ReferencesPage } from './ExercisePages';
export { ProjectPage } from './ProjectPages';
export { exerciseById, exerciseBoard, exerciseLanguage } from './exercises';
export { buildFor, galleryById } from './gallery';
export { boardOption, BOARDS, DEFAULT_BOARD_ID, isBoardId, STARTER_WIRING } from './boardRegistry';
```

- Create: `src/routes/HomeRoute.tsx`, `BenchRoute.tsx`, `LearnRoutes.tsx`, `ProjectsRoute.tsx` — thin composition only, e.g.:

```tsx
export { HomePage as HomeRoute } from '@/features/learn';
```

```tsx
import { Bench } from '@/features/bench';
export default function BenchRoute() { return <Bench />; }
```

- Modify: `src/app/App.tsx` to compose routes + features (no direct deep imports):

```tsx
import Bench from '@/features/bench';
import { HomePage, ExercisesPage, ExercisePage, ReferencesPage, ProjectPage, DEFAULT_BOARD_ID } from '@/features/learn';
```

- Create: `scripts/check-boundaries.mjs` — the encapsulation gate (no new dependency):

```js
// Fails on deep imports outside the owning feature or on cross-feature imports.
import { execSync } from 'node:child_process';
const deep = execSync('grep -rn "from [\'\\"]@/features/[a-z-]*/[^\"\\']" src --include="*.ts" --include="*.tsx" | grep -v "src/features/\\([^/]*\\)/.*from [\'\\"]@/features/\\1[\"\\']" || true').toString().trim();
// Refine: allow relative imports INSIDE the same feature; forbid '@/features/X/...' from OUTSIDE X.
```

(Write the real script during implementation: allow `@/features/<name>` exact-seam imports anywhere, forbid `@/features/<name>/subpath` from files not under `src/features/<name>/`. Keep it under 40 lines.)

- Modify: `package.json` scripts: add `"check:boundaries": "node scripts/check-boundaries.mjs"` and document `npm run check:boundaries` in commit.

**Interfaces:**
- Consumes: `@/features/bench`, `@/features/parts`, `@/features/simulation`, `@/utils` (learn is the top composer alongside routes).
- Produces: page components + registry helpers for `src/app` and `src/routes`. `src/routes` produces nothing but composition (no logic, no state).

- [ ] **Step 1: Write the failing test (the gate itself)**

```bash
node scripts/check-boundaries.mjs; echo exit=$?
```

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL — deep `../ui/...` and `../sim/...` imports still exist all over the tree, and the script flags them.

- [ ] **Step 3: Minimal implementation**

`git mv` learn files per list, write the barrel with exact export names, create the four route shims, rewrite `src/app/App.tsx` to seam imports, add the gate script + npm script. Leave `src/sim/` and `src/ui/` directories deleted only when `find src/sim src/ui -type f | wc -l` prints `0` — verify no orphans before `git rm` of the empty dirs.

- [ ] **Step 4: Run to verify it passes (full gate)**

Run: `npx tsc -b --pretty false`
Expected: PASS exit 0.

Run: `npx vitest run 2>&1 | tail -n 5`
Expected: PASS — full suite green, same count as pre-migration (no tests deleted).

Run: `npx oxlint 2>&1 | tail -n 3 && npm run check:boundaries`
Expected: both PASS.

Run: `find src/sim src/ui -type f 2>/dev/null | wc -l`
Expected: `0` or "No such file" — no orphans.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: extract features/learn and routes composition, add boundary gate"
```

---

## Self-Review (run before handoff)

1. **Spec coverage:** Blueprint `app/assets/components/hooks/utils/types/features/pages` → Tasks 1 (app, skeleton), 2 (utils/types), 3–6 (features), 7 (learn + routes as pages). Path aliases → Task 1. Per-feature `api/components/hooks/types/utils/index.ts` subfolders → implemented as flat feature folders with `index.ts` only in this migration (subfolders added lazily when a feature grows a second concern — recorded trade-off, avoids speculative depth). Encapsulation rules 1–3 → Tasks 3–7 seams + Task 7 gate script. Phases 1–3 → Tasks 1, 3–6, 7.
2. **Placeholder scan:** no TBD/TODO/"similar to Task N" — every step has exact commands, exact file paths, exact barrel code shapes (names verified at implementation time against source, never renamed).
3. **Type consistency:** barrels re-export verbatim (`Engine`, `McuRuntime`, `Bench`, `BOARDS`, `DEFAULT_BOARD_ID`…); `@/*` spelled identically in tsconfig, vite, vitest; `routes/` filenames end in `Route.tsx` consistently.
4. **Review Focus:** each of the five lines has an owning check — deep imports (Task 7 gate), cross-feature (Tasks 5–6 grep), alias divergence (Task 1 triple-resolver check), orphaned tests (Tasks 3–7 move-with-source + glob), case sensitivity (lowercase-only convention + gate).

---

## Moved-files summary (for the final report, filled in as tasks land)

- Task 1: `src/App.tsx` → `src/app/App.tsx`; skeleton seams only, no logic moves.
- Task 2: `src/ui/format.ts` → `src/utils/format.ts`.
- Task 3: pure engine (`engine/circuit/netlist/elements/mcu/bench/probe/multimeter/units/matrix/encoder/relay/remote/dialer/sonar/stepper/sdcard/pixels/dht/bus/firmware` + tests) → `features/simulation`.
- Task 4: catalogue (`catalog/catalogue/boards/breadboard/passives/modules/devices/display` + tests) → `features/parts`.
- Task 5: canvas (`Bench/Workbench/simulation-facade/wire-route/wire-colours/hit-test/part-transform/footprints/hardware/wokwi/*Browser/*Search/*Preview` + tests) → `features/bench`.
- Task 6: panels (`Scope/Multimeter/LogicAnalyser/BusMonitor/Panels` + tests) → `features/instruments`.
- Task 7: learning (`exercises/gallery/projects/HomePage/ExercisePages/ProjectPages/boardRegistry/examples/glossary/guide-dismissal/map-*/monaco-setup` + tests) → `features/learn`; thin wrappers → `src/routes`.
