---
name: Noesis
description: An instrument console for learning embedded systems — recessive chrome, one sky accent, amber meter, emerald live signal.
colors:
  primary: "#38bdf8"
  primary-strong: "#268bd2"
  primary-soft: "#38bdf8 / 0.14"
  bg: "#17171a"
  surface: "#1e1e2e"
  surface-deep: "#11111b"
  surface-alt: "#181825"
  border: "#313244"
  border-strong: "#45475a"
  text: "#cdd6f4"
  muted: "#9399b2"
  faint: "#6c7086"
  meter: "#f9e2af"
  live-signal: "#34d399"
  destructive: "#ef4444"
  wire-black: "#111111"
typography:
  body:
    fontFamily: "'Noto Sans', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "'Noto Sans', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.25
    letterSpacing: "0.02em"
  display:
    fontFamily: "'Archivo', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
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
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "0.5rem 0.75rem"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    rounded: "{rounded.control}"
    padding: "0.5rem 0.75rem"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.xl}"
    padding: "1rem"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.control}"
    padding: "0.25rem 0.5rem"
---

# Design System: Noesis

## Overview

**Creative North Star: "The Instrument Console"**

Noesis is drawn as an instrument console: recessive chrome so the canvas and the readouts carry the eye, one accent (sky) for anything the operator drives, amber reserved for the meter's own mode colour and for caution, emerald reserved for a live signal. Nothing else is allowed to be colourful, because a panel that steals the accent has taken the one cue that means "this is yours to press". The mood is recessive and instrument-grade, kept calm and focused: controls are compact, type is small, and many readouts can coexist without the screen becoming loud. Surfaces are flat at rest; depth appears only as a response to state. Components feel tactile and confident — solid fills, clear affordance, immediate feedback.

**Key Characteristics:**
- Dark console on a Catppuccin-Mocha ground (#17171a background, #1e1e2e surfaces) with a single sky accent (#38bdf8).
- Compact, dense-but-calm information layout; text-xs/text-sm dominate.
- Flat surfaces at rest; shadows only on overlays, floating panels, and hover elevation.
- Square corners (0 radius) throughout; no rounded components or marketing corners.
- Tabular numerals for all readouts; monospace for code and instrument values.

## Colors

The palette is the herdr console: a dark Catppuccin-Mocha ground with one sky accent and three reserved signal colours, shared across the whole product.

### Primary
- **Sky Accent** (#38bdf8): the single interactive accent — focus rings, selection, slider thumbs, active tabs, and solid button fills. Used on ≤10% of any screen; its rarity is the point.
- **Sky Accent Strong** (#268bd2): solid button fills and primary actions (hover deepens to #1e6fa8).
- **Sky Accent Soft** (#38bdf8 / 0.14): selection backgrounds and soft hover tints.

### Secondary
- **Caution Amber** (#f9e2af): the multimeter's own mode colour and caution states. Never used for generic emphasis.

### Tertiary
- **Live Signal Emerald** (#34d399): a signal that is currently live or changing. Reserved for live data only.

### Neutral
- **Console Black** (#17171a, --hd-bg): page background.
- **Surface** (#1e1e2e, --hd-surface): cards, panels, popovers.
- **Deep Surface** (#11111b, --hd-bg-deep): recessed wells, code blocks, canvas backdrop.
- **Alt Surface** (#181825, --hd-surface-alt): sidebars and secondary panels.
- **Border** (#313244, --hd-border): dividers and ghost borders.
- **Strong Border** (#45475a, --hd-border-strong): hover/focus borders.
- **Body Text** (#cdd6f4, --hd-text): primary readable text.
- **Muted Text** (#9399b2, --hd-muted): secondary labels and disabled text.
- **Faint Text** (#6c7086, --hd-faint): tertiary labels and placeholders.

### Signal
- **Destructive Red** (#ef4444): errors and destructive actions only.

### Named Rules
**The One Voice Rule.** The primary accent is used on ≤10% of any given screen. Its rarity is the point; a panel that steals the accent has taken the one cue that means "this is yours to press".

**The Reserved Colour Rule.** Amber is the meter's and caution's. Emerald is live data. Red is destructive. None of them may be borrowed for decoration or generic emphasis.

## Typography

**Display Font:** Archivo (headings); Noto Sans (body) with system UI fallback (ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial).
**Body Font:** Noto Sans with system UI fallback (ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial).
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