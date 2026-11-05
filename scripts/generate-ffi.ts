#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SCHEMA = join(ROOT, 'native/abi/engine-ffi.schema.json');
const CXX_OUT = join(ROOT, 'native/include/ffi-generated.h');
const TS_OUT = join(ROOT, 'src/features/simulation/engine-wasm/generated/ffi.ts');

export function parseSchema(): unknown {
  return JSON.parse(readFileSync(SCHEMA, 'utf-8'));
}

interface FfiExport {
  name: string;
  returns: string;
  parameters: string[];
}

/**
 * Reads the exported C entry points from the schema. The Emscripten build and
 * the tests both take this list from the schema, so an entry point cannot be
 * declared in one place and forgotten in another.
 */
export function ffiExports(schema: unknown): FfiExport[] {
  const table = (schema as { ffi?: { exports?: unknown } }).ffi?.exports;
  if (!Array.isArray(table) || table.length === 0) {
    throw new Error('engine-ffi.schema.json: ffi.exports must be a non-empty array');
  }
  return table.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`engine-ffi.schema.json: ffi.exports[${index}] must be an object`);
    }
    const { name, returns, parameters } = entry as Record<string, unknown>;
    if (typeof name !== 'string' || !/^[a-z_][a-z0-9_]*$/.test(name)) {
      throw new Error(`engine-ffi.schema.json: ffi.exports[${index}] has an invalid name`);
    }
    if (typeof returns !== 'string' || returns.length === 0) {
      throw new Error(`engine-ffi.schema.json: ffi.exports[${index}] (${name}) has no return type`);
    }
    if (!Array.isArray(parameters) || parameters.some((param) => typeof param !== 'string')) {
      throw new Error(`engine-ffi.schema.json: ffi.exports[${index}] (${name}) has invalid parameters`);
    }
    return { name, returns, parameters: parameters as string[] };
  });
}

export function generateCppHeader(schema: unknown): string {
  // The struct shape stays hardcoded so the packing is explicit; the exported
  // entry points are read from the schema below.
  const entryPoints = ffiExports(schema)
    .map((entry) => `${entry.returns} ${entry.name}(${entry.parameters.join(', ')});`)
    .join('\n');
  return `// Generated from native/abi/engine-ffi.schema.json — DO NOT EDIT
#pragma once
#include <cstdint>
#include <cstddef>

#pragma pack(push, 1)

// ============================================================================
// FFI Protocol Version
// ============================================================================
static constexpr uint32_t FFI_PROTOCOL_VERSION = 1;

// ============================================================================
// Commands (UI → Engine)
// ============================================================================

enum class FFICommandType : uint8_t {
    LoadCircuit = 0,
    LoadSketch = 1,
    Step = 2,
    SetPin = 3,
    SetKnob = 4,
    SetMeterMode = 5,
    SetBreakpoint = 6,
    Continue = 7,
    StepOver = 8,
    StepInto = 9,
};

struct FFICommandHeader {
    FFICommandType type;
    uint8_t padding[3];  // Align to 4 bytes
};

// LoadCircuit: circuit JSON passed separately via string buffer
struct FFILoadCircuitCommand {
    FFICommandHeader header;
    // circuit_json follows in string buffer (offset + length)
    uint32_t circuit_json_offset;
    uint32_t circuit_json_length;
};

// LoadSketch: source code + language
struct FFILoadSketchCommand {
    FFICommandHeader header;
    uint32_t source_offset;
    uint32_t source_length;
    uint8_t language;  // 0 = cpp, 1 = py
    uint8_t padding[3];
};

// Step: time delta in milliseconds
struct FFIStepCommand {
    FFICommandHeader header;
    double dt_ms;
    uint8_t padding[4];
};

// SetPin: part ID + pin name + level
struct FFISetPinCommand {
    FFICommandHeader header;
    uint32_t part_id_offset;
    uint32_t part_id_length;
    uint32_t pin_offset;
    uint32_t pin_length;
    bool level;
    uint8_t padding[3];
};

// SetKnob: part ID + knob name + value
struct FFISetKnobCommand {
    FFICommandHeader header;
    uint32_t part_id_offset;
    uint32_t part_id_length;
    uint32_t knob_offset;
    uint32_t knob_length;
    double value;
};

// SetMeterMode: meter mode enum
enum class FFIMeterMode : uint8_t {
    Off = 0,
    Volts = 1,
    Amps = 2,
    Ohms = 3,
};

struct FFISetMeterModeCommand {
    FFICommandHeader header;
    FFIMeterMode mode;
    uint8_t padding[3];
};

// SetBreakpoint: program counter + enable/disable
struct FFISetBreakpointCommand {
    FFICommandHeader header;
    uint32_t pc;
    bool enabled;
    uint8_t padding[3];
};

// Continue: no payload
struct FFIContinueCommand {
    FFICommandHeader header;
};

// StepOver: no payload
struct FFIStepOverCommand {
    FFICommandHeader header;
};

// StepInto: no payload
struct FFIStepIntoCommand {
    FFICommandHeader header;
};

// Union of all commands (for pointer casting)
union FFICommand {
    FFICommandHeader header;
    FFILoadCircuitCommand load_circuit;
    FFILoadSketchCommand load_sketch;
    FFIStepCommand step;
    FFISetPinCommand set_pin;
    FFISetKnobCommand set_knob;
    FFISetMeterModeCommand set_meter_mode;
    FFISetBreakpointCommand set_breakpoint;
    FFIContinueCommand continue_cmd;
    FFIStepOverCommand step_over;
    FFIStepIntoCommand step_into;
};

// ============================================================================
// Events (Engine → UI)
// ============================================================================

enum class FFIEventType : uint8_t {
    Solved = 0,
    DigitalLevels = 1,
    AnalogReadings = 2,
    SerialOutput = 3,
    DisplayFramebuffers = 4,
    ProbeSamples = 5,
    DebuggerState = 6,
    Faults = 7,
};

struct FFIEventHeader {
    FFIEventType type;
    uint8_t padding[3];
};

// Solved: voltages + source currents + time
struct FFISolvedEvent {
    FFIEventHeader header;
    double time_ms;
    uint32_t voltages_offset;
    uint32_t voltages_count;
    uint32_t source_currents_offset;
    uint32_t source_currents_count;
};

// DigitalLevels: boolean array
struct FFIDigitalLevelsEvent {
    FFIEventHeader header;
    uint32_t levels_offset;
    uint32_t levels_count;
};

// AnalogReadings: double array
struct FFIAnalogReadingsEvent {
    FFIEventHeader header;
    uint32_t readings_offset;
    uint32_t readings_count;
};

// SerialOutput: string
struct FFISerialOutputEvent {
    FFIEventHeader header;
    uint32_t output_offset;
    uint32_t output_length;
};

// DisplayFramebuffers: array of framebuffer descriptors
enum class FFIFramebufferKind : uint8_t {
    Monochrome = 0,
    RGB565 = 1,
    SevenSeg = 2,
    LCD = 3,
};

enum class FFIFramebufferFormat : uint8_t {
    Bpp1 = 0,
    RGB565 = 1,
    SevenSeg = 2,
    LCD = 3,
};

struct FFIFramebufferDescriptor {
    uint32_t part_id_offset;
    uint32_t part_id_length;
    FFIFramebufferKind kind;
    FFIFramebufferFormat format;
    uint16_t width;
    uint16_t height;
    uint32_t data_offset;
    uint32_t data_length;
};

struct FFIDisplayFramebuffersEvent {
    FFIEventHeader header;
    uint32_t framebuffers_offset;
    uint32_t framebuffers_count;
};

// ProbeSamples: array of (net_index, voltage)
struct FFIProbeSample {
    uint32_t net_index;
    double voltage;
};

struct FFIProbeSamplesEvent {
    FFIEventHeader header;
    uint32_t samples_offset;
    uint32_t samples_count;
};

// DebuggerState: PC, SP, cycles, registers, SREG, stack, locals
struct FFILocalSymbol {
    uint32_t name_offset;
    uint32_t name_length;
    uint32_t address;
};

struct FFIDebuggerStateEvent {
    FFIEventHeader header;
    uint32_t pc;
    uint16_t sp;
    uint64_t cycles;
    uint32_t registers_offset;  // 32 * uint8_t
    uint8_t sreg;
    uint8_t padding[3];
    uint32_t stack_offset;
    uint32_t stack_length;
    uint32_t locals_offset;
    uint32_t locals_count;
};

// Faults: string array
struct FFIFaultsEvent {
    FFIEventHeader header;
    uint32_t faults_offset;
    uint32_t faults_count;  // Each fault is offset+length pair
};

// Union of all events (for pointer casting)
union FFIEvent {
    FFIEventHeader header;
    FFISolvedEvent solved;
    FFIDigitalLevelsEvent digital_levels;
    FFIAnalogReadingsEvent analog_readings;
    FFISerialOutputEvent serial_output;
    FFIDisplayFramebuffersEvent display_framebuffers;
    FFIProbeSamplesEvent probe_samples;
    FFIDebuggerStateEvent debugger_state;
    FFIFaultsEvent faults;
};

// ============================================================================
// Circuit Snapshot (passed in LoadCircuit)
// ============================================================================

struct FFICircuitSnapshot {
    uint32_t bench_json_offset;
    uint32_t bench_json_length;
    uint32_t dynamic_state_json_offset;
    uint32_t dynamic_state_json_length;
};

// ============================================================================
// Part State Snapshot (matches PartStateSnapshot from parts-generated.h)
// ============================================================================
// Re-declared here for FFI completeness; actual definition in parts-generated.h
// This is the layout used when engine returns PartStateSnapshot[] to UI.

struct FFIFramebufferInfo {
    uint32_t framebuffer_offset;
    uint32_t framebuffer_size;
    uint16_t width;
    uint16_t height;
};

struct FFIPartStateSnapshot {
    char part_id[64];
    char kind[32];

    // Display framebuffers
    uint32_t framebuffer_offset;
    uint32_t framebuffer_size;
    uint16_t width;
    uint16_t height;

    // Servo angle (0-180)
    uint8_t servo_angle;

    // Stepper angle (0-360 degrees * 10 for 0.1 deg precision)
    int16_t stepper_angle_deci_deg;

    // Stepper driver output states
    uint8_t stepper_driver_outputs[4];  // 1A, 1B, 2A, 2B

    // 7-segment display state
    uint8_t seven_seg_digits[8];
    uint8_t seven_seg_colon;

    // Character LCD state
    uint8_t lcd_chars[80];
    uint8_t lcd_rows;
    uint8_t lcd_cols;

    // Shift register outputs
    uint8_t shift_register_outputs[8];

    // Relay contact state (true = contact closed)
    bool relay_contacts_closed;

    // Button pressed state (true = pressed)
    bool button_pressed;

    // Potentiometer wiper position, 0.0 - 1.0
    double pot_wiper;

    // RF ID card presence
    bool rfid_card_present;

    // Thermocouple temperature (0.25 degree steps)
    int16_t thermocouple_temp_quarter_deg;

    // PCF8574 I2C expander state
    uint8_t pcf8574_output_reg;
    uint8_t pcf8574_input_reg;

    // MCP23017 I2C expander state
    uint8_t mcp23017_iodira;
    uint8_t mcp23017_iodirb;
    uint8_t mcp23017_gpioa;
    uint8_t mcp23017_gpiob;
    uint8_t mcp23017_olata;
    uint8_t mcp23017_olatb;

    // ADS1115 ADC state
    uint16_t ads1115_config;
    int16_t ads1115_conversion;
    bool ads1115_conversion_ready;

    // Shift register (74HC595) state
    uint8_t shift595_shift_reg;
    uint8_t shift595_storage_reg;
    bool shift595_outputs_enabled;

    // PCD8544 (Nokia 5110) state
    uint8_t pcd8544_x;
    uint8_t pcd8544_y;
    bool pcd8544_vertical;
    bool pcd8544_extended;
    bool pcd8544_powerDown;
    bool pcd8544_blanked;
    bool pcd8544_inverse;
    uint8_t pcd8544_vop;

    // MCP4725 DAC state
    uint16_t mcp4725_value;

    // PCA9685 PWM driver state
    uint16_t pca9685_duty[16];  // 12-bit duty per channel: high counts (0-4095; 4096 = full-on)
    uint8_t pca9685_prescale;

    // RTC time
    uint8_t rtc_seconds;
    uint8_t rtc_minutes;
    uint8_t rtc_hours;
    uint8_t rtc_day;
    uint8_t rtc_date;
    uint8_t rtc_month;
    uint8_t rtc_year;

    // Generic I2C sensor state
    int32_t sensor_temp_milli_c;
    int32_t sensor_pressure_pa;
    uint32_t sensor_lux;
    uint32_t sensor_humidity_milli_pct;

    // MAX7219 config
    uint8_t max7219_decode_mode;
    uint8_t max7219_intensity;
    uint8_t max7219_scan_limit;
    bool max7219_shutdown;
    bool max7219_display_test;
};

// ============================================================================
// String buffer for variable-length data (command/event payloads)
// ============================================================================

struct FFIStringBuffer {
    char* data;
    uint32_t capacity;
    uint32_t length;
};

// Helper to append string, returns offset or UINT32_MAX on overflow
static inline uint32_t ffi_string_buffer_append(FFIStringBuffer* buf, const char* str, uint32_t len) {
    if (buf->length + len > buf->capacity) return UINT32_MAX;
    uint32_t offset = buf->length;
    for (uint32_t i = 0; i < len; i++) buf->data[buf->length++] = str[i];
    return offset;
}

// ============================================================================
// Static assertions for struct sizes
// ============================================================================

static_assert(sizeof(FFICommandHeader) == 4, "FFICommandHeader packing failed");
static_assert(sizeof(FFILoadCircuitCommand) == 12, "FFILoadCircuitCommand packing failed");
static_assert(sizeof(FFILoadSketchCommand) == 16, "FFILoadSketchCommand packing failed");
static_assert(sizeof(FFIStepCommand) == 16, "FFIStepCommand packing failed");
static_assert(sizeof(FFISetPinCommand) == 24, "FFISetPinCommand packing failed");
static_assert(sizeof(FFISetKnobCommand) == 28, "FFISetKnobCommand packing failed");
static_assert(sizeof(FFISetMeterModeCommand) == 8, "FFISetMeterModeCommand packing failed");
static_assert(sizeof(FFISetBreakpointCommand) == 12, "FFISetBreakpointCommand packing failed");
static_assert(sizeof(FFIContinueCommand) == 4, "FFIContinueCommand packing failed");
static_assert(sizeof(FFIStepOverCommand) == 4, "FFIStepOverCommand packing failed");
static_assert(sizeof(FFIStepIntoCommand) == 4, "FFIStepIntoCommand packing failed");
static_assert(sizeof(FFICommand) == 28, "FFICommand union size failed");

static_assert(sizeof(FFIEventHeader) == 4, "FFIEventHeader packing failed");
static_assert(sizeof(FFISolvedEvent) == 28, "FFISolvedEvent packing failed");
static_assert(sizeof(FFIDigitalLevelsEvent) == 12, "FFIDigitalLevelsEvent packing failed");
static_assert(sizeof(FFIAnalogReadingsEvent) == 12, "FFIAnalogReadingsEvent packing failed");
static_assert(sizeof(FFISerialOutputEvent) == 12, "FFISerialOutputEvent packing failed");
static_assert(sizeof(FFIFramebufferDescriptor) == 22, "FFIFramebufferDescriptor packing failed");
static_assert(sizeof(FFIDisplayFramebuffersEvent) == 12, "FFIDisplayFramebuffersEvent packing failed");
static_assert(sizeof(FFIProbeSample) == 12, "FFIProbeSample packing failed");
static_assert(sizeof(FFIProbeSamplesEvent) == 12, "FFIProbeSamplesEvent packing failed");
static_assert(sizeof(FFILocalSymbol) == 12, "FFILocalSymbol packing failed");
static_assert(sizeof(FFIDebuggerStateEvent) == 42, "FFIDebuggerStateEvent packing failed");
static_assert(sizeof(FFIFaultsEvent) == 12, "FFIFaultsEvent packing failed");
static_assert(sizeof(FFIEvent) == 42, "FFIEvent union size failed");

static_assert(sizeof(FFICircuitSnapshot) == 16, "FFICircuitSnapshot packing failed");
static_assert(sizeof(FFIPartStateSnapshot) == 314, "FFIPartStateSnapshot packing failed");

#pragma pack(pop)

// ============================================================================
// Engine entry points (exported from the Wasm module)
// ============================================================================

enum FFIStatus : int32_t {
    FFI_OK = 0,
    FFI_ERR_INVALID_HANDLE = 1,
    FFI_ERR_NOT_IMPLEMENTED = 2,
};

static constexpr int32_t FFI_HANDLE_NONE = 0;

extern "C" {
${entryPoints}
}
`;
}

export function generateTsInterfaces(schema: unknown): string {
  // The message types stay hardcoded so their snake_case fields match the C++
  // layout; the exported entry point names come from the schema.
  const exportedFunctions = JSON.stringify(ffiExports(schema).map((entry) => entry.name));
  return `// Generated from native/abi/engine-ffi.schema.json — DO NOT EDIT

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
export const FFI_EXPORTED_FUNCTIONS = ${exportedFunctions} as const;

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
`;
}

function main() {
  mkdirSync(dirname(CXX_OUT), { recursive: true });
  mkdirSync(dirname(TS_OUT), { recursive: true });

  const schema = parseSchema();
  const cppHeader = generateCppHeader(schema);
  const tsInterfaces = generateTsInterfaces(schema);

  writeFileSync(CXX_OUT, cppHeader, 'utf-8');
  writeFileSync(TS_OUT, tsInterfaces, 'utf-8');

  console.log(`Generated: ${CXX_OUT}`);
  console.log(`Generated: ${TS_OUT}`);
}

main();