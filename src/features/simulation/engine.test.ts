import { describe, expect, it } from 'vitest';
import { BenchBuilder } from './bench';
import { columnX, railRowY, stripRowY, breadboardDefinition } from '@/features/parts';
import { esp32DevKitV1 } from '@/features/parts';
import { ledDefinition, resistorDefinition, buttonDefinition } from '@/features/parts';
import { DIODE_PROFILES, GROUND } from './elements';
import { Engine } from './engine';
import { McuRuntime } from './mcu';
import { elementCurrent } from './circuit';
import { DynamicState } from '@/features/parts';

const BOARD_ORIGIN_X = 200;
const BOTTOM_NEGATIVE_RAIL = 2;
const SIGNAL_COLUMN = 20;

const holeX = (column: number): number => BOARD_ORIGIN_X + columnX(column);
const holeY = (row: number): number => stripRowY(row);

type Esp32Like = {
  definition: { pins: ReadonlyArray<{ id: string; label: string; x: number; y: number }> };
};

/** Ties the board's ground header to the breadboard's bottom ground rail. */
function wireBoardGround(builder: BenchBuilder, esp32: Esp32Like, column: number): void {
  const ground = esp32.definition.pins.find((pin) => pin.id === 'L_GND')!;
  builder.addWire(ground.x, ground.y, holeX(column), railRowY(BOTTOM_NEGATIVE_RAIL));
}

/**
 * An ESP32 driving GPIO2 through a 330 Ohm resistor into a red LED that returns
 * to the board's ground plane.
 */
function ledBench() {
  const builder = new BenchBuilder();
  builder.addPart(breadboardDefinition(), BOARD_ORIGIN_X, 0);
  const esp32 = builder.addPart(esp32DevKitV1(), 0, 0);

  const gpio2 = esp32.definition.pins.find((pin) => pin.id === 'R_D2')!;
  builder.addWire(gpio2.x, gpio2.y, holeX(SIGNAL_COLUMN), holeY(8));

  builder.addPart(resistorDefinition(330), holeX(SIGNAL_COLUMN), holeY(8) - 2.54);
  // Anode-anchored: the long leg lands on its hole, cathode one column along.
  const ledDef = ledDefinition(DIODE_PROFILES.red, 'Red');
  const ledAnode = ledDef.pins.find((pin) => pin.id === 'anode')!;
  builder.addPart(ledDef, holeX(SIGNAL_COLUMN + 4) - ledAnode.x, holeY(8) - ledAnode.y);
  builder.addWire(
    holeX(SIGNAL_COLUMN + 3),
    holeY(8),
    holeX(SIGNAL_COLUMN + 3),
    railRowY(BOTTOM_NEGATIVE_RAIL),
  );
  wireBoardGround(builder, esp32, 10);

  const mcu = new McuRuntime(esp32.definition);
  const engine = new Engine({ bench: builder.build(), mcu });
  engine.rebuild();

  const ledElement = engine.currentNetlist.elements.find(
    (element) => element.kind === 'diode',
  )!;
  return { builder, esp32, mcu, engine, ledElement };
}

/**
 * An input pin on column 10, a button pulling it to the ground rail, and
 * optionally a 10 kOhm pull-down on the same net.
 *
 * Everything sits in the left half of the rails. They are split at column 31,
 * so wiring to the right half would leave the button shorting nothing -- the
 * exact trap the split exists to teach.
 *
 * Button leads sit 5.08 mm apart, which is two columns on the pitch grid.
 */
function buttonBench(withPullDown: boolean) {
  const builder = new BenchBuilder();
  builder.addPart(breadboardDefinition(), BOARD_ORIGIN_X, 0);
  const esp32 = builder.addPart(esp32DevKitV1(), 0, 0);

  const inputPin = esp32.definition.pins.find((pin) => pin.id === 'L_GPIO27')!;
  builder.addWire(inputPin.x, inputPin.y, holeX(10), holeY(8));

  builder.addPart(buttonDefinition(), holeX(10), holeY(8) - 3);
  builder.addWire(holeX(12), holeY(8), holeX(12), railRowY(BOTTOM_NEGATIVE_RAIL));

  if (withPullDown) {
    builder.addPart(resistorDefinition(10_000), holeX(10), holeY(8) - 2.54);
    builder.addWire(holeX(14), holeY(8), holeX(14), railRowY(BOTTOM_NEGATIVE_RAIL));
  }

  wireBoardGround(builder, esp32, 16);

  const mcu = new McuRuntime(esp32.definition);
  const engine = new Engine({ bench: builder.build(), mcu });
  engine.rebuild();
  // Parts were added in order: breadboard, board, button, maybe resistor.
  return { builder, engine, mcu, buttonId: 'p3' };
}

describe('pin drive', () => {
  it('drives its net to the supply when written high', () => {
    const { engine, mcu } = ledBench();
    mcu.setDirection(2, 'output');
    mcu.writeDigital(2, true, engine.timeMs);
    engine.settle();

    // Just under the rail: the LED is drawing current through the pin's 40 Ohm
    // output impedance, which is exactly what that resistance is there for.
    const volts = engine.voltageOfNet(engine.netOfMcuPin('R_D2'));
    expect(volts).toBeGreaterThan(3.0);
    expect(volts).toBeLessThanOrEqual(3.3);
  });

  it('drives its net to ground when written low', () => {
    const { engine, mcu } = ledBench();
    mcu.setDirection(2, 'output');
    mcu.writeDigital(2, false, engine.timeMs);
    engine.settle();

    expect(engine.voltageOfNet(engine.netOfMcuPin('R_D2'))).toBeLessThan(0.01);
  });

  it('lights the LED only when the pin is driven high', () => {
    const { engine, mcu, ledElement } = ledBench();

    mcu.setDirection(2, 'output');
    mcu.writeDigital(2, false, engine.timeMs);
    expect(Math.abs(elementCurrent(ledElement, engine.settle()))).toBeLessThan(1e-6);

    mcu.writeDigital(2, true, engine.timeMs);
    const lit = elementCurrent(ledElement, engine.settle());

    // 3.3 V through 330 Ohm into a red LED: a few milliamps, and no more.
    expect(lit).toBeGreaterThan(0.002);
    expect(lit).toBeLessThan(0.007);
  });

  it('ignores an output request on an input-only pin', () => {
    const { engine, mcu } = ledBench();
    mcu.setDirection(34, 'output');
    // GPIO34 has no output driver on real ESP32 silicon.
    mcu.writeDigital(34, true, engine.timeMs);
    engine.settle();

    expect(mcu.configurationOf('L_GPIO34').direction).toBe('input');
    expect(engine.voltageOfNet(engine.netOfMcuPin('L_GPIO34'))).toBeLessThan(3.0);
  });

  it('limits the current a pin sources into a short to ground', () => {
    const builder = new BenchBuilder();
    const esp32 = builder.addPart(esp32DevKitV1(), 0, 0);
    const gpio4 = esp32.definition.pins.find((pin) => pin.id === 'R_D4')!;
    const ground = esp32.definition.pins.find((pin) => pin.id === 'R_GND')!;
    builder.addWire(gpio4.x, gpio4.y, ground.x, ground.y);

    const mcu = new McuRuntime(esp32.definition);
    const engine = new Engine({ bench: builder.build(), mcu });
    engine.rebuild();

    mcu.setDirection(4, 'output');
    mcu.writeDigital(4, true, engine.timeMs);
    engine.settle();

    // The pin's own 40 Ohm output impedance is the only thing in the way, so
    // 3.3 V / 40 Ohm caps it near 82 mA rather than an ideal source's infinity.
    const amps = Math.abs(engine.pinCurrentAmps('R_D4'));
    expect(amps).toBeGreaterThan(0.05);
    expect(amps).toBeLessThan(0.09);
  });
});

describe('board supply', () => {
  it('powers its own rail without anything wired to it', () => {
    const { engine } = ledBench();
    engine.settle();

    // Nothing on the bench connects to 3V3 except the board itself, and it
    // still reads a full rail: the on-board regulator is part of the board.
    expect(engine.voltageOfNet(engine.supplyRailNet)).toBeCloseTo(3.3, 6);
  });
});

describe('PWM', () => {
  it('holds the pin high through a digital write', () => {
    const { engine, mcu } = ledBench();
    mcu.setDirection(2, 'output');
    mcu.writeDigital(2, true, engine.timeMs);

    const net = engine.netOfMcuPin('R_D2');
    let allHigh = true;
    for (let step = 0; step < 50; step++) {
      engine.step(1e-4);
      if (engine.voltageOfNet(net) < 3.0) allHigh = false;
    }
    expect(allHigh).toBe(true);
  });

  it('averages to the requested duty across a PWM period', () => {
    const { engine, mcu } = ledBench();
    mcu.setDirection(2, 'output');
    mcu.writeAnalog(2, 128, engine.timeMs);

    const net = engine.netOfMcuPin('R_D2');
    let total = 0;
    // 1 kHz on the ESP32 is a 1 ms period; 200 x 100 us covers 20 of them.
    for (let step = 0; step < 200; step++) {
      engine.step(1e-4);
      total += engine.voltageOfNet(net);
    }

    expect(total / 200).toBeGreaterThan(3.3 * 0.4);
    expect(total / 200).toBeLessThan(3.3 * 0.6);
  });

  it('dims an LED rather than switching it fully off', () => {
    const { engine, mcu, ledElement } = ledBench();

    mcu.setDirection(2, 'output');
    mcu.writeAnalog(2, 255, engine.timeMs);
    const fullBrightness = elementCurrent(ledElement, engine.settle());

    mcu.writeAnalog(2, 40, engine.timeMs);
    let total = 0;
    for (let step = 0; step < 100; step++) {
      total += Math.abs(elementCurrent(ledElement, engine.step(1e-4)));
    }
    const dimmed = total / 100;

    expect(dimmed).toBeGreaterThan(0);
    expect(dimmed).toBeLessThan(fullBrightness * 0.7);
  });
});

describe('inputs', () => {
  it('pulls an input up to the supply when configured for it', () => {
    const { engine, mcu } = buttonBench(false);
    mcu.setDirection(27, 'inputPullUp');
    engine.settle();

    expect(engine.readDigital(27)).toBe(true);
    expect(engine.voltageOfNet(engine.netOfMcuPin('L_GPIO27'))).toBeCloseTo(3.3, 1);
  });

  it('reads low once a pressed button pulls the pin to ground', () => {
    const { engine, mcu, buttonId } = buttonBench(false);
    mcu.setDirection(27, 'inputPullUp');

    // The netlist is derived from state, so a held button appears as a low
    // resistance path from the input net to the ground rail.
    engine.rebuild(undefined, new DynamicState([buttonId]));
    engine.settle();

    expect(engine.readDigital(27)).toBe(false);
  });

  it('lets an external pull-down outrank the internal pull-up', () => {
    const { engine, mcu } = buttonBench(true);
    mcu.setDirection(27, 'inputPullUp');
    engine.settle();

    // 10 kOhm to ground against 45 kOhm to the rail settles near 0.6 V.
    expect(engine.voltageOfNet(engine.netOfMcuPin('L_GPIO27'))).toBeLessThan(1.0);
    expect(engine.readDigital(27)).toBe(false);
  });

  it('drifts when an input is left completely floating', () => {
    const builder = new BenchBuilder();
    const esp32 = builder.addPart(esp32DevKitV1(), 0, 0);
    const mcu = new McuRuntime(esp32.definition);
    const engine = new Engine({ bench: builder.build(), mcu });
    engine.rebuild();

    mcu.setDirection(27, 'input');
    const net = engine.netOfMcuPin('L_GPIO27');

    const readings: number[] = [];
    for (let step = 0; step < 400; step++) {
      engine.step(5e-3);
      readings.push(engine.voltageOfNet(net));
    }

    // An unwired CMOS input wanders. A simulator that pins it to 0 teaches the
    // opposite lesson from the one it exists for.
    const spread = Math.max(...readings) - Math.min(...readings);
    expect(spread).toBeGreaterThan(0.5);
    expect(Math.min(...readings)).toBeGreaterThan(0);
    expect(Math.max(...readings)).toBeLessThan(3.3);
  });

  it('reports a floating pin as floating', () => {
    const builder = new BenchBuilder();
    const esp32 = builder.addPart(esp32DevKitV1(), 0, 0);
    const mcu = new McuRuntime(esp32.definition);
    const engine = new Engine({ bench: builder.build(), mcu });
    engine.rebuild();

    expect(engine.isFloating('L_GPIO27')).toBe(true);

    const ground = esp32.definition.pins.find((pin) => pin.id === 'L_GND')!;
    const inputPin = esp32.definition.pins.find((pin) => pin.id === 'L_GPIO27')!;
    builder.addWire(inputPin.x, inputPin.y, ground.x, ground.y);
    engine.rebuild();

    expect(engine.isFloating('L_GPIO27')).toBe(false);
  });
});

describe('readAnalog', () => {
  it('scales a divider output across the ADC range', () => {
    const builder = new BenchBuilder();
    builder.addPart(breadboardDefinition(), BOARD_ORIGIN_X, 0);
    const esp32 = builder.addPart(esp32DevKitV1(), 0, 0);

    // 3V3 -> 10k -> ADC node -> 10k -> ground: a half-rail reading.
    const rail = esp32.definition.pins.find((pin) => pin.id === 'R_3V3')!;
    const adcPin = esp32.definition.pins.find((pin) => pin.id === 'L_GPIO34')!;

    builder.addWire(rail.x, rail.y, holeX(5), holeY(8));
    builder.addPart(resistorDefinition(10_000), holeX(5), holeY(8) - 2.54);

    builder.addWire(holeX(9), holeY(8), adcPin.x, adcPin.y);
    builder.addPart(resistorDefinition(10_000), holeX(9), holeY(8) - 2.54);
    builder.addWire(holeX(13), holeY(8), holeX(13), railRowY(BOTTOM_NEGATIVE_RAIL));

    wireBoardGround(builder, esp32, 16);

    const mcu = new McuRuntime(esp32.definition);
    const engine = new Engine({ bench: builder.build(), mcu });
    engine.rebuild();
    mcu.setDirection(34, 'input');
    engine.settle();

    // Half of 3.3 V on a 12-bit converter.
    const reading = engine.readAnalog(34);
    expect(reading).toBeGreaterThan(1900);
    expect(reading).toBeLessThan(2200);
  });
});

describe('netlist elements', () => {
  it('keeps the LED element addressable for brightness', () => {
    const { engine, ledElement } = ledBench();
    const elements = [...engine.currentNetlist.elements];
    expect(elements).toContain(ledElement);
    expect(ledElement.kind).toBe('diode');
    expect(ledElement.b).toBe(GROUND);
  });
});