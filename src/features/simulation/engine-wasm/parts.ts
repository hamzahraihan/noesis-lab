/**
 * engine-wasm/parts.ts — Bridge for reading PartStateSnapshot from the
 * C++ engine via WasmEngine.
 *
 * Decodes the FFIPartStateSnapshot array returned by engine_get_state()
 * and exposes typed accessors for each part's state.
 *
 * Issue #59: UI Consumption of PartStateSnapshot.
 */

import type { WasmEngine } from './adapter';

/**
 * Framebuffer info decoded from an FFIPartStateSnapshot.
 */
export interface FramebufferInfo {
  offset: number;
  size: number;
  width: number;
  height: number;
}

/**
 * Read a single part's state from the engine.
 * Returns null if the part is not found.
 */
export function getPartState(engine: WasmEngine, partId: string): Record<string, unknown> | null {
  const states = engine.getPartStates() as Record<string, unknown>[];
  return states.find((s) => s.partId === partId) ?? null;
}

/**
 * Read framebuffer info for a display part.
 */
export function getFramebuffer(engine: WasmEngine, partId: string): FramebufferInfo | null {
  const state = getPartState(engine, partId);
  if (!state) return null;
  return {
    offset: state.framebuffer as number,
    size: state.framebuffer_size as number,
    width: state.width as number,
    height: state.height as number,
  };
}

/**
 * Read servo angle from part state.
 */
export function getServoAngle(engine: WasmEngine, partId: string): number {
  const state = getPartState(engine, partId);
  return (state?.servo_angle as number) ?? 0;
}

/**
 * Read stepper angle (in deci-degrees) from part state.
 */
export function getStepperAngle(engine: WasmEngine, partId: string): number {
  const state = getPartState(engine, partId);
  return (state?.stepper_angle_deci_deg as number) ?? 0;
}

/**
 * Read 7-segment display digits from part state.
 */
export function getSevenSegmentDigits(engine: WasmEngine, partId: string): number[] {
  const state = getPartState(engine, partId);
  return (state?.seven_seg_digits as number[]) ?? [];
}

/**
 * Read LCD characters from part state.
 */
export function getLcdChars(engine: WasmEngine, partId: string): number[] {
  const state = getPartState(engine, partId);
  return (state?.lcd_chars as number[]) ?? [];
}

/**
 * Read shift register outputs from part state.
 */
export function getShiftRegisterOutputs(engine: WasmEngine, partId: string): number[] {
  const state = getPartState(engine, partId);
  return (state?.shift_register_outputs as number[]) ?? [];
}

/**
 * Read potentiometer wiper position from part state.
 */
export function getPotWiper(engine: WasmEngine, partId: string): number {
  const state = getPartState(engine, partId);
  return (state?.pot_wiper as number) ?? 0;
}

/**
 * Read sensor readings from part state.
 */
export function getSensorReadings(engine: WasmEngine, partId: string): {
  tempMilliC: number;
  pressurePa: number;
  lux: number;
  humidityMilliPct: number;
} {
  const state = getPartState(engine, partId);
  return {
    tempMilliC: (state?.sensor_temp_milli_c as number) ?? 0,
    pressurePa: (state?.sensor_pressure_pa as number) ?? 0,
    lux: (state?.sensor_lux as number) ?? 0,
    humidityMilliPct: (state?.sensor_humidity_milli_pct as number) ?? 0,
  };
}
