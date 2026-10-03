import { describe, expect, it } from 'vitest';
import { BenchBuilder, type PartInstance } from './bench';
import { esp32DevKitV1 } from './boards';
import { McuRuntime } from './mcu';
import { Engine } from './engine';
import { STEP_DEGREES, stepperDefinition, stepTransition } from './stepper';

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

describe('stepper shaft', () => {
  const PINS = { aMinus: 2, aPlus: 4, bPlus: 5, bMinus: 12 };

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
});
