// Servo pulse decoder: scripted GPIO edges through a real Engine + servo part.
//
// The edges stand in for the cycle-stamped transitions the GPIO bridge reports
// (cpu.cycles, 16000 per ms); the width-to-angle mapping itself runs unmocked
// through the engine pump into the existing Servo model.
import { describe, expect, it } from 'vitest';
import { BenchBuilder, Engine, McuRuntime } from '@/features/simulation';
import { DynamicState } from '@/features/parts';
import { arduinoUnoR3 } from '@/features/parts/boards';
import { servoDefinition } from '@/features/parts';

/** Servo signal gpio, matching the dashboard gallery's HORN_PIN. */
const SERVO_GPIO = 19;
/** Uno 16 MHz clock: cycles per millisecond of sim time. */
const CYCLES_PER_MS = 16000;

function servoBench() {
  const builder = new BenchBuilder();
  const uno = builder.addPart(arduinoUnoR3(), 0, 0);
  const horn = builder.addPart(servoDefinition(), 330, 120);
  const mcu = new McuRuntime(uno.definition);
  const pinXY = (id: string): { x: number; y: number } => {
    const found = uno.definition.pins.find((pin) => pin.id === id);
    if (!found || found.x === undefined || found.y === undefined) {
      throw new Error(`uno pin ${id} has no position`);
    }
    return { x: found.x, y: found.y };
  };
  const signal = builder.build().terminals[horn.terminals.PWM];
  const ground = builder.build().terminals[horn.terminals.GND];
  if (!signal || !ground) throw new Error('servo terminals missing');
  const signalPin = pinXY(mcu.pinIdForGpio(SERVO_GPIO)!);
  const groundPin = pinXY(uno.definition.boardPins?.find((pin) => pin.role === 'ground')?.id ?? '');
  builder.addWire(signal.x, signal.y, signalPin.x, signalPin.y);
  builder.addWire(ground.x, ground.y, groundPin.x, groundPin.y);
  const bench = builder.build();
  const engine = new Engine({ bench, mcu, dynamicState: new DynamicState() });
  engine.rebuild();
  return { engine, mcu, horn };
}

/** Scripted clock feeding one pulse: rise now, fall widthUs later, then solve. */
function drivePulse(
  engine: Engine,
  mcu: McuRuntime,
  state: { tMs: number },
  widthUs: number,
): void {
  const riseMs = state.tMs;
  mcu.writeDigital(SERVO_GPIO, true, engine.timeMs);
  engine.recordGpioEdge(SERVO_GPIO, Math.round(riseMs * CYCLES_PER_MS));
  const fallMs = riseMs + widthUs / 1000;
  mcu.writeDigital(SERVO_GPIO, false, engine.timeMs);
  engine.recordGpioEdge(SERVO_GPIO, Math.round(fallMs * CYCLES_PER_MS));
  engine.settle();
  state.tMs = fallMs + 20;
}

describe('servo pulse decoder', () => {
  it('maps a 1.5 ms pulse to 90 degrees', () => {
    const { engine, mcu, horn } = servoBench();
    const state = { tMs: 10 };
    // Off-centre first, so the 90 below proves the mapping rather than the rest pose.
    drivePulse(engine, mcu, state, 1000);
    expect(engine.servo(horn.id)!.angle).toBe(10);
    drivePulse(engine, mcu, state, 1500);
    expect(engine.servo(horn.id)!.angle).toBe(90);
  });

  it('holds the last angle through silence', () => {
    const { engine, mcu, horn } = servoBench();
    const state = { tMs: 10 };
    drivePulse(engine, mcu, state, 1500);
    expect(engine.servo(horn.id)!.angle).toBe(90);
    const load = engine.servo(horn.id)!.loadOhms;
    // Half a second of solves with no edges: the horn stays put and the part
    // keeps drawing its driven current rather than dropping to quiescent.
    for (let i = 0; i < 25; i++) engine.step(0.02);
    expect(engine.servo(horn.id)!.angle).toBe(90);
    expect(engine.servo(horn.id)!.loadOhms).toBe(load);
    expect(engine.servo(horn.id)!.loadOhms).toBeCloseTo(5 / 0.1, 6);
  });

  it('ignores noise widths outside 500–2500 us', () => {
    const { engine, mcu, horn } = servoBench();
    const state = { tMs: 10 };
    drivePulse(engine, mcu, state, 1500);
    expect(engine.servo(horn.id)!.angle).toBe(90);
    drivePulse(engine, mcu, state, 100);
    expect(engine.servo(horn.id)!.angle).toBe(90);
    drivePulse(engine, mcu, state, 5000);
    expect(engine.servo(horn.id)!.angle).toBe(90);
  });
});
