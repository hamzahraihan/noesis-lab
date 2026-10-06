# Board featured projects — design

Date: 2026-10-06. Status: approved in chat; awaiting spec review before planning.

## Intent

Pressing a board card on the homepage should take the learner to that board's
featured project — a showcase page explaining what the board runs and why —
instead of dropping them straight onto the bench. The bench stays one click
away behind an Open-in-bench button.

Success looks like: all 7 boards have a project page with per-board editorial
worth reading (not generic copy), every card routes to its page, unknown ids
fail gracefully, and nothing about the bench itself changes.

## What already exists (and is reused, not rebuilt)

- `src/ui/boardRegistry.ts`: 7 boards (`uno`, `esp32`, `nano`, `rp2040`,
  `mega`, `raspberry-pi`, `franzininho`), `boardOption`, `boardSpecs`,
  `isBoardId`, `STARTER_WIRING`. The plain bench (`/bench/:boardId`) already
  opens with the starter project wired (LED, SSD1306 OLED on I2C, ILI9341 TFT
  on SPI) and its sketch loaded — so Open-in-bench needs no new plumbing.
- `src/ui/examples.ts`: 4 bench examples (`blink`, `i2c-clock`,
  `character-lcd`, `servo`) plus the Pi Python blink. They are C++ sketches
  (Pi excepted), which constrains which boards may reference them.
- `src/ui/HomePage.tsx`: `BoardArt` (real renderer) and spec `Chip`s, reused
  by the project page rather than reimplemented.
- `src/ui/ExercisePages.tsx` null-exercise handling is the pattern for
  unknown project ids.

## Scope decisions (from scoping questions)

1. Curated showcase, not bespoke builds: no new sketches, no new wiring
   setups, nothing new for the firmware parser to validate.
2. Showcase page: board art hero, spec chips, featured starter project in
   per-board words, Run-it checklist, try-next examples, Open-in-bench CTA.
   No wiring preview image (would need the starter builder refactored
   headless first) and no full sketch print (the bench editor shows it).
3. Homepage cards point at project pages with no direct bench shortcut; the
   project page's Open-in-bench button is the way onto the bench.

## Data model — new `src/ui/projects.ts`

```ts
export interface BoardProject {
  readonly board: BoardId;
  readonly project: string;   // e.g. "Starter bench: LED, OLED and TFT"
  readonly tagline: string;   // one line under the board name
  readonly why: string;       // why this board for this project
  readonly youWillSee: readonly string[]; // what Run shows, as checklist
  readonly tryNext: readonly string[];    // EXAMPLES ids that run here
}
export const PROJECTS: readonly BoardProject[]; // one per board, BOARDS order
export function projectFor(boardId: BoardId): BoardProject | null;
```

Per-board angles (the value over generic copy): Uno — the baseline the
lessons assume; ESP32 — 3.3 V logic, input-only GPIO34–39, reset-strapping
pins; Nano — Uno's chip, breadboard-friendly size; RP2040 — modern 3.3 V
practice, 12-bit ADC, A0–A3 silkscreen surprise; Mega — pin count, SPI on
50–53 so Uno sketches don't transfer by number; Raspberry Pi — Python blink
on GPIO17, no ADC without an MCP3008, BCM numbering, `tryNext: []` with copy
pointing at the bench's Python blink (the 4 examples are C++ and would fail
to parse on the Pi); Franzininho — ATtiny85 limits, two general GPIO, LED
sharing the SDA hole.

## Pages — new `src/ui/ProjectPages.tsx`

Detail page only; the homepage is the index, so no `/projects` list route.
Small `ProjectShell` (Boards / name breadcrumb) — `ExerciseShell` stays
Learn-specific and untouched.

- Hero: large `BoardArt` (exported from `HomePage.tsx`), board name,
  summary, derived spec chips.
- "The featured project": the starter bench (blinking LED — pin 2 on the
  microcontrollers, GPIO17 on the Pi — plus OLED on I2C and TFT on SPI)
  described in the entry's per-board words (`project`, `why`).
- "Run it": `ctl-accent` Open-in-bench link to `/bench/:boardId` plus the
  `youWillSee` checklist.
- "Try next": referenced examples by name + note, with copy directing the
  learner at the bench's Load-an-example menu. Deep-linking examples into
  the bench (e.g. `?example=`) is explicitly out of scope.
- Unknown id: "No such project" shell with a link back, mirroring the
  no-such-exercise page. Guard with `isBoardId` so a hand-edited URL never
  reaches `boardOption` unvalidated.

## Routing — `src/App.tsx`

One route: `/projects/:boardId` rendering the detail page. No index route.
Route ordering: no conflicts with `/learn/*` or `/bench/*`.

## Homepage — `src/ui/HomePage.tsx`

Board card link changes from `/bench/${board.id}` to
`/projects/${board.id}`; the hover CTA label changes from "Open the bench"
to "See the featured project". Card art, chips, and layout are untouched.
The Learn banner, bench board-switcher, and all exercise links are
unchanged.

## Out of scope

- Bench behaviour, starter wiring, and example loading are untouched.
- No `?example=` deep links; no wiring preview images; no sketch prints.
- No `/projects` index page; no persistence (nothing to remember).

## Verification

- New `src/ui/projects.test.ts`: every `BoardId` covered exactly once, every
  `tryNext` id resolves in `EXAMPLES`, every `youWillSee` non-empty.
- `npm run typecheck`, `npm run lint` (0 warnings), `npm test`, `npm run
  build`, and the Impeccable detector over all touched files.
