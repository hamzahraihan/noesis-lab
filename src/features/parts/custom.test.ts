import { describe, expect, it } from 'vitest';
import {
  PART_FILE_VERSION,
  importableKinds,
  layoutValuesFor,
  partFileText,
  pinIdsForComponent,
  readPartFile,
  validatePartDefinition,
} from './custom';
import type { ComponentSpec } from './catalog';
import { DIODE_PROFILES } from './passives';

/**
 * A part the catalogue does not ship, in the shape a file would carry it.
 *
 * Deep-cloned per test so a leg can break one field without the next leg
 * inheriting it.
 */
function goodResistor(): Record<string, unknown> {
  return {
    id: 'resistor-4k7',
    name: '4.7k Resistor',
    category: 'passive',
    widthMm: 10.16,
    heightMm: 4,
    bodyColour: '#d8c9a3',
    legendColour: '#3f3a2f',
    component: { kind: 'resistor', ohms: 4700 },
    pins: [
      { id: 'a', label: '1', x: 0, y: 2 },
      { id: 'b', label: '2', x: 10.16, y: 2 },
    ],
  };
}

/** The reason a definition is refused, for the legs that expect one. */
function reasonFor(part: unknown): string {
  const verdict = validatePartDefinition(part);
  if (verdict.ok) throw new Error('expected a refusal');
  return verdict.reason;
}

describe('the derivation', () => {
  /*
   * Every rule about pins is derived from the shipped parts, so the derivation
   * itself is what has to be right: if a kind has no derivable pin set, nothing
   * of that kind is importable and the feature quietly shrinks.
   */
  it('offers every shipped kind except the board and the breadboard', () => {
    const kinds = importableKinds();
    expect(kinds).toContain('resistor');
    expect(kinds).toContain('ir-remote');
    expect(kinds).not.toContain('mcu');
    expect(kinds).not.toContain('breadboard');
    expect(kinds.length).toBe(35);
  });

  it("reads a kind's pins from the shipped part of that kind", () => {
    expect(pinIdsForComponent({ kind: 'resistor', ohms: 220 })).toEqual(['a', 'b']);
    expect(pinIdsForComponent({ kind: 'led', profile: DIODE_PROFILES.red })).toEqual([
      'anode',
      'cathode',
    ]);
    // A pinless part is a legitimate part: the bench has one already.
    expect(pinIdsForComponent({ kind: 'ir-remote' })).toEqual([]);
  });

  it('reads a layout parameter from the shipped parts, not from a list', () => {
    // A seven-segment tells its digits by its pins, so the parameter selects the
    // set: the four-digit layout is not the one-digit layout.
    const one = pinIdsForComponent({ kind: '7segment', digits: 1 })!;
    const four = pinIdsForComponent({ kind: '7segment', digits: 4 })!;
    expect(one).not.toEqual(four);
    expect(one).toContain('COM.1');
    expect(four).toContain('DIG4');

    expect(layoutValuesFor('display')).toEqual(['ssd1306', 'ssd1306-spi', 'ili9341']);
    expect(layoutValuesFor('sensor-module')).toContain('pir');
    // A kind with no layout parameter has no values to choose from.
    expect(layoutValuesFor('resistor')).toEqual([]);
  });
});

describe('a part a file may carry', () => {
  it('accepts a part the catalogue does not ship', () => {
    const verdict = validatePartDefinition(goodResistor());
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.definition.id).toBe('resistor-4k7');
    expect(verdict.definition.component).toEqual({ kind: 'resistor', ohms: 4700 });
  });

  it('refuses a kind the app owns', () => {
    const board = { ...goodResistor(), component: { kind: 'mcu', board: {} } };
    expect(reasonFor(board)).toContain('cannot be a board or a breadboard');
    const breadboard = { ...goodResistor(), component: { kind: 'breadboard' } };
    expect(reasonFor(breadboard)).toContain('cannot be a board or a breadboard');
  });

  it('refuses an id that is not a name, or is already a bench part', () => {
    expect(reasonFor({ ...goodResistor(), id: 'Resistor 4k7' })).toContain('id must be');
    expect(reasonFor({ ...goodResistor(), id: 'a'.repeat(41) })).toContain('40 characters');
    expect(reasonFor({ ...goodResistor(), id: 'led-red' })).toContain('already a bench part');
  });

  it('refuses pins the behaviour does not read', () => {
    const wrong = { ...goodResistor() };
    wrong.pins = [
      { id: 'anode', label: 'A', x: 0, y: 2 },
      { id: 'cathode', label: 'C', x: 10.16, y: 2 },
    ];
    expect(reasonFor(wrong)).toContain('reads these pins: a, b');
  });

  it("refuses a display whose pins are another controller's", () => {
    const tft = {
      ...goodResistor(),
      // A body the pins fit in, so the pin-set rule is the one that fires.
      widthMm: 20,
      heightMm: 12,
      component: { kind: 'display', controller: 'ili9341', address: 0 },
      pins: [
        { id: 'VCC', label: 'VCC', x: 0, y: 0 },
        { id: 'GND', label: 'GND', x: 0, y: 2.54 },
        { id: 'SDA', label: 'SDA', x: 0, y: 5.08 },
        { id: 'SCL', label: 'SCL', x: 0, y: 7.62 },
      ],
    };
    expect(reasonFor(tft)).toContain('reads these pins');
  });

  it('refuses a colour that is not a hex triple', () => {
    expect(reasonFor({ ...goodResistor(), bodyColour: 'red' })).toContain('six-digit hex');
    expect(reasonFor({ ...goodResistor(), bodyColour: 'url(#x)' })).toContain('six-digit hex');
    expect(reasonFor({ ...goodResistor(), legendColour: '#FFF' })).toContain('six-digit hex');
  });

  it('refuses parameters outside what the behaviour can use', () => {
    expect(reasonFor({ ...goodResistor(), component: { kind: 'resistor', ohms: 0 } })).toContain(
      'between 0 and 100 MΩ',
    );
    expect(reasonFor({ ...goodResistor(), component: { kind: 'capacitor', farads: 2 } })).toContain(
      'between 0 and 1 F',
    );
    expect(reasonFor({ ...goodResistor(), component: { kind: 'dip-switch', ways: 17 } })).toContain(
      '2 to 16',
    );
    expect(
      reasonFor({ ...goodResistor(), component: { kind: 'dip-switch', ways: 2.5 } }),
    ).toContain('whole number');
    expect(reasonFor({ ...goodResistor(), component: { kind: '7segment', digits: 5 } })).toContain(
      '1 to 4',
    );
  });

  it('refuses a parameter the kind does not declare', () => {
    expect(
      reasonFor({ ...goodResistor(), component: { kind: 'resistor', ohms: 4700, farads: 1e-6 } }),
    ).toContain('component.farads is not part of "resistor"');
    expect(
      reasonFor({ ...goodResistor(), component: { kind: 'sensor-module', variant: 'dht22' } }),
    ).toContain('is not one the bench knows');
  });

  it("refuses a display geometry that is not its controller's, and accepts the two addresses an SSD1306 has", () => {
    const oled = (address: number, pixels: unknown) => ({
      ...goodResistor(),
      widthMm: 20,
      heightMm: 12,
      component: { kind: 'display', controller: 'ssd1306', address },
      displayPixels: pixels,
      pins: [
        { id: 'VCC', label: 'VCC', x: 0, y: 0 },
        { id: 'GND', label: 'GND', x: 0, y: 2.54 },
        { id: 'SDA', label: 'SDA', x: 0, y: 5.08 },
        { id: 'SCL', label: 'SCL', x: 0, y: 7.62 },
      ],
    });
    expect(reasonFor(oled(0x3c, { width: 200, height: 100 }))).toContain('own geometry');
    expect(reasonFor(oled(0x99, { width: 128, height: 64 }))).toContain('address');
    expect(validatePartDefinition(oled(0x3d, { width: 128, height: 64 })).ok).toBe(true);
  });

  it('refuses pins outside the body, too many pins, and duplicate ids', () => {
    const outside = { ...goodResistor() };
    outside.pins = [
      { id: 'a', label: '1', x: 0, y: 40 },
      { id: 'b', label: '2', x: 10.16, y: 2 },
    ];
    expect(reasonFor(outside)).toContain('outside the part');

    const duplicates = { ...goodResistor() };
    duplicates.pins = [
      { id: 'a', label: '1', x: 0, y: 2 },
      { id: 'a', label: '2', x: 10.16, y: 2 },
    ];
    expect(reasonFor(duplicates)).toContain('two pins are called');
  });

  it('refuses knobs that cannot be driven', () => {
    const withKnobs = (knobs: unknown) => ({ ...goodResistor(), knobs });
    expect(
      reasonFor(
        withKnobs([{ id: 'w', label: 'Wiper', min: 0, max: 10, step: 1, defaultValue: 42 }]),
      ),
    ).toContain('between min and max');
    expect(
      reasonFor(
        withKnobs([{ id: 'w', label: 'Wiper', min: 0, max: 10, step: 0, defaultValue: 5 }]),
      ),
    ).toContain('step must be positive');
    expect(
      reasonFor(
        withKnobs([{ id: 'w', label: 'Wiper', min: 10, max: 0, step: 1, defaultValue: 5 }]),
      ),
    ).toContain('no range');
  });

  it('refuses a field that is not a part field, and the board-only one', () => {
    expect(reasonFor({ ...goodResistor(), colour: '#fff' })).toContain(
      'colour is not a part field',
    );
    expect(reasonFor({ ...goodResistor(), boardPins: [] })).toContain(
      'boardPins is not a part field',
    );
  });
});

describe('a part file', () => {
  it('reads a bare definition and a wrapper alike', () => {
    const bare = readPartFile(JSON.stringify(goodResistor()), 'one.json');
    expect(bare.refused).toEqual([]);
    expect(bare.definitions).toHaveLength(1);

    const wrapped = readPartFile(
      JSON.stringify({ version: PART_FILE_VERSION, parts: [goodResistor()] }),
      'two.json',
    );
    expect(wrapped.definitions).toHaveLength(1);
  });

  it('keeps the good parts of a file and names the bad ones by index', () => {
    const bad = { ...goodResistor(), id: 'led-red' };
    const read = readPartFile(
      JSON.stringify({ version: 1, parts: [goodResistor(), bad] }),
      'mix.json',
    );
    expect(read.definitions.map((definition) => definition.id)).toEqual(['resistor-4k7']);
    expect(read.refused).toHaveLength(1);
    expect(read.refused[0]!.index).toBe(1);
    expect(read.refused[0]!.reason).toContain('already a bench part');
  });

  it('refuses a version it does not speak, and text that is not JSON', () => {
    expect(() => readPartFile('{"version": 2, "parts": []}', 'v2.json')).toThrow(/version 2/);
    expect(() => readPartFile('{oops', 'broken.json')).toThrow(/broken\.json: not JSON/);
  });

  it('writes what it reads', () => {
    const verdict = validatePartDefinition(goodResistor());
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    const text = partFileText(verdict.definition);
    expect(text.endsWith('\n')).toBe(true);
    const read = readPartFile(text, 'round-trip.json');
    expect(read.definitions[0]).toEqual(verdict.definition);
  });
});

// The pinned layout rules: a definition that passes the validator is one whose
// component is one the shipped catalogue produced, so the types cannot drift.
describe('the validator and the catalogue agree', () => {
  it('accepts the shipped definitions themselves, under a custom id', () => {
    const component: ComponentSpec = { kind: 'resistor', ohms: 220 };
    const pins = pinIdsForComponent(component)!;
    const verdict = validatePartDefinition({
      ...goodResistor(),
      pins: pins.map((id, index) => ({ id, label: String(index + 1), x: index * 10, y: 2 })),
    });
    expect(verdict.ok).toBe(true);
  });
});
