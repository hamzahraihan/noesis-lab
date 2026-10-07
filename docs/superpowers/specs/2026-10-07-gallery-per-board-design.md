# Gallery per-board builds — design

Date: 2026-10-07. Status: approved in chat; awaiting spec review before planning.

## Intent

Every board's project page shows finished projects — at least 6 per board —
as runnable builds (preview image, what-it-does, parts), not the thin
example list currently on `/projects/uno`. The five Uno builds exist as
data; this program adapts the proven concepts per board until each board
has six.

Success looks like: Uno first to 6 (proves the pipeline), then one batch
per remaining board, each validated by the same harness, with board pages
and the gallery wall reading from per-board builds.

## Scope decisions (from scoping questions)

1. Phased: Uno to 6 first, then one batch per board (Nano, Mega, ESP32,
   RP2040, Pi, Franzininho). Each batch is its own implementation plan.
2. Adapt proven builds per board, not unique builds: the same concepts,
   rewired per board (Python sketches for the Pi). Uno's 6th is the
   Reaction Timer (LED + button + serial latency — GPIO and `millis` only).
3. Per-board builds inside one project entry (approach A): no entry
   duplication, no premature setup abstraction.

## Data model — evolve `src/ui/gallery.ts`

```ts
export interface GalleryBuild {
  readonly board: BoardId;
  /** Places the parts and runs the jumpers on that board's headers. */
  readonly setup: (simulation: Simulation) => void;
  /** The sketch in that board's language (Python on the Pi). */
  readonly sketch: string;
}

export interface GalleryProject {
  readonly id: string;
  readonly title: string;
  readonly blurb: string;
  readonly parts: readonly { readonly name: string; readonly qty: number }[];
  readonly builds: readonly GalleryBuild[];
  readonly working: readonly string[];
}

export function galleryById(id: string): GalleryProject | null;
export function buildFor(project: GalleryProject, board: BoardId): GalleryBuild | null;
export function boardsFor(project: GalleryProject): readonly BoardId[];
```

The `boards: BoardId[]` field retires, replaced by
`builds.map((build) => build.board)`. The five Uno entries migrate to
single-build form; the Reaction Timer is added as Uno's 6th. Sketches stay
inside the interpreter subset (global constraints of the gallery-data
plan); AVR boards normally keep the Uno sketch, ESP32/Pi/Franzininho get
adjusted sketches where pins or language differ.

## Validation harness — per build, per board

Every check loops over builds, with the bench built for that build's
board (`boardOption(build.board)`, board + breadboard placed, then
`build.setup`): sketch parses in the board's language
(`boardOption(board).language`, C++ vs Python — the exercises' rule);
wires join real part contacts with pinned per-(project, board) floors;
parts materialize; every placed part is touched. Preview assertions frame
per (project, board) with board-namespaced cache keys — this also clears
the reviewer's deferred items (key namespacing, boards[0]-only coverage).

## Display (feeds gallery UI work)

- Board pages: a "Finished projects" section per board — thumbnail, title,
  blurb per build for that board — replacing the thin try-next list.
- Gallery wall cards carry board tags from `boardsFor`.
- Bench `?project=` loading resolves a (project, board) pair and shows
  the compact project banner.
- Unknown project ids and board-less projects render not-found/empty
  states, never throws.

## Batches after v1

Nano, Mega, ESP32, RP2040, Pi, Franzininho — one plan each, each adding
`GalleryBuild`s to the existing concepts (plus board-character builds only
where cheap), each gated by the same harness. Minimum per batch: the
board reaches 6 visible projects.

## Out of scope

- New firmware APIs, new simulator parts, new boards.
- Unique per-board concepts beyond adaptation (revisit after all boards
  reach 6).
- Pages, routes, bench plumbing, homepage (gallery UI work, separate
  track building on this data).

## Verification

- `gallery.test.ts` per-build coverage for every project.
- `npm run typecheck`, `npm run lint` (0 warnings), `npm test`,
  `npm run build`, Impeccable detector over touched files.
- Manual browser pass per batch: board page shows its projects, each
  opens on the bench and runs.
