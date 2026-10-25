import { describe, expect, it } from 'vitest';
import {
  arduinoMega2560,
  arduinoNano,
  arduinoUnoR3,
  esp32DevKitV1,
  esp32C3DevKit,
  esp32S3DevKit,
  stm32f103BluePill,
  nanoRp2040Connect,
  raspberryPiPico,
} from './boards';
import { McuRuntime } from '@/features/simulation';
import type { PartDefinition } from './catalog';

const BOARDS: ReadonlyArray<readonly [string, () => PartDefinition]> = [
  ['esp32', esp32DevKitV1],
  ['esp32-c3', esp32C3DevKit],
  ['esp32-s3', esp32S3DevKit],
  ['stm32f103', stm32f103BluePill],
  ['uno', arduinoUnoR3],
  ['mega', arduinoMega2560],
  ['nano', arduinoNano],
  ['rp2040', nanoRp2040Connect],
  ['pico', raspberryPiPico],
];

describe('board definitions', () => {
  it.each(BOARDS)('gives every hole on the %s a unique pin id', (_name, make) => {
    const ids = make().pins.map((pin) => pin.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(BOARDS)('never numbers two holes on the %s the same', (_name, make) => {
    // `pinIdForGpio` is a map keyed by pin number, so a second pin claiming a
    // number overwrites the first and silently takes its terminal with it.
    const definition = make();
    const numbered = (definition.boardPins ?? []).filter((pin) => pin.gpio !== undefined);
    const numbers = numbered.map((pin) => pin.gpio);
    expect(new Set(numbers).size).toBe(numbers.length);
  });

  it.each(BOARDS)('exposes at least one firmware-visible pin on the %s', (_name, make) => {
    expect(new McuRuntime(make()).pins().length).toBeGreaterThan(0);
  });

  it.each(BOARDS)('runs the %s off a rail the engine can find', (_name, make) => {
    // The engine holds the board's own regulator up by matching this label, so
    // a board whose rail is spelled differently reads 0 V across the breadboard.
    const mcu = new McuRuntime(make());
    const rail = mcu.board.logicVolts === 5 ? '5V' : '3V3';
    expect(mcu.pins().some((pin) => pin.role === 'power' && pin.label === rail)).toBe(true);
  });

  it.each(BOARDS)('resolves every default bus pin on the %s to a header hole', (_name, make) => {
    // A bus pin that names nothing is a bus no display can ever reach, which
    // looks exactly like a wiring mistake and is not one.
    const mcu = new McuRuntime(make());
    for (const gpio of [...mcu.i2cPins, ...mcu.spiPins]) {
      expect(mcu.pinIdForGpio(gpio), `${mcu.board.id} pin ${gpio}`).toBeDefined();
    }
  });

  it('lights the Arduino L lamp from digital 13 on every Arduino board', () => {
    for (const make of [arduinoUnoR3, arduinoMega2560, arduinoNano]) {
      const definition = make();
      const mcu = new McuRuntime(definition);
      const lamp = definition.boardPins?.find((pin) => pin.gpio === 13);
      expect(lamp?.role, definition.id).toBe('gpio');
      expect(mcu.pinIdForGpio(13)).toBe(lamp?.id);
    }
  });

  it('numbers the Mega analog block after the digital one, not from zero', () => {
    // The trap worth remembering when a sketch moves between the two boards:
    // A0 is pin 54 on the Mega and pin 14 on the Uno.
    const mcu = new McuRuntime(arduinoMega2560());
    expect(mcu.pinIdForGpio(54)).toBe('J3_A0');
    expect(mcu.pinIdForGpio(69)).toBe('J3_A15');
    expect(new McuRuntime(arduinoUnoR3()).pinIdForGpio(14)).toBe('J3_A0');
  });

  it('samples the RP2040 analog block on the GPIO its silkscreen names', () => {
    const mcu = new McuRuntime(nanoRp2040Connect());
    expect(mcu.pinIdForGpio(26)).toBe('J3_A0');
    expect(mcu.pinIdForGpio(29)).toBe('J3_A3');
    expect(mcu.pinIdForGpio(15)).toBe('J1_D3');
  });

  it('maps the RP2040 header to the GPIOs its silkscreen names', () => {
    /*
     * The Nano form factor is wrapped around a chip whose pins are numbered
     * independently: D2 is GPIO25 and D13 is GPIO6, not 2 and 13. A4/A5 are
     * the I2C pair on GPIO12/13, and A6/A7 have no GPIO behind them. This is
     * the table a MicroPython sketch names its pins by, so it has to be the
     * real one rather than the header digit.
     */
    const mcu = new McuRuntime(nanoRp2040Connect());
    const expected: ReadonlyArray<readonly [number, string]> = [
      [0, 'J1_TX'],
      [1, 'J1_RX'],
      [25, 'J1_D2'],
      [15, 'J1_D3'],
      [16, 'J1_D4'],
      [17, 'J1_D5'],
      [18, 'J1_D6'],
      [19, 'J1_D7'],
      [20, 'J1_D8'],
      [21, 'J1_D9'],
      [5, 'J1_D10'],
      [7, 'J1_D11'],
      [4, 'J1_D12'],
      [6, 'J2_D13'],
      [26, 'J3_A0'],
      [27, 'J3_A1'],
      [28, 'J3_A2'],
      [29, 'J3_A3'],
      [12, 'J3_A4'],
      [13, 'J3_A5'],
    ];
    for (const [gpio, pinId] of expected) {
      expect(mcu.pinIdForGpio(gpio), `GPIO${gpio}`).toBe(pinId);
    }
    // Every numbered hole is a different pad. A duplicate would let the last
    // declaration steal the first one's terminal.
    expect(new Set(expected.map(([gpio]) => gpio)).size).toBe(expected.length);
    expect(mcu.boardPin('J3_A6')?.gpio).toBeUndefined();
    expect(mcu.boardPin('J3_A7')?.gpio).toBeUndefined();
  });

  it('runs the Nano and the Uno off the same chip, at the same voltage', () => {
    expect(arduinoNano().component).toMatchObject({ board: { logicVolts: 5, adcBits: 10 } });
    expect(arduinoUnoR3().component).toMatchObject({ board: { logicVolts: 5, adcBits: 10 } });
  });

  it('runs the RP2040 at 3.3 V, which is what changes a sketch across boards', () => {
    expect(nanoRp2040Connect().component).toMatchObject({
      board: { logicVolts: 3.3, adcBits: 12 },
    });
  });

  it('keeps A6 and A7 off the Nano as output pins', () => {
    const mcu = new McuRuntime(arduinoNano());
    expect(mcu.boardPin('J3_A6')?.canDrive).toBe(false);
    expect(mcu.boardPin('J3_A7')?.canDrive).toBe(false);
  });
});

describe('the Arduino pin namespace', () => {
  it('renames the pins on the board whose header and chip disagree', () => {
    /*
     * The Nano RP2040 Connect is the one board where a C++ sketch's pin index
     * is not the chip's GPIO: `pinMode(2)` means the hole labelled D2, which
     * is GPIO25, and the analog block answers 14 to 19 the way every Arduino
     * board does.
     */
    const mcu = new McuRuntime(nanoRp2040Connect());
    expect(mcu.arduinoPins.map).toMatchObject({
      2: 25,
      10: 5,
      12: 4,
      13: 6,
      14: 26,
      17: 29,
      18: 12,
      19: 13,
    });
  });

  it('gives the analog constants the values each core uses', () => {
    // An ESP32 names its analog pins by the GPIO behind them.
    expect(new McuRuntime(esp32DevKitV1()).arduinoPins.aliases).toEqual({
      A0: 36,
      A1: 39,
      A2: 34,
      A3: 35,
      A4: 32,
      A5: 33,
    });
    // A Mega numbers them after its fifty-four digital pins.
    expect(new McuRuntime(arduinoMega2560()).arduinoPins.aliases).toEqual({
      A0: 54,
      A1: 55,
      A2: 56,
      A3: 57,
      A4: 58,
      A5: 59,
    });
    // The Pico's analog pins are GP26 to GP28.
    expect(new McuRuntime(raspberryPiPico()).arduinoPins.aliases).toEqual({
      A0: 26,
      A1: 27,
      A2: 28,
    });
    // An Uno's are 14 to 19, which is the default, so it says nothing.
    expect(new McuRuntime(arduinoUnoR3()).arduinoPins.aliases).toBeUndefined();
  });
});

describe('default bus pins', () => {
  it('puts the I2C bus on the pins each board silkscreens for it', () => {
    expect(new McuRuntime(esp32DevKitV1()).i2cPins).toEqual([21, 22]);
    expect(new McuRuntime(arduinoUnoR3()).i2cPins).toEqual([18, 19]);
    expect(new McuRuntime(arduinoMega2560()).i2cPins).toEqual([20, 21]);
    expect(new McuRuntime(nanoRp2040Connect()).i2cPins).toEqual([12, 13]);
  });

  it('puts the Mega SPI on its own 50-53 block rather than the Uno 10-13', () => {
    expect(new McuRuntime(arduinoMega2560()).spiPins).toEqual([53, 9, 52, 51]);
    expect(new McuRuntime(arduinoUnoR3()).spiPins).toEqual([10, 9, 13, 11]);
  });

  it('names the RP2040 SPI pins by GPIO, not by header digit', () => {
    // D10/D9/D13/D11 carry GPIO5/21/6/7 on the Nano RP2040.
    expect(new McuRuntime(nanoRp2040Connect()).spiPins).toEqual([5, 21, 6, 7]);
  });

  it('leaves the Nano and the Uno on the same bus pins', () => {
    // Same chip, so a sketch that wires the Uno wires the Nano unchanged.
    expect(new McuRuntime(arduinoNano()).spiPins).toEqual(new McuRuntime(arduinoUnoR3()).spiPins);
    expect(new McuRuntime(arduinoNano()).i2cPins).toEqual(new McuRuntime(arduinoUnoR3()).i2cPins);
  });
});
