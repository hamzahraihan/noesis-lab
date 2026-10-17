---
name: Noesis
description: An instrument console for learning embedded systems — recessive chrome, one sky accent, amber meter, emerald live signal.
colors:
  primary: "oklch(0.685 0.169 237.323)"
  primary-strong: "oklch(0.588 0.158 241.966)"
  primary-soft: "oklch(0.685 0.169 237.323 / 0.14)"
  meter: "#fbbf24"
  live-signal: "#34d399"
  destructive: "#ef4444"
  neutral-950: "#020617"
  neutral-900: "#0f172a"
  neutral-800: "#1e293b"
  neutral-700: "#334155"
  neutral-600: "#475569"
  neutral-500: "#64748b"
  neutral-400: "#94a3b8"
  neutral-300: "#cbd5e1"
  neutral-200: "#e2e8f0"
  neutral-100: "#f1f5f9"
typography:
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: "0.02em"
  display:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.01em"
  mono:
    fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.4
  silkscreen:
    fontFamily: "'DejaVu Sans Mono', 'Consolas', monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1
rounded:
  control: "0"
  md: "0"
  xl: "0"
  full: "0"
spacing:
  xs: "0.25rem"
  sm: "0.5rem"
  md: "0.75rem"
  lg: "1rem"
  xl: "1.5rem"
components:
  button-primary:
    backgroundColor: "{colors.primary-strong}"
    textColor: "#ffffff"
    rounded: "{rounded.control}"
    padding: "0.5rem 0.75rem"
  button-secondary:
    backgroundColor: "{colors.neutral-800}"
    textColor: "{colors.neutral-200}"
    rounded: "{rounded.control}"
    padding: "0.5rem 0.75rem"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.neutral-300}"
    rounded: "{rounded.control}"
    padding: "0.5rem 0.75rem"
  card:
    backgroundColor: "{colors.neutral-900}"
    textColor: "{colors.neutral-100}"
    rounded: "{rounded.xl}"
    padding: "1rem"
  input:
    backgroundColor: "{colors.neutral-800}"
    textColor: "{colors.neutral-200}"
    rounded: "{rounded.control}"
    padding: "0.25rem 0.5rem"
---

# Design System: Noesis

## Overview

**Creative North Star: "The Instrument Console"**

Noesis is drawn as an instrument console: recessive chrome so the canvas and the readouts carry the eye, one accent (sky) for anything the operator drives, amber reserved for the meter's own mode colour and for caution, emerald reserved for a live signal. Nothing else is allowed to be colourful, because a panel that steals the accent has taken the one cue that means "this is yours to press". The mood is recessive and instrument-grade, kept calm and focused: controls are compact, type is small, and many readouts can coexist without the screen becoming loud. Surfaces are flat at rest; depth appears only as a response to state. Components feel tactile and confident — solid fills, clear affordance, immediate feedback.

**Key Characteristics:**
- Dark slate console (neutral-950 background, neutral-900 surfaces) with a single sky accent.
- Compact, dense-but-calm information layout; text-xs/text-sm dominate.
- Flat surfaces at rest; shadows only on overlays, floating panels, and hover elevation.
- Square corners (0 radius) throughout; no rounded components or marketing corners.
- Tabular numerals for all readouts; monospace for code and instrument values.

## Colors

The palette is a dark slate console with one interactive accent and three reserved signal colours.

### Primary
- **Sky Instrument Blue** (oklch(0.685 0.169 237.323)): the single interactive accent — focus rings, selection, slider thumbs, and the solid button fill's brighter partner. Used on ≤10% of any screen; its rarity is the point.
- **Sky Instrument Blue Strong** (oklch(0.588 0.158 241.966)): solid button fills and primary actions.
- **Sky Instrument Blue Soft** (oklch(0.685 0.169 237.323 / 0.14)): selection backgrounds and soft hover tints.

### Secondary
- **Meter Amber** (#fbbf24): the multimeter's own mode colour and caution states. Never used for generic emphasis.

### Tertiary
- **Live Signal Emerald** (#34d399): a signal that is currently live or changing. Reserved for live data only.

### Neutral
- **Console Black** (#020617, neutral-950): page background.
- **Surface** (#0f172a, neutral-900): cards, panels, popovers.
- **Raised Surface** (#1e293b, neutral-800): inputs, secondary buttons, hover states.
- **Border** (#334155, neutral-700): dividers and ghost borders.
- **Muted Text** (#64748b–#94a3b8, neutral-500/400): secondary labels and disabled text.
- **Body Text** (#cbd5e1–#f1f5f9, neutral-300/100): primary readable text.

### Signal
- **Destructive Red** (#ef4444): errors and destructive actions only.

### Named Rules
**The One Voice Rule.** The primary accent is used on ≤10% of any given screen. Its rarity is the point; a panel that steals the accent has taken the one cue that means "this is yours to press".

**The Reserved Colour Rule.** Amber is the meter's. Emerald is live data. Red is destructive. None of them may be borrowed for decoration or generic emphasis.

## Typography

**Display Font:** System UI sans-serif (Tailwind default stack: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial).
**Body Font:** Same system UI sans-serif stack.
**Label/Mono Font:** JetBrains Mono / Cascadia Code / Consolas (instruments and code); DejaVu Sans Mono / Consolas (hardware silkscreen).

**Character:** Small, dense, instrument-grade. Controls and readouts sit at 0.75–0.875 rem; the largest page title is 1.5 rem. Nothing shouts. Monospace is reserved for values, code, and silkscreen.

### Hierarchy
- **Display** (600, 1.5 rem, 1.1): page titles and section headers (e.g. "Noesis Lab").
- **Title** (600, 0.875 rem, 1.25, tracking-tight): card titles and panel headers.
- **Body** (400, 0.875 rem, 1.5): prose and descriptions; max line length ~75 ch.
- **Label** (500, 0.75 rem, 1.25, tracking 0.02 em): control labels, badges, status text.
- **Mono** (400, 0.75 rem, 1.4): code, instrument readouts, serial output.
- **Silkscreen** (400, 0.875 rem, 1.0): component labels drawn on hardware artwork.

### Named Rules
**The Small-By-Default Rule.** Readouts and controls start at text-xs (0.75 rem). Larger sizes are earned by hierarchy, not by default.

## Layout

The layout is a compact, information-dense console. Content sits in a centred column (max-w-5xl) with generous vertical rhythm (py-12, mt-8/mt-12). Cards and panels use a 3-column grid at lg, 2-column at sm, 1-column on mobile. Spacing scale is Tailwind's 0.25 rem base: xs 0.25, sm 0.5, md 0.75, lg 1, xl 1.5. Density is comfortable-to-dense: gap-3 (0.75) between controls, gap-4 (1) between cards, gap-6 (1.5) between sections. Responsive behaviour follows Tailwind defaults (sm 640, md 768, lg 1024); the bench itself is a fixed-aspect canvas that scrolls rather than reflows.

## Elevation & Depth

Flat-by-default. Surfaces are flat at rest; depth is conveyed by slate tonal steps (950 → 900 → 800) and 1 px slate-800/700 borders, not shadows. Shadows appear only as a response to state or layering: shadow-xs on inputs, shadow-md on dropdowns/popovers, shadow-lg on dialogs and floating toolbars, shadow-xl on the instrument panel, and a soft custom shadow (0 8px 24px -16px rgba(0,0,0,0.7)) on exercise/project cards that lifts on hover. Ghost borders use an inset box-shadow of 1 px slate-700/red-900 rather than a real border, so they never shift layout.

### Shadow Vocabulary
- **Input rest** (`box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.05)`): subtle inset on text fields.
- **Popover** (`shadow-md`): dropdowns, selects, tooltips.
- **Dialog / floating toolbar** (`shadow-lg`): modal dialogs and floating benches.
- **Instrument panel** (`shadow-xl`): the oscilloscope/logic-analyser panel.
- **Card hover lift** (`0 12px 32px -16px rgba(0,0,0,0.8)` on hover vs `0 8px 24px -16px rgba(0,0,0,0.7)` at rest): exercise and project cards.

### Named Rules
**The Flat-By-Default Rule.** Surfaces are flat at rest. Shadows appear only as a response to state (hover, overlay, focus) or to separate a floating layer from the canvas.

## Shapes

No rounded corners anywhere: every surface, control, card, dialog, sheet, badge, and slider thumb is square (0 radius). The form language is squared-off and utilitarian. Borders are 1 px slate-800/700; ghost borders use an inset box-shadow so they never shift layout. Clipping is used for overflow-hidden cards and scroll areas.

## Components

### Buttons
Tactile and confident. Square corners (0 radius), text-xs, font-medium. Primary: sky-strong fill with white text. Secondary: slate-800 fill with slate-200 text (the default thing you press). Outline: transparent with a 1 px inset slate-700 border, slate-300 text. Destructive: transparent with inset red-900 border, red-300 text. Ghost: no fill until hover (slate-800). Sizes: sm (h-7, px-2.5), default (h-8, px-3), icon (size-8). Focus: 2 px ring in the accent with 2 px offset. Disabled: 45% opacity, no pointer events.

### Cards / Containers
Square corners (0 radius), slate-900/60 background at 60% opacity, 1 px slate-800 border, p-4, flex column with gap-3. Title is 11 px uppercase tracked slate-400. Hover lifts the card 1 px and brightens border to slate-600 and background to slate-900, with a deeper shadow.

### Inputs / Fields
Square corners (0 radius), slate-800 background, transparent border, text-xs slate-200, px-2 py-1, h-7. Hover darkens to slate-700. Focus: accent border + 2 px accent ring at 40% opacity. Placeholder slate-500. Disabled 45% opacity.

### Badges / Chips
Square corners (0 radius), slate-800 background, text-xs. Outline variant uses an inset 1 px slate-700 border. Used for spec readouts (logic V, ADC bits, GPIO count, etc.).

### Tabs
Square corners (0 radius), text-sm. Active tab gets a slate background (background token) with a subtle shadow; inactive tabs are muted slate-400 text. Transition on color and shadow.

### Navigation / Overlays
Dialogs and sheets: square corners (0 radius), slate-900 background, slate-700 border, shadow-lg/xl, p-6. Dropdowns/popovers: square corners (0 radius), slate popover background, 1 px border, shadow-md, with Radix enter/exit animations (fade + zoom 95%).

### Named Rules
**The Compact-Control Rule.** Every interactive control is h-7 or h-8 at text-xs. Larger controls must justify themselves.

## Do's and Don'ts

### Do:
- **Do** use the sky accent only for operator-driven elements: primary buttons, focus rings, selection, slider thumbs, links, and active icons.
- **Do** reserve amber for the meter and caution, emerald for live signals, red for destruction.
- **Do** keep surfaces flat at rest and let shadows respond to state.
- **Do** use tabular numerals (`.num`) for every numeric readout.
- **Do** keep all corners square (0 radius) on every component.

### Don't:
- **Don't** introduce additional bright colours; the console has one voice.
- **Don't** use large rounded corners (16 px+) or marketing-style hero patterns.
- **Don't** put shadows on resting surfaces.
- **Don't** redefine a token value in prose differently from the frontmatter.
- **Don't** fabricate components that don't exist (no avatars, no pricing cards, no marketing heroes).