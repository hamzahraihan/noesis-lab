import { describe, it, expect } from 'vitest';

import {
  findPartState,
  getAds1115Reading,
  getButtonPressed,
  getDialerDigit,
  getFramebuffer,
  getIna219Reading,
  getIrCode,
  getLcdGeometry,
  getLcdText,
  getMax7219Config,
  getMcp23017Regs,
  getMcp4725Value,
  getPartKind,
  getPartState,
  getPca9685Duty,
  getPcf8574Regs,
  getPotWiper,
  getRelayContactsClosed,
  getRfidCardPresent,
  getRtcTime,
  getSensorReadings,
  getServoAngle,
  getSevenSegmentColon,
  getSevenSegmentDigits,
  getShift595State,
  getShiftRegisterOutputs,
  getSonarEchoUs,
  getStepperAngle,
  getStepperDriverOutputs,
  getThermocoupleTempC,
  indexPartStates,
  type PartStateSource,
  type FFIPartStateSnapshot,
} from './parts';

function makeState(overrides: Partial<FFIPartStateSnapshot> = {}): FFIPartStateSnapshot {
  return {
    partId: 'p1',
    kind: 'servo',
    framebuffer: 1024,
    framebuffer_size: 512,
    width: 128,
    height: 64,
    servo_angle: 45,
    stepper_angle_deci_deg: 901,
    stepper_driver_outputs: [1, 0, 1, 0],
    seven_seg_digits: [1, 2, 3, 4, 0, 0, 0, 0],
    seven_seg_colon: 1,
    lcd_chars: [...'Hi'.split('').map((c) => c.charCodeAt(0)), ...new Array(78).fill(32)],
    lcd_rows: 2,
    lcd_cols: 16,
    shift_register_outputs: [1, 0, 1, 1, 0, 0, 0, 1],
    relay_contacts_closed: true,
    button_pressed: true,
    pot_wiper: 0.25,
    rfid_card_present: true,
    thermocouple_temp_quarter_deg: 100,
    pcf8574_output_reg: 0x5a,
    pcf8574_input_reg: 0xa5,
    mcp23017_iodira: 0x01,
    mcp23017_iodirb: 0x02,
    mcp23017_gpioa: 0x03,
    mcp23017_gpiob: 0x04,
    mcp23017_olata: 0x0f,
    mcp23017_olatb: 0xf0,
    ads1115_config: 0x85eb,
    ads1115_conversion: 4095,
    ads1115_conversion_ready: true,
    shift595_shift_reg: 0xaa,
    shift595_storage_reg: 0x55,
    shift595_outputs_enabled: true,
    pcd8544_x: 10,
    pcd8544_y: 2,
    pcd8544_vertical: true,
    pcd8544_extended: false,
    pcd8544_powerDown: false,
    pcd8544_blanked: false,
    pcd8544_inverse: true,
    pcd8544_vop: 64,
    mcp4725_value: 2048,
    pca9685_duty: [4095, ...new Array(15).fill(0)],
    pca9685_prescale: 121,
    rtc_seconds: 30,
    rtc_minutes: 15,
    rtc_hours: 10,
    rtc_day: 3,
    rtc_date: 7,
    rtc_month: 11,
    rtc_year: 126,
    sensor_temp_milli_c: 23500,
    sensor_pressure_pa: 101325,
    sensor_lux: 300,
    sensor_humidity_milli_pct: 45000,
    max7219_decode_mode: 0,
    max7219_intensity: 8,
    max7219_scan_limit: 7,
    max7219_shutdown: false,
    max7219_display_test: false,
    ...overrides,
  };
}

const source = (states: FFIPartStateSnapshot[]): PartStateSource => ({
  getPartStates: () => states,
});

describe('part state accessors', () => {
  it('looks up one part by id and reports its kind', () => {
    const states = [makeState({ partId: 'a' }), makeState({ partId: 'b', kind: 'stepper' })];
    expect(getPartState(source(states), 'b')?.kind).toBe('stepper');
    expect(getPartState(source(states), 'missing')).toBeNull();
    expect(getPartKind(findPartState(states, 'a'))).toBe('servo');
    expect(getPartKind(null)).toBeNull();
  });

  it('reads framebuffer, servo and stepper slices', () => {
    const src = source([makeState()]);
    expect(getFramebuffer(src, 'p1')).toEqual({ offset: 1024, size: 512, width: 128, height: 64 });
    expect(getFramebuffer(source([makeState({ framebuffer_size: 0 })]), 'p1')).toBeNull();
    expect(getFramebuffer(src, 'missing')).toBeNull();
    expect(getServoAngle(src, 'p1')).toBe(45);
    expect(getServoAngle(src, 'missing')).toBe(0);
    expect(getStepperAngle(src, 'p1')).toBeCloseTo(90.1, 6);
    expect(getStepperDriverOutputs(src, 'p1')).toEqual([1, 0, 1, 0]);
    expect(getStepperDriverOutputs(src, 'missing')).toEqual([]);
  });

  it('reads display slices including LCD text', () => {
    const src = source([makeState()]);
    expect(getSevenSegmentDigits(src, 'p1')).toEqual([1, 2, 3, 4, 0, 0, 0, 0]);
    expect(getSevenSegmentColon(src, 'p1')).toBe(true);
    expect(getLcdGeometry(src, 'p1')).toEqual({ rows: 2, cols: 16 });
    const text = getLcdText(src, 'p1');
    expect(text.split('\n')).toHaveLength(2);
    expect(text.startsWith('Hi')).toBe(true);
    expect(getLcdText(source([makeState({ lcd_cols: 0 })]), 'p1')).toBe('');
    expect(getShiftRegisterOutputs(src, 'p1')).toHaveLength(8);
  });

  it('reads switches, wipers and thermocouple', () => {
    const src = source([makeState()]);
    expect(getRelayContactsClosed(src, 'p1')).toBe(true);
    expect(getRelayContactsClosed(src, 'missing')).toBe(false);
    expect(getButtonPressed(src, 'p1')).toBe(true);
    expect(getPotWiper(src, 'p1')).toBeCloseTo(0.25, 6);
    expect(getRfidCardPresent(src, 'p1')).toBe(true);
    expect(getThermocoupleTempC(src, 'p1')).toBeCloseTo(25, 6);
  });

  it('reads I2C expander and driver slices', () => {
    const src = source([makeState()]);
    expect(getPcf8574Regs(src, 'p1')).toEqual({ output: 0x5a, input: 0xa5 });
    expect(getPcf8574Regs(src, 'missing')).toBeNull();
    expect(getMcp23017Regs(src, 'p1')).toEqual({
      iodirA: 0x01,
      iodirB: 0x02,
      gpioA: 0x03,
      gpioB: 0x04,
      olatA: 0x0f,
      olatB: 0xf0,
    });
    expect(getAds1115Reading(src, 'p1')).toEqual({
      config: 0x85eb,
      conversion: 4095,
      conversionReady: true,
    });
    expect(getShift595State(src, 'p1')).toEqual({
      shiftReg: 0xaa,
      storageReg: 0x55,
      outputsEnabled: true,
    });
    expect(getMcp4725Value(src, 'p1')).toBe(2048);
    expect(getPca9685Duty(src, 'p1')).toHaveLength(16);
  });

  it('reads display-controller, RTC, sensor and MAX7219 slices', () => {
    const src = source([makeState()]);
    expect(getRtcTime(src, 'p1')).toEqual({
      seconds: 30,
      minutes: 15,
      hours: 10,
      day: 3,
      date: 7,
      month: 11,
      year: 126,
    });
    expect(getSensorReadings(src, 'p1')).toEqual({
      tempMilliC: 23500,
      pressurePa: 101325,
      lux: 300,
      humidityMilliPct: 45000,
    });
    expect(getMax7219Config(src, 'p1')).toEqual({
      decodeMode: 0,
      intensity: 8,
      scanLimit: 7,
      shutdown: false,
      displayTest: false,
    });
  });

  it('indexes a snapshot array for one-frame lookups', () => {
    const index = indexPartStates([makeState({ partId: 'x' }), makeState({ partId: 'y' })]);
    expect(index.get('x')?.partId).toBe('x');
    expect(index.has('y')).toBe(true);
    expect(indexPartStates(null).size).toBe(0);
    expect(findPartState(null, 'x')).toBeNull();
    expect(findPartState(undefined, 'x')).toBeNull();
  });

  it('tolerates future snapshot fields that have not landed yet', () => {
    const src = source([makeState()]);
    // The schema does not carry these fields yet, so they read null rather
    // than a default the engine never reported.
    expect(getSonarEchoUs(src, 'p1')).toBeNull();
    expect(getIna219Reading(src, 'p1')).toBeNull();
    expect(getDialerDigit(src, 'p1')).toBeNull();
    expect(getIrCode(src, 'p1')).toBeNull();
  });
});
