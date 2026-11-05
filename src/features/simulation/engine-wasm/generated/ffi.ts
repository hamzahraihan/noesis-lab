// Generated from native/abi/engine-ffi.schema.json — DO NOT EDIT

// ============================================================================
// FFI Protocol Version
// ============================================================================
export const FFI_PROTOCOL_VERSION = 1;

// Status codes shared with native/include/ffi-generated.h.
// Const objects instead of enums: the app compiles with erasableSyntaxOnly,
// which rejects enum declarations.
export const FFIStatus = {
  Ok: 0,
  InvalidHandle: 1,
  NotImplemented: 2,
} as const;

export type FFIStatus = (typeof FFIStatus)[keyof typeof FFIStatus];

export const FFI_HANDLE_NONE = 0;

// C entry points the Wasm module exports (see ffi.exports in the schema).
export const FFI_EXPORTED_FUNCTIONS = ["engine_create","engine_step","engine_set_pin","engine_set_knob","engine_get_state","engine_get_voltages","engine_get_serial","engine_set_breakpoint","engine_clear_breakpoint","engine_set_step_over","engine_set_step_into","engine_get_debug_state","engine_destroy"] as const;

// ============================================================================
// Commands (UI → Engine)
// ============================================================================

export const FFICommandType = {
  LoadCircuit: 0,
  LoadSketch: 1,
  Step: 2,
  SetPin: 3,
  SetKnob: 4,
  SetMeterMode: 5,
  SetBreakpoint: 6,
  Continue: 7,
  StepOver: 8,
  StepInto: 9,
} as const;

export type FFICommandType = (typeof FFICommandType)[keyof typeof FFICommandType];

export interface FFICommandHeader {
  type: FFICommandType;
}

export interface FFILoadCircuitCommand extends FFICommandHeader {
  type: typeof FFICommandType.LoadCircuit;
  circuitJson: string;
}

export interface FFILoadSketchCommand extends FFICommandHeader {
  type: typeof FFICommandType.LoadSketch;
  source: string;
  language: 'cpp' | 'py';
}

export interface FFIStepCommand extends FFICommandHeader {
  type: typeof FFICommandType.Step;
  dtMs: number;
}

export interface FFISetPinCommand extends FFICommandHeader {
  type: typeof FFICommandType.SetPin;
  partId: string;
  pin: string;
  level: boolean;
}

export interface FFISetKnobCommand extends FFICommandHeader {
  type: typeof FFICommandType.SetKnob;
  partId: string;
  knob: string;
  value: number;
}

export const FFIMeterMode = {
  Off: 0,
  Volts: 1,
  Amps: 2,
  Ohms: 3,
} as const;

export type FFIMeterMode = (typeof FFIMeterMode)[keyof typeof FFIMeterMode];

export interface FFISetMeterModeCommand extends FFICommandHeader {
  type: typeof FFICommandType.SetMeterMode;
  mode: FFIMeterMode;
}

export interface FFISetBreakpointCommand extends FFICommandHeader {
  type: typeof FFICommandType.SetBreakpoint;
  pc: number;
  enabled: boolean;
}

export interface FFIContinueCommand extends FFICommandHeader {
  type: typeof FFICommandType.Continue;
}

export interface FFIStepOverCommand extends FFICommandHeader {
  type: typeof FFICommandType.StepOver;
}

export interface FFIStepIntoCommand extends FFICommandHeader {
  type: typeof FFICommandType.StepInto;
}

export type FFICommand =
  | FFILoadCircuitCommand
  | FFILoadSketchCommand
  | FFIStepCommand
  | FFISetPinCommand
  | FFISetKnobCommand
  | FFISetMeterModeCommand
  | FFISetBreakpointCommand
  | FFIContinueCommand
  | FFIStepOverCommand
  | FFIStepIntoCommand;

// ============================================================================
// Events (Engine → UI)
// ============================================================================

export const FFIEventType = {
  Solved: 0,
  DigitalLevels: 1,
  AnalogReadings: 2,
  SerialOutput: 3,
  DisplayFramebuffers: 4,
  ProbeSamples: 5,
  DebuggerState: 6,
  Faults: 7,
} as const;

export type FFIEventType = (typeof FFIEventType)[keyof typeof FFIEventType];

export interface FFIEventHeader {
  type: FFIEventType;
}

export interface FFISolvedEvent extends FFIEventHeader {
  type: typeof FFIEventType.Solved;
  timeMs: number;
  voltages: Float64Array;
  sourceCurrents: Float64Array;
}

export interface FFIDigitalLevelsEvent extends FFIEventHeader {
  type: typeof FFIEventType.DigitalLevels;
  levels: boolean[];
}

export interface FFIAnalogReadingsEvent extends FFIEventHeader {
  type: typeof FFIEventType.AnalogReadings;
  readings: number[];
}

export interface FFISerialOutputEvent extends FFIEventHeader {
  type: typeof FFIEventType.SerialOutput;
  output: string;
}

export const FFIFramebufferKind = {
  Monochrome: 0,
  RGB565: 1,
  SevenSeg: 2,
  LCD: 3,
} as const;

export type FFIFramebufferKind = (typeof FFIFramebufferKind)[keyof typeof FFIFramebufferKind];

export const FFIFramebufferFormat = {
  Bpp1: 0,
  RGB565: 1,
  SevenSeg: 2,
  LCD: 3,
} as const;

export type FFIFramebufferFormat =
  (typeof FFIFramebufferFormat)[keyof typeof FFIFramebufferFormat];

export interface FFIFramebufferDescriptor {
  partId: string;
  kind: FFIFramebufferKind;
  format: FFIFramebufferFormat;
  width: number;
  height: number;
  data: Uint8Array | Uint16Array;
}

export interface FFIDisplayFramebuffersEvent extends FFIEventHeader {
  type: typeof FFIEventType.DisplayFramebuffers;
  framebuffers: FFIFramebufferDescriptor[];
}

export interface FFIProbeSample {
  netIndex: number;
  voltage: number;
}

export interface FFIProbeSamplesEvent extends FFIEventHeader {
  type: typeof FFIEventType.ProbeSamples;
  samples: FFIProbeSample[];
}

export interface FFILocalSymbol {
  name: string;
  address: number;
}

export interface FFIDebuggerStateEvent extends FFIEventHeader {
  type: typeof FFIEventType.DebuggerState;
  pc: number;
  sp: number;
  cycles: number;
  registers: Uint8Array;  // length 32
  sreg: number;
  stack: number[];
  locals: FFILocalSymbol[];
}

export interface FFIFaultsEvent extends FFIEventHeader {
  type: typeof FFIEventType.Faults;
  faults: string[];
}

export type FFIEvent =
  | FFISolvedEvent
  | FFIDigitalLevelsEvent
  | FFIAnalogReadingsEvent
  | FFISerialOutputEvent
  | FFIDisplayFramebuffersEvent
  | FFIProbeSamplesEvent
  | FFIDebuggerStateEvent
  | FFIFaultsEvent;

// ============================================================================
// Circuit Snapshot (passed in LoadCircuit)
// ============================================================================

export interface FFICircuitSnapshot {
  bench: unknown;  // CircuitDoc JSON
  dynamicState: unknown;  // DynamicState JSON
}

// ============================================================================
// Part State Snapshot (matches C++ FFIPartStateSnapshot)
// ============================================================================

export interface FFIPartStateSnapshot {
  partId: string;
  kind: string;

  // Display framebuffers
  framebuffer: number;  // Wasm memory offset
  framebuffer_size: number;
  width: number;
  height: number;

  // Servo angle (0-180)
  servo_angle: number;

  // Stepper angle (0-360 degrees * 10 for 0.1 deg precision)
  stepper_angle_deci_deg: number;

  // Stepper driver output states
  stepper_driver_outputs: [number, number, number, number];

  // 7-segment display state
  seven_seg_digits: [number, number, number, number, number, number, number, number];
  seven_seg_colon: number;

  // Character LCD state
  lcd_chars: number[];
  lcd_rows: number;
  lcd_cols: number;

  // Shift register outputs
  shift_register_outputs: [number, number, number, number, number, number, number, number];

  // Relay contact state (true = contact closed)
  relay_contacts_closed: boolean;

  // Button pressed state (true = pressed)
  button_pressed: boolean;

  // Potentiometer wiper position, 0.0 - 1.0
  pot_wiper: number;

  // RF ID card presence
  rfid_card_present: boolean;

  // Thermocouple temperature (0.25 degree steps)
  thermocouple_temp_quarter_deg: number;

  // PCF8574 I2C expander state
  pcf8574_output_reg: number;
  pcf8574_input_reg: number;

  // MCP23017 I2C expander state
  mcp23017_iodira: number;
  mcp23017_iodirb: number;
  mcp23017_gpioa: number;
  mcp23017_gpiob: number;
  mcp23017_olata: number;
  mcp23017_olatb: number;

  // ADS1115 ADC state
  ads1115_config: number;
  ads1115_conversion: number;
  ads1115_conversion_ready: boolean;

  // Shift register (74HC595) state
  shift595_shift_reg: number;
  shift595_storage_reg: number;
  shift595_outputs_enabled: boolean;

  // PCD8544 (Nokia 5110) state
  pcd8544_x: number;
  pcd8544_y: number;
  pcd8544_vertical: boolean;
  pcd8544_extended: boolean;
  pcd8544_powerDown: boolean;
  pcd8544_blanked: boolean;
  pcd8544_inverse: boolean;
  pcd8544_vop: number;

  // MCP4725 DAC state
  mcp4725_value: number;

  // PCA9685 PWM driver state
  pca9685_duty: number[];
  pca9685_prescale: number;

  // RTC time
  rtc_seconds: number;
  rtc_minutes: number;
  rtc_hours: number;
  rtc_day: number;
  rtc_date: number;
  rtc_month: number;
  rtc_year: number;

  // Generic I2C sensor state
  sensor_temp_milli_c: number;
  sensor_pressure_pa: number;
  sensor_lux: number;
  sensor_humidity_milli_pct: number;

  // MAX7219 config
  max7219_decode_mode: number;
  max7219_intensity: number;
  max7219_scan_limit: number;
  max7219_shutdown: boolean;
  max7219_display_test: boolean;
}

export interface FFIPartStateSnapshotResponse {
  parts: FFIPartStateSnapshot[];
}

// ============================================================================
// Serialization Helpers
// ============================================================================

/**
 * Serializes an FFICommand to a flat buffer for Wasm.
 * Returns { commandBuffer: Uint8Array, stringBuffer: Uint8Array }
 */
export function serializeCommand(_cmd: FFICommand): { commandBuffer: Uint8Array; stringBuffer: Uint8Array } {
  // Implementation deferred to adapter.ts
  throw new Error('Not implemented - use WasmEngine adapter');
}

/**
 * Deserializes an FFIEvent from Wasm memory.
 */
export function deserializeEvent(
  _memory: WebAssembly.Memory,
  _eventPtr: number
): FFIEvent {
  // Implementation deferred to adapter.ts
  throw new Error('Not implemented - use WasmEngine adapter');
}

/**
 * Deserializes PartStateSnapshot array from Wasm memory.
 */
export function deserializePartStates(
  _memory: WebAssembly.Memory,
  _partsPtr: number,
  _count: number
): FFIPartStateSnapshot[] {
  // Implementation deferred to adapter.ts
  throw new Error('Not implemented - use WasmEngine adapter');
}
