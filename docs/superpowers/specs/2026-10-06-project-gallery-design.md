# Project gallery — design

Date: 2026-10-06. Status: approved in chat; awaiting spec review before planning.

## Intent

The projects experience should be a gallery of several runnable projects —
a wall of wiring-diagram thumbnails with titles, in the spirit of the
reference image (Simon-style games, RTC clock, keypad safe, pong, and
company) — not one starter blurb per board. Clicking a project opens its
detail page first (preview image, what it does, parts), then loads the
wiring + sketch onto the bench.

Success looks like: a `/projects` wall, five working projects a learner can
open on the bench and run, per-board showcases kept and linked, and every
homepage card still reaching a project.

## What this supersedes

PR #1 (`board-projects` branch: one showcase page per board at
`/projects/:boardId`) aimed at the old direction. That route collides with
the gallery, and the branch was never merged. The plan closes PR #1
unmerged and builds fresh: board showcases move to `/boards/:boardId`,
the gallery takes `/projects` + `/projects/:id`. Nothing from the old
branch is salvaged except the per-board editorial, which is reused as the
board pages' copy.

## Scope decisions (from scoping questions)

1. Detail page, then bench: gallery card → project detail (preview, parts,
   working checklist) → Open-on-bench loads wiring + sketch.
2. Starter set of 5, chosen by the builder from proven parts and firmware
   APIs. Exact clones of the reference wall are infeasible: the firmware
   has no `tone()` (piano), there is no 32×32 matrix part (8×8 NeoPixel at
   largest), and 32 servos would crush the solver.
3. Both, linked: per-board showcase pages stay and gain a "Projects for
   this board" section; the global gallery sits beside them; homepage
   cards keep pointing at board pages.

## The five projects (all Uno-tagged for v1)

1. **Alarm Clock with RTC** — DS1307 + LCD1602 + two set buttons.
   Proven: Wire reads and LCD writes both exist as bench examples.
2. **Electronic Safe** — membrane keypad + LCD + servo lock. Keypad
   readability from firmware must be verified during build; the fallback
   is a 3-button code lock with LEDs, no keypad.
3. **Servo Dashboard** — potentiometer + servo + OLED readout.
   Proven: ADC reads, servo writes, hand-driven display commands.
4. **Parking Sensor** — sonar + buzzer + LED bar. Proven: `pulseIn` + GPIO.
   Buzzer sounds come from GPIO switching, not `tone()`.
5. **Weather Station** — DHT22 + LCD + serial log. Proven: DHT port exists.

Each project needs an authored sketch (must pass the real firmware
parser), a working `setup()` (must wire without throwing and join real
contacts), and a preview (must frame non-empty content). If any project
fails validation during build, it is cut or replaced — the gallery ships
with whatever validates, minimum three.

## Data model — new `src/ui/gallery.ts`

```ts
export interface GalleryProject {
  readonly id: string;
  readonly title: string;
  readonly blurb: string;
  readonly boards: readonly BoardId[];
  readonly parts: readonly { readonly name: string; readonly qty: number }[];
  readonly setup: (simulation: Simulation) => void;
  readonly sketch: string;
  readonly working: readonly string[];
}
export const GALLERY: readonly GalleryProject[];
export function galleryById(id: string): GalleryProject | null;
```

Same vocabulary as exercises minus curriculum fields (`level`, `hints`,
`solution`), so the preview and bench machinery can treat both alike.
Validation tests mirror `exercises.test.ts`: setups run without throwing,
sketches parse, wires join real part contacts, board tags are real
`BoardId`s, ids unique.

## Previews — generalize, don't duplicate

`exercise-preview-data.ts` splits into a generic
`previewBench(boardId, setup, cacheKey)` plus a thin `previewFor(exercise)`
wrapper with identical behaviour. A generic thumbnail component serves
gallery cards (slice fit) and detail heroes (meet fit) with the existing
framing rules: exercise/project parts only, wires drawn whole and clipped,
board and breadboard bodies excluded.

## Pages and routes

- `/projects` — gallery wall: thumbnail + title cards in the reference
  image's arrangement, using our renderer, not screenshots.
- `/projects/:id` — detail: hero preview, what-it-does, parts list,
  working checklist, Open-on-bench CTA.
- `/boards/:boardId` — board showcase (PR #1 page, rebased onto the new
  route) with a "Projects for this board" section linking into the
  gallery; empty state copy where a board has no projects yet.
- Unknown ids anywhere → not-found shells with a way back, mirroring the
  no-such-exercise page. Hand-edited URLs must never throw inside render.

## Bench — `src/ui/Bench.tsx`

A `?project=:id` parameter beside `?ex=`: loads the project's setup and
sketch. Shows a compact project banner (title + back-to-project link + Run
reminder), not the full exercise guide — the guide stays
exercise-specific, and a second guide is out of scope. `?ex=` and
`?project=` never combine; `?ex=` wins if both are present, and the banner
only appears for projects.

## Homepage — `src/ui/HomePage.tsx`

Board cards point at `/boards/:boardId` (route rename from PR #1's
`/projects/:boardId`). A "Featured projects" banner joins the Learn
banner and links to `/projects`. Card art, chips, and layout untouched.

## Out of scope

- Bench behaviour beyond `?project=` loading and the banner; no guide
  changes; no `?example=` deep links.
- New firmware APIs (`tone()`, keypad ports if missing — verify first,
  then fall back, never extend the interpreter here).
- New simulator parts; new boards; a `/boards` index (homepage is it).
- Persistence of any kind.

## Verification

- New `src/ui/gallery.test.ts` per the data-model section, plus preview
  coverage for every project.
- `npm run typecheck`, `npm run lint` (0 warnings), `npm test`,
  `npm run build`, Impeccable detector over all touched files.
- Manual browser pass (owed, as usual): gallery wall, each detail page,
  each Open-on-bench load, unknown ids, narrow mobile width.
