# Firmware multi-file tabs — design

Date: 2026-10-08. Status: approved in chat (approach A); awaiting spec review before planning.

## Intent

The bench firmware editor (`FirmwareEditor` in `src/features/instruments/Panels.tsx`)
is single-file: `Bench.tsx` holds `firmware: string`, `Simulation.loadFirmware(source,
language)` parses one translation unit, and every example / exercise / gallery build
carries `sketch: string`. Learners outgrow one file as soon as helpers (`oledCommand`,
`tftCommand`, clock BCD conversion, servo sweeps) deserve their own tab.

Success looks like: Arduino-style tabs in the bench editor (`main.ino` + `*.h` /
`*.cpp` / `*.ino`, `main.py` + `*.py` on the Pi) with true `#include "…"` / `import`
resolution between project files, errors that name `file:line`, and tabs that
persist across reload and survive in shareable bench links.

## Scope decisions (from scoping questions)

1. Firmware tabs in bench (not a generic code scaffolder, not agent permissions).
2. True includes/imports (approach A), not concatenated text: `#include "helpers.h"`
   must name a project file; `import helpers` / `from helpers import fn` must name a
   sibling `helpers.py`. System headers (`<Arduino.h>`, `<Wire.h>`) and runtime
   modules (`time`, `gpiozero`) stay runtime-provided and never resolve to files.
3. Tabs persist across reload (localStorage) and encode into shareable links
   (`?files=` compressed payload). Bench-local-only and full saveable project
   bundles are out of scope for v1.

## Approach (A selected, B/C rejected)

- **A. Project model + AST merge (selected).** New `FirmwareProject { language,
  files: [{ name, content }], activeName }`. Each file parses to the existing
  `Program` AST (`parseFirmware` / `parsePython`); a resolver merges `defines +
  globals + functions`. The VM stays single-AST ("two front ends, one VM").
- **B. Textual expansion (rejected).** Paste includes into one string before parse.
  Cheapest now, but error lines point at generated text and Python namespacing is
  wrong.
- **C. Separate compilation units (rejected).** Real headers/linkage/namespaces.
  Over-engineering for an interpreter that deliberately excludes structs, classes,
  pointers and heap (`parser.ts` header comment).

## 1. Project model + cross-file resolution

New file `src/features/simulation/firmware/project.ts`:

```ts
export interface FirmwareFile { readonly name: string; readonly content: string }
export interface FirmwareProject {
  readonly language: FirmwareLanguage;
  readonly files: readonly FirmwareFile[];
  readonly activeName: string;
}
```

Rules:

- Entry file required: `main.ino` (C++) or `main.py` (Python). Cannot be renamed
  or deleted. Helpers: C++ `*.h`, `*.cpp`, `*.ino`; Python `*.py`.
- Filename validation: `^[a-z0-9_-]+\.(ino|cpp|h|py)$`, lowercase only, unique per
  project. Violations are project errors shown under the editor, not exceptions.
- Caps: max 8 files, max 32 KB per file (keeps share links encodable; enforced at
  add/import time with a named error).

Build (`FirmwareRuntime.fromProject(project)`; existing `constructor(source,
language)` remains as a single-file wrapper so current tests are untouched):

- Pre-scan each file for local references only: C++ `^#\s*include\s*"([^"]+)"`,
  Python `^\s*(import\s+(\w+)|from\s+(\w+)\s+import\s+)`. Angle-bracket includes and
  `import time` / `from gpiozero import …` are skipped (runtime-provided).
- Referenced name must match a project file (`helpers.h`, `helpers` → `helpers.py`);
  otherwise `main.ino:1: #include "missing.h" not found`.
- Parse each file with its existing front end, passing the file name for error
  attribution. Merge in dependency order: `defines` unioned (same name + different
  value = error naming both files), `globals` concatenated, `functions` merged
  (duplicate name = error naming both files).
- Include-guard set makes double-includes free. Any include/import cycle is an
  error naming the loop (`a.h → b.h → a.h`).

Single-file examples / exercises / gallery builds load as `{ main.* }` with no
data-shape change in v1.

## 2. Editor tabs + data flow

`Bench` replaces `firmware: string` state with `project: FirmwareProject`, seeded
the same way as today (`exercise?.sketch` / `projectBuild?.sketch` / starter wrapped
as single-file projects). `FirmwareEditor` props change from `value: string` /
`onChange(string)` to `project: FirmwareProject` / `onProjectChange(project)`.

- Tab strip under the Firmware header: one tab per file, active = `activeName`,
  `+` adds (name validated first), `×` deletes (entry has no `×`), double-click
  renames inline.
- Monaco stays a single instance: `value = active file content`, `onChange` writes
  back to that file only. Cursor restore on tab switch is best-effort: the host
  saves `editor.saveViewState()` per file on switch and calls `restoreViewState`
  on select, ignoring failures; per-tab undo history is not preserved in v1.
- Flow unchanged from today: typing updates React state only; **Run** calls
  `simulation.loadFirmware(project)` then `start()`; `simulation.firmwareError`
  renders under the editor.
- `project.language` replaces the separate `language` state. Switching C++ ↔ Python
  on a multi-file project uses a native `window.confirm` warning before discarding
  other-language tabs (cancel keeps the project); no custom modal in v1.

## 3. Persist + share

- Autosave: on every `project` change (debounced ~500 ms) write
  `localStorage["noesis:bench:<boardId>:project"] = JSON({ language, files,
  activeName })`. Per-board keys keep pin-numbering differences isolated.
- Mount precedence: `?ex=` / `?project=` > `?files=` > localStorage > starter
  single-file. Loading an example / exercise / gallery build overwrites that
  board's save.
- Share: header "Copy link" builds `#/bench/<board>?files=<compressed>` where the
  payload is `compressToEncodedURIComponent(JSON({ language, files }))` via
  `lz-string` (MIT, ~3 KB; new dependency, since no built-in API does URL-safe
  compression). Invalid `?files=` falls back to the starter with an error line
  under the editor, never a blank bench.
- Size guard: if the compressed payload exceeds ~1800 chars the button disables
  with title "Too large to share by link — files stay local". HashRouter links must
  survive copy/paste, so oversize projects remain local-only by design.

## 4. Errors + migration + testing

Errors are `file:line`-aware:

- Extend `FirmwareSyntaxError` with `file: string` (both front ends take a file
  name; single-file callers pass `main.ino` / `main.py` so messages are unchanged).
- New `FirmwareProjectError` for structural failures, rendered in the same error
  bar: `helpers.h:4: duplicate function 'oledCommand' (also in main.ino)`,
  `main.ino:1: #include "missing.h" not found`, `main.py:2: import helpers not
  found`, `a.h → b.h → a.h: include cycle detected`. The editor auto-switches
  `activeName` to the error file.

Migration is additive: `Simulation.loadFirmware` and `FirmwareRuntime` keep string
overloads wrapping as `{ main.* }`. `Example.sketch` / `GalleryBuild.sketch` /
exercise sketches stay `string` in v1; multi-file examples are an explicit
follow-up, not this spec.

Tests (all new files co-located with firmware code):

- `project.test.ts`: merge order, duplicate-function error (both files named),
  define-conflict error, quoted-vs-angle include handling, Python `import` /
  `from…import` resolution, include/import cycles, filename + count + size
  validation, entry-file protection.
- `share-codec.test.ts`: compress round-trip, oversize guard threshold, corrupt
  `?files=` fallback to starter.
- Bench-level: autosave precedence (`?ex` > `?files` > localStorage > starter),
  example load clearing multi-file state, tab add/rename/delete including entry
  protection.

## Out of scope

- Multi-file example / exercise / gallery data shapes (follow-up spec).
- Per-tab undo history and Monaco multi-model editing.
- Saveable named projects, project bundles / downloads, server-side storage.
- New firmware APIs, new parts, or interpreter language growth (no structs,
  classes, pointers, heap — unchanged).
