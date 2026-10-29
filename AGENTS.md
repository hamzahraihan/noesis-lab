# AGENTS.md

Working notes for this repo. Everything here is something the code does not tell
you on its own, or costs an hour to rediscover.

## A gallery project touches five places, not one

Adding a `GalleryProject` is never a single-file change: a circuit document in
`src/features/learn/circuits/` plus its registration in `circuits/index.ts`, the
`GALLERY` entry with its sketch, a live bench leg in `gallery.test.ts`, and a
checks function in `diagnostics/registry.ts` wired into `checksFor`.

The diagnostics entry is not optional: `diagnostics/registry.test.ts` asserts
every gallery build has at least one check, so a project without one fails the
suite even though the project itself runs. That same file also has to list the
project id before its checks are executed rather than merely counted.

Counts are hand-maintained in `docs/parity-scorecard.md` (gallery projects,
committed circuits) and the part paragraphs in `docs/PLAN.md`; a new project or
part will leave them stale unless you update them.

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

`npm run format:check` fails across the repo on CRLF line endings and is not
part of `npm run check`. It is not a gate; do not reformat files to satisfy it.

Routing is hash-based (`/#/boards`, `/#/diagnostics`). `src/main.tsx` folds the
clean top-level paths into the hash before the router mounts, but a static host
without a rewrite rule still answers a clean path with its own 404.
