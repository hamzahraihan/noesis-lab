// Timer1 PWM acceptance: a worker-compiled analogWrite sketch fades D9.
//
// Gated twice like the gallery Tier-2 fixture (toolchain presence, then
// Tier-2 fetch reachability): without either, the test SKIPs with a reason
// instead of failing. With both, the sketch compiles through the worker
// project path with no extra libraries, flashes onto an AvrBackend over the
// alarm wiring family (Uno + breadboard), and steps; D9 must sit at ~0.5
// duty while the Timer0 path (gpio 5/6) stays digital.
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { boardOption } from '@/features/learn/boardRegistry';
import { firmwareForBuild, galleryById } from '@/features/learn/gallery';
import { breadboardDefinition } from '@/features/parts';
import { Simulation } from '@/features/bench/simulations/simulation';
import { TIER2_MANIFEST } from '@/features/simulation';
import type { AvrBackend } from './core';

/**
 * Whether the Tier-2 fetch path answers at all. Same shape as the gallery
 * fixture gate: any HTTP answer counts as reachable; only a network failure
 * or timeout skips.
 */
async function tier2Reachable(): Promise<boolean> {
  try {
    const response = await fetch(TIER2_MANIFEST[0].url, {
      method: 'HEAD',
      signal: AbortSignal.timeout(5000),
    });
    return response.status > 0;
  } catch {
    return false;
  }
}

describe('timer1 PWM acceptance', () => {
  it('fades D9 under a worker-compiled analogWrite sketch', async () => {
    let pkg: string | null = null;
    try {
      pkg = createRequire(import.meta.url).resolve('@horang-corp/avr-gcc-wasm/package.json');
    } catch { /* fall through to skip */ }
    if (!pkg) {
      console.warn('SKIP fade: toolchain absent');
      return;
    }
    if (!(await tier2Reachable())) {
      console.warn('SKIP fade: Tier-2 fetch unreachable');
      return;
    }
    const sketch = `#include <Arduino.h>\nvoid setup() {}\nvoid loop() { analogWrite(9, 128); }\n`;
    // Alarm wiring family: Uno + breadboard + the alarm project's setup, so
    // the bench around the core matches the gallery legs.
    const alarmSetup = galleryById('alarm-clock')!.builds[0]!.setup;
    const board = boardOption('uno').make();
    const simulation = new Simulation(board);
    simulation.execution = 'avr';
    simulation.addPart(board, 0, 0);
    simulation.addPart(breadboardDefinition(), 230, 0);
    alarmSetup(simulation);
    // Compile via the worker project path with no extra libraries.
    await simulation.compileAndRun(
      firmwareForBuild({ board: 'uno', setup: alarmSetup, sketch }, 'arduino-cpp'),
    );
    expect(simulation.compileState, 'fade sketch compiles').toBe('ready');
    expect(simulation.firmwareError, 'fade sketch firmware').toBeNull();
    const backend = (simulation as unknown as { avrBackend: AvrBackend | null }).avrBackend;
    expect(backend, 'fresh HEX flashes onto a live core').not.toBeNull();
    // Step 50 ms frames on the AvrBackend; analogWrite re-stamps the duty
    // every loop iteration, so the mcu intent converges to the PWM level.
    for (let frame = 0; frame < 3; frame++) backend!.step(50);
    expect(backend!.fault, 'no core fault surfaces').toBeNull();
    const duty9 = simulation.mcu.configurationOf(simulation.mcu.pinIdForGpio(9)!).duty;
    expect(duty9, 'D9 duty ~0.5').toBeGreaterThan(0.48);
    expect(duty9, 'D9 duty ~0.5').toBeLessThan(0.52);
    // Timer0 path untouched: gpio 5/6 stay digital at 0.
    for (const gpio of [5, 6]) {
      const configuration = simulation.mcu.configurationOf(simulation.mcu.pinIdForGpio(gpio)!);
      expect(configuration.pwm, `gpio ${gpio} stays digital`).toBe(false);
      expect(configuration.duty, `gpio ${gpio} stays 0`).toBe(0);
    }
    // Budget: a cold single-TU build compiles the Arduino core plus the
    // sketch TU through the wasm toolchain (measured in minutes, not
    // seconds); the browser reuses its versioned cache across sessions,
    // Node rebuilds every run.
  }, 1_500_000);
});

describe('timer1 input-capture loopback', () => {
  it('counts D7→D8 loopback edges through ICP1 capture', async () => {
    let pkg: string | null = null;
    try {
      pkg = createRequire(import.meta.url).resolve('@horang-corp/avr-gcc-wasm/package.json');
    } catch { /* fall through to skip */ }
    if (!pkg) {
      console.warn('SKIP loopback: toolchain absent');
      return;
    }
    if (!(await tier2Reachable())) {
      console.warn('SKIP loopback: Tier-2 fetch unreachable');
      return;
    }
    // loop() toggles D7 with delay(100): every loopback edge sits 100 ms
    // apart, far above the solve cadence where capture sampling aliases.
    // The ISR counts captures, derives the period from consecutive ICR1
    // values (prescaler 1024 → 64 us per tick), and flips ICES1 after every
    // capture — the standard both-edges technique, so each 100 ms toggle
    // latches regardless of direction. Rising-only would see a 200 ms
    // period and ~5 edges here, which is why the asserts below pin 8–12
    // edges with a 90–110 ms ICR1-derived period instead.
    const sketch = [
      '#include <Arduino.h>',
      // NOTE: no explicit <avr/interrupt.h> — the worker only compiles
      // bundled headers, and Arduino.h already pulls avr/interrupt.h in
      // (ISR, sei, and the TIMER1_CAPT_vect / register symbols below).
      'volatile uint8_t edgeCount = 0;',
      'volatile uint16_t prevCapture = 0;',
      'volatile uint8_t lastPeriodMs = 0;',
      'ISR(TIMER1_CAPT_vect) {',
      '  uint16_t now = ICR1;',
      '  uint16_t delta = now - prevCapture;',
      '  prevCapture = now;',
      '  if (edgeCount > 0) lastPeriodMs = (uint8_t)((delta * 64UL) / 1000UL);',
      '  edgeCount++;',
      '  TCCR1B ^= (1 << ICES1);',
      '}',
      'void setup() {',
      '  pinMode(7, OUTPUT);',
      '  pinMode(8, INPUT);',
      '  TCCR1A = 0;',
      '  TCCR1B = (1 << ICES1) | (1 << CS12) | (1 << CS10);',
      '  TCNT1 = 0;',
      '  TIFR1 = (1 << ICF1);',
      '  TIMSK1 = (1 << ICIE1);',
      '  GPIOR0 = 0;',
      '  GPIOR1 = 0;',
      '  sei();',
      '}',
      'void loop() {',
      '  digitalWrite(7, !digitalRead(7));',
      '  delay(100);',
      '  GPIOR0 = edgeCount;',
      '  GPIOR1 = lastPeriodMs;',
      '}',
      '',
    ].join('\n');
    // Bare Uno + breadboard (no alarm wiring, so D7/D8 are free), with D7
    // wired straight to D8. The project setup token mirrors the fade test;
    // it plays no part in the worker compile.
    const alarmSetup = galleryById('alarm-clock')!.builds[0]!.setup;
    const board = boardOption('uno').make();
    const simulation = new Simulation(board);
    simulation.execution = 'avr';
    simulation.addPart(board, 0, 0);
    simulation.addPart(breadboardDefinition(), 230, 0);
    const d7 = simulation.boardTerminal('D7');
    const d8 = simulation.boardTerminal('D8');
    expect(d7, 'D7 terminal exists').not.toBeNull();
    expect(d8, 'D8 terminal exists').not.toBeNull();
    simulation.routeWire(d7!, d8!);
    // Compile via the worker project path with no extra libraries.
    await simulation.compileAndRun(
      firmwareForBuild({ board: 'uno', setup: alarmSetup, sketch }, 'arduino-cpp'),
    );
    expect(simulation.compileState, 'loopback sketch compiles').toBe('ready');
    expect(simulation.firmwareError, 'loopback sketch firmware').toBeNull();
    const backend = (simulation as unknown as { avrBackend: AvrBackend | null }).avrBackend;
    expect(backend, 'fresh HEX flashes onto a live core').not.toBeNull();
    // Step 800 ms in 40 ms frames (the backend clamp). The backend ticks
    // once per executed instruction while each instruction retires 1+
    // cycles, so firmware time runs ahead of the step budget (measured ~13
    // toggles per 1000 ms of stepping); 800 ms centers ~10 loopback edges
    // in the 8–12 window at 100 ms spacing.
    for (let frame = 0; frame < 20; frame++) backend!.step(40);
    expect(backend!.fault, 'no core fault surfaces').toBeNull();
    // The ISR count and period are mirrored to GPIOR0/GPIOR1 (data 0x3E /
    // 0x4A — I/O 0x1E / 0x2A), the only firmware state at fixed addresses
    // the test can read.
    const cpu = (backend! as unknown as { cpu: { data: Uint8Array } }).cpu;
    const edges = cpu.data[0x3e];
    expect(edges, 'loopback edges counted').toBeGreaterThanOrEqual(8);
    expect(edges, 'loopback edges counted').toBeLessThanOrEqual(12);
    const periodMs = cpu.data[0x4a];
    expect(periodMs, 'ICR1-derived period ms').toBeGreaterThanOrEqual(90);
    expect(periodMs, 'ICR1-derived period ms').toBeLessThanOrEqual(110);
    // Budget: same cold single-TU worker compile as the fade leg above.
  }, 1_500_000);
});

describe('dashboard servo HEX acceptance', () => {
  it('drives the horn to 45 under a worker-compiled Servo sketch', async () => {
    let pkg: string | null = null;
    try {
      pkg = createRequire(import.meta.url).resolve('@horang-corp/avr-gcc-wasm/package.json');
    } catch { /* fall through to skip */ }
    if (!pkg) {
      console.warn('SKIP servo: toolchain absent');
      return;
    }
    if (!(await tier2Reachable())) {
      console.warn('SKIP servo: Tier-2 fetch unreachable');
      return;
    }
    // Servo is a Tier-1 provided library (bundled in the toolchain, declared
    // here through the provided-source pattern): no fetch, no vendored driver.
    // attach(pin, 1000, 2000) pins the pulse window to the decoder's own
    // 1000–2000 us scale, so write(45) emits a 1250 us pulse and must read 45.
    const sketch = [
      '#include <Arduino.h>',
      '#include <Servo.h>',
      'Servo horn;',
      'void setup() {',
      '  horn.attach(19, 1000, 2000);',
      '  horn.write(90);',
      '  pinMode(6, OUTPUT);',
      '  pinMode(7, OUTPUT);',
      '  pinMode(8, OUTPUT);',
      '}',
      'void loop() {',
      '  delay(1000);',
      '  horn.write(45);',
      '  digitalWrite(6, HIGH);',
      '  digitalWrite(7, LOW);',
      '  digitalWrite(8, HIGH);',
      '  delay(1000);',
      '}',
      '',
    ].join('\n');
    // Dashboard wiring family: Uno + breadboard + the dashboard project's
    // setup (servo on gpio 19, slide pot, three sink-wired LEDs on D6/D7/D8).
    const dashboardSetup = galleryById('dashboard')!.builds[0]!.setup;
    const board = boardOption('uno').make();
    const simulation = new Simulation(board);
    simulation.execution = 'avr';
    simulation.addPart(board, 0, 0);
    simulation.addPart(breadboardDefinition(), 230, 0);
    dashboardSetup(simulation);
    // Compile via the worker project path with the Servo library declared.
    await simulation.compileAndRun(
      firmwareForBuild(
        {
          board: 'uno',
          setup: dashboardSetup,
          sketch,
          libraries: [{ name: 'Servo', source: 'provided' }],
        },
        'arduino-cpp',
      ),
    );
    expect(simulation.compileState, 'servo sketch compiles').toBe('ready');
    expect(simulation.firmwareError, 'servo sketch firmware').toBeNull();
    const backend = (simulation as unknown as { avrBackend: AvrBackend | null }).avrBackend;
    expect(backend, 'fresh HEX flashes onto a live core').not.toBeNull();
    // Step 2 sim-seconds in 40 ms frames (the backend clamp). The first loop
    // writes 45 at t=1 s, so every completed pulse after that is 1250 us.
    for (let frame = 0; frame < 50; frame++) backend!.step(40);
    expect(backend!.fault, 'no core fault surfaces').toBeNull();
    const hornPart = simulation.bench.parts.find(
      (part) => part.definition.component.kind === 'servo',
    );
    expect(hornPart, 'dashboard servo is on the bench').toBeDefined();
    expect(simulation.engine.servo(hornPart!.id)!.angle, 'horn follows the 45-degree pulse').toBe(45);
    // Sink wiring (anode to 5V): the lit MID LED's pin sits LOW, the dark
    // LOW/HIGH pins sit HIGH.
    for (const [gpio, duty] of [
      [6, 1],
      [7, 0],
      [8, 1],
    ] as const) {
      const configuration = simulation.mcu.configurationOf(simulation.mcu.pinIdForGpio(gpio)!);
      expect(configuration.duty, `gpio ${gpio} duty`).toBe(duty);
    }
    const pinVolts = (gpio: number): number => {
      const pinId = simulation.mcu.pinIdForGpio(gpio)!;
      return simulation.engine.voltageOfNet(simulation.engine.netOfMcuPin(pinId));
    };
    expect(pinVolts(7), 'MID LED net lit (pin sinks)').toBeLessThan(1);
    expect(pinVolts(6), 'LOW LED net dark').toBeGreaterThan(4);
    expect(pinVolts(8), 'HIGH LED net dark').toBeGreaterThan(4);
    // Budget: same cold worker compile as the fade leg above, plus the Servo
    // library TU.
  }, 1_500_000);
});
