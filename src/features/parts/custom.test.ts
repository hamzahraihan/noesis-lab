import { describe, expect, it } from 'vitest';
import {
  PART_FILE_VERSION,
  SCRIPT_MAX_CHARS,
  importableKinds,
  layoutValuesFor,
  partFileText,
  pinIdsForComponent,
  readPartFile,
  validatePartDefinition,
} from './custom';
import type { ComponentSpec } from './catalog';
import { PART_CATALOGUE } from './catalogue';
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
    // 35 shipped kinds plus `scripted`, which ships no part on purpose: the
    // whole point of that kind is that the host has no model for it.
    expect(kinds).toContain('scripted');
    expect(kinds.length).toBe(36);
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

/**
 * A scripted part, in the shape a file would carry it.
 *
 * This is the kind with no shipped twin: nothing in the catalogue tells the
 * validator what its pins are, so the bus does.
 */
function goodScript(): Record<string, unknown> {
  return {
    id: 'soil-probe',
    name: 'Soil moisture probe',
    category: 'input',
    widthMm: 20,
    heightMm: 12,
    bodyColour: '#5b6b4a',
    legendColour: '#f2f2ee',
    component: { kind: 'scripted', bus: 'analog' },
    script: '({ analog: () => 0.5 })',
    pins: [
      { id: 'AOUT', label: 'OUT', x: 0, y: 6 },
      { id: 'VCC', label: 'VCC', x: 10, y: 6 },
      { id: 'GND', label: 'GND', x: 20, y: 6, net: 'GND' },
    ],
  };
}

describe('a scripted part', () => {
  it('needs no shipped twin: the bus names its pins', () => {
    const verdict = validatePartDefinition(goodScript());
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.definition.component).toEqual({ kind: 'scripted', bus: 'analog' });
    expect(verdict.definition.script).toContain('analog');
  });

  it('speaks analog or digital and nothing else', () => {
    expect(reasonFor({ ...goodScript(), component: { kind: 'scripted' } })).toContain(
      'component.bus must be one of analog, digital, i2c',
    );
    expect(reasonFor({ ...goodScript(), component: { kind: 'scripted', bus: 'spi' } })).toContain(
      'component.bus must be one of analog, digital, i2c',
    );
    const digital = goodScript();
    digital.component = { kind: 'scripted', bus: 'digital' };
    digital.pins = [
      { id: 'DOUT', label: 'OUT', x: 0, y: 6 },
      { id: 'VCC', label: 'VCC', x: 10, y: 6 },
      { id: 'GND', label: 'GND', x: 20, y: 6, net: 'GND' },
    ];
    expect(validatePartDefinition(digital).ok).toBe(true);
  });

  it('draws the pins its bus brings', () => {
    const wrong = goodScript();
    wrong.pins = [
      { id: 'SIG', label: 'OUT', x: 0, y: 6 },
      { id: 'VCC', label: 'VCC', x: 10, y: 6 },
      { id: 'GND', label: 'GND', x: 20, y: 6, net: 'GND' },
    ];
    expect(reasonFor(wrong)).toContain('AOUT');
  });

  it('carries its own script, and a script belongs to it alone', () => {
    expect(reasonFor({ ...goodScript(), script: undefined })).toContain('must carry its script');
    expect(reasonFor({ ...goodScript(), script: '   ' })).toContain('must carry its script');
    expect(reasonFor({ ...goodResistor(), script: '({ resistor: () => 10 })' })).toContain(
      'script is only for a scripted part',
    );
  });

  it('bounds the script, because a part is one file with nothing to fetch', () => {
    const huge = goodScript();
    huge.script = `/*${'x'.repeat(SCRIPT_MAX_CHARS)}*/`;
    expect(reasonFor(huge)).toContain('at most');
  });

  it('speaks i2c with an address, and needs one in range', () => {
    const i2c = goodScript();
    // Four leads need a body wide enough to draw them on.
    i2c.widthMm = 30;
    i2c.component = { kind: 'scripted', bus: 'i2c', address: 0x50 };
    i2c.pins = [
      { id: 'SDA', label: 'SDA', x: 0, y: 6 },
      { id: 'SCL', label: 'SCL', x: 10, y: 6 },
      { id: 'VCC', label: 'VCC', x: 20, y: 6 },
      { id: 'GND', label: 'GND', x: 30, y: 6, net: 'GND' },
    ];
    const verdict = validatePartDefinition(i2c);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.definition.component).toMatchObject({ address: 0x50 });

    // The seven-bit space minus what the standard reserves: general call at the
    // bottom, the ten-bit prefixes at the top.
    expect(reasonFor({ ...i2c, component: { kind: 'scripted', bus: 'i2c' } })).toContain(
      'component.address',
    );
    expect(
      reasonFor({ ...i2c, component: { kind: 'scripted', bus: 'i2c', address: 0x04 } }),
    ).toContain('component.address');
    expect(
      reasonFor({ ...i2c, component: { kind: 'scripted', bus: 'i2c', address: 0x78 } }),
    ).toContain('component.address');

    // A bus that does not use an address may not carry one.
    expect(
      reasonFor({ ...goodScript(), component: { kind: 'scripted', bus: 'analog', address: 0x50 } }),
    ).toContain('component.address');
  });

  it('round-trips through the file the app writes, script and all', () => {
    const verdict = validatePartDefinition(goodScript());
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    const read = readPartFile(partFileText(verdict.definition), 'exported.part.json');
    expect(read.refused).toEqual([]);
    const back = read.definitions[0];
    expect(back?.script).toBe('({ analog: () => 0.5 })');
    expect(back?.component).toEqual({ kind: 'scripted', bus: 'analog' });
    expect(back?.pins.map((pin) => pin.id)).toEqual(['AOUT', 'VCC', 'GND']);
  });

  it('leaves the knobs to the script, but still checks they can be turned', () => {
    const knobbed = goodScript();
    knobbed.knobs = [
      { id: 'moisture', label: 'Moisture', min: 0, max: 100, step: 1, defaultValue: 40 },
    ];
    expect(validatePartDefinition(knobbed).ok).toBe(true);
    const broken = goodScript();
    broken.knobs = [{ id: 'moisture', label: 'Moisture', min: 100, max: 0, step: 1 }];
    expect(reasonFor(broken)).toContain('min must be below max');
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
      displayPixels: { width: 320, height: 240 },
      glassMm: { width: 53, height: 39.8 },
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
    // Built from the shipped panel so the pins are its own, in its own order:
    // only the address and the pixel count are being varied here.
    const oled = (address: number, pixels: unknown) => ({
      ...PART_CATALOGUE.find((entry) => entry.id === 'ssd1306-128x64-3c')!.make(),
      id: 'imported-oled',
      component: { kind: 'display', controller: 'ssd1306', address },
      displayPixels: pixels,
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
    const pot = () => ({
      ...PART_CATALOGUE.find((entry) => entry.id === 'potentiometer-10000')!.make(),
      id: 'imported-turn',
    });
    const withKnobs = (knobs: unknown) => ({ ...pot(), knobs });
    expect(
      reasonFor(
        withKnobs([{ id: 'turn', label: 'Wiper', min: 0, max: 10, step: 1, defaultValue: 42 }]),
      ),
    ).toContain('between min and max');
    expect(
      reasonFor(
        withKnobs([{ id: 'turn', label: 'Wiper', min: 0, max: 10, step: 0, defaultValue: 5 }]),
      ),
    ).toContain('step must be positive');
    expect(
      reasonFor(
        withKnobs([{ id: 'turn', label: 'Wiper', min: 10, max: 0, step: 1, defaultValue: 5 }]),
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

/*
 * The catalogue is the format's specification, so every part the app ships in an
 * importable kind has to be expressible as a file. A shipped definition the
 * validator refuses is a rule that does not describe the bench -- and it would be
 * a part the operator cannot save and open again.
 *
 * The id is the one field that must differ: an imported id may not collide with a
 * shipped one, which is the point of the rule.
 */
describe('the shipped catalogue', () => {
  const importable = new Set<string>(importableKinds());

  it.each(
    PART_CATALOGUE.filter((entry) => importable.has(entry.make().component.kind)).map(
      (entry) => [entry.id, entry] as const,
    ),
  )('%s is expressible as a part file', (_id, entry) => {
    const slug = entry.id.replace(/[^a-z0-9-]+/g, '-');
    const definition = { ...entry.make(), id: `imported-${slug}` };
    const { definitions, refused } = readPartFile(
      partFileText(definition),
      `${entry.id}.part.json`,
    );
    expect(refused.map((r) => r.reason)).toEqual([]);
    expect(definitions.length).toBe(1);
  });

  it('covers every importable kind', () => {
    const covered = new Set<string>(
      PART_CATALOGUE.filter((entry) => importable.has(entry.make().component.kind)).map(
        (entry) => entry.make().component.kind,
      ),
    );
    // A kind with no shipped part would have no pin ids to derive and no
    // parameters to copy, so the format could not describe it at all -- with one
    // exception, which is the point of the kind: a scripted part's pins and
    // parameters belong to its script, and `custom.ts` names them itself.
    expect([...importable].filter((kind) => !covered.has(kind))).toEqual(['scripted']);
  });
});

/*
 * Rules the behaviour, not the catalogue alone, decides.
 *
 * Each of these was found by asking what the *consumer* reads: `DynamicState.knob`
 * looks a value up by id, the artwork picks an LED's colour by identity, the
 * solver dereferences an LED's diode, the iOS-style press goes through
 * `definition.momentary`, and a pin's `net` joins it to a rail without a wire.
 * A part that breaks one of them imports cleanly and then does nothing, or does
 * something the operator never asked for -- which is worse than a refusal.
 */
describe('rules the behaviour decides', () => {
  const shipped = (id: string) => ({
    ...PART_CATALOGUE.find((entry) => entry.id === id)!.make(),
    id: 'imported-copy',
  });

  it('refuses a display whose pins are the right ones in the wrong order', () => {
    const panel = shipped('ili9341-320x240');
    panel.pins = [...panel.pins].reverse();
    expect(reasonFor(panel)).toContain('order');
  });

  it('refuses a knob whose id the behaviour does not read', () => {
    const part = { ...shipped('potentiometer-10000') };
    part.knobs = [{ id: 'wiper', label: 'Wiper', min: 0, max: 1, step: 0.01, defaultValue: 0.5 }];
    const reason = reasonFor(part);
    expect(reason).toContain('turn');
    expect(reason).toContain('behaviour reads');
  });

  it('accepts every knob a 4x4 keypad has, sixteen of them', () => {
    const verdict = validatePartDefinition(shipped('membrane-keypad'));
    expect(verdict.ok ? null : verdict.reason).toBeNull();
  });

  it('refuses a momentary kind that would never be pressed', () => {
    const button = { ...shipped('button-tactile') };
    delete (button as { momentary?: boolean }).momentary;
    expect(reasonFor(button)).toContain('momentary');
  });

  it('refuses an LED with no diode at all', () => {
    const led = shipped('led-red');
    const component = { ...led.component } as Record<string, unknown>;
    delete component.profile;
    expect(reasonFor({ ...led, component })).toContain('diode');
  });

  it("rebinds a diode that arrived as numbers to the bench's own", () => {
    // The artwork compares by identity (`ledColour`), so a copy that looks the
    // same draws red. A stored part comes back with the numbers, not the name.
    const led = shipped('led-red');
    // Through the file reader, which is how a stored part comes back.
    const { definitions } = readPartFile(partFileText(led), 'led.part.json');
    expect(definitions.length).toBe(1);
    const verdict = validatePartDefinition(JSON.parse(JSON.stringify(definitions[0])) as unknown);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.definition.component).toMatchObject({ profile: DIODE_PROFILES.red });
    }
  });

  it('refuses a pin joined to a rail this kind does not use', () => {
    const part = shipped('resistor-220');
    part.pins = part.pins.map((pin, index) => (index === 0 ? { ...pin, net: 'GND' } : pin));
    expect(reasonFor(part)).toContain('net');
  });

  it('refuses an id the bench already answers to', () => {
    expect(reasonFor({ ...goodResistor(), id: 'esp32-devkit-v1' })).toContain(
      'already a bench part',
    );
    const free = validatePartDefinition({ ...goodResistor(), id: 'resistor-4k7' });
    expect(free.ok ? null : free.reason).toBeNull();
  });
});
