# Board Featured Projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Board cards on the homepage lead to a per-board featured-project showcase page instead of straight to the bench.

**Architecture:** New `projects.ts` data module (one curated entry per board) plus a new `ProjectPages.tsx` detail page at `/projects/:boardId`, reusing `BoardArt` and spec chips from `HomePage.tsx`; the bench itself is untouched because `/bench/:boardId` already opens with the starter project wired and loaded.

**Tech Stack:** React 19, react-router v8 (`HashRouter` — all links are client-side hash routes), TypeScript, Tailwind CSS v4, vitest.

**Spec:** `docs/superpowers/specs/2026-10-06-board-projects-design.md`

## Global Constraints

- The bench, starter wiring, and example loading are untouched — no changes to `Bench.tsx`, `examples.ts`, or `boardRegistry.ts` behavior.
- Every board (`uno`, `esp32`, `nano`, `rp2040`, `mega`, `raspberry-pi`, `franzininho`) gets exactly one project entry.
- `tryNext` holds only ids that exist in `EXAMPLES`; the Pi entry holds none because the four examples are C++ sketches that cannot parse on the Python board.
- Visual system is preserved: slate-950 surfaces, one sky accent, `ctl` controls — no new palette.
- `npm run typecheck` clean, `npm run lint` with 0 warnings and 0 errors, full `npm test` green, `npm run build` succeeds.

## Review Focus

- A hand-edited URL like `#/projects/banana` must render the friendly not-found shell, never throw inside render — pinned by the Task 3 dev check of that URL.
- The Pi page must render its no-examples copy instead of an empty "Try next" section — pinned by the Task 3 dev check of `#/projects/raspberry-pi`.
- A `tryNext` typo that names no example must fail the suite, not the learner — pinned by Task 1 tests resolving every id against `EXAMPLES`.
- Exporting `BoardArt`/`Chip` from `HomePage.tsx` must not change the homepage's own rendering — pinned by Task 2 running the existing suite plus a render smoke check of both exports.
- A card link missing its leading slash would resolve relative to the current hash route — pinned by the Task 4 dev click-through of all 7 cards.

---

### Task 1: Project data and its tests

**Files:**
- Create: `src/ui/projects.ts`
- Create: `src/ui/projects.test.ts`

**Interfaces:**
- Consumes: `BoardId` from `./boardRegistry`, `EXAMPLES` ids (`blink`, `i2c-clock`, `character-lcd`, `servo`) from `./examples`.
- Produces: `BoardProject`, `PROJECTS`, `projectFor(boardId: BoardId): BoardProject | null` for Task 3.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { BOARDS, type BoardId } from './boardRegistry';
import { EXAMPLES } from './examples';
import { PROJECTS, projectFor } from './projects';

const EXAMPLE_IDS = new Set(EXAMPLES.map((example) => example.id));

describe('board projects', () => {
  it('covers every board exactly once', () => {
    const ids = PROJECTS.map((entry) => entry.board);
    expect(new Set(ids).size).toBe(BOARDS.length);
    for (const board of BOARDS) {
      expect(ids.filter((id) => id === board.id).length, board.id).toBe(1);
    }
  });

  it('finds each board project by id and nothing else', () => {
    for (const board of BOARDS) {
      expect(projectFor(board.id)?.board).toBe(board.id);
    }
  });

  it('names only examples that exist, and always says what running shows', () => {
    for (const entry of PROJECTS) {
      for (const id of entry.tryNext) {
        expect(EXAMPLE_IDS.has(id), `${entry.board} tryNext "${id}"`).toBe(true);
      }
      expect(entry.youWillSee.length, `${entry.board} youWillSee`).toBeGreaterThan(0);
      expect(entry.project.length, `${entry.board} project`).toBeGreaterThan(0);
      expect(entry.why.length, `${entry.board} why`).toBeGreaterThan(0);
    }
  });

  it('sends the Pi learner to the Python blink, not to C++ examples', () => {
    const pi = projectFor('raspberry-pi' as BoardId);
    expect(pi?.tryNext).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/ui/projects.test.ts`
Expected: FAIL with "Failed to resolve import ./projects" (file does not exist yet).

- [ ] **Step 3: Write the data module**

```ts
/**
 * The featured project for each board: a curated showcase, not a new build.
 *
 * The bench already opens with every board's starter project wired (a
 * blinking LED, an SSD1306 OLED on I2C, an ILI9341 TFT on SPI) and its
 * sketch loaded, so these entries describe that project in per-board words
 * rather than inventing seven new ones. `tryNext` names bench examples by
 * their EXAMPLES id; the Pi names none, because those examples are C++
 * sketches and its bench speaks Python.
 */

import type { BoardId } from './boardRegistry';

export interface BoardProject {
  readonly board: BoardId;
  /** The project, in a few words: what is wired and loaded. */
  readonly project: string;
  /** One line under the board name. */
  readonly tagline: string;
  /** Why this board for this project — the per-board angle. */
  readonly why: string;
  /** What pressing Run shows, as a checklist. */
  readonly youWillSee: readonly string[];
  /** Bench example ids worth trying next, in EXAMPLES words. */
  readonly tryNext: readonly string[];
}

const STARTER_SEEN = [
  'The on-bench LED blinks steadily',
  'A bar sweeps each display, both buses driven by hand',
  'The serial monitor counts along: blink 1, blink 2, …',
] as const;

export const PROJECTS: readonly BoardProject[] = [
  {
    board: 'uno',
    project: 'Starter bench: LED, OLED and TFT',
    tagline: 'The classic first bench — one blinking LED and two hand-driven displays.',
    why: 'The baseline the lessons assume: 5 V logic and a 10-bit ADC, so every number in the curriculum measures what it says.',
    youWillSee: [...STARTER_SEEN],
    tryNext: ['blink', 'i2c-clock', 'character-lcd', 'servo'],
  },
  {
    board: 'esp32',
    project: 'Starter bench: LED, OLED and TFT',
    tagline: 'The same starter bench at 3.3 V — plus the pins that bite.',
    why: '3.3 V logic, a 12-bit ADC, input-only GPIO34–39, and reset-strapping pins the bench reproduces so you can hit them safely.',
    youWillSee: [...STARTER_SEEN],
    tryNext: ['blink', 'i2c-clock', 'character-lcd', 'servo'],
  },
  {
    board: 'nano',
    project: 'Starter bench: LED, OLED and TFT',
    tagline: "The Uno's chip on a breadboard-friendly board.",
    why: 'Same ATmega, same 5 V, same 10-bit ADC — every lesson transfers unchanged, and the narrow board leaves room on the breadboard.',
    youWillSee: [...STARTER_SEEN],
    tryNext: ['blink', 'i2c-clock', 'character-lcd', 'servo'],
  },
  {
    board: 'rp2040',
    project: 'Starter bench: LED, OLED and TFT',
    tagline: 'Modern 3.3 V practice with a 12-bit ADC.',
    why: '3.3 V logic and 12-bit conversion on a Nano-sized board. The analogue block silkscreens A0–A3 on the pins its ADC samples, which surprises anyone coming from an AVR.',
    youWillSee: [...STARTER_SEEN],
    tryNext: ['blink', 'i2c-clock', 'character-lcd', 'servo'],
  },
  {
    board: 'mega',
    project: 'Starter bench: LED, OLED and TFT',
    tagline: 'Room to grow: the most pins of any board here.',
    why: "Bigger builds. Its SPI lives on pins 50–53 rather than the Uno's 10–13, so a sketch written for one does not transfer by pin number.",
    youWillSee: [...STARTER_SEEN],
    tryNext: ['blink', 'i2c-clock', 'character-lcd', 'servo'],
  },
  {
    board: 'raspberry-pi',
    project: 'Python blink on GPIO17',
    tagline: 'A Linux computer you wire directly — in Python, not C++.',
    why: '3.3 V GPIO that is not 5 V tolerant, no analogue input without an MCP3008, and BCM numbering. The bench opens in Python because that is what this board speaks.',
    youWillSee: [
      'The LED on GPIO17 blinks on and off twice a second',
      'The wired OLED and TFT stay dark — this sketch drives no bus',
    ],
    tryNext: [],
  },
  {
    board: 'franzininho',
    project: 'Starter bench: LED, OLED and TFT',
    tagline: 'An ATtiny85 on a carrier: six I/O pins and hard limits.',
    why: 'Two general GPIO and four analogue pins, buses on the port bits, and a silkscreen that disagrees with the firmware numbers — PB5 is pin 4 and PB4 is pin 5. Pin 2 shares SDA, so no sketch owns it outright.',
    youWillSee: [...STARTER_SEEN],
    tryNext: ['blink'],
  },
];

export function projectFor(boardId: BoardId): BoardProject | null {
  return PROJECTS.find((entry) => entry.board === boardId) ?? null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/ui/projects.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/ui/projects.ts src/ui/projects.test.ts
git commit -m "Add per-board featured project data"
```

### Task 2: Share the homepage artwork and chips

**Files:**
- Modify: `src/ui/HomePage.tsx` (add two `export` keywords, nothing else)

**Interfaces:**
- Consumes: nothing new.
- Produces: exported `BoardArt({ board, className })` and `Chip({ label, value })` for Task 3.

- [ ] **Step 1: Export the two components**

In `src/ui/HomePage.tsx`, change `function Chip(` to `export function Chip(` and `function BoardArt(` to `export function BoardArt(`. No other change to the file — same props, same markup, same homepage rendering.

- [ ] **Step 2: Verify nothing changed**

Run: `npm run typecheck && npx vitest run src/ui/boardRegistry.test.ts`
Expected: typecheck clean, existing board tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/ui/HomePage.tsx
git commit -m "Export BoardArt and Chip for project pages"
```

### Task 3: Project detail page and route

**Files:**
- Create: `src/ui/ProjectPages.tsx`
- Modify: `src/App.tsx` (add import + one `<Route>`)

**Interfaces:**
- Consumes: `projectFor` from `./projects`; `BoardArt`, `Chip` from `./HomePage`; `boardOption`, `boardSpecs`, `isBoardId` from `./boardRegistry`; `EXAMPLES` from `./examples`.
- Produces: exported `ProjectPage` mounted at `/projects/:boardId` for Task 4 links.

- [ ] **Step 1: Write the page**

Create `src/ui/ProjectPages.tsx` with exactly this content:

```tsx
/**
 * Board featured projects: one showcase page per board.
 *
 * The homepage is the index, so there is no list route — only the detail
 * page. The bench is one click away behind Open in bench, which needs no
 * plumbing: `/bench/:boardId` already opens with the starter project wired
 * and its sketch loaded.
 */

import { Link, useParams } from 'react-router';
import { boardOption, boardSpecs, isBoardId } from './boardRegistry';
import { EXAMPLES } from './examples';
import { BoardArt, Chip } from './HomePage';
import { projectFor } from './projects';

export function ProjectPage() {
  const { boardId } = useParams<{ boardId?: string }>();
  const project = isBoardId(boardId) ? projectFor(boardId) : null;

  if (project === null) {
    return (
      <ProjectShell title="No such project">
        <p className="text-sm leading-relaxed text-slate-400">
          There is no project {boardId ?? 'here'}.{' '}
          <Link to="/" className="text-sky-400 underline underline-offset-2">
            Back to the boards
          </Link>
          .
        </p>
      </ProjectShell>
    );
  }

  const board = boardOption(project.board);
  const specs = boardSpecs(project.board);
  const next = EXAMPLES.filter((example) => project.tryNext.includes(example.id));

  return (
    <ProjectShell title={board.name}>
      <p className="max-w-[65ch] text-[15px] leading-relaxed text-slate-300">{project.tagline}</p>

      <figure>
        <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/60 p-6 shadow-[0_8px_24px_-16px_rgba(0,0,0,0.7)]">
          <BoardArt board={board} className="h-56 w-full" />
        </div>
        <figcaption className="mt-2 text-xs leading-relaxed text-slate-500">
          The board itself, drawn by the bench's own renderer at its own size.
        </figcaption>
      </figure>

      <div className="flex flex-wrap gap-1.5" aria-label="Board specifications">
        <Chip label="logic" value={`${specs.logicVolts} V`} />
        {specs.adcCount > 0 ? (
          <Chip label="ADC" value={`${specs.adcBits}-bit`} />
        ) : (
          <Chip label="ADC" value="none" />
        )}
        <Chip label="GPIO" value={String(specs.gpioCount)} />
        <Chip label="analogue" value={String(specs.adcCount)} />
        <Chip label="PWM" value={`${specs.pwmHz} Hz`} />
      </div>

      <ProjectSection title="The featured project">
        <p className="text-sm font-medium text-slate-200">{project.project}</p>
        <p className="mt-2 max-w-[65ch] text-sm leading-relaxed text-slate-400">{project.why}</p>
      </ProjectSection>

      <ProjectSection title="Run it">
        <ul className="space-y-1.5">
          {project.youWillSee.map((sign) => (
            <li key={sign} className="flex gap-2.5 text-sm leading-relaxed text-slate-400">
              <span className="text-sky-500">·</span>
              <span>{sign}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4">
          <Link to={`/bench/${project.board}`} className="ctl ctl-accent">
            Open in bench
          </Link>
        </div>
      </ProjectSection>

      <ProjectSection title="Try next">
        {next.length > 0 ? (
          <ul className="space-y-2.5">
            {next.map((example) => (
              <li
                key={example.id}
                className="rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3"
              >
                <p className="text-sm font-medium text-slate-200">{example.name}</p>
                <p className="mt-1 text-sm leading-relaxed text-slate-400">{example.note}</p>
                <p className="mt-1.5 text-xs leading-relaxed text-slate-500">
                  On the bench: Load an example → {example.name}.
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="max-w-[65ch] text-sm leading-relaxed text-slate-400">
            The examples above are Arduino sketches, and this bench speaks Python — start from
            the Python blink it opens with instead.
          </p>
        )}
      </ProjectSection>
    </ProjectShell>
  );
}

function ProjectShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-200">
      <header className="border-b border-slate-800">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-4">
          <Link to="/" className="ctl ctl-quiet">
            Boards
          </Link>
          <span className="text-slate-600">/</span>
          <span className="text-sm text-slate-400">Featured project</span>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-2xl font-semibold tracking-tight text-balance text-slate-100">{title}</h1>
        <div className="mt-8 space-y-10">{children}</div>
      </main>
    </div>
  );
}

function ProjectSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="border-b border-slate-800 pb-2.5 text-sm font-semibold tracking-tight text-slate-100">
        {title}
      </h2>
      <div className="mt-3.5">{children}</div>
    </section>
  );
}
```

- [ ] **Step 2: Mount the route**

In `src/App.tsx`, add the import and the route (beside the Learn routes, before the `/bench` redirect — order is irrelevant to matching here since all prefixes differ, but keep board-related routes grouped):

```tsx
import { ProjectPage } from './ui/ProjectPages';
```

```tsx
<Route path="/projects/:boardId" element={<ProjectPage />} />
```

- [ ] **Step 3: Verify it renders**

Run: `npm run typecheck && npx vitest run src/ui/projects.test.ts`
Expected: typecheck clean, Task 1 tests still pass. Then open `#/projects/uno` and `#/projects/banana` in dev (`npm run dev`) and confirm the showcase and the not-found shell respectively.

- [ ] **Step 4: Commit**

```bash
git add src/ui/ProjectPages.tsx src/App.tsx
git commit -m "Add board featured project pages"
```

### Task 4: Retarget the homepage cards

**Files:**
- Modify: `src/ui/HomePage.tsx` (card link target + CTA label only)

**Interfaces:**
- Consumes: the `/projects/:boardId` route from Task 3.
- Produces: cards navigating to project pages.

- [ ] **Step 1: Point cards at the project pages**

In `src/ui/HomePage.tsx`, inside the `BOARDS.map` card, change:

```tsx
<Link
  to={`/bench/${board.id}`}
```

to:

```tsx
<Link
  to={`/projects/${board.id}`}
```

and change the hover CTA:

```tsx
Open the bench
```

to:

```tsx
See the featured project
```

Nothing else on the card changes — art, chips, and layout stay as they are.

- [ ] **Step 2: Verify every card links to a project**

Run: `npm run typecheck`
Expected: clean. Then confirm in dev that each of the 7 cards lands on its project page and each page's Open-in-bench button lands on that board's bench.

- [ ] **Step 3: Commit**

```bash
git add src/ui/HomePage.tsx
git commit -m "Route board cards to featured projects"
```

### Task 5: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Run the whole suite**

Run: `npm test`
Expected: all files pass, including `src/ui/projects.test.ts`.

- [ ] **Step 2: Run lint, build, and the design detector**

Run: `npm run lint`
Expected: 0 warnings, 0 errors.

Run: `npm run build`
Expected: `✓ built in …` with no errors.

Run: `node C:\Users\Asep Saepuloh\.config\opencode\skills\impeccable\scripts/detect.mjs --json src/ui/projects.ts src/ui/ProjectPages.tsx src/ui/HomePage.tsx src/App.tsx`
Expected: `[]`.

- [ ] **Step 3: Manual pass**

Open `#/projects/raspberry-pi` (empty `tryNext` fallback copy), `#/projects/banana` (not-found shell), and click every homepage card through to its bench and back. Confirm keyboard focus is visible on the new links and the layout holds at a narrow mobile width.
