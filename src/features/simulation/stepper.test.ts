import { describe, expect, it } from 'vitest';
import { BenchBuilder, type PartInstance } from './bench';
import { esp32DevKitV1 } from '@/features/parts';
import { DynamicState } from '@/features/parts';
import { buildNetlist } from './netlist';
import { McuRuntime } from './mcu';
import { Engine } from './engine';
import { STEP_DEGREES, biaxialStepperDefinition, stepperDefinition, stepTransition } from './stepper';
import { renderedSizeMm, wokwiPartFor } from '@/ui/wokwi';

describe('stepper definition', () => {
  it('exposes four coil pins in a row', () => {
    const def = stepperDefinition();
    expect(def.pins.map((p) => p.id)).toEqual(['A-', 'A+', 'B+', 'B-']);
    expect([def.widthMm, def.heightMm]).toEqual([42, 42]);
  });
});

describe('step transition', () => {
  it('steps forward round the Gray cycle', () => {
    expect(stepTransition([1, 1], [-1, 1])).toBe(1);
  });
  it('holds on jitter', () => {
    expect(stepTransition([1, 1], [1, 1])).toBe(0);
    expect(stepTransition([1, 1], [-1, -1])).toBe(0);
  });
});

describe('stepper shaft', () => {  const PINS = { aMinus: 2, aPlus: 4, bPlus: 5, bMinus: 12 };

  function shaftBench() {
    const builder = new BenchBuilder();
    const esp32 = builder.addPart(esp32DevKitV1(), 0, 0);
    const stepper = builder.addPart(stepperDefinition(), 200, 0);
    const at = (part: PartInstance, pinId: string) => {
      const pin = part.definition.pins.find((p) => p.id === pinId)!;
      return { x: part.x + pin.x, y: part.y + pin.y };
    };
    const gpioPin = (gpio: number) => {
      const id = esp32.definition.boardPins!.find((p) => p.gpio === gpio)!.id;
      const pin = esp32.definition.pins.find((p) => p.id === id)!;
      return { x: pin.x, y: pin.y };
    };
    const wire = (gpio: number, targetPin: string) => {
      const from = gpioPin(gpio);
      const to = at(stepper, targetPin);
      builder.addWire(from.x, from.y, to.x, to.y);
    };
    wire(PINS.aMinus, 'A-');
    wire(PINS.aPlus, 'A+');
    wire(PINS.bPlus, 'B+');
    wire(PINS.bMinus, 'B-');
    const mcu = new McuRuntime(esp32.definition);
    for (const gpio of Object.values(PINS)) mcu.setDirection(gpio, 'output');
    const engine = new Engine({ bench: builder.build(), mcu });
    engine.rebuild();
    return { engine, mcu, stepper };
  }

  function driveCoils(mcu: McuRuntime, timeMs: number, pA: number, pB: number) {
    mcu.writeDigital(PINS.aPlus, pA > 0, timeMs);
    mcu.writeDigital(PINS.aMinus, pA < 0, timeMs);
    mcu.writeDigital(PINS.bPlus, pB > 0, timeMs);
    mcu.writeDigital(PINS.bMinus, pB < 0, timeMs);
  }

  it('advances one full step per Gray transition through real pins', () => {
    const { engine, mcu, stepper } = shaftBench();
    const sequence: Array<readonly [number, number]> = [[1, 1], [-1, 1], [-1, -1], [1, -1], [1, 1]];
    for (const [pA, pB] of sequence) {
      driveCoils(mcu, engine.timeMs, pA, pB);
      engine.settle();
    }
    expect(engine.stepperAngle(stepper.id)).toBeCloseTo(4 * STEP_DEGREES, 6);
  });

  it('holds on repeated states and identical winding levels', () => {
    const { engine, mcu, stepper } = shaftBench();
    driveCoils(mcu, engine.timeMs, 1, 1);
    engine.settle();
    const armed = engine.stepperAngle(stepper.id);
    driveCoils(mcu, engine.timeMs, 1, 1);
    engine.settle();
    expect(engine.stepperAngle(stepper.id)).toBeCloseTo(armed, 6);
    // Both ends of winding A high: zero differential, no edge to count.
    mcu.writeDigital(PINS.aPlus, true, engine.timeMs);
    mcu.writeDigital(PINS.aMinus, true, engine.timeMs);
    engine.settle();
    expect(engine.stepperAngle(stepper.id)).toBeCloseTo(armed, 6);
  });

  it('holds on a two-hop move through fully undriven windings', () => {
    const { engine, mcu, stepper } = shaftBench();
    driveCoils(mcu, engine.timeMs, 1, 1);
    engine.settle();
    const armed = engine.stepperAngle(stepper.id);
    // Sleep both windings, then resume at the next Gray state: the dead
    // intermediate breaks the edge, so nothing counts.
    mcu.writeDigital(PINS.aPlus, false, engine.timeMs);
    mcu.writeDigital(PINS.aMinus, false, engine.timeMs);
    mcu.writeDigital(PINS.bPlus, false, engine.timeMs);
    mcu.writeDigital(PINS.bMinus, false, engine.timeMs);
    engine.settle();
    driveCoils(mcu, engine.timeMs, -1, 1);
    engine.settle();
    expect(engine.stepperAngle(stepper.id)).toBeCloseTo(armed, 6);
  });
});

describe('stepper selection', () => {
  it('selection boxes match the stepper artworks', () => {
    const single = renderedSizeMm(stepperDefinition());
    expect(single.widthMm).toBe(42);
    expect(single.heightMm).toBe(42);
    expect(wokwiPartFor(stepperDefinition())?.tag).toBe('wokwi-stepper-motor');
    const twin = renderedSizeMm(biaxialStepperDefinition());
    expect(twin.widthMm).toBe(56);
    expect(twin.heightMm).toBe(67.5);
    expect(wokwiPartFor(biaxialStepperDefinition())?.tag).toBe('wokwi-biaxial-stepper');
  });
});

describe('biaxial stepper', () => {
  it('exposes eight pins for two axes', () => {
    const def = biaxialStepperDefinition();
    expect(def.pins.map((p) => p.id)).toEqual(['A1-', 'A1+', 'B1+', 'B1-', 'A2-', 'A2+', 'B2+', 'B2-']);
    expect([def.widthMm, def.heightMm]).toEqual([56, 67.5]);
  });

  it('stamps four winding resistors, two per axis', () => {
    const builder = new BenchBuilder();
    builder.addPart(biaxialStepperDefinition(), 200, 0);
    const netlist = buildNetlist(builder.build(), new DynamicState());
    expect(netlist.elements.filter((e) => e.kind === 'resistor' && e.label?.startsWith('winding')).length).toBe(4);
  });

  it('sequences one axis without disturbing the other', () => {
    const builder = new BenchBuilder();
    const esp32 = builder.addPart(esp32DevKitV1(), 0, 0);
    const twin = builder.addPart(biaxialStepperDefinition(), 200, 0);
    const at = (part: PartInstance, pinId: string) => {
      const pin = part.definition.pins.find((p) => p.id === pinId)!;
      return { x: part.x + pin.x, y: part.y + pin.y };
    };
    const gpioPin = (gpio: number) => {
      const id = esp32.definition.boardPins!.find((p) => p.gpio === gpio)!.id;
      const pin = esp32.definition.pins.find((p) => p.id === id)!;
      return { x: pin.x, y: pin.y };
    };
    // Axis 1 coils on gpios 2/4/5/12; axis 2 parked with A2+ high, rest low.
    const axis1: Array<[number, string]> = [[2, 'A1-'], [4, 'A1+'], [5, 'B1+'], [12, 'B1-']];
    for (const [gpio, target] of axis1) {
      const from = gpioPin(gpio);
      const to = at(twin, target);
      builder.addWire(from.x, from.y, to.x, to.y);
    }
    const park: Array<[number, string]> = [[25, 'A2-'], [26, 'A2+'], [27, 'B2+'], [33, 'B2-']];
    for (const [gpio, target] of park) {
      const from = gpioPin(gpio);
      const to = at(twin, target);
      builder.addWire(from.x, from.y, to.x, to.y);
    }
    const mcu = new McuRuntime(esp32.definition);
    for (const gpio of [2, 4, 5, 12, 25, 26, 27, 33]) mcu.setDirection(gpio, 'output');
    const engine = new Engine({ bench: builder.build(), mcu });
    engine.rebuild();
    const drive = (pA: number, pB: number) => {
      mcu.writeDigital(4, pA > 0, engine.timeMs);
      mcu.writeDigital(2, pA < 0, engine.timeMs);
      mcu.writeDigital(5, pB > 0, engine.timeMs);
      mcu.writeDigital(12, pB < 0, engine.timeMs);
    };
    mcu.writeDigital(26, true, engine.timeMs);
    for (const [pA, pB] of [[1, 1], [-1, 1], [-1, -1], [1, -1], [1, 1]] as const) {
      drive(pA, pB);
      engine.settle();
    }
    expect(engine.stepperAngle(twin.id, 1)).toBeCloseTo(4 * STEP_DEGREES, 6);
    expect(engine.stepperAngle(twin.id, 2)).toBeCloseTo(0, 6);
  });
});
