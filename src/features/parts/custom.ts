/**
 * Custom parts: a part this repository did not write, as data.
 *
 * A part is already pure data -- `PartDefinition` is ids, geometry, a
 * `ComponentSpec` and pins, with no functions anywhere in it -- and behaviour
 * reaches the solver through one function, `elementsForPart`, which switches on
 * `component.kind` and reads the parameters and the pin ids. So a custom part is
 * a `PartDefinition` whose kind is one the host implements: nothing here
 * evaluates anything, and a part cannot introduce behaviour the app does not
 * already have. What it *can* do is say what the catalogue does not: another
 * resistance, another I2C address, a different number of digits, another lead
 * spacing, a name and a colour of its own.
 *
 * That makes the validator the feature. An imported part is untrusted input, and
 * the failure it has to prevent is quiet: a pin id the behaviour never reads
 * resolves to `GROUND` in `elementsForPart`, so a typo yields a circuit that
 * "works" with a lead on the wrong node. Every rule below is a refusal with a
 * reason, and the rules are derived from the shipped parts rather than
 * hand-listed -- the pin ids a kind's behaviour reads *are* the ids the shipped
 * definitions of that kind use, so the catalogue is the specification.
 *
 * Not here, deliberately: new behaviour (scripting, a Wasm chip ABI), parts
 * inside a circuit document or a share link, a part editor, and any user
 * artwork. See `docs/superpowers/specs/2026-10-18-custom-part-api-design.md`.
 */

import type { ComponentSpec, PartDefinition } from './catalog';
import { BENCH_PART_IDS, PART_CATALOGUE } from './catalogue';
import { DIODE_PROFILES } from './passives';
import type { DiodeProfile } from '@/features/simulation/elements';

/** The file format's version. Bumped only when the shape changes. */
export const PART_FILE_VERSION = 1;

/**
 * A part file is a few hundred bytes; this stops a file that was never a part.
 * Larger than any real definition by two orders of magnitude.
 */
export const PART_FILE_MAX_BYTES = 262_144;

/**
 * How much source a part file may carry.
 *
 * The data half's rule is that a part is one file with nothing to fetch; a script
 * is still text, so it has a ceiling -- comfortably above a real sensor, far
 * below a bundle.
 */
export const SCRIPT_MAX_CHARS = 32_768;

/** The kinds a custom part may be: the board and the breadboard are not parts. */
const RESERVED_KINDS = new Set(['mcu', 'breadboard']);

/** The definition's own keys, so a typo is a message rather than a dead field. */
const DEFINITION_KEYS = new Set([
  'id',
  'name',
  'category',
  'widthMm',
  'heightMm',
  'component',
  'pins',
  'knobs',
  'momentary',
  'bodyColour',
  'legendColour',
  'displayPixels',
  'ramPixels',
  'glassMm',
  'large',
  'script',
]);

const PIN_KEYS = new Set(['id', 'label', 'x', 'y', 'net']);
const KNOB_KEYS = new Set(['id', 'label', 'min', 'max', 'step', 'toggle', 'unit', 'defaultValue']);
const PIXEL_KEYS = new Set(['width', 'height']);
const CATEGORIES = new Set(['passive', 'input', 'output']);

/**
 * The addresses each display controller answers at.
 *
 * A table rather than a derivation because the controller's own hardware is the
 * fact: an SSD1306's address is its jumper (0x3C or 0x3D) and a panel on SPI has
 * none to join, whatever the one shipped definition happens to say. The firmware
 * has to use the same address in its `Wire` calls, which is what makes a part at
 * 0x3D a working part rather than a broken one.
 */
const DISPLAY_ADDRESSES: Readonly<Record<string, readonly number[]>> = {
  ssd1306: [0x3c, 0x3d],
  'ssd1306-spi': [0],
  ili9341: [0],
};

/** Kinds whose behaviour reads a single resistance. */
const OHM_KINDS = new Set(['resistor', 'potentiometer', 'slide-potentiometer']);

/** The enum parameters any kind may carry, each checked against the shipped set. */
const ENUM_PARAMS = ['variant', 'device', 'controller'] as const;

/**
 * The diodes an LED may name.
 *
 * A file names one -- `"profile": "red"` -- and the validator resolves it to the
 * bench's own numbers, so an author picks among the diodes the simulator has
 * rather than inventing a forward voltage and a breakdown in JSON. The names are
 * `DIODE_PROFILES`' keys: red, green, yellow, blue, white, silicon.
 */
const DIODE_NAMES = Object.keys(DIODE_PROFILES);

/** The integer parameters, per kind, with the range the bench can drive. */
const INTEGER_PARAMS: Readonly<
  Record<string, { readonly param: string; readonly min: number; readonly max: number }>
> = {
  'dip-switch': { param: 'ways', min: 2, max: 16 },
  '7segment': { param: 'digits', min: 1, max: 4 },
};

/**
 * The parameter that selects a pin layout, for the kinds where one does.
 *
 * Measured against the shipped catalogue: of the 35 importable kinds, 32 use
 * exactly one set of pin ids and the three named here use one per value -- a
 * display by its controller, a sensor module and an LCD by their variants. That
 * is what makes "the ids the behaviour reads" a lookup instead of a judgement.
 */
function layoutParam(kind: string): string | null {
  if (kind === 'scripted') return 'bus';
  if (kind === 'display') return 'controller';
  if (kind === 'sensor-module' || kind === 'lcd') return 'variant';
  if (kind === 'i2c-sensor') return 'device';
  if (kind === '7segment') return 'digits';
  if (kind === 'dip-switch') return 'ways';
  return null;
}

/* ------------------------------------------------------------------ *
 * The derivation: what the shipped parts say about a kind
 * ------------------------------------------------------------------ */

/** One shipped definition, indexed by the kind and layout parameter it uses. */
interface ShippedShape {
  readonly kind: string;
  readonly layout: string;
  readonly definition: PartDefinition;
}

let shapes: readonly ShippedShape[] | null = null;
let kinds: readonly string[] | null = null;

/** The shipped definitions, indexed once, lazily. */
function shippedShapes(): readonly ShippedShape[] {
  if (shapes !== null) return shapes;
  const built: ShippedShape[] = [];
  for (const entry of PART_CATALOGUE) {
    const definition = entry.make();
    const kind = definition.component.kind;
    if (RESERVED_KINDS.has(kind)) continue;
    built.push({ kind, layout: layoutKey(definition.component), definition });
  }
  shapes = built;
  return built;
}

/** The layout parameter's value for a component, as a comparable key. */
function layoutKey(component: ComponentSpec): string {
  const param = layoutParam(component.kind);
  if (param === null) return '';
  return String((component as unknown as Record<string, unknown>)[param] ?? '');
}

/** The kinds a custom part may use: every kind the catalogue ships, less two. */
export function importableKinds(): readonly string[] {
  if (kinds !== null) return kinds;
  // `scripted` is the one kind with no shipped part to derive from: the host has
  // no model for it, which is the whole point, so its bus and pins are named
  // here the way a sibling kind's would be derived.
  kinds = [...new Set([...shippedShapes().map((shape) => shape.kind), 'scripted'])].sort();
  return kinds;
}

/** The buses a scripted part may speak, and the pins each one brings. */
const SCRIPTED_BUSES: Readonly<Record<string, readonly string[]>> = {
  analog: ['AOUT', 'VCC', 'GND'],
  digital: ['DOUT', 'VCC', 'GND'],
  // A slave needs both lines and a rail; which pins of the board they land on is
  // the operator's business, exactly as it is for a real module.
  i2c: ['SDA', 'SCL', 'VCC', 'GND'],
};

/**
 * The addresses an I2C part may claim.
 *
 * Seven bits, minus what the standard reserves: 0x00-0x07 are the general-call
 * and high-speed codes and 0x78-0x7F are the ten-bit prefixes, so a part at one
 * of those would be a part nothing can talk to.
 */
const SCRIPTED_ADDRESS_RANGE = { min: 0x08, max: 0x77 } as const;

/** The rails a scripted part's own leads may join, as the bench's modules do. */
const SCRIPTED_NETS: readonly string[] = ['GND', 'VCC'];

/** The shipped definitions of a kind, optionally narrowed to one layout. */
function shapesOf(kind: string, layout?: string): readonly ShippedShape[] {
  return shippedShapes().filter(
    (shape) => shape.kind === kind && (layout === undefined || shape.layout === layout),
  );
}

/** One string parameter's value on a component, or undefined. */
function paramValue(component: unknown, param: string): unknown {
  return (component as Record<string, unknown>)[param];
}

/**
 * The ids a kind's behaviour reads for the given parameters.
 *
 * Null when the kind is not importable or when no shipped part uses these
 * parameters -- a 5-digit seven-segment, say, has no behaviour to read it.
 */
export function pinIdsForComponent(component: ComponentSpec): readonly string[] | null {
  const shape = shapesOf(component.kind, layoutKey(component))[0];
  return shape === undefined ? null : shape.definition.pins.map((pin) => pin.id);
}

/**
 * The knob ids a kind's behaviour reads, for the given parameters.
 *
 * Derived like the pin ids, and for the same reason: the behaviour looks knob
 * values up by id (`DynamicState.knob`), so a knob with an id the behaviour does
 * not ask for would sit in the inspector doing nothing at all -- an imported
 * potentiometer that cannot be turned. The shipped part of that kind is the list.
 */
function knobIdsFor(kind: string, layout: string): readonly string[] {
  const ids: string[] = [];
  for (const shape of shapesOf(kind, layout)) {
    for (const knob of shape.definition.knobs ?? []) {
      if (!ids.includes(knob.id)) ids.push(knob.id);
    }
  }
  return ids;
}

/**
 * The `net` names the shipped leads of a kind use.
 *
 * A pin's `net` joins it to a named rail without a wire, which is how the
 * shipped modules that carry their own supply do it (an LCD's VSS on ground).
 * Only the names the bench's own parts of that kind use are allowed: anything
 * else would let a file wire itself to a rail the operator never drew.
 */
function netNamesFor(kind: string, layout: string): readonly string[] {
  const names: string[] = [];
  for (const shape of shapesOf(kind, layout)) {
    for (const pin of shape.definition.pins) {
      if (pin.net !== undefined && !names.includes(pin.net)) names.push(pin.net);
    }
  }
  return names;
}

/** Whether every shipped definition of a kind and layout carries a field. */
function shippedAlwaysHas(kind: string, layout: string, key: keyof PartDefinition): boolean {
  const found = shapesOf(kind, layout);
  return found.length > 0 && found.every((shape) => shape.definition[key] !== undefined);
}

/** The same question about a field of the component rather than the part. */
function componentAlwaysHas(kind: string, layout: string, key: string): boolean {
  const found = shapesOf(kind, layout);
  return (
    found.length > 0 &&
    found.every(
      (shape) =>
        (shape.definition.component as unknown as Record<string, unknown>)[key] !== undefined,
    )
  );
}

/** The bench's own diode whose numbers are these, or null. */
function benchDiodeFor(value: unknown): DiodeProfile | null {
  if (typeof value !== 'object' || value === null) return null;
  const text = JSON.stringify(value);
  return Object.values(DIODE_PROFILES).find((profile) => JSON.stringify(profile) === text) ?? null;
}

/** The values a layout parameter accepts, taken from the shipped parts. */
export function layoutValuesFor(kind: string): readonly string[] {
  const param = layoutParam(kind);
  if (param === null) return [];
  return stringValuesOf(kind, param);
}

/** The values a string parameter accepts, taken from the shipped parts. */
function stringValuesOf(kind: string, param: string): readonly string[] {
  const values: string[] = [];
  for (const shape of shapesOf(kind)) {
    const value = paramValue(shape.definition.component, param);
    if (typeof value === 'string' && !values.includes(value)) values.push(value);
  }
  return values;
}

/* ------------------------------------------------------------------ *
 * The validator
 * ------------------------------------------------------------------ */

export type PartVerdict =
  | { readonly ok: true; readonly definition: PartDefinition }
  | { readonly ok: false; readonly reason: string };

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isPlainObject = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const HEX_COLOUR = /^#[0-9a-f]{6}$/;
const PART_ID = /^[a-z0-9][a-z0-9-]*$/;

const refuse = (reason: string): PartVerdict => ({ ok: false, reason });

/** Whether a value names one of the bench's diodes. */
function isDiodeName(value: unknown): value is keyof typeof DIODE_PROFILES {
  return typeof value === 'string' && DIODE_NAMES.includes(value);
}

/**
 * Whether a value *is* one of the bench's diodes, numbers and all.
 *
 * Both forms are accepted on purpose. A file names a diode, because a hand
 * author should not invent a forward voltage; but a definition that has been
 * through the app once is stored as JSON (`custom-store.ts`) and comes back with
 * the resolved numbers, so a round trip has to be valid input. What is never
 * accepted is a profile that resembles no diode the bench has.
 */
function isBenchDiode(value: unknown): boolean {
  return benchDiodeFor(value) !== null;
}

type ComponentVerdict =
  | { readonly ok: true; readonly component: ComponentSpec }
  | { readonly ok: false; readonly reason: string };

/** The component a file's `component` describes, or the reason it cannot be one. */
function checkComponent(value: unknown): ComponentVerdict {
  const bad = (reason: string): ComponentVerdict => ({ ok: false, reason });
  if (!isPlainObject(value)) return bad('component must be an object');
  const component = value as Record<string, unknown>;
  const kind = component.kind;
  if (typeof kind !== 'string') return bad('component.kind must be a name');
  if (RESERVED_KINDS.has(kind)) {
    return bad(
      `component.kind "${kind}" is the app's own: a custom part cannot be a board or a breadboard`,
    );
  }
  if (!importableKinds().includes(kind)) return bad(`unknown component.kind "${kind}"`);

  // The keys this kind's spec declares, and nothing else: a parameter the
  // behaviour does not read would look like it did something.
  const allowed = new Set<string>(['kind']);
  for (const param of ENUM_PARAMS) {
    if (stringValuesOf(kind, param).length > 0) allowed.add(param);
  }
  const layout = layoutParam(kind);
  if (layout !== null) allowed.add(layout);
  // The diode, which is a name in the file rather than the bench's numbers.
  if (kind === 'led') allowed.add('profile');
  if (kind === 'scripted') {
    allowed.add('bus');
    const bus = (component as { bus?: unknown }).bus;
    if (bus === 'i2c') allowed.add('address');
  }
  if (OHM_KINDS.has(kind)) allowed.add('ohms');
  if (kind === 'capacitor') allowed.add('farads');
  if (kind === 'display') allowed.add('address');
  if (kind === 'shift-register') {
    allowed.add('spi');
    allowed.add('latch');
    allowed.add('enable');
  }
  const integer = INTEGER_PARAMS[kind];
  if (integer !== undefined) allowed.add(integer.param);
  for (const key of Object.keys(component)) {
    if (!allowed.has(key)) return bad(`component.${key} is not part of "${kind}"`);
  }

  if (kind === 'scripted') {
    const bus = component.bus;
    if (typeof bus !== 'string' || SCRIPTED_BUSES[bus] === undefined) {
      return bad(`component.bus must be one of ${Object.keys(SCRIPTED_BUSES).join(', ')}`);
    }
  }
  if (kind === 'shift-register') {
    /*
     * The chip names three of its own pins: the clock and the data in are the
     * bus's wires, and the latch and the enable are the ones the sketch
     * drives. A file has to name the same pins the shipped part does, because
     * the behaviour reads the part's pins by those names.
     */
    const spi = component.spi;
    if (!isPlainObject(spi)) return bad('component.spi must be an object');
    const wiring = spi as Record<string, unknown>;
    for (const key of Object.keys(wiring)) {
      if (key !== 'clock' && key !== 'dataIn') {
        return bad(`component.spi.${key} is not a field of the SPI wiring`);
      }
    }
    const clock = wiring.clock;
    const dataIn = wiring.dataIn;
    const latch = component.latch;
    const enable = component.enable;
    if (typeof clock !== 'string' || typeof dataIn !== 'string') {
      return bad('component.spi must name the clock and the data in');
    }
    if (typeof latch !== 'string') return bad('component.latch must name a pin');
    if (typeof enable !== 'string') return bad('component.enable must name a pin');
    const ids = pinIdsForComponent(component as unknown as ComponentSpec);
    if (ids === null) return bad('this part has no pins to name');
    for (const name of [clock, dataIn, latch, enable]) {
      if (!ids.includes(name)) {
        return bad(`the pin "${name}" is not one this part has`);
      }
    }
  }
  for (const param of ENUM_PARAMS) {
    if (kind === 'scripted') break;
    if (!(param in component)) continue;
    const values = stringValuesOf(kind, param);
    if (values.length === 0) return bad(`component.${param} is not part of "${kind}"`);
    const given = component[param];
    if (typeof given !== 'string' || !values.includes(given)) {
      return bad(
        `component.${param} "${String(given)}" is not one the bench knows (${values.join(', ')})`,
      );
    }
  }
  /*
   * An LED names a diode rather than carrying one.
   *
   * `DiodeProfile` is a set of numbers -- forward volts, rated amps, breakdown --
   * and a file that supplied them would be inventing a diode. The name picks one
   * of the bench's own, which is what the resolution at the end of this function
   * swaps in.
   */
  if ('profile' in component) {
    if (kind !== 'led') return bad(`component.profile is not part of "${kind}"`);
    const given = component.profile;
    if (!isDiodeName(given) && !isBenchDiode(given)) {
      return bad(
        `component.profile must name one of the bench's diodes (${DIODE_NAMES.join(', ')}), not a set of numbers`,
      );
    }
  }

  if (OHM_KINDS.has(kind)) {
    const ohms = component.ohms;
    if (!isFiniteNumber(ohms)) return bad('component.ohms must be a number');
    if (ohms <= 0 || ohms > 1e8) return bad('component.ohms must be between 0 and 100 MΩ');
  }
  if (kind === 'capacitor') {
    const farads = component.farads;
    if (!isFiniteNumber(farads)) return bad('component.farads must be a number');
    if (farads <= 0 || farads > 1) return bad('component.farads must be between 0 and 1 F');
  }
  if (integer !== undefined) {
    const given = component[integer.param];
    if (
      !isFiniteNumber(given) ||
      !Number.isInteger(given) ||
      given < integer.min ||
      given > integer.max
    ) {
      return bad(
        `component.${integer.param} must be a whole number of ${integer.min} to ${integer.max}`,
      );
    }
  }
  if (kind === 'scripted' && (component as { bus?: unknown }).bus === 'i2c') {
    const address = (component as { address?: unknown }).address;
    if (
      !isFiniteNumber(address) ||
      !Number.isInteger(address) ||
      address < SCRIPTED_ADDRESS_RANGE.min ||
      address > SCRIPTED_ADDRESS_RANGE.max
    ) {
      return bad(
        `a scripted i2c part needs component.address between 0x${SCRIPTED_ADDRESS_RANGE.min.toString(16)} and 0x${SCRIPTED_ADDRESS_RANGE.max.toString(16)}`,
      );
    }
  }
  if (kind === 'display') {
    const address = component.address;
    if (!isFiniteNumber(address) || !Number.isInteger(address) || address < 0 || address > 127) {
      return bad('component.address must be a whole I2C address');
    }
    const controller = String(component.controller);
    const known = DISPLAY_ADDRESSES[controller];
    if (known === undefined || !known.includes(address)) {
      const addresses = (known ?? []).map((value) => `0x${value.toString(16)}`).join(', ');
      return bad(
        `component.address ${address} is not an address a bench ${controller} answers at (${addresses || 'none'})`,
      );
    }
  }
  // A named diode becomes the bench's own diode here: that is the one
  // transformation the validator makes, because the file says *which* diode and
  // the bench is the only thing that knows the numbers.
  // A named diode becomes the bench's own diode here, and so does a set of
  // numbers equal to one of them: the artwork picks an LED's colour by identity
  // (`ledColour`), so a definition that arrived as JSON has to be rebound to the
  // bench's object rather than left as a copy that looks the same.
  const resolved =
    kind === 'led'
      ? {
          ...component,
          profile: isDiodeName(component.profile)
            ? DIODE_PROFILES[component.profile as keyof typeof DIODE_PROFILES]
            : (benchDiodeFor(component.profile) ?? component.profile),
        }
      : component;
  return { ok: true, component: resolved as unknown as ComponentSpec };
}

/** The reason a pin list is not the one this component's behaviour reads, or null. */
function checkPins(
  value: unknown,
  component: ComponentSpec,
  width: number,
  height: number,
): string | null {
  if (!Array.isArray(value)) return 'pins must be an array';
  if (value.length > 64) return 'a part may have at most 64 pins';
  const ids = new Set<string>();
  for (const [index, entry] of value.entries()) {
    if (!isPlainObject(entry)) return `pins[${index}] must be an object`;
    const pin = entry as Record<string, unknown>;
    for (const key of Object.keys(pin)) {
      if (!PIN_KEYS.has(key)) return `pins[${index}].${key} is not a pin field`;
    }
    if (typeof pin.id !== 'string' || pin.id === '') return `pins[${index}].id must be a name`;
    if (ids.has(pin.id)) return `two pins are called "${pin.id}"`;
    ids.add(pin.id);
    if (typeof pin.label !== 'string') return `pins[${index}].label must be text`;
    if (pin.net !== undefined) {
      if (typeof pin.net !== 'string') return `pins[${index}].net must be a name`;
      const nets =
        component.kind === 'scripted'
          ? SCRIPTED_NETS
          : netNamesFor(component.kind, layoutKey(component));
      if (!nets.includes(pin.net)) {
        return `pins[${index}].net "${pin.net}" is not one this kind's own leads join (${nets.join(', ') || 'none'})`;
      }
    }
    if (!isFiniteNumber(pin.x) || !isFiniteNumber(pin.y)) {
      return `pins[${index}] must have finite x and y`;
    }
    // The 1 mm margin the shipped parts use for leads that overhang the body.
    if (pin.x < -1 || pin.y < -1 || pin.x > width + 1 || pin.y > height + 1) {
      return `pins[${index}] (${pin.id}) is outside the part's own body`;
    }
  }

  const expected =
    component.kind === 'scripted'
      ? (SCRIPTED_BUSES[String(component.bus)] ?? null)
      : pinIdsForComponent(component);
  if (expected === null) {
    return 'no bench part of this kind and these parameters exists, so nothing would read its pins';
  }
  const want = [...expected].sort().join(', ');
  const have = [...ids].sort().join(', ');
  if (have !== want) {
    return want === ''
      ? 'this kind has no pins, so the part must declare none'
      : `this kind's behaviour reads these pins: ${want}`;
  }
  /*
   * A display's order is part of the drawing: the footprint lays the header row
   * out from the pin list itself (`definition.pins[0]?.y` and the silkscreen that
   * walks it), so the same leads in another order are a panel whose header is
   * drawn in the wrong place. Every other kind draws pins by position, so this is
   * the one that has to be a sequence rather than a set.
   */
  if (component.kind === 'display') {
    const declared = value.map((entry) => String((entry as { id: unknown }).id)).join(', ');
    if (declared !== [...expected].join(', ')) {
      return `a display's pins are drawn in the order they are declared: ${[...expected].join(', ')}`;
    }
  }
  return null;
}

/**
 * The reason a knob list cannot be driven, or null.
 *
 * The ids are the behaviour's, not the author's: `DynamicState.knob` looks a
 * value up by id, so a knob called anything else is a control that turns and
 * changes nothing. There is no cap on how many -- the kind's own list is the
 * bound (a 4x4 keypad has sixteen).
 */
function checkKnobs(value: unknown, component: ComponentSpec): string | null {
  if (!Array.isArray(value)) return 'knobs must be an array';
  // None at all is always legal: the behaviour then reads the value its own
  // constants default to. What is not legal is a control nothing asks for.
  if (value.length === 0) return null;
  // A scripted part's knobs are the script's own, which is the one place this
  // rule cannot come from the catalogue: no shipped part reads them, but the
  // script that came with the file does.
  const allowed = knobIdsFor(component.kind, layoutKey(component));
  const scripted = component.kind === 'scripted';
  if (!scripted && allowed.length === 0) return `this kind's behaviour reads no knobs`;
  const ids = new Set<string>();
  for (const [index, entry] of value.entries()) {
    if (!isPlainObject(entry)) return `knobs[${index}] must be an object`;
    const knob = entry as Record<string, unknown>;
    for (const key of Object.keys(knob)) {
      if (!KNOB_KEYS.has(key)) return `knobs[${index}].${key} is not a knob field`;
    }
    if (typeof knob.id !== 'string' || knob.id === '') return `knobs[${index}].id must be a name`;
    if (ids.has(knob.id)) return `two knobs are called "${knob.id}"`;
    if (!scripted && !allowed.includes(knob.id)) {
      return `knobs[${index}].id "${knob.id}" is not one this kind's behaviour reads (${allowed.join(', ')})`;
    }
    ids.add(knob.id);
    if (typeof knob.label !== 'string') return `knobs[${index}].label must be text`;
    const { min, max, step, defaultValue } = knob;
    if (!isFiniteNumber(min) || !isFiniteNumber(max) || !isFiniteNumber(step)) {
      return `knobs[${index}] must have finite min, max and step`;
    }
    if (min >= max) return `knobs[${index}] has no range: min must be below max`;
    if (step <= 0) return `knobs[${index}].step must be positive`;
    if (!isFiniteNumber(defaultValue) || defaultValue < min || defaultValue > max) {
      return `knobs[${index}].defaultValue must lie between min and max`;
    }
    if (knob.toggle !== undefined && typeof knob.toggle !== 'boolean') {
      return `knobs[${index}].toggle must be true or false`;
    }
    if (knob.unit !== undefined && typeof knob.unit !== 'string') {
      return `knobs[${index}].unit must be text`;
    }
  }
  return null;
}

/** The reason a millimetre or pixel rectangle is not a rectangle, or null. */
function checkBox(value: unknown, what: string, limit: number): string | null {
  if (value === undefined) return null;
  if (!isPlainObject(value)) return `${what} must be an object`;
  const box = value as Record<string, unknown>;
  for (const key of Object.keys(box)) {
    if (!PIXEL_KEYS.has(key)) return `${what}.${key} is not a dimension`;
  }
  const { width, height } = box;
  if (!isFiniteNumber(width) || !isFiniteNumber(height)) {
    return `${what} must have finite width and height`;
  }
  if (width <= 0 || height <= 0 || width > limit || height > limit) {
    return `${what} must be a real rectangle`;
  }
  return null;
}

/**
 * A value from a part file, as a definition this bench can place -- or the
 * reason it cannot be one.
 *
 * The order is the order a hand author would fix things in: the shape of the
 * object, then its identity, then the component, then the pins that follow from
 * it.
 */
export function validatePartDefinition(value: unknown): PartVerdict {
  if (!isPlainObject(value)) return refuse('a part must be an object');
  const part = value as Record<string, unknown>;

  for (const key of Object.keys(part)) {
    if (!DEFINITION_KEYS.has(key)) return refuse(`${key} is not a part field`);
  }
  if (typeof part.id !== 'string' || !PART_ID.test(part.id)) {
    return refuse('id must be lower-case letters, digits and dashes');
  }
  if (part.id.length > 40) return refuse('id must be at most 40 characters');
  if (BENCH_PART_IDS.has(part.id)) {
    return refuse(`id "${part.id}" is already a bench part`);
  }
  if (typeof part.name !== 'string' || part.name === '') return refuse('name must be text');
  if (typeof part.category !== 'string' || !CATEGORIES.has(part.category)) {
    return refuse('category must be passive, input or output');
  }
  const width = part.widthMm;
  const height = part.heightMm;
  if (!isFiniteNumber(width) || !isFiniteNumber(height)) {
    return refuse('widthMm and heightMm must be numbers');
  }
  if (width <= 0 || height <= 0 || width > 200 || height > 200) {
    return refuse('a part must be smaller than 200 mm on each side');
  }
  for (const key of ['bodyColour', 'legendColour'] as const) {
    const colour = part[key];
    if (typeof colour !== 'string' || !HEX_COLOUR.test(colour)) {
      return refuse(`${key} must be a six-digit hex colour, like #d8c9a3`);
    }
  }
  if (part.momentary !== undefined && typeof part.momentary !== 'boolean') {
    return refuse('momentary must be true or false');
  }
  if (part.large !== undefined && typeof part.large !== 'boolean') {
    return refuse('large must be true or false');
  }
  for (const key of ['displayPixels', 'ramPixels'] as const) {
    const reason = checkBox(part[key], key, 4096);
    if (reason !== null) return refuse(reason);
  }
  const glassReason = checkBox(part.glassMm, 'glassMm', 200);
  if (glassReason !== null) return refuse(glassReason);

  const componentVerdict = checkComponent(part.component);
  if (!componentVerdict.ok) return refuse(componentVerdict.reason);
  const component = componentVerdict.component;
  const layout = layoutKey(component);

  // A display's own geometry is the controller's, not the author's: a panel
  // claiming pixels nothing can address would be drawn stretched and read back
  // wrong.
  if (component.kind === 'display') {
    // One controller, several panels: the ILI9341 is sold at 320x240 and at
    // 480x320, and both are shapes it answers, so the rule is "a panel this
    // controller has", not "the first one in the catalogue".
    const controller = String((component as unknown as Record<string, unknown>).controller);
    const panels = shapesOf(component.kind, layout).map((shape) => shape.definition);
    for (const key of ['displayPixels', 'ramPixels', 'glassMm'] as const) {
      const theirs = panels.map((panel) => panel[key]);
      const known = theirs.filter((value) => value !== undefined);
      const mine = part[key];
      if (mine === undefined) {
        // Omitting one would silently take a default, and a default is a
        // different panel from the one the operator drew.
        if (known.length > 0 && known.length === theirs.length) {
          return refuse(`${key} is the ${controller}'s own geometry and has to be given`);
        }
        continue;
      }
      const text = JSON.stringify(mine);
      if (!known.some((value) => JSON.stringify(value) === text)) {
        const options = [...new Set(known.map((value) => JSON.stringify(value)))].join(' or ');
        return refuse(`${key} must be a ${controller}'s own geometry (${options || 'none'})`);
      }
    }
  }

  // Fields the kind's own parts all carry, because the behaviour reads them: an
  // LED's diode, a button's momentary contact.
  const script = part.script;
  if (component.kind === 'scripted') {
    if (typeof script !== 'string' || script.trim() === '') {
      return refuse('a scripted part must carry its script');
    }
    if (script.length > SCRIPT_MAX_CHARS) {
      return refuse(`a script may be at most ${SCRIPT_MAX_CHARS} characters`);
    }
  } else if (script !== undefined) {
    return refuse('script is only for a scripted part');
  }
  const profile = (component as unknown as Record<string, unknown>).profile;
  if (componentAlwaysHas(component.kind, layout, 'profile') && profile === undefined) {
    return refuse(`${component.kind} must name a diode in component.profile`);
  }
  if (shippedAlwaysHas(component.kind, layout, 'momentary') && part.momentary !== true) {
    return refuse(
      `this kind is a momentary contact, so momentary must be true -- otherwise nothing can press it`,
    );
  }
  const pinReason = checkPins(part.pins, component, width, height);
  if (pinReason !== null) return refuse(pinReason);
  const knobReason = checkKnobs(part.knobs ?? [], component);
  if (knobReason !== null) return refuse(knobReason);

  // Every field has been checked against the allowlist above, so the shape is
  // the type; the component is the resolved one (a named diode, not a name).
  return { ok: true, definition: { ...part, component } as unknown as PartDefinition };
}

/* ------------------------------------------------------------------ *
 * The file
 * ------------------------------------------------------------------ */

export interface PartFileRead {
  readonly definitions: readonly PartDefinition[];
  readonly refused: readonly { readonly index: number; readonly reason: string }[];
}

/**
 * A part file's text as definitions.
 *
 * One file may hold several parts, so a file that came from a colleague works
 * whole; a single bare definition is accepted too, because the file for one part
 * should not need ceremony. Malformed JSON throws -- the operator chose a file,
 * and "which file, and that it is not JSON" is the useful thing to say -- while a
 * definition that breaks a rule is refused by index with its reason, so a good
 * part in a bad file still arrives.
 */
export function readPartFile(text: string, label: string): PartFileRead {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${label}: not JSON`);
  }

  const wrapper = isPlainObject(parsed) ? (parsed as Record<string, unknown>) : null;
  if (wrapper?.version !== undefined && wrapper.version !== PART_FILE_VERSION) {
    throw new Error(
      `${label}: part file version ${String(wrapper.version)} is not ${PART_FILE_VERSION}`,
    );
  }
  const entries: unknown[] = Array.isArray(parsed)
    ? parsed
    : wrapper !== null && Array.isArray(wrapper.parts)
      ? (wrapper.parts as unknown[])
      : [parsed];

  const definitions: PartDefinition[] = [];
  const refused: { index: number; reason: string }[] = [];
  for (const [index, entry] of entries.entries()) {
    const verdict = validatePartDefinition(entry);
    if (verdict.ok) definitions.push(verdict.definition);
    else refused.push({ index, reason: verdict.reason });
  }
  return { definitions, refused };
}

/**
 * A definition as file text: two-space JSON and a trailing newline, the same
 * shape the bench's circuit files use, so a part written here can be committed
 * and a committed part can be opened here.
 */
export function partFileText(definition: PartDefinition): string {
  return `${JSON.stringify({ version: PART_FILE_VERSION, parts: [definition] }, null, 2)}\n`;
}
