import { describe, expect, it } from 'vitest';
import { DS3231_ADDRESS, DS3231_TEMPERATURE_KNOB, Ds3231 } from './ds3231';
import { ds3231Definition } from './sensors';

/** A sketch's transaction: the register, then the bytes it writes. */
function writeRegisters(rtc: Ds3231, register: number, ...bytes: number[]): void {
  rtc.receive(register, true);
  for (const byte of bytes) rtc.receive(byte, false);
}

/** A sketch's read: point at a register, then ask for `count` bytes. */
function readRegisters(rtc: Ds3231, register: number, count: number): number[] {
  rtc.receive(register, true);
  return [...rtc.read(count)];
}

describe('the DS3231', () => {
  it('answers on the address the module is strapped to', () => {
    expect(new Ds3231().address).toBe(DS3231_ADDRESS);
    expect(DS3231_ADDRESS).toBe(0x68);
  });

  it('reads the host clock as BCD, the way the chip stores it', () => {
    const rtc = new Ds3231();
    rtc.setTime(new Date(2026, 9, 24, 15, 30, 45));
    // Seconds, minutes, hours, day of week, date, month, year.
    expect(readRegisters(rtc, 0x00, 7)).toEqual([0x45, 0x30, 0x15, 0x06, 0x24, 0x10, 0x26]);
  });

  it('advances a sketch-set time rather than taking it back', () => {
    const rtc = new Ds3231();
    rtc.setTime(new Date(2000, 0, 1, 0, 0, 23));
    // RTClib adjust(): pointer at 0x00, then sec/min/hr/dow/date/month/year.
    writeRegisters(rtc, 0x00, 0x00, 0x01, 0x00, 0x06, 0x01, 0x01, 0x00);
    rtc.setTime(new Date(2000, 0, 1, 0, 0, 24));
    expect(readRegisters(rtc, 0x00, 2)).toEqual([0x01, 0x01]);
  });

  it('starts with the oscillator flag set, and clears it when the time is set', () => {
    const rtc = new Ds3231();
    expect(rtc.lostPower()).toBe(true);
    expect(readRegisters(rtc, 0x0f, 1)[0]! & 0x80).toBe(0x80);

    writeRegisters(rtc, 0x00, 0x00, 0x01, 0x00, 0x06, 0x01, 0x01, 0x00);
    expect(rtc.lostPower()).toBe(false);
    expect(readRegisters(rtc, 0x0f, 1)[0]! & 0x80).toBe(0);
  });

  it('reports the die temperature in quarter-degree steps', () => {
    const rtc = new Ds3231();
    rtc.setTemperatureSource(() => 23.25);
    expect(readRegisters(rtc, 0x11, 2)).toEqual([0x17, 0x40]);
    expect(rtc.temperatureCelsius()).toBe(23.25);
  });

  it('reports a negative temperature as signed counts', () => {
    const rtc = new Ds3231();
    rtc.setTemperatureSource(() => -5.5);
    expect(readRegisters(rtc, 0x11, 2)).toEqual([0xfa, 0x80]);
    expect(rtc.temperatureCelsius()).toBe(-5.5);
  });

  it('keeps the alarm registers apart from the DS1307 RAM', () => {
    const rtc = new Ds3231();
    writeRegisters(rtc, 0x07, 0x80, 0x05, 0x12, 0x41, 0x00, 0x30, 0x07);
    expect(readRegisters(rtc, 0x07, 7)).toEqual([0x80, 0x05, 0x12, 0x41, 0x00, 0x30, 0x07]);
  });

  it('stores the control, status and aging registers', () => {
    const rtc = new Ds3231();
    writeRegisters(rtc, 0x0e, 0x05);
    writeRegisters(rtc, 0x10, 0xe0);
    expect(readRegisters(rtc, 0x0e, 1)).toEqual([0x05]);
    expect(readRegisters(rtc, 0x10, 1)).toEqual([0xe0]);
  });

  it('answers zero for the registers the chip does not define', () => {
    const rtc = new Ds3231();
    writeRegisters(rtc, 0x13, 0xaa);
    expect(readRegisters(rtc, 0x13, 1)).toEqual([0x00]);
  });
});

describe('the DS3231 module', () => {
  it('is a four-pin I2C sensor with a temperature knob', () => {
    const definition = ds3231Definition();
    expect(definition.component).toEqual({ kind: 'i2c-sensor', device: 'ds3231' });
    expect(definition.pins.map((pin) => pin.id)).toEqual(['GND', 'VCC', 'SDA', 'SCL']);
    expect(definition.knobs).toContain(DS3231_TEMPERATURE_KNOB);
  });
});
