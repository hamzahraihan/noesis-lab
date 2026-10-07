import { describe, expect, it } from 'vitest';
import { BenchBuilder } from '@/features/simulation';
import { columnX, railRowY, stripRowY, breadboardDefinition } from './breadboard';
import { esp32DevKitV1 } from './boards';
import { ledDefinition, resistorDefinition } from './passives';
import { DIODE_PROFILES } from '@/features/simulation';
import { Engine } from '@/features/simulation';
import { McuRuntime } from '@/features/simulation';
import { FirmwareRunner } from '@/features/simulation';
import { measureDutyCycle, measureFrequency } from '@/features/simulation';

const BREADBOARD_ORIGIN_X = 230;
const SIGNAL_COLUMN = 20;

const holeX = (column: number) => BREADBOARD_ORIGIN_X + columnX(column);
const holeY = (row: number): number => stripRowY(row);

/** Runs a jumper between two board points. */
function link(
  builder: BenchBuilder,
  from: { x: number; y: number },
  to: { x: number; y: number },
): void {
  builder.addWire(from.x, from.y, to.x, to.y);
}
/** The bench the app opens with: an ESP32 driving an LED on GPIO2. */
function ledBench() {
  const builder = new BenchBuilder();
  const esp32 = builder.addPart(esp32DevKitV1(), 0, 0);
  builder.addPart(breadboardDefinition(), BREADBOARD_ORIGIN_X, 0);

  const pinAt = (id: string) => esp32.definition.pins.find((pin) => pin.id === id)!;
  const railY = railRowY(2);

  link(builder, pinAt('R_D2'), { x: holeX(SIGNAL_COLUMN), y: holeY(8) });
  builder.addPart(resistorDefinition(330), holeX(SIGNAL_COLUMN), holeY(8) - 2.54);
  // Anode-anchored: the long leg lands on its hole, cathode one column along.
  const scopeLed = ledDefinition(DIODE_PROFILES.red, 'Red');
  const scopeAnode = scopeLed.pins.find((pin) => pin.id === 'anode')!;
  builder.addPart(
    scopeLed,
    holeX(SIGNAL_COLUMN + 4) - scopeAnode.x,
    holeY(8) - scopeAnode.y,
  );
  link(builder, { x: holeX(SIGNAL_COLUMN + 3), y: holeY(8) }, { x: holeX(SIGNAL_COLUMN + 3), y: railY });
  link(builder, pinAt('L_GND'), { x: holeX(10), y: railY });

  const mcu = new McuRuntime(esp32.definition);
  const engine = new Engine({ bench: builder.build(), mcu });
  engine.rebuild();
  return { builder, esp32, mcu, engine };
}

/** Runs a sketch, spending real simulated time on the circuit. */
function runSketch(engine: Engine, mcu: McuRuntime, source: string, ms: number): void {
  const runner = new FirmwareRunner(source, {
    nowMs: () => engine.timeMs,
    pinMode: (pin, mode) => {
      engine.settle();
      mcu.setDirection(pin, mode === 0 ? 'input' : mode === 2 ? 'inputPullUp' : 'output');
    },
    digitalWrite: (pin, level) => {
      mcu.writeDigital(pin, level !== 0, engine.timeMs);
      engine.settle();
    },
    digitalRead: (pin) => {
      engine.settle();
      return engine.readDigital(pin) ? 1 : 0;
    },
    analogWrite: (pin, value) => {
      mcu.writeAnalog(pin, value, engine.timeMs);
      engine.settle();
    },
    analogRead: (pin) => {
      engine.settle();
      return engine.readAnalog(pin);
    },
    serialBegin: () => {},
    serialWrite: () => {},
    spi: { begin: () => {}, transfer: () => 0, end: () => 0 },
    wire: {
      begin: () => {}, beginTransmission: () => {}, write: () => 1, endTransmission: () => 0,
      requestFrom: () => 0, read: () => -1, available: () => 0,
    },
  });

  let guard = 0;
  while (engine.timeMs < ms && guard++ < 20_000) {
    const requested = runner.step();
    if (requested === null) break;
    const remaining = ms - engine.timeMs;
    if (engine.hasDynamics()) {
      const target = engine.timeMs + Math.min(requested, remaining);
      while (engine.timeMs < target) engine.step(0.0001);
    } else {
      engine.skip(Math.min(requested, remaining) / 1000);
    }
  }
}

const PWM_SKETCH = `
void setup() { pinMode(2, OUTPUT); }
void loop() { analogWrite(2, 128); delay(1000); }
`;


/**
 * Probing a live circuit is the most expensive thing the suite does: every
 * sample is a fresh solve of a bench with a whole breadboard on it. The
 * explicit timeout below is the honest cost of that, not a way to paper over a
 * slow assertion.
 */
const PROBE_TEST_TIMEOUT_MS = 20_000;
describe('probing a running circuit', () => {

  it('records the voltages a solve produced on a watched net', () => {
    const { engine, mcu } = ledBench();
    const net = engine.netOfMcuPin('R_D2');
    engine.probes.watch(net);

    mcu.setDirection(2, 'output');
    mcu.writeDigital(2, true, 0);
    engine.settle();

    const samples = engine.probes.waveform(net)!.toArray();
    expect(samples.length).toBeGreaterThan(0);
    expect(samples[samples.length - 1].v).toBeGreaterThan(3.0);
  });

  it('captures nothing on a net with no probe', () => {
    const { engine } = ledBench();
    const net = engine.netOfMcuPin('R_D2');
    engine.settle();
    expect(engine.probes.waveform(net)).toBeUndefined();
  });

  it(
    'measures the PWM frequency a sketch asked for',
    () => {
      const { engine, mcu } = ledBench();
      // The ESP32's LEDC runs at 1 kHz by default.
      const net = engine.netOfMcuPin('R_D2');
      engine.probes.watch(net);

      runSketch(engine, mcu, PWM_SKETCH, 25);

      const frequency = measureFrequency(engine.probes.waveform(net)!.toArray());
      expect(frequency).toBeGreaterThan(850);
      expect(frequency).toBeLessThan(1150);
    },
    PROBE_TEST_TIMEOUT_MS,
  );

  it(
    'measures a duty cycle that tracks what analogWrite asked for',
    () => {
    const dutyAt = (value: number): number => {
      const { engine, mcu } = ledBench();
      const net = engine.netOfMcuPin('R_D2');
      engine.probes.watch(net);
      runSketch(engine, mcu, PWM_SKETCH.replace("128", String(value)), 25);
      return measureDutyCycle(engine.probes.waveform(net)!.toArray());
    };

    const half = dutyAt(128);
    const quarter = dutyAt(64);

    // Compared rather than pinned to a number: the bench takes roughly ten
    // samples per PWM cycle, so an absolute reading depends on where the
    // capture happens to start. What must hold is that a lower duty measures
    // lower. `measureDutyCycle`'s accuracy against a clean signal is covered
    // in probe.test.ts.
    expect(half).toBeGreaterThan(0);
    expect(quarter).toBeLessThan(half);
    expect(quarter).toBeGreaterThan(0);
    },
    PROBE_TEST_TIMEOUT_MS,
  );

  it('follows the pin rather than the rail', () => {
    const { engine, mcu } = ledBench();
    const net = engine.netOfMcuPin('R_D2');
    engine.probes.watch(net);

    mcu.setDirection(2, 'output');
    mcu.writeDigital(2, false, 0);
    engine.settle();

    const samples = engine.probes.waveform(net)!.toArray();
    expect(samples[samples.length - 1].v).toBeLessThan(0.01);
  });
});