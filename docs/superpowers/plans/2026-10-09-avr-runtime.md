# AVR Runtime (Plan A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the bundled alarm-clock Uno sketch on a real AVR core (avr8js) through the existing device models, with the interpreter as untouched default.

**Architecture:** New `src/features/simulation/avr/` module. `AvrBackend` implements a new `ExecutionBackend` seam (`step`/`reset`/`fault`); `GpioBridge` pushes PORTx/DDRx edges into `McuRuntime` and serves PINx reads from settled engine state; `MmioTrap` routes shim-core Serial/Wire writes into the existing serial buffer and `Ds1307` model; `Simulation` branches on an `execution` flag. Engine, interpreter, and all models untouched.

**Tech Stack:** TypeScript, Vitest, `avr8js@0.21.1` (MIT, spike-proven in `G:/Temp/avr-spike/spike.cjs`), existing `McuRuntime`/`Engine`/`I2CBus`/`Ds1307`.

**Spec:** `docs/superpowers/specs/2026-10-09-avr-hybrid-backend-design.md`

## Global Constraints

- Interpreter path stays byte-identical: default `execution` is `'interpreter'`; all 638 current tests stay green.
- Engine and device models are read-only: no edits under `src/features/simulation/` except `src/features/bench/simulation.ts` integration points.
- `avr8js` version pinned to `0.21.1` (the spike-proven version).
- AVR data addresses (decimal): PINB 35, DDRB 36, PORTB 37; PINC 38, DDRC 39, PORTC 40; PIND 41, DDRD 42, PORTD 43.
- Uno gpio map: PORTD bit i → gpio i; PORTB bit i → gpio 8+i; PORTC bit i → gpio 14+i.
- Cycles per ms derived as `boardClockHz / 1000` (Uno 16MHz → 16,000), never a bare constant.
- Every task ends in a commit; test commands are `npx vitest run <file>` and `npx tsc -b`.

## Review Focus

- Sketch using EEPROM/ADC/PWM/interrupts on the avr backend silently does nothing (shim has no such peripherals; expect a logged refusal, not a hang) — pinned in Task 8.
- Non-Uno board with `execution: 'avr'` must fall back to interpreter, never crash — pinned in Task 8.
- Checked-in HEX older than sketch sources must be caught by the manifest hash check — pinned in Task 7.
- Button held during a tick boundary reads consistently on both backends — pinned in Task 9.
- Missing toolchain/HEX must skip (never fail) HEX-gated tests with an explicit reason — pinned in Task 7.

---

### Task 1: Dependency + ExecutionBackend seam + gpio map

**Files:**
- Modify: `package.json` (add `"avr8js": "0.21.1"` under dependencies)
- Create: `src/features/simulation/avr/backend.ts`
- Create: `src/features/simulation/avr/avr.test.ts`

**Interfaces:**
- Consumes: nothing (new seam).
- Produces: `ExecutionBackend` interface (`step(budgetMs: number): void`, `reset(): void`, `readonly fault: string | null`); `UNO_GPIO_MAP: ReadonlyArray<{ port: 'B' | 'C' | 'D'; bit: number; gpio: number }>` (24 entries); `UNO_CLOCK_HZ = 16_000_000`; `cyclesPerMs(clockHz: number): number`.

**Deviation from spec (explicit):** no `InterpreterBackend` adapter wrapper. `Simulation.tick` branches on the flag instead, so the interpreter path stays byte-identical per the spec's own no-touch rule. The interface still constrains `AvrBackend` and documents the seam.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { UNO_GPIO_MAP, UNO_CLOCK_HZ, cyclesPerMs } from './backend';

describe('avr seam', () => {
  it('maps every Uno digital gpio to its port bit', () => {
    expect(UNO_GPIO_MAP).toHaveLength(20);
    expect(UNO_GPIO_MAP.find((m) => m.gpio === 13)).toEqual({ port: 'B', bit: 5, gpio: 13 });
    expect(UNO_GPIO_MAP.find((m) => m.gpio === 0)).toEqual({ port: 'D', bit: 0, gpio: 0 });
    expect(UNO_GPIO_MAP.find((m) => m.gpio === 14)).toEqual({ port: 'C', bit: 0, gpio: 14 });
  });

  it('derives cycles per ms from the board clock', () => {
    expect(UNO_CLOCK_HZ).toBe(16_000_000);
    expect(cyclesPerMs(UNO_CLOCK_HZ)).toBe(16_000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/simulation/avr/avr.test.ts`
Expected: FAIL with "Failed to resolve import ./backend" (after `npm install` for the dep step below, the import error is about the missing module, not the package).

- [ ] **Step 3: Install the dependency**

Run: `npm install avr8js@0.21.1`
Expected: `package.json` gains `"avr8js": "0.21.1"`; `package-lock.json` updated.

- [ ] **Step 4: Write minimal implementation**

```ts
/** The seam Simulation programs to. One implementer today (AvrBackend); the
 * interpreter path stays inline in Simulation per the no-touch rule. */
export interface ExecutionBackend {
  step(budgetMs: number): void;
  reset(): void;
  readonly fault: string | null;
}

export interface GpioMapEntry {
  readonly port: 'B' | 'C' | 'D';
  readonly bit: number;
  readonly gpio: number;
}

function* gpioEntries(): Generator<GpioMapEntry> {
  for (let bit = 0; bit < 8; bit++) yield { port: 'D', bit, gpio: bit };
  for (let bit = 0; bit < 6; bit++) yield { port: 'B', bit, gpio: 8 + bit };
  for (let bit = 0; bit < 6; bit++) yield { port: 'C', bit, gpio: 14 + bit };
}

export const UNO_GPIO_MAP: ReadonlyArray<GpioMapEntry> = [...gpioEntries()];
export const UNO_CLOCK_HZ = 16_000_000;
export function cyclesPerMs(clockHz: number): number {
  return Math.round(clockHz / 1000);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/features/simulation/avr/avr.test.ts`
Expected: PASS (2 tests). Run: `npx tsc -b`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/features/simulation/avr/backend.ts src/features/simulation/avr/avr.test.ts
git commit -m "feat(avr): add avr8js dep and ExecutionBackend seam with Uno gpio map"
```

### Task 2: GpioBridge push path (core writes → McuRuntime)

**Files:**
- Create: `src/features/simulation/avr/gpio.ts`
- Modify: `src/features/simulation/avr/avr.test.ts` (append describe block)

**Interfaces:**
- Consumes: `UNO_GPIO_MAP` from `./backend`; `CPU`, `AVRIOPort`, `portBConfig`, `portCConfig`, `portDConfig` from `'avr8js'`; `McuRuntime` type from `@/features/simulation/mcu` (only `setDirection(gpio, dir)` and `writeDigital(gpio, high, timeMs)` are called).
- Produces: `attachGpioBridge(cpu: CPU, mcu: McuRuntime, nowMs: () => number): void` — subscribes port listeners; on any PORT/DDR change recomputes direction+level per mapped bit: DDR=1 → `'output'` with level PORT bit; DDR=0 + PORT=1 → `'inputPullUp'`; else `'input'`.

- [ ] **Step 1: Write the failing test**

```ts
import { CPU, AVRIOPort, portBConfig, portDConfig } from 'avr8js';
import { McuRuntime } from '@/features/simulation/mcu';
import { arduinoUnoR3 } from '@/features/parts/boards';
import { attachGpioBridge } from './gpio';

describe('gpio push path', () => {
  it('drives D13 output high on PORTB bit 5', () => {
    const cpu = new CPU(new Uint16Array(64));
    new AVRIOPort(cpu, portBConfig);
    new AVRIOPort(cpu, portDConfig);
    const mcu = new McuRuntime(arduinoUnoR3());
    attachGpioBridge(cpu, mcu, () => 0);
    cpu.writeData(36, 0x20); // DDRB bit 5: output
    cpu.writeData(37, 0x20); // PORTB bit 5: high
    expect(mcu.configurationOf('J1_D13').direction).toBe('output');
  });
});
```

Note: `arduinoUnoR3` board-pin id for gpio 13 — if the id differs, read it from `src/features/parts/boards.ts` (the `McuRuntime.pinIdForGpio(13)` helper gives it; prefer `mcu.configurationOf(mcu['pinIdForGpio']...)` only via the public `pinIdForGpio(13)` method). Adjust the test to resolve the id via `mcu.pinIdForGpio(13)!` rather than hard-coding. Verify `pinIdForGpio` is public on `McuRuntime` (it is: `mcu.ts` line ~160).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/simulation/avr/avr.test.ts`
Expected: FAIL with "Failed to resolve import ./gpio".

- [ ] **Step 3: Write minimal implementation**

```ts
import { CPU, AVRIOPort, portBConfig, portCConfig, portDConfig } from 'avr8js';
import { McuRuntime, type PinDirection } from '@/features/simulation/mcu';
import { UNO_GPIO_MAP } from './backend';

const PORTS = { B: portBConfig, C: portCConfig, D: portDConfig } as const;

/** Pushes AVR DDR/PORT state into McuRuntime intent on every change. */
export function attachGpioBridge(cpu: CPU, mcu: McuRuntime, nowMs: () => number): void {
  const ports = {
    B: new AVRIOPort(cpu, PORTS.B),
    C: new AVRIOPort(cpu, PORTS.C),
    D: new AVRIOPort(cpu, PORTS.D),
  };
  const sync = (): void => {
    for (const entry of UNO_GPIO_MAP) {
      const ddr = (cpu.data[portDataAddr(entry.port, 'ddr')] >> entry.bit) & 1;
      const port = (cpu.data[portDataAddr(entry.port, 'port')] >> entry.bit) & 1;
      const direction: PinDirection = ddr === 1 ? 'output' : port === 1 ? 'inputPullUp' : 'input';
      mcu.setDirection(entry.gpio, direction);
      if (direction === 'output') mcu.writeDigital(entry.gpio, port === 1, nowMs());
    }
  };
  for (const port of Object.values(ports)) port.addListener(() => sync());
  sync();
}

function portDataAddr(port: 'B' | 'C' | 'D', reg: 'ddr' | 'port'): number {
  // AVR data addresses (decimal): DDRB 36, PORTB 37, DDRC 39, PORTC 40, DDRD 42, PORTD 43.
  if (port === 'B') return reg === 'ddr' ? 36 : 37;
  if (port === 'C') return reg === 'ddr' ? 39 : 40;
  return reg === 'ddr' ? 42 : 43;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/simulation/avr/avr.test.ts`
Expected: PASS. Run: `npx tsc -b`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/features/simulation/avr/gpio.ts src/features/simulation/avr/avr.test.ts
git commit -m "feat(avr): push AVR DDR/PORT state into McuRuntime"
```

### Task 3: GpioBridge read path (PINx ← settled engine)

**Files:**
- Modify: `src/features/simulation/avr/gpio.ts`
- Modify: `src/features/simulation/avr/avr.test.ts` (append describe block)

**Interfaces:**
- Consumes: `attachGpioBridge` signature extended with a fourth argument `readPin: (gpio: number) => boolean`.
- Produces: same `attachGpioBridge(cpu, mcu, nowMs, readPin)`; on PINx hook reads it settles via the caller (the trap calls `readPin`, and `AvrBackend` in Task 6 passes a settle-then-`engine.readDigital` closure). Inside this task, `readPin` is an injected stub in tests.

Implementation detail (exact): register `cpu.readHooks[35]`, `[38]`, `[41]` (PINB/PINC/PIND data addresses). Each hook builds its byte: for each mapped bit of that port, `readPin(gpio) ? 1 : 0`. Return the byte. Note `cpu.js` only consults `readHooks` for `addr >= 32`; all three qualify.

- [ ] **Step 1: Write the failing test**

```ts
describe('gpio read path', () => {
  it('serves PINB bit 5 from the injected reader', () => {
    const cpu = new CPU(new Uint16Array(64));
    new AVRIOPort(cpu, portBConfig);
    new AVRIOPort(cpu, portDConfig);
    const mcu = new McuRuntime(arduinoUnoR3());
    let pressed = false;
    attachGpioBridge(cpu, mcu, () => 0, (gpio) => (gpio === 13 ? pressed : false));
    expect(cpu.readData(35) & 0x20).toBe(0);
    pressed = true;
    expect(cpu.readData(35) & 0x20).toBe(0x20);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/simulation/avr/avr.test.ts`
Expected: FAIL (attachGpioBridge takes 3 args; read path unimplemented — `cpu.readData(35)` returns 0 either way, second assertion fails).

- [ ] **Step 3: Write minimal implementation**

Extend `attachGpioBridge` with `readPin: (gpio: number) => boolean` and after the listener setup add:

```ts
const pinAddr = { B: 35, C: 38, D: 41 } as const;
for (const [port, addr] of Object.entries(pinAddr) as Array<['B' | 'C' | 'D', number]>) {
  cpu.readHooks[addr] = () => {
    let byte = 0;
    for (const entry of UNO_GPIO_MAP) {
      if (entry.port === port && readPin(entry.gpio)) byte |= 1 << entry.bit;
    }
    return byte;
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/simulation/avr/avr.test.ts`
Expected: PASS. Run: `npx tsc -b`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/features/simulation/avr/gpio.ts src/features/simulation/avr/avr.test.ts
git commit -m "feat(avr): serve AVR PINx reads from injected pin reader"
```

### Task 4: AvrBackend timing core (cycles, slices, clamp, reset)

**Files:**
- Create: `src/features/simulation/avr/core.ts`
- Modify: `src/features/simulation/avr/avr.test.ts` (append describe block)

**Interfaces:**
- Consumes: `ExecutionBackend` from `./backend`; `cyclesPerMs`, `UNO_CLOCK_HZ` from `./backend`; `CPU`, `avrInstruction` from `'avr8js'`; `attachGpioBridge` from `./gpio`.
- Produces: `class AvrBackend implements ExecutionBackend` with `constructor(programWords: Uint16Array, hooks: AvrHooks)` where `AvrHooks = { mcu: McuRuntime; nowMs: () => number; readPin: (gpio: number) => boolean; onSettle: () => void }`; `step(budgetMs)` runs `cyclesPerMs(UNO_CLOCK_HZ) * budgetMs` cycles as `avrInstruction(cpu); cpu.tick();` with `onSettle()` called at each whole-ms boundary; carries fractional-ms remainder to the next call; clamps a single `step()` to 40ms (mirrors `MAX_FRAME_MS = 40` in `simulation.ts:64`) with the excess dropped and counted in `clampedMs`; `reset()` rebuilds CPU state from the original words and zeroes cycles; `fault` starts null.

Millis source (exact, no Timer0 peripheral): `cpu.addClockEvent(() => { msCounter += 1; }, cyclesPerMs(UNO_CLOCK_HZ))` re-armed each fire (avr8js clock events are one-shot; re-arm inside the callback). Expose `millis()` for the shim in Task 7 via `readHooks` on a reserved address (address chosen in Task 5 with the trap map — use `0x1F0`).

- [ ] **Step 1: Write the failing test**

```ts
import { AvrBackend } from './core';

describe('avr timing core', () => {
  it('advances 16000 cycles per ms and settles per ms', () => {
    const backend = new AvrBackend(new Uint16Array(64), {
      mcu: new McuRuntime(arduinoUnoR3()),
      nowMs: () => 0,
      readPin: () => false,
      onSettle: () => settles++,
    });
    // (declare `let settles = 0;` before construction)
    backend.step(2.5);
    expect(backend.cycles).toBe(40_000);
    expect(settles).toBe(2);
    backend.step(0.5);
    expect(settles).toBe(3); // carried 0.5 + 0.5 completes the ms
  });

  it('clamps a single step to 40ms', () => {
    const backend = /* ...same construction... */;
    backend.step(1000);
    expect(backend.cycles).toBe(40 * 16_000);
    expect(backend.clampedMs).toBeGreaterThan(0);
  });
});
```

Write both tests with their own `settles` counter and construction (no shared helpers — each test reads standalone).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/simulation/avr/avr.test.ts`
Expected: FAIL with "Failed to resolve import ./core".

- [ ] **Step 3: Write minimal implementation**

```ts
import { CPU, avrInstruction } from 'avr8js';
import type { McuRuntime } from '@/features/simulation/mcu';
import { UNO_CLOCK_HZ, cyclesPerMs, type ExecutionBackend } from './backend';
import { attachGpioBridge } from './gpio';

export interface AvrHooks {
  readonly mcu: McuRuntime;
  readonly nowMs: () => number;
  readonly readPin: (gpio: number) => boolean;
  readonly onSettle: () => void;
}

/** Single step clamp, mirroring MAX_FRAME_MS in bench/simulation.ts. */
export const MAX_STEP_MS = 40;

export class AvrBackend implements ExecutionBackend {
  private cpu: CPU;
  private msCarry = 0;
  private msCounter = 0;
  clampedMs = 0;
  private failed: string | null = null;

  constructor(
    private readonly programWords: Uint16Array,
    private readonly hooks: AvrHooks,
  ) {
    this.cpu = this.buildCpu();
  }

  get fault(): string | null {
    return this.failed;
  }

  get cycles(): number {
    return this.cpu.cycles;
  }

  millis(): number {
    return this.msCounter;
  }

  step(budgetMs: number): void {
    if (this.failed) return;
    const clamped = Math.min(Math.max(budgetMs, 0), MAX_STEP_MS);
    if (budgetMs > MAX_STEP_MS) this.clampedMs += budgetMs - MAX_STEP_MS;
    const perMs = cyclesPerMs(UNO_CLOCK_HZ);
    let ms = this.msCarry + clamped;
    const settleEvery = perMs;
    let sinceSettle = 0;
    const totalCycles = Math.floor(ms * perMs);
    for (let i = 0; i < totalCycles; i++) {
      try {
        avrInstruction(this.cpu);
        this.cpu.tick();
      } catch (error) {
        this.failed = `core fault at PC=${this.cpu.pc} cycles=${this.cpu.cycles}: ${String(error)}`;
        return;
      }
      sinceSettle += 1;
      if (sinceSettle >= settleEvery) {
        sinceSettle = 0;
        this.hooks.onSettle();
      }
    }
    const consumedMs = totalCycles / perMs;
    this.msCarry = ms - consumedMs;
    if (sinceSettle > 0) this.hooks.onSettle();
  }

  reset(): void {
    this.cpu = this.buildCpu();
    this.msCarry = 0;
    this.msCounter = 0;
    this.clampedMs = 0;
    this.failed = null;
  }

  private buildCpu(): CPU {
    const cpu = new CPU(new Uint16Array(this.programWords));
    attachGpioBridge(cpu, this.hooks.mcu, this.hooks.nowMs, this.hooks.readPin);
    const perMs = cyclesPerMs(UNO_CLOCK_HZ);
    const tickMs = (): void => {
      this.msCounter += 1;
      cpu.addClockEvent(tickMs, perMs);
    };
    cpu.addClockEvent(tickMs, perMs);
    return cpu;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/simulation/avr/avr.test.ts`
Expected: PASS. Run: `npx tsc -b`
Expected: clean. Measure: add a wall-clock assertion? No — keep the suite fast; perf is guarded in Task 9.

- [ ] **Step 5: Commit**

```bash
git add src/features/simulation/avr/core.ts src/features/simulation/avr/avr.test.ts
git commit -m "feat(avr): add AvrBackend timing core with ms slicing and clamp"
```

### Task 5: MmioTrap Serial path

**Files:**
- Create: `src/features/simulation/avr/trap.ts`
- Modify: `src/features/simulation/avr/avr.test.ts` (append describe block)

**Interfaces:**
- Consumes: `CPU` from `'avr8js'`.
- Produces: `SERIAL_TX_ADDR = 0x1F0`, `MILLIS_ADDR = 0x1F1`; `attachMmioTrap(cpu, sink)` where `sink = { serialWrite(text: string): void; millis(): number }`; writes to `SERIAL_TX_ADDR` append the byte as a char via `serialWrite`; reads of `MILLIS_ADDR` return `millis() & 0xff` (4 consecutive reads assemble LE32 — document this contract for the shim in Task 7).

- [ ] **Step 1: Write the failing test**

```ts
import { SERIAL_TX_ADDR, MILLIS_ADDR, attachMmioTrap } from './trap';

describe('mmio trap serial path', () => {
  it('forwards serial bytes as text', () => {
    const cpu = new CPU(new Uint16Array(64));
    const out: string[] = [];
    attachMmioTrap(cpu, { serialWrite: (t) => out.push(t), millis: () => 0 });
    cpu.writeData(SERIAL_TX_ADDR, 65); // 'A'
    cpu.writeData(SERIAL_TX_ADDR, 66); // 'B'
    expect(out.join('')).toBe('AB');
  });

  it('serves millis as LE32 across four reads', () => {
    const cpu = new CPU(new Uint16Array(64));
    attachMmioTrap(cpu, { serialWrite: () => {}, millis: () => 0x01020304 });
    const bytes = [0, 1, 2, 3].map((i) => cpu.readData(MILLIS_ADDR + i));
    expect(bytes).toEqual([0x04, 0x03, 0x02, 0x01]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/simulation/avr/avr.test.ts`
Expected: FAIL with "Failed to resolve import ./trap".

- [ ] **Step 3: Write minimal implementation**

```ts
import type { CPU } from 'avr8js';

/** Serial TX: shim writes one byte per char. SRAM-safe (ATmega328P SRAM starts 0x100). */
export const SERIAL_TX_ADDR = 0x1f0;
/** Millis base: four consecutive LE bytes assemble millis() as LE32. */
export const MILLIS_ADDR = 0x1f1;

export interface MmioSink {
  serialWrite(text: string): void;
  millis(): number;
}

/** Traps shim-core MMIO writes/reads. Malformed use is counted by the caller (Task 8). */
export function attachMmioTrap(cpu: CPU, sink: MmioSink): void {
  cpu.writeHooks[SERIAL_TX_ADDR] = (value) => {
    sink.serialWrite(String.fromCharCode(value & 0xff));
  };
  for (let i = 0; i < 4; i++) {
    const addr = MILLIS_ADDR + i;
    cpu.readHooks[addr] = () => (sink.millis() >>> (8 * i)) & 0xff;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/simulation/avr/avr.test.ts`
Expected: PASS. Run: `npx tsc -b`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/features/simulation/avr/trap.ts src/features/simulation/avr/avr.test.ts
git commit -m "feat(avr): add MMIO trap for shim Serial and millis"
```

### Task 6: MmioTrap Wire path (packets → engine I2C)

**Files:**
- Modify: `src/features/simulation/avr/trap.ts`
- Modify: `src/features/simulation/avr/avr.test.ts` (append describe block)

**Interfaces:**
- Consumes: `attachMmioTrap(cpu, sink)` extended: `sink` gains `i2cWrite(address: number, bytes: number[]): void` and `i2cRead(address: number, count: number): number[]`.
- Produces: same function; new addresses `WIRE_TX_ADDR = 0x1F5` (write byte: `[address, len, ...bytes]` framed — shim writes address, then count, then bytes; trap buffers until complete and calls `i2cWrite` once) and `WIRE_RX_ADDR = 0x1F9` (shim writes `[address, count]` to request, then reads bytes back one per read; trap calls `i2cRead` at request time and stages the response).

Framing protocol (exact, mirrored in the shim task):
- TX: write `WIRE_TX_ADDR` ← address; write `WIRE_TX_ADDR` ← count N; write N bytes → one `i2cWrite(address, bytes)` call.
- RX: write `WIRE_RX_ADDR` ← address; write `WIRE_RX_ADDR` ← count → one `i2cRead(address, count)` call, response staged; each read of `WIRE_RX_ADDR` pops the next staged byte (0x00 past the end).

- [ ] **Step 1: Write the failing test**

```ts
describe('mmio trap wire path', () => {
  it('frames an I2C write transaction', () => {
    const cpu = new CPU(new Uint16Array(64));
    const writes: Array<{ address: number; bytes: number[] }> = [];
    attachMmioTrap(cpu, {
      serialWrite: () => {},
      millis: () => 0,
      i2cWrite: (address, bytes) => writes.push({ address, bytes }),
      i2cRead: () => [],
    });
    cpu.writeData(WIRE_TX_ADDR, 0x68);
    cpu.writeData(WIRE_TX_ADDR, 2);
    cpu.writeData(WIRE_TX_ADDR, 0x00);
    cpu.writeData(WIRE_TX_ADDR, 0x11);
    expect(writes).toEqual([{ address: 0x68, bytes: [0x00, 0x11] }]);
  });

  it('stages an I2C read response', () => {
    const cpu = new CPU(new Uint16Array(64));
    attachMmioTrap(cpu, {
      serialWrite: () => {},
      millis: () => 0,
      i2cWrite: () => {},
      i2cRead: (address, count) => (address === 0x68 ? [1, 2, 3].slice(0, count) : []),
    });
    cpu.writeData(WIRE_RX_ADDR, 0x68);
    cpu.writeData(WIRE_RX_ADDR, 3);
    expect([cpu.readData(WIRE_RX_ADDR), cpu.readData(WIRE_RX_ADDR), cpu.readData(WIRE_RX_ADDR)]).toEqual([1, 2, 3]);
    expect(cpu.readData(WIRE_RX_ADDR)).toBe(0x00);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/simulation/avr/avr.test.ts`
Expected: FAIL (`WIRE_TX_ADDR` not exported; sink type lacks i2c methods).

- [ ] **Step 3: Write minimal implementation**

Extend `trap.ts` (keep Task 5 code verbatim, add below it):

```ts
/** Wire TX framer: address, count, then bytes → one i2cWrite call. */
export const WIRE_TX_ADDR = 0x1f5;
/** Wire RX: address, count → i2cRead staged; reads pop staged bytes. */
export const WIRE_RX_ADDR = 0x1f9;

export interface MmioI2cSink {
  i2cWrite(address: number, bytes: number[]): void;
  i2cRead(address: number, count: number): number[];
}

export type MmioSink = {
  serialWrite(text: string): void;
  millis(): number;
} & MmioI2cSink;
```

(Replace the Task 5 `MmioSink` interface with the combined one — same file, no duplication.) Framer state machine inside `attachMmioTrap`:

```ts
let txAddress = 0;
let txRemaining = -1;
const txBytes: number[] = [];
cpu.writeHooks[WIRE_TX_ADDR] = (value) => {
  const byte = value & 0xff;
  if (txRemaining === -1 && txBytes.length === 0 && txAddress === 0 && txArmedAddress === false) {
    txAddress = byte;
    txArmedAddress = true;
    return;
  }
  ...
};
```

Write it as an explicit three-state machine with named state and a reset on completion:

```ts
type TxState = 'idle' | 'haveAddress' | 'haveCount';
let txState: TxState = 'idle';
let txAddress = 0;
let txRemaining = 0;
const txBytes: number[] = [];
cpu.writeHooks[WIRE_TX_ADDR] = (value) => {
  const byte = value & 0xff;
  if (txState === 'idle') {
    txAddress = byte;
    txState = 'haveAddress';
    return;
  }
  if (txState === 'haveAddress') {
    txRemaining = byte;
    txBytes.length = 0;
    txState = 'haveCount';
    if (txRemaining === 0) {
      sink.i2cWrite(txAddress, []);
      txState = 'idle';
    }
    return;
  }
  txBytes.push(byte);
  txRemaining -= 1;
  if (txRemaining <= 0) {
    sink.i2cWrite(txAddress, [...txBytes]);
    txState = 'idle';
  }
};

let rxStaged: number[] = [];
let rxState: 'idle' | 'haveAddress' = 'idle';
let rxAddress = 0;
cpu.writeHooks[WIRE_RX_ADDR] = (value) => {
  const byte = value & 0xff;
  if (rxState === 'idle') {
    rxAddress = byte;
    rxState = 'haveAddress';
    return;
  }
  rxStaged = sink.i2cRead(rxAddress, byte);
  rxState = 'idle';
};
cpu.readHooks[WIRE_RX_ADDR] = () => rxStaged.shift() ?? 0x00;
```

A write arriving mid-frame restarts interpretation from that byte as a fresh
address (documented; the shim never does this — its TX/RX sequences are always
complete).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/simulation/avr/avr.test.ts`
Expected: PASS. Run: `npx tsc -b`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/features/simulation/avr/trap.ts src/features/simulation/avr/avr.test.ts
git commit -m "feat(avr): frame MMIO Wire transactions to the I2C sink"
```

### Task 7: Shim core + offline HEX build + committed alarm HEX

**Files:**
- Create: `src/features/simulation/avr/shim/shim.h` (MMIO map + Arduino-API subset declarations)
- Create: `src/features/simulation/avr/shim/shim.cpp` (digital/Serial/Wire/millis/delay against real registers + trap addresses from Tasks 5–6)
- Create: `scripts/build-avr-hex.sh` (arduino-cli: compile gallery alarm sources + shim for `arduino:avr:uno`, emit HEX + sha256 manifest)
- Create: `scripts/stage-avr-sketch.mjs` (regenerate `.avr-stage/alarm/` from `gallery.ts` ALARM_CLOCK sources + shim copies; fails loudly if a gallery tab is missing)
- Create: `src/features/simulation/avr/hex/manifest.json` (`{ file, sha256, sourcesHash }`)
- Create: `src/features/simulation/avr/hex/alarm-clock-uno.hex` (built artifact, committed)
- Create: `src/features/simulation/avr/hex.test.ts` (manifest + presence tests)

**Interfaces:**
- Consumes: trap addresses `0x1F0/0x1F1/0x1F5/0x1F9` and the TX/RX framing protocol from Tasks 5–6 (mirrored exactly in `shim.cpp`).
- Produces: HEX bytes loadable as `new Uint16Array(hexBytes.buffer)` for `AvrBackend` (Task 8); `manifest.json` verified by `hex.test.ts`.

Shim API surface (exact — everything the alarm sketch calls, nothing more): `pinMode`, `digitalWrite`, `digitalRead`, `millis`, `delay`, `Serial.begin/print/println`, `Wire.begin/beginTransmission/write/endTransmission/requestFrom/available/read`. `delay` busy-waits on the MMIO millis counter (exact under the Task 4 ms clock events).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { galleryById } from '@/features/learn/gallery';

const HEX = join(__dirname, 'hex', 'alarm-clock-uno.hex');
const MANIFEST = join(__dirname, 'hex', 'manifest.json');

function sourcesHash(): string {
  const build = galleryById('alarm-clock')!.builds[0];
  const parts = [build.sketch, ...(build.files ?? []).map((f) => `${f.name}\n${f.content}`)];
  return createHash('sha256').update(parts.join('\n')).digest('hex');
}

describe('avr hex assets', () => {
  it('ships a manifest whose hashes match the files and the sketch sources', () => {
    if (!existsSync(HEX) || !existsSync(MANIFEST)) {
      console.warn('SKIP: HEX assets absent (build with scripts/build-avr-hex.sh)');
      return;
    }
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as {
      file: string;
      sha256: string;
      sourcesHash: string;
    };
    const bytes = readFileSync(HEX);
    expect(manifest.file).toBe('alarm-clock-uno.hex');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.sha256);
    expect(manifest.sourcesHash).toBe(sourcesHash());
    expect(bytes.length).toBeGreaterThan(1024);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/features/simulation/avr/hex.test.ts`
Expected: FAIL with "Failed to resolve"? No — the test file itself is new and self-contained; it fails by assertion only if assets exist and mismatch. With no assets yet it warns+returns (pass-by-skip). To keep red-green honest, first create the test with a hard `expect(existsSync(HEX)).toBe(true)` — run, watch it FAIL — then relax to the skip form above once the HEX lands. Do exactly that: hard assertion first, FAIL observed, then build, then relax.

- [ ] **Step 3: Write shim + build script, build the HEX**

`shim.h` declares the subset; `shim.cpp` implements it (DDR/PORT/volatile register access for Uno, MMIO trap writes/reads at the Task 5–6 addresses with the exact framing). `scripts/build-avr-hex.sh`:

Stage layout (exact): `.avr-stage/alarm/` containing `alarm.ino` (the gallery
`sketch` content), one file per gallery tab (`config.h`, `button.h`,
`button.cpp`, `clock.h`, `clock.cpp`, `alarmtone.h`, `alarmtone.cpp`), plus
`shim.h`/`shim.cpp` copied from `src/features/simulation/avr/shim/`. The
sketch includes `"config.h"` etc. exactly as in `gallery.ts`, so no source
rewrites — only the include path gains the shim dir. A checked-in node
staging script (`scripts/stage-avr-sketch.mjs`, written in this task)
regenerates `.avr-stage/` from `gallery.ts` so the stage can never drift
from the sources the test hashes.

```bash
#!/usr/bin/env bash
set -euo pipefail
# Requires: arduino-cli + arduino:avr core installed.
# Usage: bash scripts/build-avr-hex.sh
node scripts/stage-avr-sketch.mjs
arduino-cli compile --fqbn arduino:avr:uno \
  --build-property compiler.cpp.extra_flags="-I src/features/simulation/avr/shim" \
  --output-dir .avr-stage/build .avr-stage/alarm
python3 - <<'EOF'
import hashlib, json
order = ['alarm.ino', 'config.h', 'button.h', 'button.cpp', 'clock.h', 'clock.cpp', 'alarmtone.h', 'alarmtone.cpp']
def entry(name):
    raw = open(f'.avr-stage/alarm/{name}', 'rb').read()
    return raw if name == 'alarm.ino' else (name + '\n').encode() + raw
blob = b'\n'.join(entry(n) for n in order)
hexraw = open('.avr-stage/build/alarm.ino.hex', 'rb').read()
json.dump({"file": "alarm-clock-uno.hex", "sha256": hashlib.sha256(hexraw).hexdigest(), "sourcesHash": hashlib.sha256(blob).hexdigest()}, open('src/features/simulation/avr/hex/manifest.json', 'w'), indent=2)
EOF
cp .avr-stage/build/alarm.ino.hex src/features/simulation/avr/hex/alarm-clock-uno.hex
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/features/simulation/avr/hex.test.ts`
Expected: PASS (assets present, hashes match). Run: `npx tsc -b`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/features/simulation/avr/shim scripts/build-avr-hex.sh scripts/stage-avr-sketch.mjs src/features/simulation/avr/hex src/features/simulation/avr/hex.test.ts
git commit -m "feat(avr): add shim core, HEX build script, and alarm-clock HEX"
```

### Task 8: Simulation integration (flag, flash, tick branch, fallback)

**Files:**
- Modify: `src/features/bench/simulation.ts` (flag, `loadFirmware` flash path, `tick` branch, fault fallback)
- Modify: `src/features/simulation/avr/avr.test.ts` (integration tests with real `Simulation`: fallback cases only — no HEX needed)

**Interfaces:**
- Consumes: `AvrBackend` from `./core`; `attachMmioTrap` from `./trap`; HEX loader (`parseIntelHex(path): Uint16Array` — small helper in `avr/hex.ts`, Intel-HEX record types 00/01/04 only, others throw `Error('unsupported HEX record')`).
- Produces: `simulation.execution: 'interpreter' | 'avr'` (default `'interpreter'`); avr allowed only when board id is `'uno'` and HEX bytes are available; otherwise silent fallback to interpreter. `AvrBackend` wired with `readPin = (gpio) => { this.engine.settle(); return this.engine.readDigital(gpio); }`, `onSettle = () => this.engine.settle()`, serial sink → the capped `serialWrite` at `simulation.ts:1483`, i2c sink → `this.i2c.write/requestFrom/read/available` (the `I2CBus` at `simulation.ts:992`). Core fault → `firmwareError = backend.fault`, backend discarded, next load retries interpreter.

Exact `tick` branch (insert at the top of the slice loop in `simulation.ts:935`, keeping the interpreter path below byte-identical):

```ts
if (this.avrBackend) {
  this.avrBackend.step(Math.max(frameEnd - this.engine.timeMs, 0));
  this.engine.settle();
  this.advanceBy(frameEnd - this.engine.timeMs);
  return;
}
```

Undo semantics (explicit deviation from spec §4): history snapshots bench geometry only, exactly as today — firmware (either backend) keeps running across undo. `loadFirmware` resets/discards the backend like it resets the runner.

- [ ] **Step 1: Write the failing tests**

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('avr integration fallback', () => {
  it('refuses avr on non-Uno boards', () => { /* mega + execution avr → runner is interpreter, firmwareError null */ });
  it('refuses avr when no HEX is available', () => { /* uno + execution avr, no hex → interpreter */ });
  it('rejects unsupported HEX records', () => {
    expect(() => parseIntelHex(':020000040800F2\n:00000001FF')).toThrow('unsupported HEX record');
  });
  it('has no EEPROM/peripheral surface to hang on', () => {
    const header = readFileSync(join(__dirname, 'shim', 'shim.h'), 'utf8').toLowerCase();
    for (const symbol of ['eeprom', 'adc', 'analogread', 'spi.', 'attachinterrupt']) {
      expect(header, `shim exposes no ${symbol}`).not.toContain(symbol);
    }
  });
});
```

Write the EEPROM test as a source-grep assertion on `shim.h` (exact, runnable, no hang possible).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/features/simulation/avr/avr.test.ts`
Expected: FAIL (`execution` flag and `parseIntelHex` missing).

- [ ] **Step 3: Write minimal implementation**

`avr/hex.ts` Intel-HEX parser (records 00 data with extended-linear-address 04 base, 01 EOF; checksum-verified, mismatch throws `Error('HEX checksum mismatch')`). `simulation.ts`: `execution` field + setter, `avrBackend` field, flash path in `loadFirmware` (try HEX → construct `AvrBackend` with wired sinks; catch → `firmwareError`, null backend, interpreter continues), tick branch above, fault check after step (`if (backend.fault) { this.firmwareError = backend.fault; this.avrBackend = null; }`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/features/simulation/avr/avr.test.ts`
Expected: PASS. Run: `npm test -- src/features/learn/gallery.test.ts` (default backend — must be unaffected)
Expected: PASS. Run: `npx tsc -b`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/features/simulation/avr/hex.ts src/features/simulation/avr/avr.test.ts src/features/bench/simulation.ts
git commit -m "feat(avr): integrate AvrBackend into Simulation with fallback"
```

### Task 9: Parity, fault, and perf tests

**Files:**
- Modify: `src/features/learn/gallery.test.ts` (parameterize the two live alarm tests over both backends; avr cases skip with reason when HEX is absent)
- Modify: `src/features/simulation/avr/avr.test.ts` (perf guard: 20ms backend step completes in under 2s wall-clock)

**Interfaces:**
- Consumes: everything from Tasks 1–8.
- Produces: green parity matrix (interpreter × avr) or explicit skips.

- [ ] **Step 1: Write the failing tests**

Parameterize `runs each LCD project live on the bench` and `moves the alarm-clock digits over time and on button taps`: wrap bodies in `for (const execution of ['interpreter', 'avr'] as const)`, set `simulation.execution = execution` after construction. Gate: `if (execution === 'avr' && !hexAvailable()) { console.warn('SKIP avr parity: no HEX'); continue; }` where `hexAvailable()` checks the Task 7 HEX path. First run must show the avr leg failing or skipping while interpreter passes.

Perf guard in `avr.test.ts`:

```ts
it('steps 20ms of core time within budget', () => {
  const backend = /* Task 4 construction with HEX-sized program (use a 16KB zeroed program: new Uint16Array(8192)) */;
  const start = performance.now();
  backend.step(20);
  expect(performance.now() - start).toBeLessThan(2000);
});
```

- [ ] **Step 2: Run tests to verify the avr leg fails/skips**

Run: `npm test -- src/features/learn/gallery.test.ts`
Expected: interpreter legs PASS; avr legs SKIP (no HEX yet) or FAIL (HEX present but bridge incomplete) — either is a legitimate red state; record which.

- [ ] **Step 3: Implement to green**

Fix bridge/integration issues until the avr legs assert identically (0000 → 0001, colon blink set equality, serial ticks, alarm-toggle tap). No test-assertion changes allowed — only production code.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- src/features/learn/gallery.test.ts`
Expected: PASS all legs (or interpreter PASS + avr SKIP with reason if HEX truly unavailable in the environment — then Task 7's build must be completed by a machine with the toolchain; do not weaken assertions). Run: `npm test`
Expected: all 638+ new tests PASS. Run: `npx tsc -b`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/features/learn/gallery.test.ts src/features/simulation/avr/avr.test.ts
git commit -m "test(avr): parity matrix over interpreter and AVR backends"
```

## Follow-up plan (not this plan)

Plan B — in-browser compile worker: WASM toolchain packaging, core/library IndexedDB cache, `Toolchain.compile` wired into `loadFirmware`, worker progress/cancellation UI, toolchain tests. Starts after this plan is green.
