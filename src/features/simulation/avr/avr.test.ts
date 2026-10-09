import { describe, expect, it } from 'vitest';
import { CPU, AVRIOPort, portBConfig, portDConfig, timer0Config } from 'avr8js';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { McuRuntime } from '@/features/simulation/mcu';
import { arduinoMega2560, arduinoUnoR3 } from '@/features/parts/boards';
import { firmwareForBuild, galleryById } from '@/features/learn/gallery';
import { Simulation } from '@/features/bench/simulation';
import { UNO_GPIO_MAP, UNO_CLOCK_HZ, cyclesPerMs } from './backend';
import { attachGpioBridge } from './gpio';
import { AvrBackend } from './core';
import { hexForSourcesHash, parseIntelHex, sha256Hex, sourcesHashForProject } from './hex';

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

describe('gpio push path', () => {
  it('drives D13 output high on PORTB bit 5', () => {
    const cpu = new CPU(new Uint16Array(64));
    new AVRIOPort(cpu, portBConfig);
    new AVRIOPort(cpu, portDConfig);
    const mcu = new McuRuntime(arduinoUnoR3());
    attachGpioBridge(cpu, mcu, () => 0, () => false);
    cpu.writeData(36, 0x20); // DDRB bit 5: output
    cpu.writeData(37, 0x20); // PORTB bit 5: high
    expect(mcu.configurationOf(mcu.pinIdForGpio(13)!).direction).toBe('output');
  });
});

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

describe('avr timing core', () => {
  it('advances 16000 cycles per ms and settles per ms', () => {
    let settles = 0;
    const backend = new AvrBackend(new Uint16Array(64), {
      mcu: new McuRuntime(arduinoUnoR3()),
      nowMs: () => 0,
      readPin: () => false,
      onSettle: () => settles++,
      serial: { serialWrite: () => {} },
      i2c: { writeByte: () => true, readByte: () => 0xff },
    });
    backend.step(2.5);
    expect(backend.cycles).toBe(40_000);
    expect(settles).toBe(2);
    backend.step(0.5);
    expect(settles).toBe(3); // carried 0.5 + 0.5 completes the ms
  });

  it('clamps a single step to 40ms', () => {
    let settles = 0;
    const backend = new AvrBackend(new Uint16Array(64), {
      mcu: new McuRuntime(arduinoUnoR3()),
      nowMs: () => 0,
      readPin: () => false,
      onSettle: () => settles++,
      serial: { serialWrite: () => {} },
      i2c: { writeByte: () => true, readByte: () => 0xff },
    });
    backend.step(1000);
    expect(backend.cycles).toBe(40 * 16_000);
    expect(backend.clampedMs).toBeGreaterThan(0);
  });

  it('steps 20ms of core time within budget', () => {
    const backend = new AvrBackend(new Uint16Array(8192), {
      mcu: new McuRuntime(arduinoUnoR3()),
      nowMs: () => 0,
      readPin: () => false,
      onSettle: () => {},
      serial: { serialWrite: () => {} },
      i2c: { writeByte: () => true, readByte: () => 0xff },
    });
    const start = performance.now();
    backend.step(20);
    expect(performance.now() - start).toBeLessThan(2000);
  });
});

describe('avr timer0', () => {
  it('free-runs TCNT0 from the prescaler so stock millis/delay can tick', () => {
    const backend = new AvrBackend(new Uint16Array(64), {
      mcu: new McuRuntime(arduinoUnoR3()),
      nowMs: () => 0,
      readPin: () => false,
      onSettle: () => {},
      serial: { serialWrite: () => {} },
      i2c: { writeByte: () => true, readByte: () => 0xff },
    });
    // The backend owns its CPU; reach in for register-level driving.
    const cpu = (backend as unknown as { cpu: CPU }).cpu;
    expect(cpu.readData(timer0Config.TCNT)).toBe(0);
    cpu.writeData(timer0Config.TCCRB, 0x03); // CS02:0 = 011: prescaler 64
    backend.step(2);
    expect(cpu.readData(timer0Config.TCNT)).not.toBe(0);
  });
});

describe('avr integration fallback', () => {
  it('refuses avr on non-Uno boards', () => {
    const simulation = new Simulation(arduinoMega2560());
    simulation.execution = 'avr';
    simulation.loadFirmware('void setup() {}\nvoid loop() {}\n');
    expect(simulation.runner, 'mega runs the interpreter').not.toBeNull();
    expect(simulation.firmwareError, 'mega reports no error').toBeNull();
  });

  it('refuses avr when no HEX is available', () => {
    const simulation = new Simulation(arduinoUnoR3());
    simulation.execution = 'avr';
    simulation.loadFirmware('void setup() {}\nvoid loop() {}\n');
    expect(simulation.runner, 'uno without HEX runs the interpreter').not.toBeNull();
    expect(simulation.firmwareError, 'uno without HEX reports no error').toBeNull();
  });

  it('rejects unsupported HEX records', () => {
    expect(() => parseIntelHex(':020000040800F2\n:00000001FF')).toThrow('unsupported HEX record');
  });
});

describe('intel-hex loader', () => {
  it('packs data records little-endian into flash words', () => {
    const words = parseIntelHex(':0400000034120000B6\n:00000001FF\n');
    expect(words[0]).toBe(0x1234);
    expect(words[1]).toBe(0x0000);
    expect(words.length).toBe(16384);
  });

  it('rejects checksum mismatches', () => {
    expect(() => parseIntelHex(':0400000034120000B5\n:00000001FF\n')).toThrow(
      'HEX checksum mismatch',
    );
  });

  it('rejects data past the 32KB flash', () => {
    expect(() => parseIntelHex(':02800000FFFF80\n:00000001FF\n')).toThrow(
      'unsupported HEX record',
    );
  });
});

describe('hex asset gating', () => {
  it('computes sha256 exactly like the HEX manifest formula', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    const build = galleryById('alarm-clock')!.builds[0]!;
    const project = firmwareForBuild(build, 'arduino-cpp');
    const parts = [build.sketch, ...(build.files ?? []).map((f) => `${f.name}\n${f.content}`)];
    expect(sourcesHashForProject(project)).toBe(createHash('sha256').update(parts.join('\n')).digest('hex'));
  });

  it('finds no HEX while the toolchain build is pending', () => {
    if (existsSync(join(__dirname, 'hex', 'alarm-clock-uno.hex'))) {
      console.warn('SKIP: HEX present, absence assertion not applicable');
      return;
    }
    expect(hexForSourcesHash('0'.repeat(64))).toBeNull();
  });
});

import { avrInstruction } from 'avr8js';
import { attachUsartBridge } from './usart';
import { TwiBridgeHandler, attachTwiBridge, type TwiCompleter, type TwiSink } from './twi';

function recorder() {
  const calls: string[] = [];
  const completer: TwiCompleter = {
    completeStart: () => calls.push('start'),
    completeStop: () => calls.push('stop'),
    completeConnect: (ack) => calls.push(`connect:${ack ? 1 : 0}`),
    completeWrite: (ack) => calls.push(`write:${ack ? 1 : 0}`),
    completeRead: (v) => calls.push(`read:${v}`),
  };
  return { calls, completer };
}

describe('twi bridge', () => {
  it('forwards a write transaction byte by byte with ACKs', () => {
    const { calls, completer } = recorder();
    const delivered: number[] = [];
    const handler = new TwiBridgeHandler(completer, {
      writeByte: (_addr, byte) => {
        delivered.push(byte);
        return true;
      },
      readByte: () => 0xff,
    });
    handler.start(false);
    handler.connectToSlave(0x68, true);
    handler.writeByte(0x00);
    handler.writeByte(0x11);
    handler.stop();
    expect(delivered).toEqual([0x00, 0x11]);
    expect(calls).toEqual(['start', 'connect:1', 'write:1', 'write:1', 'stop']);
  });

  it('twi start completes', () => {
    const { calls, completer } = recorder();
    const handler = new TwiBridgeHandler(completer, {
      writeByte: () => true,
      readByte: () => 0xff,
    });
    handler.start(false);
    handler.start(true);
    expect(calls).toEqual(['start', 'start']);
  });

  it('serves read bytes per index and resets on stop', () => {
    const { calls, completer } = recorder();
    const handler = new TwiBridgeHandler(completer, {
      writeByte: () => true,
      readByte: (_addr, index) => [10, 20, 30][index] ?? 0xff,
    });
    handler.start(false);
    handler.connectToSlave(0x68, false);
    handler.readByte(true);
    handler.readByte(true);
    handler.readByte(false);
    handler.stop();
    expect(calls).toEqual(['start', 'connect:1', 'read:10', 'read:20', 'read:30', 'stop']);
    handler.start(false);
    handler.connectToSlave(0x68, false);
    handler.readByte(true);
    expect(calls.at(-1)).toBe('read:10');
  });

  it('NACKs a read connect after a NACKed write', () => {
    const { calls, completer } = recorder();
    const handler = new TwiBridgeHandler(completer, {
      writeByte: () => false,
      readByte: () => 0xff,
    });
    handler.start(false);
    handler.connectToSlave(0x68, true);
    handler.writeByte(0x00);
    handler.start(true);
    handler.connectToSlave(0x68, false);
    expect(calls).toEqual(['start', 'connect:1', 'write:0', 'start', 'connect:0']);
  });

  it('attaches the TWI peripheral to a CPU', () => {
    const cpu = new CPU(new Uint16Array(256));
    expect(() =>
      attachTwiBridge(cpu, { writeByte: () => true, readByte: () => 0xff }),
    ).not.toThrow();
  });
});

describe('twi write phase close', () => {
  function handlerWith(writeEnd: () => void, sink?: Partial<TwiSink>) {
    const { completer } = recorder();
    return new TwiBridgeHandler(completer, {
      writeByte: () => true,
      readByte: () => 0xff,
      writeEnd,
      ...sink,
    });
  }

  it('fires writeEnd exactly once per write phase', () => {
    let ends = 0;
    const handler = handlerWith(() => ends++);
    handler.start(false);
    handler.connectToSlave(0x68, true);
    handler.writeByte(0x00);
    handler.writeByte(0x11);
    handler.stop();
    expect(ends).toBe(1);
  });

  it('stays silent for read-only phases', () => {
    let ends = 0;
    const handler = handlerWith(() => ends++);
    handler.start(false);
    handler.connectToSlave(0x68, false);
    handler.readByte(true);
    handler.stop();
    expect(ends).toBe(0);
  });

  it('stays silent for an empty stop', () => {
    let ends = 0;
    const handler = handlerWith(() => ends++);
    handler.start(false);
    handler.stop();
    expect(ends).toBe(0);
  });

  it('stays silent when the closing phase is a read after a write', () => {
    let ends = 0;
    const handler = handlerWith(() => ends++);
    handler.start(false);
    handler.connectToSlave(0x68, true);
    handler.writeByte(0x00);
    handler.start(true); // repeated start: register pointer set, now reading
    handler.connectToSlave(0x68, false);
    handler.readByte(false);
    handler.stop();
    expect(ends).toBe(0);
  });

  it('tolerates sinks without writeEnd', () => {
    const { completer } = recorder();
    const handler = new TwiBridgeHandler(completer, {
      writeByte: () => true,
      readByte: () => 0xff,
    });
    handler.start(false);
    handler.connectToSlave(0x68, true);
    handler.writeByte(0x00);
    expect(() => handler.stop()).not.toThrow();
  });
});

describe('avr i2c bus log', () => {
  it('records an AVR-driven write transaction in the bus log', () => {
    const simulation = new Simulation(arduinoUnoR3());
    expect(simulation.busLines()).toHaveLength(0);
    // The AVR sink is built inline where the HEX is flashed; reach it for
    // wiring-level driving (no committed HEX exists in this checkout).
    const sink = (
      simulation as unknown as { avrI2cSink(): TwiSink }
    ).avrI2cSink();
    const { completer } = recorder();
    const handler = new TwiBridgeHandler(completer, sink);
    handler.start(false);
    handler.connectToSlave(0x3c, true);
    handler.writeByte(0x00);
    handler.writeByte(0xaf);
    handler.stop();
    const entries = simulation.busLines().filter((entry) => entry.bus === 'i2c');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.address).toBe(0x3c);
    expect([...(entries[0]?.bytes ?? [])]).toEqual([0x00, 0xaf]);
  });
});

describe('usart bridge', () => {
  it('forwards a UDR0 byte as serial text', () => {
    const cpu = new CPU(new Uint16Array(256));
    const out: string[] = [];
    attachUsartBridge(cpu, { serialWrite: (t) => out.push(t) });
    cpu.writeData(0xc1, 0x08); // UCSR0B: TXEN
    cpu.writeData(0xc4, 103); // UBRR0L: 9600 baud at 16MHz
    cpu.writeData(0xc6, 65); // UDR0: 'A'
    for (let i = 0; i < 200_000; i++) {
      avrInstruction(cpu);
      cpu.tick();
    }
    expect(out.join('')).toContain('A');
  });
});

import { lintPrototypes, packageSketch } from './packager';
import { toSingleFileProject } from '../firmware/project';
import type { CompileResult } from './toolchain/client';

const project = {
  language: 'arduino-cpp',
  activeName: 'main.ino',
  files: [
    { name: 'main.ino', content: '#include <Arduino.h>\n#include "cfg.h"\nvoid loop() {}\n' },
    { name: 'cfg.h', content: '#define X 1\n' },
  ],
} as const;

describe('sketch packager', () => {
  it('concatenates tabs with local includes stripped', () => {
    const packed = packageSketch(project);
    expect(packed.source).toBe('#define X 1\n#include <Arduino.h>\nvoid loop() {}\n');
    expect(packed.lineMap[0]).toEqual({ file: 'cfg.h', line: 1 });
    expect(packed.lineMap[1]).toEqual({ file: 'main.ino', line: 1 });
  });

  it('ensures Arduino.h with a mapped marker line', () => {
    const packed = packageSketch({ language: 'arduino-cpp', activeName: 'main.ino', files: [{ name: 'main.ino', content: 'void loop() {}\n' }] });
    expect(packed.source.startsWith('#include <Arduino.h>\n')).toBe(true);
    expect(packed.lineMap[0]).toEqual({ file: '<packager>', line: 0 });
  });

  it('flags calls with no prior declaration', () => {
    const hits = lintPrototypes('void loop() {\n  appTick();\n}\nvoid appTick() {}\n');
    expect(hits).toEqual([{ line: 2, name: 'appTick' }]);
    expect(lintPrototypes('void appTick() {}\nvoid loop() {\n  appTick();\n}\n')).toEqual([]);
  });

  it('treats prototype declarations as defined', () => {
    expect(lintPrototypes('void appTick();\nvoid loop() {\n  appTick();\n}\n')).toEqual([]);
  });

  it('does not treat keyword-led call lines as definitions', () => {
    expect(lintPrototypes('void loop() {\n  return foo();\n}\n')).toEqual([{ line: 2, name: 'foo' }]);
    expect(lintPrototypes('void loop() {\n  if (x) {\n  } else foo();\n}\n')).toEqual([{ line: 3, name: 'foo' }]);
  });
});

describe('avr compile fallback matrix', () => {
  const blink = () => toSingleFileProject('void setup() {}\nvoid loop() {}\n', 'arduino-cpp');

  it('refuses non-Uno before compiling', async () => {
    let calls = 0;
    const stub = async (): Promise<CompileResult> => {
      calls += 1;
      throw new Error('worker must not run for non-Uno boards');
    };
    const simulation = new Simulation(arduinoMega2560(), { avrCompile: stub });
    simulation.execution = 'avr';
    await simulation.compileAndRun(blink());
    expect(calls, 'worker never runs for a Mega').toBe(0);
    expect(simulation.firmwareError).toBe('AVR backend needs an Uno board');
    expect(simulation.compileState).toEqual({ error: 'AVR backend needs an Uno board' });
    expect(simulation.runner, 'mega falls back to the interpreter').not.toBeNull();
  });

  it('falls back to interpreter with reason on build failure', async () => {
    const stub = async (): Promise<CompileResult> => {
      throw new Error('compile failed: boom');
    };
    const simulation = new Simulation(arduinoUnoR3(), { avrCompile: stub });
    simulation.execution = 'avr';
    await simulation.compileAndRun(blink());
    expect(simulation.firmwareError).toContain('compile failed');
    expect(simulation.compileState).toEqual({ error: expect.stringContaining('compile failed') });
    expect(simulation.runner, 'uno without HEX runs the interpreter').not.toBeNull();
    expect(
      (simulation as unknown as { avrBackend: unknown }).avrBackend,
      'failed build flashes nothing',
    ).toBeNull();
  });

  it('cancelling a build flashes nothing', async () => {
    const stub = (
      _source: string,
      _onProgress: (stage: string) => void,
      signal: AbortSignal,
    ): Promise<CompileResult> =>
      new Promise<CompileResult>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('compile cancelled')), { once: true });
      });
    const simulation = new Simulation(arduinoUnoR3(), { avrCompile: stub });
    simulation.execution = 'avr';
    const pending = simulation.compileAndRun(blink());
    (simulation as unknown as { compileAbort: AbortController | null }).compileAbort?.abort();
    await pending;
    expect(
      (simulation as unknown as { avrBackend: unknown }).avrBackend,
      'cancelled build flashes nothing',
    ).toBeNull();
    expect(simulation.firmwareError ?? '').toMatch(/cancel/i);
    expect(simulation.compileState).toEqual({ error: expect.stringMatching(/cancel/i) });
  });
});
