import { describe, expect, it } from 'vitest';
import { CPU, AVRIOPort, portBConfig, portDConfig } from 'avr8js';
import { McuRuntime } from '@/features/simulation/mcu';
import { arduinoUnoR3 } from '@/features/parts/boards';
import { UNO_GPIO_MAP, UNO_CLOCK_HZ, cyclesPerMs } from './backend';
import { attachGpioBridge } from './gpio';

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
    attachGpioBridge(cpu, mcu, () => 0);
    cpu.writeData(36, 0x20); // DDRB bit 5: output
    cpu.writeData(37, 0x20); // PORTB bit 5: high
    expect(mcu.configurationOf(mcu.pinIdForGpio(13)!).direction).toBe('output');
  });
});
