# AGENTS.md

Working notes for this repo. Everything here is something the code does not tell
you on its own, or costs an hour to rediscover.

## A gallery project starts in one file, not five

Add the project to `src/features/learn/gallery-projects.json` and run
`npm run generate:gallery`. That writes `src/features/learn/generated/` —
the `GALLERY` entries, the circuit registry, the checks map, and the test
coverage list — so the five hand-synced files this used to need
(`gallery.ts`, `circuits/index.ts`, `diagnostics/registry.ts`,
`gallery.test.ts`, `diagnostics/registry.test.ts`) can no longer disagree.

What the generator cannot invent is the content: the circuit document under
`src/features/learn/circuits/`, the sketch, and a checks function. A build with
no checks is still a failure — `diagnostics/registry.test.ts` asserts it.

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

## The diagnostics harness reads pins by definition id

`HarnessSim.partVolts(partId, pinId)` looks the pin up in the netlist, which
uses the part definition's ids (`anode`, `cathode`), not the circuit JSON's
wire aliases (`A`, `K`). Passing an alias returns 0 V rather than throwing,
so a check looks like "the light never came on".

Checks in one entry share a single sim and run in order, so a later check may
depend on state an earlier one built — the existing entries already do this.

## Sketch constraint: no attachInterrupt

The interpreter refuses `attachInterrupt` on purpose. A demo that needs an edge
must either poll, or watch the part's own INT pin with `digitalRead` and touch
the bus only when it fires — that is the idiom the MCP23017 project uses.

## Verification in this environment

`npm test` (the whole suite) outruns a 10-minute command cap because of the AVR
compile legs. Verify with `npx vitest run <changed paths>` instead; `npm run
check` is the full gate when there is no cap.

`native/` is invisible to `tsc` and `npm test`. `npm run check:native`
syntax-checks the two wasm entry points (`native/src/solver.cpp`,
`native/src/parts/parts.cpp`) and is part of `npm run check`, so run it before
claiming a C++ change works. The other `.cpp` files are `#include`d by one of
those two — compiling `elements.cpp` or `units.cpp` on its own fails on purpose.
A real wasm build needs emsdk; `scripts/build-parts-probe.mjs` resolves `emcc`
from `$EMCC`, then `$EMSDK` (or the in-repo `emsdk/`), then PATH, and writes the
artifact the differential tests load (`src/features/parts/wasm/parts.wasm`).

`npm run format:check` is not part of `npm run check` and is not a gate: the
generated files (`src/features/learn/generated/`, `src/features/parts/wasm/generated/`)
are not formatter-canonical, so the check can never pass repo-wide. Never run
`npm run format` over the tree to "fix" it — that rewrites hundreds of unrelated
files. `.gitattributes` pins `eol=lf`, so CRLF is no longer the reason it fails.
The pre-commit hook runs `oxlint --fix` only, for the same reason.

Routing is hash-based (`/#/boards`, `/#/diagnostics`). `src/main.tsx` folds the
clean top-level paths into the hash before the router mounts, but a static host
without a rewrite rule still answers a clean path with its own 404.
