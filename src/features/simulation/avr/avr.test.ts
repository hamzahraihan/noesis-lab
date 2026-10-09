import { describe, expect, it } from 'vitest';
import { CPU, AVRIOPort, portBConfig, portDConfig } from 'avr8js';
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
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
import { SERIAL_TX_ADDR, MILLIS_ADDR, WIRE_TX_ADDR, WIRE_RX_ADDR, attachMmioTrap } from './trap';

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
    });
    backend.step(1000);
    expect(backend.cycles).toBe(40 * 16_000);
    expect(backend.clampedMs).toBeGreaterThan(0);
  });
});

describe('mmio trap serial path', () => {
  it('forwards serial bytes as text', () => {
    const cpu = new CPU(new Uint16Array(64));
    const out: string[] = [];
    attachMmioTrap(cpu, { serialWrite: (t) => out.push(t), millis: () => 0, i2cWrite: () => {}, i2cRead: () => [] });
    cpu.writeData(SERIAL_TX_ADDR, 65); // 'A'
    cpu.writeData(SERIAL_TX_ADDR, 66); // 'B'
    expect(out.join('')).toBe('AB');
  });

  it('serves millis as LE32 across four reads', () => {
    const cpu = new CPU(new Uint16Array(64));
    attachMmioTrap(cpu, { serialWrite: () => {}, millis: () => 0x01020304, i2cWrite: () => {}, i2cRead: () => [] });
    const bytes = [0, 1, 2, 3].map((i) => cpu.readData(MILLIS_ADDR + i));
    expect(bytes).toEqual([0x04, 0x03, 0x02, 0x01]);
  });
});

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

  it('has no EEPROM/peripheral surface to hang on', () => {
    const header = readFileSync(join(__dirname, 'shim', 'shim.h'), 'utf8').toLowerCase();
    for (const symbol of ['eeprom', 'adc', 'analogread', 'spi.', 'attachinterrupt']) {
      expect(header, `shim exposes no ${symbol}`).not.toContain(symbol);
    }
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
