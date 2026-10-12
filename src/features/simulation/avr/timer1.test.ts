import { describe, expect, it } from 'vitest';
import { CPU, timer1Config } from 'avr8js';
import { attachGpioBridge } from './gpio';
import { attachTimer1, bindTimer1Outputs } from './timer1';
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

function cpuWithOc(): { cpu: CPU; mcu: McuRuntime } {
  const cpu = new CPU(new Uint16Array(64));
  const mcu = new McuRuntime(arduinoUnoR3());
  attachTimer1(cpu, mcu, () => 0, () => false);
  bindTimer1Outputs(cpu, mcu, () => 0);
  return { cpu, mcu };
}

function dutyOf(mcu: McuRuntime, gpio: number): number {
  return mcu.configurationOf(mcu.pinIdForGpio(gpio)!).duty;
}

function pwmOf(mcu: McuRuntime, gpio: number): boolean {
  return mcu.configurationOf(mcu.pinIdForGpio(gpio)!).pwm;
}

function directionOf(mcu: McuRuntime, gpio: number): string {
  return mcu.configurationOf(mcu.pinIdForGpio(gpio)!).direction;
}

describe('timer1 OC outputs', () => {
  it('stamps OC1A duty on D9 in Fast PWM', () => {
    const { cpu, mcu } = cpuWithOc();
    cpu.writeData(0x88, 0x80); // OCR1AL = 128
    // Correction vs the brief draft (which had 0x82): 0x82 sets WGM11, which
    // with WGM12 below selects mode 6 (Fast PWM 9-bit, TOP 511), not the
    // 8-bit mode this test names and asserts. 0x81 sets WGM10 for mode 5
    // (Fast PWM 8-bit, TOP 255, COM1A non-inverting).
    cpu.writeData(0x80, 0x81); // COM1A non-inverting, Fast PWM 8-bit (WGM10)
    cpu.writeData(0x81, 0x09); // WGM12 + prescaler 1
    cpu.writeData(36, 0x02); // DDRB bit 1: D9 output
    expect(dutyOf(mcu, 9)).toBeCloseTo(128 / 255, 2);
  });

  it('stamps the inverting complement on OC1B/D10', () => {
    const { cpu, mcu } = cpuWithOc();
    cpu.writeData(0x8a, 192); // OCR1BL = 192
    cpu.writeData(0x80, 0x31); // COM1B inverting, Fast PWM 8-bit (WGM10)
    cpu.writeData(0x81, 0x09); // WGM12 + prescaler 1
    cpu.writeData(36, 0x04); // DDRB bit 2: D10 output
    expect(dutyOf(mcu, 10)).toBeCloseTo((255 - 192) / 255, 2);
    expect(pwmOf(mcu, 10)).toBe(true);
    // COM1A is disconnected, so D9 falls back to plain GPIO LOW.
    expect(dutyOf(mcu, 9)).toBe(0);
    expect(pwmOf(mcu, 9)).toBe(false);
    expect(directionOf(mcu, 9)).toBe('input');
  });

  it('scales duty by TOP outside 8-bit modes', () => {
    const { cpu, mcu } = cpuWithOc();
    // 0x82 here is deliberate: WGM11 without WGM10 is phase-correct 9-bit
    // (mode 2, TOP 511) once TCCR1B below leaves WGM12 clear.
    cpu.writeData(0x89, 0x01); // OCR1AH = 1 (16-bit TEMP stage)
    cpu.writeData(0x88, 0x00); // OCR1AL = 0: OCR1A = 256
    cpu.writeData(0x80, 0x82); // COM1A non-inverting, phase-correct 9-bit
    cpu.writeData(0x81, 0x01); // prescaler 1, WGM12 clear
    cpu.writeData(36, 0x02); // DDRB bit 1: D9 output
    expect(dutyOf(mcu, 9)).toBeCloseTo(128 / 255, 2); // round(255*256/511) = 128
  });

  it('falls back to plain GPIO when COM is disconnected', () => {
    const { cpu, mcu } = cpuWithOc();
    cpu.writeData(0x88, 0x80); // OCR1AL = 128 (ignored while disconnected)
    cpu.writeData(0x80, 0x01); // COM disconnected, Fast PWM 8-bit
    cpu.writeData(0x81, 0x09); // WGM12 + prescaler 1
    cpu.writeData(36, 0x02); // DDRB bit 1: D9 output
    cpu.writeData(37, 0x02); // PORTB bit 1: HIGH
    expect(dutyOf(mcu, 9)).toBe(1);
    expect(pwmOf(mcu, 9)).toBe(false);
    expect(directionOf(mcu, 9)).toBe('output');
    cpu.writeData(37, 0x00); // PORTB bit 1: LOW
    expect(dutyOf(mcu, 9)).toBe(0);
  });

  it('falls back to plain GPIO when the pin is an input', () => {
    const { cpu, mcu } = cpuWithOc();
    cpu.writeData(0x88, 0x80); // OCR1AL = 128
    cpu.writeData(0x80, 0x81); // COM1A non-inverting, Fast PWM 8-bit
    cpu.writeData(0x81, 0x09); // WGM12 + prescaler 1
    cpu.writeData(36, 0x00); // DDRB: D9 stays an input
    cpu.writeData(37, 0x02); // PORTB bit 1: pull-up
    // The fallback mirrors the GPIO bridge: pull-up direction, no digital
    // write, and the pin is never converted to an output.
    expect(directionOf(mcu, 9)).toBe('inputPullUp');
    expect(pwmOf(mcu, 9)).toBe(false);
    expect(dutyOf(mcu, 9)).toBe(0);
    cpu.writeData(37, 0x00); // PORTB bit 1: pull-up off
    expect(directionOf(mcu, 9)).toBe('input');
    expect(pwmOf(mcu, 9)).toBe(false);
  });

  it('drops PWM when COM disconnects after connecting (digitalWrite path)', () => {
    const { cpu, mcu } = cpuWithOc();
    cpu.writeData(0x88, 0x80); // OCR1AL = 128
    cpu.writeData(0x80, 0x81); // COM1A non-inverting, Fast PWM 8-bit
    cpu.writeData(0x81, 0x09); // WGM12 + prescaler 1
    cpu.writeData(36, 0x02); // DDRB bit 1: D9 output
    expect(pwmOf(mcu, 9)).toBe(true);
    // Arduino digitalWrite clears COM first (turnOffPWM), then drives PORT.
    cpu.writeData(0x80, 0x01); // COM disconnected, mode unchanged
    cpu.writeData(37, 0x02); // PORTB bit 1: HIGH
    expect(pwmOf(mcu, 9)).toBe(false);
    expect(dutyOf(mcu, 9)).toBe(1);
  });

  it('leaves non-Timer1 pins untouched while D9 runs PWM (mixed-pins)', () => {
    const cpu = new CPU(new Uint16Array(64));
    const mcu = new McuRuntime(arduinoUnoR3());
    // Bridge first: the OC routing chains onto its DDRB/PORTB hooks, and its
    // all-GPIO sync on any port write would clobber a duty stamped earlier,
    // so firmware order (GPIO first, analogWrite last) is load-bearing here.
    attachGpioBridge(cpu, mcu, () => 0, () => false);
    attachTimer1(cpu, mcu, () => 0, () => false);
    bindTimer1Outputs(cpu, mcu, () => 0);
    cpu.writeData(42, 0x20); // DDRD bit 5: D5 output (Timer0 path)
    cpu.writeData(43, 0x20); // PORTD bit 5: HIGH
    cpu.writeData(0x88, 0x80); // OCR1AL = 128
    cpu.writeData(0x80, 0x81); // COM1A non-inverting, Fast PWM 8-bit
    cpu.writeData(0x81, 0x09); // WGM12 + prescaler 1
    cpu.writeData(36, 0x02); // DDRB bit 1: D9 output
    expect(dutyOf(mcu, 9)).toBeCloseTo(128 / 255, 2);
    expect(pwmOf(mcu, 9)).toBe(true);
    expect(dutyOf(mcu, 5)).toBe(1);
    expect(pwmOf(mcu, 5)).toBe(false);
    expect(dutyOf(mcu, 6)).toBe(0);
    expect(pwmOf(mcu, 6)).toBe(false);
  });
});
