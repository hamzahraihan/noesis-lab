import { describe, expect, it } from 'vitest';
import { CPU, AVRIOPort, portBConfig, portDConfig } from 'avr8js';
import { McuRuntime } from '@/features/simulation/mcu';
import { arduinoUnoR3 } from '@/features/parts/boards';
import { UNO_GPIO_MAP, UNO_CLOCK_HZ, cyclesPerMs } from './backend';
import { attachGpioBridge } from './gpio';
import { AvrBackend } from './core';

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
