/**
 * engine-wasm/parts.ts — Typed accessors over `PartStateSnapshot`.
 *
 * The C++ engine reports each part's decoded state once per solve through
 * `WasmEngine.getPartStates()`. UI code (the bench's render state, the
 * instruments' Inspector) should read part state through here rather than
 * reaching into the legacy TS engine's part maps: the snapshots are the one
 * representation both engines agree on.
 *
 * Every accessor takes the same source either way — a pre-fetched snapshot
 * array or the engine itself — and returns a typed value instead of the raw
 * `Record`, so callers never cast. Lookups are by part id; a missing part
 * reads as null / zero / empty rather than throwing, because not every
 * bench part has a snapshot row for a given field group.
 *
 * Issue #40: React consumption of PartStateSnapshot.
 */

import type { WasmEngine } from './adapter';
import type { FFIPartStateSnapshot } from './generated/ffi';

export type { FFIPartStateSnapshot };
/** The snapshot type as UI code names it. */
export type PartStateSnapshot = FFIPartStateSnapshot;

/** Anything that can hand over the decoded snapshots: the wasm engine, or a test stub. */
export type PartStateSource = Pick<WasmEngine, 'getPartStates'>;

/**
 * Framebuffer info decoded from an FFIPartStateSnapshot: the wasm-memory
 * offset of the pixel buffer, its size in bytes, and the panel geometry.
 */
export interface FramebufferInfo {
  offset: number;
  size: number;
  width: number;
  height: number;
}

/** Generic I2C sensor readings, in their native units. */
export interface SensorReadings {
  tempMilliC: number;
  pressurePa: number;
  lux: number;
  humidityMilliPct: number;
}

/** PCF8574 I/O expander registers. */
export interface Pcf8574Regs {
  output: number;
  input: number;
}

/** MCP23017 I/O expander registers. */
export interface Mcp23017Regs {
  iodirA: number;
  iodirB: number;
  gpioA: number;
  gpioB: number;
  olatA: number;
  olatB: number;
}

/** ADS1115 ADC conversion state. */
export interface Ads1115Reading {
  config: number;
  conversion: number;
  conversionReady: boolean;
}

/** 74HC595 shift-register state. */
export interface Shift595State {
  shiftReg: number;
  storageReg: number;
  outputsEnabled: boolean;
}

/** PCD8544 (Nokia 5110) display state. */
export interface Pcd8544State {
  x: number;
  y: number;
  vertical: boolean;
  extended: boolean;
  powerDown: boolean;
  blanked: boolean;
  inverse: boolean;
  vop: number;
}

/** MAX7219 segment-driver configuration. */
export interface Max7219Config {
  decodeMode: number;
  intensity: number;
  scanLimit: number;
  shutdown: boolean;
  displayTest: boolean;
}

/** RTC time. */
export interface RtcTime {
  seconds: number;
  minutes: number;
  hours: number;
  day: number;
  date: number;
  month: number;
  year: number;
}

/** INA219 current/power-sensor reading (future snapshot field; absent reads null). */
export interface Ina219Reading {
  busVolts: number;
  shuntMillivolts: number;
  currentMilliAmps: number;
  powerMilliwatts: number;
}

/**
 * Totally decodes every part's snapshot in one pass. The single decode per
 * render frame is the point: a bench with dozens of parts must not pay a
 * full wasm-memory walk per accessor call.
 */
export function getAllPartStates(source: PartStateSource): FFIPartStateSnapshot[] {
  return source.getPartStates();
}

/**
 * Finds one part's snapshot in an already-fetched array, or null when the
 * part has no row.
 */
export function findPartState(
  states: readonly FFIPartStateSnapshot[] | null | undefined,
  partId: string,
): FFIPartStateSnapshot | null {
  if (!states) return null;
  return states.find((state) => state.partId === partId) ?? null;
}

/** Indexes a snapshot array by part id for one render frame's lookups. */
export function indexPartStates(
  states: readonly FFIPartStateSnapshot[] | null | undefined,
): ReadonlyMap<string, FFIPartStateSnapshot> {
  const index = new Map<string, FFIPartStateSnapshot>();
  for (const state of states ?? []) index.set(state.partId, state);
  return index;
}

/**
 * Reads a single part's state from the engine.
 * Returns null if the part is not found.
 */
export function getPartState(source: PartStateSource, partId: string): FFIPartStateSnapshot | null {
  return findPartState(source.getPartStates(), partId);
}

/**
 * The snapshot `kind` for a part (e.g. `'servo'`, `'mcu'`), or null.
 */
export function getPartKind(state: FFIPartStateSnapshot | null): string | null {
  return state?.kind ?? null;
}

/**
 * Read framebuffer info for a display part.
 * Returns null when the part has no row or no framebuffer.
 */
export function getFramebuffer(
  source: PartStateSource,
  partId: string,
): FramebufferInfo | null {
  const state = getPartState(source, partId);
  if (!state || state.framebuffer_size === 0) return null;
  return {
    offset: state.framebuffer,
    size: state.framebuffer_size,
    width: state.width,
    height: state.height,
  };
}

/**
 * Read servo angle (0-180 degrees) from part state.
 */
export function getServoAngle(source: PartStateSource, partId: string): number {
  const state = getPartState(source, partId);
  return state?.servo_angle ?? 0;
}

/**
 * Read stepper shaft angle in degrees, decoded from the deci-degree field.
 */
export function getStepperAngle(source: PartStateSource, partId: string): number {
  const state = getPartState(source, partId);
  return (state?.stepper_angle_deci_deg ?? 0) / 10;
}

/** Raw stepper shaft angle in deci-degrees (0.1° steps). */
export function getStepperAngleDeciDeg(source: PartStateSource, partId: string): number {
  const state = getPartState(source, partId);
  return state?.stepper_angle_deci_deg ?? 0;
}

/** Stepper driver output levels, 4-tuple. */
export function getStepperDriverOutputs(
  source: PartStateSource,
  partId: string,
): readonly number[] {
  const state = getPartState(source, partId);
  return state?.stepper_driver_outputs ?? [];
}

/**
 * Read 7-segment display digits from part state.
 */
export function getSevenSegmentDigits(source: PartStateSource, partId: string): number[] {
  const state = getPartState(source, partId);
  return state ? [...state.seven_seg_digits] : [];
}

/** 7-segment colon lit flag. */
export function getSevenSegmentColon(source: PartStateSource, partId: string): boolean {
  const state = getPartState(source, partId);
  return (state?.seven_seg_colon ?? 0) !== 0;
}

/**
 * Read LCD character codes from part state (row-major DDRAM bytes).
 */
export function getLcdChars(source: PartStateSource, partId: string): number[] {
  const state = getPartState(source, partId);
  return state ? [...state.lcd_chars] : [];
}

/**
 * Read the LCD glass as text, one line per row. Trailing blanks on each
 * row are kept — the glass shows them, unlike the token-trimmed element.
 */
export function getLcdText(source: PartStateSource, partId: string): string {
  const state = getPartState(source, partId);
  if (!state || state.lcd_cols === 0 || state.lcd_rows === 0) return '';
  const lines: string[] = [];
  for (let row = 0; row < state.lcd_rows; row++) {
    let line = '';
    for (let column = 0; column < state.lcd_cols; column++) {
      line += String.fromCharCode(state.lcd_chars[row * state.lcd_cols + column] ?? 32);
    }
    lines.push(line);
  }
  return lines.join('\n');
}

/** LCD geometry from the snapshot. */
export function getLcdGeometry(
  source: PartStateSource,
  partId: string,
): { rows: number; cols: number } {
  const state = getPartState(source, partId);
  return { rows: state?.lcd_rows ?? 0, cols: state?.lcd_cols ?? 0 };
}

/**
 * Read shift register outputs from part state.
 */
export function getShiftRegisterOutputs(source: PartStateSource, partId: string): number[] {
  const state = getPartState(source, partId);
  return state ? [...state.shift_register_outputs] : [];
}

/** Relay contact closed flag. */
export function getRelayContactsClosed(source: PartStateSource, partId: string): boolean {
  const state = getPartState(source, partId);
  return state?.relay_contacts_closed ?? false;
}

/** Momentary button pressed flag. */
export function getButtonPressed(source: PartStateSource, partId: string): boolean {
  const state = getPartState(source, partId);
  return state?.button_pressed ?? false;
}

/**
 * Read potentiometer wiper position from part state (0.0-1.0).
 */
export function getPotWiper(source: PartStateSource, partId: string): number {
  const state = getPartState(source, partId);
  return state?.pot_wiper ?? 0;
}

/** RFID card present flag. */
export function getRfidCardPresent(source: PartStateSource, partId: string): boolean {
  const state = getPartState(source, partId);
  return state?.rfid_card_present ?? false;
}

/** Thermocouple temperature in degrees C, from 0.25° quarter-degree steps. */
export function getThermocoupleTempC(source: PartStateSource, partId: string): number {
  const state = getPartState(source, partId);
  return (state?.thermocouple_temp_quarter_deg ?? 0) / 4;
}

/** PCF8574 I/O expander registers. */
export function getPcf8574Regs(source: PartStateSource, partId: string): Pcf8574Regs | null {
  const state = getPartState(source, partId);
  if (!state) return null;
  return { output: state.pcf8574_output_reg, input: state.pcf8574_input_reg };
}

/** MCP23017 I/O expander registers. */
export function getMcp23017Regs(source: PartStateSource, partId: string): Mcp23017Regs | null {
  const state = getPartState(source, partId);
  if (!state) return null;
  return {
    iodirA: state.mcp23017_iodira,
    iodirB: state.mcp23017_iodirb,
    gpioA: state.mcp23017_gpioa,
    gpioB: state.mcp23017_gpiob,
    olatA: state.mcp23017_olata,
    olatB: state.mcp23017_olatb,
  };
}

/** ADS1115 ADC conversion state. */
export function getAds1115Reading(source: PartStateSource, partId: string): Ads1115Reading | null {
  const state = getPartState(source, partId);
  if (!state) return null;
  return {
    config: state.ads1115_config,
    conversion: state.ads1115_conversion,
    conversionReady: state.ads1115_conversion_ready,
  };
}

/** 74HC595 shift-register state. */
export function getShift595State(source: PartStateSource, partId: string): Shift595State | null {
  const state = getPartState(source, partId);
  if (!state) return null;
  return {
    shiftReg: state.shift595_shift_reg,
    storageReg: state.shift595_storage_reg,
    outputsEnabled: state.shift595_outputs_enabled,
  };
}

/** PCD8544 (Nokia 5110) display state. */
export function getPcd8544State(source: PartStateSource, partId: string): Pcd8544State | null {
  const state = getPartState(source, partId);
  if (!state) return null;
  return {
    x: state.pcd8544_x,
    y: state.pcd8544_y,
    vertical: state.pcd8544_vertical,
    extended: state.pcd8544_extended,
    powerDown: state.pcd8544_powerDown,
    blanked: state.pcd8544_blanked,
    inverse: state.pcd8544_inverse,
    vop: state.pcd8544_vop,
  };
}

/** MCP4725 DAC output value. */
export function getMcp4725Value(source: PartStateSource, partId: string): number {
  const state = getPartState(source, partId);
  return state?.mcp4725_value ?? 0;
}

/** PCA9685 PWM duty cycle per channel (16 values). */
export function getPca9685Duty(source: PartStateSource, partId: string): number[] {
  const state = getPartState(source, partId);
  return state ? [...state.pca9685_duty] : [];
}

/** PCA9685 prescaler. */
export function getPca9685Prescale(source: PartStateSource, partId: string): number {
  const state = getPartState(source, partId);
  return state?.pca9685_prescale ?? 0;
}

/** RTC time from part state. */
export function getRtcTime(source: PartStateSource, partId: string): RtcTime | null {
  const state = getPartState(source, partId);
  if (!state) return null;
  return {
    seconds: state.rtc_seconds,
    minutes: state.rtc_minutes,
    hours: state.rtc_hours,
    day: state.rtc_day,
    date: state.rtc_date,
    month: state.rtc_month,
    year: state.rtc_year,
  };
}

/**
 * Read sensor readings from part state.
 */
export function getSensorReadings(source: PartStateSource, partId: string): SensorReadings {
  const state = getPartState(source, partId);
  return {
    tempMilliC: state?.sensor_temp_milli_c ?? 0,
    pressurePa: state?.sensor_pressure_pa ?? 0,
    lux: state?.sensor_lux ?? 0,
    humidityMilliPct: state?.sensor_humidity_milli_pct ?? 0,
  };
}

/** MAX7219 segment-driver configuration. */
export function getMax7219Config(source: PartStateSource, partId: string): Max7219Config | null {
  const state = getPartState(source, partId);
  if (!state) return null;
  return {
    decodeMode: state.max7219_decode_mode,
    intensity: state.max7219_intensity,
    scanLimit: state.max7219_scan_limit,
    shutdown: state.max7219_shutdown,
    displayTest: state.max7219_display_test,
  };
}

// ---------------------------------------------------------------------------
// Fields the C++ snapshot has not landed yet. These read through an unknown
// overlay so they stay null until the schema grows the field, instead of
// inventing a value the engine never reported.
// ---------------------------------------------------------------------------

/** Raw optional field lookup against a snapshot that may not carry it yet. */
function optionalField(state: FFIPartStateSnapshot | null, key: string): unknown {
  if (!state) return undefined;
  return (state as unknown as Record<string, unknown>)[key];
}

/** Sonar echo time in microseconds, or null until the snapshot carries it. */
export function getSonarEchoUs(source: PartStateSource, partId: string): number | null {
  const value = optionalField(getPartState(source, partId), 'sonar_echo_us');
  return typeof value === 'number' ? value : null;
}

/** INA219 current/power reading, or null until the snapshot carries it. */
export function getIna219Reading(source: PartStateSource, partId: string): Ina219Reading | null {
  const state = getPartState(source, partId);
  const busVolts = optionalField(state, 'ina219_bus_volts');
  if (typeof busVolts !== 'number') return null;
  return {
    busVolts,
    shuntMillivolts: (optionalField(state, 'ina219_shunt_millivolts') as number) ?? 0,
    currentMilliAmps: (optionalField(state, 'ina219_current_milli_amps') as number) ?? 0,
    powerMilliwatts: (optionalField(state, 'ina219_power_milliwatts') as number) ?? 0,
  };
}

/** Rotary-encoder count, or null until the snapshot carries it. */
export function getEncoderCount(source: PartStateSource, partId: string): number | null {
  const value = optionalField(getPartState(source, partId), 'encoder_count');
  return typeof value === 'number' ? value : null;
}

/** Dialer latched digit, or null until the snapshot carries it. */
export function getDialerDigit(source: PartStateSource, partId: string): number | null {
  const value = optionalField(getPartState(source, partId), 'dialer_digit');
  return typeof value === 'number' ? value : null;
}

/** IR receiver code, or null until the snapshot carries it. */
export function getIrCode(source: PartStateSource, partId: string): number | null {
  const value = optionalField(getPartState(source, partId), 'ir_code');
  return typeof value === 'number' ? value : null;
}

/** SD card used bytes, or null until the snapshot carries it. */
export function getSdUsedBytes(source: PartStateSource, partId: string): number | null {
  const value = optionalField(getPartState(source, partId), 'sd_used_bytes');
  return typeof value === 'number' ? value : null;
}
