# AGENTS.md

## A gallery project starts in one file, not five

Add the project to `src/features/learn/gallery-projects.json` and run
`npm run generate:gallery`. That writes `src/features/learn/generated/` —
the `GALLERY` entries, the circuit registry, the checks map, and the test
coverage record — so the hand-synced files this used to need can no longer
disagree.

The JSON carries the two fields the generator used to keep in tables beside
itself: `checks` names the check symbol (an object keyed by variant when one
project ships two builds), and `wireFloor` states the fewest wires the project's
circuit must carry. Nothing about a project is decided anywhere else.

What the generator cannot invent is the content: the circuit document under
`src/features/learn/circuits/`, the sketch, and the checks themselves, which
live in one file per project under
`src/features/learn/diagnostics/checks/<id>.ts`. A project with no checks is
still a failure — `diagnostics/registry.test.ts` runs every interpreter build and
fails on a check that fails. Five checks fail today and are named in that file's
`KNOWN_GAPS` with the reason each is wrong; they are not wiring gaps, and they are
listed rather than deleted so the failure stays visible.

Counts in `docs/parity-scorecard.md`, `docs/PLAN.md`, and `PRODUCT.md` are
`<!-- COUNT:... -->` placeholders. Run `npm run update:docs-counts` after a
change that moves one; CI re-runs it and fails on any diff.

## Rules and what enforces them

| Rule | Enforcement |
| --- | --- |
| A new gallery project ships a circuit, a sketch, and at least one check | `npm run generate:gallery` builds the registries; `diagnostics/registry.test.ts` fails a build with no check |
| Pin lookups use part-definition ids, never circuit wire aliases | `partVolts` throws on an unknown pin; `harness.test.ts` covers the `A` vs `anode` case |
| Type lists have one source | Generated files and `keyof typeof` / `Record<...>`; `tsc -b` fails on a mismatch |
| The Wasm ABI stays in step with TypeScript | `native/abi/part-state.schema.json` generates the C header and the TS types; `npm run generate:abi` runs in `prepare` |
| Docs counts match the source | `<!-- COUNT:... -->` placeholders; CI runs `update:docs-counts` and fails on a diff |
| Committed code is lint-clean | Husky `pre-commit` → `lint-staged` → `oxlint --fix`; CI runs `npm run lint` |
| A device with knobs reads them from the world, never from a list in the engine | `devices/world.ts` is the only place a knob reaches a device; `world.test.ts` turns each knob on a real bench and fails if the device was handed nothing |

## The diagnostics harness reads pins by definition id

`HarnessSim.partVolts(partId, pinId)` looks the pin up in the netlist, which
uses the part definition's ids (`anode`, `cathode`), not the circuit JSON's
wire aliases (`A`, `K`). Passing an alias returns 0 V rather than throwing,
so a check looks like "the light never came on".

Checks in one entry share a single sim and run in order, so a later check may
depend on state an earlier one built — the existing entries already do this.

## A device with knobs gets its world from `devices/world.ts`

Each device declares the knobs it wants (`KnobSpec` list) and a `setXSource`
setter. `installWorld(device, { controls, partId })` joins the two, and the
engine calls it on every rebuild — the device reads the world when the chip
reports, so a knob turned between two reads is seen by the next one.

The old arrangement was a 57-line `instanceof` chain in `engine-legacy.ts` that
covered 12 of the 30 knob-bearing I2C devices. The other 19 declared a knob
nothing read, so the bench showed a control that did nothing. `createI2cDevice`
also ended in `return new Hx711()`, which is why an HTU21D gallery build loaded
clean and handed the firmware a load cell.

Two things follow for a new device: add an arm to `world.ts` (the chain is
keyed on the concrete class, so a device with no arm is visibly missing), and
add a case to `world.test.ts` — it turns the knob to both ends of its range and
asserts what the device was handed, so a missing arm fails there rather than on
a bench.

## Sketch constraint: no attachInterrupt

The interpreter refuses `attachInterrupt` on purpose. A demo that needs an edge
must either poll, or watch the part's own INT pin with `digitalRead` and touch
the bus only when it fires — that is the idiom the MCP23017 project uses.

## Verification in this environment

`npm test` (the whole suite) outruns a 10-minute command cap because of the AVR
compile legs. Verify with `npx vitest run <changed paths>` instead; `npm run
check` is the full gate when there is no cap.

`native/` is invisible to `tsc` and `npm test`. `npm run check:native`
syntax-checks the wasm entry points (`native/src/solver.cpp`,
`native/src/parts/parts.cpp`, and whichever of `native/src/engine_main.cpp` /
`native/src/engine_ffi_stub.cpp` exists) and is part of `npm run check`, so run
it before claiming a C++ change works. The other `.cpp` files are `#include`d by
one of those entry points — compiling `elements.cpp` or `units.cpp` on its own
fails on purpose. A real wasm build needs emsdk; `scripts/lib/parts-build.mjs`
(shared by `build:parts` and `build:parts:probe`) resolves `emcc` from `$EMCC`,
then `$EMSDK` (or the in-repo `emsdk/`), then PATH, and writes the artifact the
differential tests load (`src/features/parts/wasm/parts.wasm`). The two parts
entry points differ only in the manifest they record
(`native/parts-wasm-manifest.json` vs `native/parts-probe-manifest.json`).

`npm run format:check` is not part of `npm run check` and is not a gate: the
generated files (`src/features/learn/generated/`, `src/features/parts/wasm/generated/`)
are not formatter-canonical, so the check can never pass repo-wide. Never run
`npm run format` over the tree to "fix" it — that rewrites hundreds of unrelated
files. `.gitattributes` pins `eol=lf`, so CRLF is no longer the reason it fails.
The pre-commit hook runs `oxlint --fix` only, for the same reason.

## Reminder

The repository name is **`noesis-lab`** (noasis, not "noasis"). Use this exact spelling in paths, URLs, and commit messages.

## Agent skills

### Issue tracker

Issues live in the repo's GitHub Issues (uses the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage labels. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout (root `GLOSSARY.md` + `docs/adr/`). See `docs/agents/domain.md`.

Routing is hash-based (`/#/boards`, `/#/diagnostics`). `src/main.tsx` folds the
clean top-level paths into the hash before the router mounts, but a static host
without a rewrite rule still answers a clean path with its own 404.
