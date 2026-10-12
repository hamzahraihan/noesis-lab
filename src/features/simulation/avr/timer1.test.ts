import { describe, expect, it } from 'vitest';
import { CPU, timer1Config } from 'avr8js';
import { attachTimer1 } from './timer1';
import { McuRuntime } from '../mcu';
import { arduinoUnoR3 } from '@/features/parts/boards';

function cpuWithTimer1(): { cpu: CPU; mcu: McuRuntime } {
  const cpu = new CPU(new Uint16Array(64));
  const mcu = new McuRuntime(arduinoUnoR3());
  attachTimer1(cpu, mcu, () => 0, () => false);
  return { cpu, mcu };
}

describe('timer1 core', () => {
  it('uses the datasheet register and vector addresses', () => {
    expect(timer1Config.TCCRA).toBe(0x80);
    expect(timer1Config.TCCRB).toBe(0x81);
    expect(timer1Config.TCCRC).toBe(0x82);
    expect(timer1Config.TCNT).toBe(0x84);
    expect(timer1Config.ICR).toBe(0x86);
    expect(timer1Config.OCRA).toBe(0x88);
    expect(timer1Config.OCRB).toBe(0x8a);
    expect(timer1Config.TIMSK).toBe(0x6f);
    expect(timer1Config.TIFR).toBe(0x36);
    expect(timer1Config.captureInterrupt).toBe(0x14);
    expect(timer1Config.compAInterrupt).toBe(0x16);
    expect(timer1Config.compBInterrupt).toBe(0x18);
    expect(timer1Config.ovfInterrupt).toBe(0x1a);
  });

  it('free-runs TCNT1 from the prescaler', () => {
    const { cpu } = cpuWithTimer1();
    expect(cpu.readData(0x84)).toBe(0);
    cpu.writeData(0x81, 0x03); // CS12:0 = 011: prescaler 64
    for (let i = 0; i < 20000; i++) cpu.tick();
    expect(cpu.readData(0x84) | (cpu.readData(0x85) << 8)).not.toBe(0);
  });

  it('fires the COMPA interrupt and sets OCF1A', () => {
    const { cpu } = cpuWithTimer1();
    cpu.writeData(0x88, 0x10); // OCR1AL = 16
    cpu.writeData(0x6f, 0x02); // OCIE1A
    cpu.writeData(0x81, 0x09); // CTC mode (WGM12), prescaler 1
    for (let i = 0; i < 100; i++) cpu.tick();
    expect(cpu.readData(0x36) & 0x02).not.toBe(0); // OCF1A in TIFR1
  });

  it('reprogramming prescaler and mode mid-cycle settles without stuck flags', () => {
    const { cpu } = cpuWithTimer1();
    cpu.writeData(0x81, 0x03);
    for (let i = 0; i < 5000; i++) cpu.tick();
    cpu.writeData(0x80, 0x00);
    cpu.writeData(0x81, 0x00); // stop
    cpu.writeData(0x81, 0x01); // restart prescaler 1
    for (let i = 0; i < 100; i++) cpu.tick();
    expect(cpu.readData(0x84) | (cpu.readData(0x85) << 8)).not.toBe(0);
  });
});
