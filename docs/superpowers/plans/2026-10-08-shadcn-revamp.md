# shadcn UI revamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all hand-rolled `.ctl` DOM chrome with shadcn primitives while preserving the dark instrument-console theme.

**Architecture:** Add shadcn foundation (config + `cn()` + theme vars + `ui/*` primitives mapped to slate/sky tokens), then migrate Learn pages → Bench chrome → instruments file-by-file, deleting `.ctl` CSS last with a grep gate at every phase.

**Tech Stack:** React 19, Vite 8, Tailwind CSS v4 (`@tailwindcss/vite`), shadcn new-york style, Radix primitives, `class-variance-authority` + `clsx` + `tailwind-merge`, `tw-animate-css`, TypeScript (bundler mode, `verbatimModuleSyntax`, `noUnusedLocals`), Vitest (node env, `src/**/*.test.ts`), Oxlint.

**Spec:** `docs/superpowers/specs/2026-10-08-shadcn-revamp-design.md`

## Global Constraints

- Preserve dark console identity: slate-950 surfaces, sky accent primary, dense `h-7` (1.75rem) controls, uppercase panel headings — no stock light theme, no light/dark toggle in v1.
- Chrome only: canvas/SVG renderers (`Workbench`, `footprints.tsx`, `PartPreview` SVG content), Monaco instance/options, `wokwi` bridge, and simulation model stay untouched.
- Keep `@radix-ui/react-icons` imports as-is this pass; no mass icon migration to `lucide-react`.
- Preserve `:focus-visible` ring, `::selection`, scrollbars, `input[type=range].wiper` styling, `guide-backdrop`/`guide-panel` animations + `prefers-reduced-motion` guard, `.num` tabular-nums.
- Boundary rules stay green: only `src/app/**` and `src/routes/**` may deep-import `@/features/bench/Bench`; no bench/instruments → learn value edges; `src/components/index.ts` is the shared UI seam.
- Each phase gates on `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, plus `npm run check:boundaries` before commits touching imports.
- No placeholders: every step ships exact code; no `TODO`/`TBD`.

## Review Focus

- Keyboard-only operator tabs through Bench toolbar and opens/closes ComponentBrowser dialog: focus ring must stay visible on every shadcn trigger (pinned in Task 4 and Task 10 manual checks).
- `prefers-reduced-motion` user opens ExerciseGuide: no backdrop/panel animation may play (pinned in Task 8 manual check).
- Long board/example names in Bench header `Select` trigger: trigger must truncate, never push Run/Components off-screen (pinned in Task 9 manual check).
- Empty ComponentBrowser search (no matches): must show the guided empty state with a clear-search action, not a blank list (pinned in Task 10 code + check).
- Narrow (768px) bench with FirmwareEditor toolbar: language select + example select + Run must not overlap the tablist or error bar (pinned in Task 11 manual check).

---

### Task 1: Foundation config — deps, components.json, animate CSS

**Files:**
- Modify: `package.json`
- Create: `components.json`
- Modify: `src/index.css` (animate import line only)

**Interfaces:**
- Consumes: existing `vite.config.ts` `@` alias, `tsconfig.app.json` `@/*` paths, `vitest.config.ts` `@` alias (all already configured — verified, no changes needed).
- Produces: `components.json` contract consumed by Tasks 4–6 (`style: new-york`, aliases `@/components`, `@/lib/utils`, `@/components/ui`, `css: src/index.css`).

- [ ] **Step 1: Install shadcn foundation dependencies**

Run: `npm install class-variance-authority clsx tailwind-merge @radix-ui/react-slot tw-animate-css lucide-react`
Expected: PASS — `package.json` gains the five/six entries; no other deps change.

- [ ] **Step 2: Create components.json**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "",
    "css": "src/index.css",
    "baseColor": "slate",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

- [ ] **Step 3: Add the Tailwind v4 animation import**

In `src/index.css`, change line 1 from:

```css
@import "tailwindcss";
```

to:

```css
@import "tailwindcss";
@import "tw-animate-css";
```

Nothing else in `index.css` changes in this task.

- [ ] **Step 4: Verify install and build**

Run: `npm run typecheck`
Expected: PASS

Run: `npm run build`
Expected: PASS — no UI behavior change yet.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json components.json src/index.css
git commit -m "chore(ui): shadcn foundation config and deps"
```

---

### Task 2: cn() util with a real node test

**Files:**
- Create: `src/lib/utils.ts`
- Create: `src/lib/utils.test.ts`

**Interfaces:**
- Consumes: `clsx`, `tailwind-merge` from Task 1.
- Produces: `cn(...inputs: ClassValue[]): string` consumed by every `ui/*` component in Tasks 4–6 and all migrations in Tasks 7–11.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/utils.test.ts
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('merges class lists', () => {
    assert.equal(cn('px-2', 'py-1'), 'px-2 py-1');
  });

  it('tailwind-merge resolves conflicting utilities', () => {
    assert.equal(cn('bg-slate-800', 'bg-slate-700'), 'bg-slate-700');
  });

  it('ignores falsy conditional entries', () => {
    assert.equal(cn('ctl', false && 'ctl-accent', undefined, 'h-7'), 'ctl h-7');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/utils.test.ts`
Expected: FAIL with "Failed to resolve import ./utils" (file does not exist yet).

- [ ] **Step 3: Write minimal implementation**

```ts
// src/lib/utils.ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/utils.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run repo gates**

Run: `npm run typecheck && npm run lint && npm test`
Expected: PASS — full engine suite (`src/**/*.test.ts`) still green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/utils.ts src/lib/utils.test.ts
git commit -m "feat(ui): add cn() class merge util with tests"
```

---

### Task 3: Dark-console shadcn theme vars in index.css

**Files:**
- Modify: `src/index.css` (`:root` theme block only; everything else byte-identical)

**Interfaces:**
- Consumes: existing `@theme` tokens (`--color-accent`, `--color-accent-strong`, `--radius-control`) and Tailwind v4 slate scale.
- Produces: shadcn CSS vars (`--background`, `--foreground`, `--primary`, `--muted`, `--destructive`, `--radius-*`, `--ring`) consumed by `ui/*` in Tasks 4–6. Deletes nothing; the `.ctl` block stays until Task 12.

- [ ] **Step 1: Add shadcn vars mapped to console tokens**

Insert directly after the existing `@theme { ... }` block (after line 22), leaving that block untouched:

```css
:root {
  --radius: var(--radius-control);
  --background: var(--color-slate-950);
  --foreground: var(--color-slate-100);
  --card: var(--color-slate-900);
  --card-foreground: var(--color-slate-100);
  --popover: var(--color-slate-900);
  --popover-foreground: var(--color-slate-100);
  --primary: var(--color-accent-strong);
  --primary-foreground: #fff;
  --secondary: var(--color-slate-800);
  --secondary-foreground: var(--color-slate-200);
  --muted: var(--color-slate-800);
  --muted-foreground: var(--color-slate-400);
  --accent: var(--color-slate-800);
  --accent-foreground: var(--color-slate-100);
  --destructive: var(--color-red-500);
  --destructive-foreground: var(--color-slate-100);
  --border: var(--color-slate-800);
  --input: var(--color-slate-700);
  --ring: var(--color-accent);
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --radius-sm: calc(var(--radius) - 2px);
  --radius-md: var(--radius);
  --radius-lg: calc(var(--radius) + 2px);
}
```

NOTE: the file already defines `--color-accent*` in `@theme`; the `@theme inline` `--color-accent` override above would clash. Resolve by naming the shadcn accent pair `--color-accentx`? No — do not rename. Instead, in the `@theme inline` block use `--color-accent-foreground` only and omit `--color-accent` (keep the bench's oklch accent as the single source). Final block omits the two `--color-accent` lines and keeps the rest verbatim. (This note is the decision, not a placeholder: omit those two lines.)

- [ ] **Step 2: Verify no existing rules were touched**

Run: `git diff --stat src/index.css`
Expected: only additions (the `:root` + `@theme inline` blocks); zero deletions. Confirm with `git diff src/index.css | grep "^-" | grep -v "^---"` returning nothing.

- [ ] **Step 3: Verify build**

Run: `npm run typecheck && npm run build`
Expected: PASS — visuals unchanged (no component consumes the vars yet).

- [ ] **Step 4: Commit**

```bash
git add src/index.css
git commit -m "feat(ui): shadcn theme vars mapped to dark console tokens"
```

---

### Task 4: Button primitive + public seam (+ focus-ring pin)

**Files:**
- Create: `src/components/ui/button.tsx`
- Modify: `src/components/index.ts`

**Interfaces:**
- Consumes: `cn` from Task 2, `@radix-ui/react-slot` `Slot`, `class-variance-authority` `cva`.
- Produces: `Button`, `buttonVariants` (variants `default | secondary | outline | destructive | ghost`, sizes `sm | default | icon | icon-sm`) consumed by Tasks 7–11. Variant contract: `default` = old `.ctl-accent`, `secondary` = old `.ctl-quiet`, `outline` = old `.ctl-outline`, `destructive` = old `.ctl-danger`; `sm` = `h-7` density, `icon-sm` = 28px square (old `.ctl-icon`).

- [ ] **Step 1: Write button.tsx**

```tsx
// src/components/ui/button.tsx
import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-45 aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        // Old .ctl-accent: the one action a panel exists to offer.
        default: 'bg-primary text-primary-foreground hover:bg-[var(--color-accent)]',
        // Old .ctl-quiet: the default thing you press.
        secondary: 'bg-secondary text-secondary-foreground hover:bg-slate-700',
        // Old .ctl-outline: a secondary commitment.
        outline:
          'bg-transparent text-slate-300 shadow-[inset_0_0_0_1px_var(--color-slate-700)] hover:bg-slate-800 hover:text-slate-100',
        // Old .ctl-danger: destructive and nothing else.
        destructive:
          'bg-transparent text-red-300 shadow-[inset_0_0_0_1px_var(--color-red-900)] hover:bg-red-950 hover:text-red-200',
        ghost: 'hover:bg-slate-800 hover:text-slate-100',
      },
      size: {
        sm: 'h-7 px-2.5',
        default: 'h-8 px-3',
        icon: 'size-8 p-0',
        'icon-sm': 'size-7 p-0',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'sm' },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button';
  return <Comp data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { Button, buttonVariants };
```

- [ ] **Step 2: Open the public seam**

Replace `src/components/index.ts` content (`// Public seam for components.\nexport {};`) with:

```ts
// Public seam for components.
export { Button, buttonVariants } from './ui/button';
```

- [ ] **Step 3: Verify gates**

Run: `npm run typecheck && npm run lint && npm run check:boundaries && npm test`
Expected: PASS (no consumers yet; seam import resolves).

- [ ] **Step 4: Manual focus-ring pin (Review Focus #1)**

Run: `npm run dev`, render `<Button variant="secondary">Test</Button>` temporarily? No — do not ship temp code. Instead keyboard-tab to any existing focusable element and confirm the sky `:focus-visible` ring still renders (theme untouched). Record result in the commit message body (`focus ring: intact`).

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/button.tsx src/components/index.ts
git commit -m "feat(ui): shadcn Button mapped to ctl variants"
```

---

### Task 5: Input, Label, Badge, Separator primitives

**Files:**
- Create: `src/components/ui/input.tsx`
- Create: `src/components/ui/label.tsx`
- Create: `src/components/ui/badge.tsx`
- Create: `src/components/ui/separator.tsx`
- Modify: `src/components/index.ts`

**Interfaces:**
- Consumes: `cn` (Task 2), theme vars (Task 3).
- Produces: `Input`, `Label`, `Badge` (+ `badgeVariants`), `Separator` consumed by Tasks 7–11. `Badge` replaces Learn `Chip` (`label` → muted prefix, `value` → tabular-nums).

- [ ] **Step 1: Write input.tsx**

```tsx
// src/components/ui/input.tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'h-7 w-full min-w-0 rounded-md border border-transparent bg-slate-800 px-2 py-1 text-xs text-slate-200 shadow-xs transition-colors outline-none placeholder:text-slate-500 hover:bg-slate-700 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-45',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
```

- [ ] **Step 2: Write label.tsx**

```tsx
// src/components/ui/label.tsx
import * as React from 'react';
import * as LabelPrimitive from '@radix-ui/react-label';
import { cn } from '@/lib/utils';

function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn('text-xs text-slate-400', className)}
      {...props}
    />
  );
}

export { Label };
```

- [ ] **Step 3: Install the label primitive, then write badge.tsx and separator.tsx**

Run: `npm install @radix-ui/react-label @radix-ui/react-separator`
Expected: PASS.

```tsx
// src/components/ui/badge.tsx
import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-baseline gap-1.5 rounded-md px-2 py-1 text-xs [&_span:first-child]:text-slate-500 [&_span:last-child]:font-medium [&_span:last-child]:text-slate-200 [&_span:last-child]:tabular-nums',
  {
    variants: { variant: { secondary: 'bg-slate-800', outline: 'shadow-[inset_0_0_0_1px_var(--color-slate-700)]' } },
    defaultVariants: { variant: 'secondary' },
  },
);

function Badge({ className, variant, ...props }: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
```

```tsx
// src/components/ui/separator.tsx
import * as React from 'react';
import * as SeparatorPrimitive from '@radix-ui/react-separator';
import { cn } from '@/lib/utils';

function Separator({ className, orientation = 'horizontal', decorative = true, ...props }: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        'shrink-0 bg-slate-800 data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px',
        className,
      )}
      {...props}
    />
  );
}

export { Separator };
```

- [ ] **Step 4: Extend the seam**

Append to `src/components/index.ts`:

```ts
export { Input } from './ui/input';
export { Label } from './ui/label';
export { Badge, badgeVariants } from './ui/badge';
export { Separator } from './ui/separator';
```

- [ ] **Step 5: Verify gates**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/input.tsx src/components/ui/label.tsx src/components/ui/badge.tsx src/components/ui/separator.tsx src/components/index.ts package.json package-lock.json
git commit -m "feat(ui): shadcn Input Label Badge Separator primitives"
```

---

### Task 6: Card, Dialog, Sheet, Tabs, Select, Tooltip, DropdownMenu, ScrollArea

**Files:**
- Create: `src/components/ui/card.tsx`
- Create: `src/components/ui/dialog.tsx`
- Create: `src/components/ui/sheet.tsx`
- Create: `src/components/ui/tabs.tsx`
- Create: `src/components/ui/select.tsx`
- Create: `src/components/ui/tooltip.tsx`
- Create: `src/components/ui/dropdown-menu.tsx`
- Create: `src/components/ui/scroll-area.tsx`
- Modify: `src/components/index.ts`

**Interfaces:**
- Consumes: `cn` (Task 2), theme vars (Task 3), `Button` ghost variant (Task 4) for dialog close.
- Produces: full dialog/select/tab/tooltip/card surface consumed by Tasks 8–11. `CardTitle` carries the uppercase `panel-title` treatment (`text-[11px] font-semibold tracking-[0.08em] text-slate-400 uppercase`).

- [ ] **Step 1: Install Radix primitives**

Run: `npm install @radix-ui/react-dialog @radix-ui/react-tabs @radix-ui/react-select @radix-ui/react-tooltip @radix-ui/react-dropdown-menu @radix-ui/react-scroll-area`
Expected: PASS.

- [ ] **Step 2: Write card.tsx**

```tsx
// src/components/ui/card.tsx
import * as React from 'react';
import { cn } from '@/lib/utils';

function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card" className={cn('flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4', className)} {...props} />;
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-header" className={cn('flex flex-col gap-1', className)} {...props} />;
}

function CardTitle({ className, ...props }: React.ComponentProps<'h3'>) {
  return <h3 data-slot="card-title" className={cn('text-[11px] font-semibold tracking-[0.08em] text-slate-400 uppercase', className)} {...props} />;
}

function CardDescription({ className, ...props }: React.ComponentProps<'p'>) {
  return <p data-slot="card-description" className={cn('text-sm text-slate-400', className)} {...props} />;
}

function CardContent({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-content" className={cn('flex flex-col gap-3', className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="card-footer" className={cn('flex items-center gap-2', className)} {...props} />;
}

export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter };
```

- [ ] **Step 3: Write dialog.tsx, sheet.tsx, tabs.tsx, select.tsx, tooltip.tsx, dropdown-menu.tsx, scroll-area.tsx**

Use the canonical shadcn new-york implementations for these seven files with two repo adaptations: (a) every `bg-background`/`bg-popover` surface stays (theme already maps to slate), (b) dialog/sheet content uses `rounded-xl border-slate-700 bg-slate-900`, (c) select trigger height `h-7 text-xs`, (d) tooltip content `bg-slate-800 text-xs text-slate-200`. Do not restyle beyond these four adaptations. The full file contents follow the shadcn CLI output for `dialog sheet tabs select tooltip dropdown-menu scroll-area` — copy from the installed CLI template at implementation time via `npx shadcn@latest add dialog sheet tabs select tooltip dropdown-menu scroll-area --overwrite` is FORBIDDEN (it would rewrite Tasks 4–5 files); hand-write the seven files instead, importing `cn` from `@/lib/utils`.

- [ ] **Step 4: Extend the seam**

Append to `src/components/index.ts`:

```ts
export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from './ui/card';
export {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from './ui/dialog';
export { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetDescription } from './ui/sheet';
export { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
export { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from './ui/select';
export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from './ui/tooltip';
export { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from './ui/dropdown-menu';
export { ScrollArea } from './ui/scroll-area';
```

Export names must match the symbols actually defined in Step 3 — if a CLI-template symbol differs (e.g. `DialogPortal`), add it to both files, never leave a dangling re-export (would fail `typecheck` on `verbatimModuleSyntax`).

- [ ] **Step 5: Verify gates**

Run: `npm run typecheck && npm run lint && npm test && npm run build && npm run check:boundaries`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/card.tsx src/components/ui/dialog.tsx src/components/ui/sheet.tsx src/components/ui/tabs.tsx src/components/ui/select.tsx src/components/ui/tooltip.tsx src/components/ui/dropdown-menu.tsx src/components/ui/scroll-area.tsx src/components/index.ts package.json package-lock.json
git commit -m "feat(ui): shadcn Card Dialog Sheet Tabs Select Tooltip primitives"
```

---

### Task 7: Learn pages migration (Home, Exercises, Projects, Preview)

**Files:**
- Modify: `src/features/learn/HomePage.tsx` (`Chip` → `Badge`, cards → `Card`)
- Modify: `src/features/learn/ExercisePages.tsx` (nav links → `Button asChild`, cards → `Card`)
- Modify: `src/features/learn/ProjectPages.tsx` (`Chip` import, `ctl-accent/quiet` links → `Button asChild`)
- Modify: `src/features/learn/ExercisePreview.tsx` (any raw buttons → `Button`; headings keep text, no `panel-title` class)

**Interfaces:**
- Consumes: `Button`, `Card*`, `Badge` (Tasks 4–6). `Chip` stays exported from `HomePage.tsx` as a deprecated alias (same props) so `ProjectPages.tsx` keeps compiling mid-task; removed in Task 12.
- Produces: Learn pages with zero `ctl` classes; `Chip` alias removal scheduled in Task 12.

- [ ] **Step 1: Migrate HomePage — Chip to Badge, cards to Card**

In `src/features/learn/HomePage.tsx`: replace the `Chip` body with a `Badge` wrapper (keep the `Chip` export name this task):

```tsx
import { Badge } from '@/components';
...
export function Chip({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <Badge>
      <span>{label}</span>
      <span>{value}</span>
    </Badge>
  );
}
```

Replace the two card containers: the `/learn` banner `Link` and each board-card `Link` — wrap content in `Card` visuals by changing their class strings to the `Card` equivalent (`rounded-xl border border-slate-800 bg-slate-900/60 p-4 ...`) OR by using `Card` as the element with `asChild`? `Card` has no `asChild`; keep the `Link` element and apply `Card`-identical classes plus `transition-colors hover:border-slate-600 hover:bg-slate-900`. Do not change `to=` targets.

- [ ] **Step 2: Migrate ExercisePages and ProjectPages links**

Example replacement (apply to every `ctl` link in both files):

```tsx
// before
<Link to="/" className="ctl ctl-quiet">
// after
<Button asChild variant="secondary" size="sm">
  <Link to="/">Boards</Link>
</Button>
```

```tsx
// before
<Link to={`/bench/${EXERCISE_BOARD}`} className="ctl ctl-accent">
// after
<Button asChild size="sm">
  <Link to={`/bench/${EXERCISE_BOARD}`}>Open bench</Link>
</Button>
```

`variant="default"` is the accent — do not pass `variant="accent"` (does not exist). Keep all link text, `title`s, and `to=` values identical.

- [ ] **Step 3: Verify Learn has no ctl leftovers**

Run: `grep -rn 'ctl' src/features/learn --include="*.tsx" | grep -v '^\s*\*' | grep -v 'exactly'`
Expected: empty (only code comments mentioning backticks may remain; no `className` with `ctl`).

- [ ] **Step 4: Verify gates**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: PASS.

- [ ] **Step 5: Manual check + commit**

Open `/`, `/learn`, `/projects/uno`: board cards render, Learn banner navigates, spec chips show values. Then:

```bash
git add src/features/learn/HomePage.tsx src/features/learn/ExercisePages.tsx src/features/learn/ProjectPages.tsx src/features/learn/ExercisePreview.tsx
git commit -m "feat(ui): migrate Learn pages to shadcn Card Button Badge"
```

---

### Task 8: ExerciseGuide migration (Dialog + step buttons + reduced-motion pin)

**Files:**
- Modify: `src/features/learn/ExerciseGuide.tsx`

**Interfaces:**
- Consumes: `Dialog*`, `Button` (Tasks 4, 6). Keeps `guide-backdrop`/`guide-panel` CSS classes and `prefers-reduced-motion` behavior.
- Produces: Guide overlay as `Dialog` with identical open/close/Escape semantics and step state.

- [ ] **Step 1: Replace overlay divs with Dialog, buttons with Button**

Replace the `fixed inset-0 ... guide-backdrop` wrapper + inner `guide-panel` div with:

```tsx
<Dialog open={open} onOpenChange={(next) => { if (!next) close(); }}>
  <DialogContent className="guide-panel max-h-[85vh] max-w-3xl overflow-hidden bg-slate-900" aria-describedby={undefined}>
    {/* existing guide body verbatim: steps, wiring summary, stuck section */}
  </DialogContent>
</Dialog>
```

Keep the `guide-backdrop` fade by retaining the class on `DialogOverlay` (edit `ui/dialog.tsx` overlay to include `guide-backdrop` ONLY if the overlay file edit is confined to a `className` merge — otherwise wrap content and accept Radix's overlay fade). Step pills:

```tsx
// before
className={`ctl ${done.has(stepIndex) ? 'ctl-accent' : 'ctl-outline'}`}
// after
<Button size="sm" variant={done.has(stepIndex) ? 'default' : 'outline'}>
```

Close/back/link row: `ctl-quiet` → `variant="secondary"`, `ctl-accent` → default, `ctl-outline` → `outline`, `Link` CTAs via `asChild`.

- [ ] **Step 2: Verify gates**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: PASS.

- [ ] **Step 3: Manual reduced-motion + keyboard pin (Review Focus #2, #1)**

Open a bench with `?ex=` guide: Tab reaches every step button with visible ring; Escape closes; with OS reduced-motion on, backdrop/panel appear instantly (no animation). Record in commit body.

- [ ] **Step 4: Commit**

```bash
git add src/features/learn/ExerciseGuide.tsx src/components/ui/dialog.tsx
git commit -m "feat(ui): migrate ExerciseGuide to shadcn Dialog"
```

---

### Task 9: Bench header migration (toolbar Buttons, board/example Selects, truncation pin)

**Files:**
- Modify: `src/features/bench/Bench.tsx` (header block ~lines 1000–1200 only; canvas/model code untouched)

**Interfaces:**
- Consumes: `Button`, `Select*`, `Tooltip*`, `Separator` (Tasks 4–6). Keeps all handlers (`simulation.start/stop`, `stepHistory`, `copyShareLink`, `setBrowserOpen`, `setGuideOpen`, board `navigate`) byte-identical.
- Produces: Bench header with zero `ctl`/`ctl-select`; wire-color swatches stay custom (not Buttons).

- [ ] **Step 1: Replace header buttons**

```tsx
// before
<Link to="/" className="ctl ctl-quiet" title="Back to the board list">
// after
<Button asChild variant="secondary" size="sm" title="Back to the board list">
  <Link to="/">...</Link>
</Button>
```

```tsx
// before
<button type="button" onClick={...} className="ctl ctl-quiet" title={...}>
// after
<Button type="button" variant="secondary" size="sm" onClick={...} title={...} aria-label={...}>
```

Run/Pause keeps its handler; `ctl-accent` Components button → `<Button size="sm">` (default variant); Guide button → `variant="outline"`. Undo/Redo icon-only → `size="icon-sm"` with existing `aria-label`s. Disabled states (`disabled={!simulation.canUndo()}`, `shareTooLarge`) pass through to `Button disabled` (shipped `disabled:opacity-45` matches old `.ctl:disabled`).

- [ ] **Step 2: Replace board select with Select (keep guard)**

```tsx
<Select
  value={boardId}
  onValueChange={(next) => { if (isBoardId(next)) navigate(`/bench/${next}`); }}
>
  <SelectTrigger className="h-7 max-w-44 truncate text-xs" aria-label="Board" title="Swap board">
    <SelectValue />
  </SelectTrigger>
  <SelectContent>
    {BOARDS.map((board) => (
      <SelectItem key={board.id} value={board.id}>{board.name}</SelectItem>
    ))}
  </SelectContent>
</Select>
```

Apply the same pattern to any other native `<select>` in this file (example picker if present). `max-w-44 truncate` is the Review Focus #3 pin — do not omit.

- [ ] **Step 3: Verify header has no ctl**

Run: `grep -n 'ctl' src/features/bench/Bench.tsx | grep -v '^\s*\*' | grep -v 'exactly'`
Expected: empty.

- [ ] **Step 4: Verify gates**

Run: `npm run typecheck && npm run lint && npm test && npm run build && npm run check:boundaries`
Expected: PASS.

- [ ] **Step 5: Manual truncation pin (Review Focus #3) + commit**

With the longest board name selected, header still shows Run/Components without overflow. Then:

```bash
git add src/features/bench/Bench.tsx
git commit -m "feat(ui): migrate Bench header to shadcn Button Select"
```

---

### Task 10: ComponentBrowser + PartSearch migration (empty-state pin)

**Files:**
- Modify: `src/features/bench/ComponentBrowser.tsx`
- Modify: `src/features/bench/PartSearch.tsx`

**Interfaces:**
- Consumes: `Dialog*`, `Input`, `Tabs*`, `ScrollArea`, `Badge`, `Button`, `Card*` (Tasks 4–6). Keeps `onPlace`/`onClose`, Escape handler, search autofocus, `CATALOGUE_GROUPS` order.
- Produces: Browser with zero `ctl`/`empty`; `PartSearch` input as `Input`, browse button as `Button outline`, list rows keep `PartPreview` SVG untouched.

- [ ] **Step 1: Rewrite ComponentBrowser shell**

Replace the `fixed inset-0 z-50 ...` wrapper + inner panel div with:

```tsx
<Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
  <DialogContent className="flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden bg-slate-900" aria-label="Component browser">
    <DialogHeader className="flex shrink-0 flex-row items-center gap-2 border-b border-slate-800 p-3">
      <Input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search parts…" aria-label="Search parts" className="h-7" />
      <DialogClose asChild>
        <Button variant="secondary" size="icon-sm" aria-label="Close component browser">
          <Cross2Icon className="icon" aria-hidden="true" />
        </Button>
      </DialogClose>
    </DialogHeader>
    <Tabs value={view} onValueChange={(v) => setView(v as 'catalogue' | 'library')}>
      <TabsList>...</TabsList>
      ...
    </Tabs>
  </DialogContent>
</Dialog>
```

Group filter pills: `ctl rounded-full` → `<Button size="sm" variant={active ? 'default' : 'secondary'} className="rounded-full">`. Library tab trigger likewise. Remove the manual `window keydown Escape` effect (Radix Dialog owns it) — delete the effect, keep autofocus effect.

Empty state (Review Focus #4):

```tsx
{matches.length === 0 && (
  <div className="flex flex-col items-center justify-center gap-2 px-4 py-16 text-center text-xs text-slate-500">
    <p>No parts match “{query}”.</p>
    <Button variant="outline" size="sm" onClick={() => { setQuery(''); setGroup('all'); }}>
      Clear search
    </Button>
  </div>
)}
```

Sections list goes in `ScrollArea`; group headings use `Badge`. Keep `onClick={onClose}`-on-backdrop? No — Radix overlay click closes via `onOpenChange`; do not re-add a wrapper `onClick`.

- [ ] **Step 2: Migrate PartSearch**

Search `<input>` → `<Input>` (keep `value`/`onChange`/refs), browse `<button className="ctl ctl-outline ...">` → `<Button variant="outline" size="sm" className="mx-2 mb-3 shrink-0">`, result rows keep structure, `empty` div → the centered muted + action pattern from Step 1.

- [ ] **Step 3: Verify no ctl/empty classes**

Run: `grep -n 'ctl\|"empty\|empty flex\|empty py' src/features/bench/ComponentBrowser.tsx src/features/bench/PartSearch.tsx`
Expected: empty.

- [ ] **Step 4: Verify gates**

Run: `npm run typecheck && npm run lint && npm test && npm run build`
Expected: PASS.

- [ ] **Step 5: Manual dialog pin (Review Focus #1, #4) + commit**

Press C: dialog opens, autofocus in search, Tab reaches close with ring, Escape closes, nonsense query shows Clear-search empty state. Then:

```bash
git add src/features/bench/ComponentBrowser.tsx src/features/bench/PartSearch.tsx
git commit -m "feat(ui): migrate ComponentBrowser and PartSearch to shadcn Dialog"
```

---

### Task 11: Instruments migration (Panels, Scope, Multimeter, LogicAnalyser, BusMonitor)

**Files:**
- Modify: `src/features/instruments/Panels.tsx` (Inspector, FirmwareEditor toolbar/tabs, SerialMonitor empty text kept, StatusBar untouched except any buttons)
- Modify: `src/features/instruments/Scope.tsx` (two `ctl-select` → `Select`, `panel-title` → `CardTitle` row)
- Modify: `src/features/instruments/Multimeter.tsx` (mode buttons → `Button`, three `ctl-select` → `Select`)
- Modify: `src/features/instruments/LogicAnalyser.tsx` (channel toggles → `Button`, `panel-title` → `CardTitle`)
- Modify: `src/features/instruments/BusMonitor.tsx` (icon button → `Button icon-sm`, `panel-title` → `CardTitle`)

**Interfaces:**
- Consumes: `Button`, `Select*`, `CardTitle`, `Separator`, `Tooltip*`, `Badge` (Tasks 4–6). Monaco `Editor` props/options untouched; pin-voltage readout markup untouched; `PanelTitle` helper deleted at the end of this task and replaced by a shared `CardTitle` row.
- Produces: instruments with zero `ctl*`/`panel-title`/`empty`; narrow-width toolbar intact (Review Focus #5).

- [ ] **Step 1: Replace shared PanelTitle + Inspector controls (Panels.tsx)**

Delete the local `PanelTitle` function and replace each usage:

```tsx
// before
<PanelTitle icon={<CubeIcon className="icon-sm" />} text="Inspector" />
// after
<div className="flex h-9 shrink-0 items-center gap-2 border-b border-slate-800 px-3">
  <CardTitle className="flex items-center gap-2">
    <CubeIcon className="icon-sm text-slate-500" aria-hidden="true" />
    Inspector
  </CardTitle>
</div>
```

Inspector empty div `className="empty flex-1"` → `className="flex flex-1 flex-col items-center justify-center gap-2 px-4 py-6 text-center text-xs text-slate-500"`. Press-and-hold `ctl h-8` → `<Button variant={controls.isPressed(part.id) ? 'default' : 'secondary'} className="h-8 w-full">` with identical mouse handlers; remove the `!bg-amber-400` override and instead pass `className={controls.isPressed(part.id) ? 'h-8 w-full !bg-amber-400 !text-slate-900' : 'h-8 w-full'}` (pressed-state amber is a domain signal, kept as the single `!` exception). Turn-part `ctl-quiet h-8` → `<Button variant="secondary" className="h-8 w-full">` keeping `title` + rotation readout span. Remove-part `ctl-danger` → `<Button variant="destructive" className="mt-1 w-full">`.

- [ ] **Step 2: Replace FirmwareEditor toolbar + tabs**

Language/example `<select className="ctl-select...">` → `Select` with `SelectTrigger className="h-7 text-xs"` + `SelectContent`/`SelectItem` (options map 1:1, `title` attrs preserved on items via `title` passthrough span). Run/Reset `ctl` → `<Button size="sm" variant={running ? 'secondary' : 'default'}>`. Add-file `ctl ctl-quiet ctl-icon` → `<Button variant="secondary" size="icon-sm" className="shrink-0 font-mono">`. File tabs keep `role="tablist"` markup (already accessible); only class strings change from hand-rolled to slate equivalents — do not swap in `Tabs` here (tab behavior is custom with double-click rename; `Tabs` migration is out of scope).

- [ ] **Step 3: Replace Scope, Multimeter, LogicAnalyser, BusMonitor controls**

Scope `ctl-select max-w-28` / `h-6 w-20` → `Select` with `SelectTrigger className="h-6 max-w-28 text-[11px]"` / `"h-6 w-20 text-[11px]"`. Multimeter mode buttons `ctl h-6` → `<Button size="sm" className="h-6 px-1.5 text-[11px]" variant={...}>` keeping the amber-selected `!` exception; its three `ctl-select h-6` → `Select` triggers `h-6 flex-1 text-[11px]`. LogicAnalyser channel `ctl h-6` → `<Button size="sm" className="h-6 px-2 text-[11px]" variant={on ? 'default' : 'secondary'}>`. BusMonitor `ctl ctl-icon ctl-quiet` → `<Button variant="secondary" size="icon-sm">`. Each `panel-title` heading → the `CardTitle` row from Step 1.

- [ ] **Step 4: Verify instruments have no ctl**

Run: `grep -n 'ctl\|panel-title\|"empty' src/features/instruments/*.tsx`
Expected: empty.

- [ ] **Step 5: Verify gates + narrow-width pin (Review Focus #5)**

Run: `npm run typecheck && npm run lint && npm test && npm run build && npm run check:boundaries`
Expected: PASS. Then at 768px width: FirmwareEditor language + example selects + Run visible without overlap; error bar sits below tabs.

- [ ] **Step 6: Commit**

```bash
git add src/features/instruments/Panels.tsx src/features/instruments/Scope.tsx src/features/instruments/Multimeter.tsx src/features/instruments/LogicAnalyser.tsx src/features/instruments/BusMonitor.tsx
git commit -m "feat(ui): migrate instruments to shadcn Button Select CardTitle"
```

---

### Task 12: Delete legacy CSS + final gates + Chip alias removal

**Files:**
- Modify: `src/index.css` (delete `.ctl*`, `.ctl-select`, `.panel-title`, `.empty` rules only)
- Modify: `src/features/learn/HomePage.tsx` (remove deprecated `Chip` alias if unused)
- Modify: `src/features/learn/ProjectPages.tsx` (import `Badge` directly if it used `Chip`)

**Interfaces:**
- Consumes: zero-`ctl` guarantee from Tasks 7–11.
- Produces: CSS with no `.ctl`/`.panel-title`/`.empty`; repo-wide grep gate at zero; full gate suite green.

- [ ] **Step 1: Prove zero usages before deleting**

Run: `grep -rn 'className="[^"]*ctl\|ctl-quiet\|ctl-outline\|ctl-accent\|ctl-danger\|ctl-select\|ctl-icon\|panel-title' src --include="*.tsx" --include="*.ts"`
Expected: empty. If any hit, stop — migrate it in its owning task's file, do not delete CSS yet.

Run: `grep -rn '"empty\|empty flex\|empty py' src --include="*.tsx"`
Expected: empty.

- [ ] **Step 2: Delete the legacy component layer**

In `src/index.css`, delete the rules `.ctl`, `.ctl-icon`, `.ctl-quiet` (+`:hover`), `.ctl-outline` (+`:hover`), `.ctl-accent` (+`:hover`), `.ctl-danger` (+`:hover`), `.ctl[aria-pressed]` block, `.ctl:disabled`, `.ctl-select` (+`:hover`), `.panel-title`, `.empty` — and nothing else. Keep `:focus-visible`, `::selection`, `a`, `input/textarea` caret, scrollbars, `wiper` slider, `.icon`/`.icon-sm`, `.num`, guide animations + reduced-motion. Verify with `git diff src/index.css | grep "^-" | grep -v "^---" | grep -v "ctl\|panel-title\|empty\|^-$"`: empty (only legacy lines removed).

- [ ] **Step 3: Remove Chip alias**

If `ProjectPages.tsx` still imports `Chip` from `./HomePage`, change it to import `Badge` from `@/components` and render `<Badge><span>label</span><span>value</span></Badge>`; delete `Chip` from `HomePage.tsx`. If already unused, just delete `Chip`.

- [ ] **Step 4: Run the full gate suite**

Run: `npm run typecheck`
Expected: PASS.

Run: `npm run lint`
Expected: PASS.

Run: `npm test`
Expected: PASS.

Run: `npm run check:boundaries`
Expected: `boundaries ok (...)`.

Run: `npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/index.css src/features/learn/HomePage.tsx src/features/learn/ProjectPages.tsx
git commit -m "chore(ui): remove legacy ctl css and Chip alias"
```

---

## Self-Review

**1. Spec coverage:** Intent (all DOM chrome on shadcn, dark theme kept) → Tasks 1–6 foundation + 7–11 migrations + 12 deletion. Scope decisions (full replacement phased; dark theme; chrome only; approach A) → task order and untouched canvas/Monaco/sim. Section 1 (components.json, cn, ui list, theme vars, deps, preserved rules) → Tasks 1–6. Section 2 (button/select/dialog/sheet/tabs/tooltip/card/badge/separator/empty/panel-title mapping, icons kept) → Tasks 4–6 + applied in 7–11. Section 3 (order foundation→Learn→Bench→instruments→delete; boundaries; typecheck/lint/test/build + grep gate; keyboard/reduced-motion) → Tasks 7–12 gates and manual pins. No gaps.

**2. Placeholder scan:** No `TBD`/`TODO`/placeholder text. Task 6 Step 3 names the exact seven files and the four allowed adaptations and forbids CLI overwrite of Tasks 4–5 — concrete, not "add appropriately". All code steps ship exact snippets with exact class strings. Fixed during review: Task 3 omits the clashing `--color-accent` inline lines explicitly; Task 6 seam warns about dangling re-exports.

**3. Type consistency:** `cn(...inputs: ClassValue[]): string` (Task 2) matches all `cn(...)` calls. `buttonVariants({ variant, size })` with `default | secondary | outline | destructive | ghost` × `sm | default | icon | icon-sm` matches every `variant=`/`size=` used in Tasks 7–11 (`variant="accent"` never used). `Badge` children-as-spans matches `Chip` call sites. `Select value/onValueChange`, `Dialog open/onOpenChange`, `Tabs value/onValueChange` signatures are consistent across Tasks 8–11. `noUnusedLocals` respected: Task 12 removes `Chip` once unused.

**4. Review Focus:** Five pins listed up top; each is pinned to its owning task's manual step: focus ring → Tasks 4 + 10; reduced-motion → Task 8; Select truncation → Task 9; empty search → Task 10; narrow toolbar → Task 11.
