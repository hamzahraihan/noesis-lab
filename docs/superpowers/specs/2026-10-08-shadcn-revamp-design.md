# shadcn UI revamp — design

Date: 2026-10-08. Status: approved in chat (approach A phased full replacement); awaiting spec review before planning.

## Intent

Revamp the Noesis Lab UI with shadcn UI components. The app (Vite + React 19 + Tailwind v4 via `@tailwindcss/vite`) currently uses a hand-rolled `.ctl` / `.ctl-select` / `.panel-title` / `.empty` system in `src/index.css` plus raw Radix icons and hand-built dialogs/cards across Bench, instruments, and Learn pages.

Success looks like: every DOM chrome control (buttons, selects, dialogs, cards, tabs, tooltips, badges, empty states, form inputs) is a shadcn primitive from `src/components/ui/*`, the dark instrument-console identity (slate-950 surfaces, sky accent, dense 28px controls, uppercase panel headings) is preserved via the shadcn theme, and `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all pass with `.ctl` CSS deleted.

What this is not: a restyle of canvas/SVG renderers (`Workbench`, `footprints.tsx`, `PartPreview`), Monaco firmware editor internals, `wokwi` bridge, or simulation logic. Those stay untouched.

## Scope decisions (from scoping questions)

1. Full replacement of the custom `.ctl` system (not side-by-side, not one pilot screen). Phased execution, but the committed end state is zero `.ctl` usages.
2. Preserve dark console theme: shadcn CSS vars map to existing slate/sky/amber tokens; dense `h-7` control height; `panel-title` uppercase treatment retained via `CardTitle` styling. No stock light theme, no new light mode in v1.
3. Chrome only: canvas/SVG, Monaco, simulation model untouched. shadcn replaces DOM chrome: buttons, selects, dialogs/sheets, cards, tabs, tooltips, dropdowns, badges/chips, separators, scroll areas, labels, empty states, search inputs.
4. Approach A selected (phased full replacement). B big-bang rejected as too risky for `Bench.tsx` (1484 lines) + `Workbench.tsx` (1342 lines). C adapter shim rejected as it prolongs two systems.

## Approach (A selected, B/C rejected)

- **A. CLI foundation + phased file-by-file migration (selected).** `components.json` (new-york, RSC false), `src/lib/utils.ts` (`cn()`), Tailwind v4 theme vars in `src/index.css`, then migrate Learn pages → Bench chrome → instruments, deleting `.ctl` CSS last. Each phase gated on typecheck/lint/test/build + `.ctl` grep count strictly decreasing.
- **B. Big-bang rewrite (rejected).** All `.ctl`/select/dialog replaced in one PR and custom CSS deleted at once. Fastest but likely breaks bench toolbar/palette wiring and instrument panels with no bisect point.
- **C. Adapter shim (rejected).** Wrap `.ctl` strings in shadcn `Button` variants while keeping old CSS alive. Keeps the app green but ships two design systems indefinitely and doubles review surface.

## 1. Foundation architecture

New files:

- `components.json`: style `new-york`, `rsc: false`, `tsx: true`, `tailwind.css: src/index.css`, aliases `@/components`, `@/lib/utils`, `@/components/ui`.
- `src/lib/utils.ts`: `cn()` via `clsx` + `tailwind-merge`.
- `src/components/ui/*`: `button`, `input`, `select`, `dialog`, `card`, `tabs`, `tooltip`, `dropdown-menu`, `badge`, `separator`, `scroll-area`, `sheet`, `label` (+ `sonner` only if a toast need is confirmed; otherwise omitted — YAGNI).
- `src/components/index.ts`: becomes the public seam re-exporting `ui/*` (currently `export {}`).

Theme (`src/index.css`, Tailwind v4):

- Keep `@import "tailwindcss"` + `@import "tw-animate-css"`; add shadcn `:root` CSS vars mapped to console tokens: `--background` → slate-950, `--primary` → `--color-accent-strong`, `--muted`/`--muted-foreground` → slate-800/400, `--destructive` → red scale already used by `.ctl-danger`, `--radius` → `var(--radius-control)` (0.375rem).
- Preserve as-is: `:focus-visible` ring, `::selection`, link offset, caret-color, scrollbars, `input[type="range"].wiper` slider, `.guide-backdrop`/`.guide-panel` animations + `prefers-reduced-motion`, `.num` tabular-nums, `.icon`/`.icon-sm` sizes.
- Delete at the end (grep gate): `.ctl`, `.ctl-icon`, `.ctl-quiet`, `.ctl-outline`, `.ctl-accent`, `.ctl-danger`, `.ctl-select`, `.panel-title`, `.empty`. Nothing else in `index.css` is removed.

Dependencies to add: `class-variance-authority`, `clsx`, `tailwind-merge`, `@radix-ui/react-slot`, `lucide-react` (installed but not mass-adopted this pass), `tw-animate-css`, plus Radix primitives pulled by the chosen `ui/*` components. Keep `@radix-ui/react-icons` during migration; no icon rewrite.

Constraints: `@` alias already configured in `vite.config.ts`, `tsconfig.app.json`, and (to verify) `vitest.config.ts`. `verbatimModuleSyntax` + `noUnusedLocals`/`noUnusedParameters` stay clean. Deep `@/features/bench/Bench` composition exemption and bench → learn zero-direction boundary (see `scripts/check-boundaries.mjs`) stay intact.

## 2. Component mapping

| Current | shadcn target | Notes |
|---|---|---|
| `.ctl` + `.ctl-quiet` | `Button variant="secondary" size="sm"` (`h-7`) | Default neutral pressable |
| `.ctl-outline` | `Button variant="outline" size="sm"` | Secondary commitments (parts browser trigger) |
| `.ctl-accent` | `Button variant="default" size="sm"` | One primary action per panel; `default` maps to sky accent theme |
| `.ctl-danger` | `Button variant="destructive" size="sm"` | Destructive only |
| `aria-pressed` / `aria-expanded[data-toggle]` held-down | `Button` pressed state / `Toggle` where semantically a toggle | Preserve keyboard + pressed contrast |
| `.ctl-icon` square glyph | `Button size="icon-sm"` (28px) | Keep 1rem Radix glyph sizing |
| `.ctl-select` native `<select>` | `Select` (`Trigger`/`Content`/`Item`) | Bench header board/example pickers, instrument selects |
| `ComponentBrowser` fixed overlay | `Dialog` + `Input` + `Tabs` (catalogue/library) + `ScrollArea` + `Badge` group labels | Default is centered `Dialog` matching current overlay; switch to `Sheet` only if visual review prefers a side panel. Keep Escape-to-close, autofocus search, `aria-modal` |
| `PartSearch` input | `Input` + `Command`-less simple list (YAGNI: no `cmdk` unless fuzzy need proven) | Keep existing filter semantics |
| Learn cards (`HomePage`, `ExercisePages`, `ProjectPages`) | `Card` (`Header`/`Title`/`Description`/`Content`) + `Badge` replacing custom `Chip` | `Link` via `Button asChild` where the card is a link |
| `.panel-title` headings | `CardHeader`/`CardTitle` styled uppercase `tracking-wide text-slate-400` | Instruments: `Panels`, `Scope`, `Multimeter`, `LogicAnalyser`, `BusMonitor` |
| `.empty` states | `Card` + muted text + action `Button` (Empty pattern, no new dep) | Preserve "what to do next + control that does it" copy |
| Hand tooltips/titles | `Tooltip` (`Provider`/`Trigger`/`Content`) | Bench toolbar glyph buttons, instrument readouts |
| Section dividers | `Separator` | Panel stacks |
| `ExerciseGuide` backdrop/panel | `Dialog` content with existing `guide-backdrop`/`guide-panel` animations retained | Keep 180ms/240ms timings + reduced-motion guard |
| `StatusBar`, `FirmwareEditor` toolbar | `Button`/`Select`/`Separator` only; Monaco instance untouched | No editor option changes |

Icons: keep `@radix-ui/react-icons` imports as-is this pass. `lucide-react` is installed for new shadcn components that reference it, but no mass icon migration.

## 3. Migration order, data flow, verification

Order:

1. Foundation: `components.json`, deps, `lib/utils`, `ui/*` primitives, theme vars. Gate: `typecheck` + `lint` + `test` + `build` green; no UI behavior change.
2. Learn pages: `HomePage`, `ExercisePages`, `ExerciseGuide`, `ExercisePreview`, `ProjectPages`. Lowest interaction risk, highest visual payoff.
3. Bench chrome: `Bench.tsx` header/toolbar/palette triggers, `PartSearch`, `ComponentBrowser`, `PartPreview` frame (SVG content untouched), `StatusBar`.
4. Instruments: `Panels.tsx` (`FirmwareEditor`, `Inspector`, `SerialMonitor`, `StatusBar`), `Scope.tsx`, `Multimeter.tsx`, `LogicAnalyser.tsx`, `BusMonitor.tsx` — toolbar + headings + empty states only.
5. Deletion: remove `.ctl*`/`.ctl-select`/`.panel-title`/`.empty` CSS once `grep -rn "\.ctl\|panel-title\|class=.*empty" src` shows zero component usages. CSS deletion is its own commit.

Data flow: no change. The `Simulation` mutable model outside React, version-counter re-render, route props (`BenchRoute` → `Bench`), and firmware/share codecs are untouched. This is a presentational swap with identical props and event handlers.

Error handling / a11y guards: preserve `:focus-visible` ring on all shadcn triggers, keep `Escape` closes dialog, keep `aria-pressed`/`aria-expanded` semantics, keep `prefers-reduced-motion` for guide animations, keep `.num` tabular-nums on readouts. Any shadcn default that drops these is overridden in theme, not accepted silently.

Testing:

- Each phase: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
- `grep` gate: `.ctl` usage count strictly decreases per phase, zero at deletion commit.
- `scripts/check-boundaries.mjs` (`npm run check:boundaries`) stays green.
- Manual: keyboard tab through Bench toolbar + dialog open/close, Learn card links openable in new tab, instrument panels render with and without data (empty states).

Out of scope: light mode, new toast system (unless a current `alert()`/`status` need forces `sonner`), icon set migration, canvas/SVG artwork restyle, Monaco theming beyond toolbar, new routes or boards.
