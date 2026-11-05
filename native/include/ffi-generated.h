// Generated from native/abi/engine-ffi.schema.json — DO NOT EDIT
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
int32_t engine_create(const char* circuit_json, const char* sketch_json);
int32_t engine_step(int32_t handle, double dt_ms);
int32_t engine_set_pin(int32_t handle, const char* part_id, const char* pin, int32_t level);
int32_t engine_set_knob(int32_t handle, const char* part_id, const char* knob, double value);
const FFIPartStateSnapshot* engine_get_state(int32_t handle, int32_t* out_count);
const double* engine_get_voltages(int32_t handle, int32_t* out_count);
const char* engine_get_serial(int32_t handle);
int32_t engine_set_breakpoint(int32_t handle, int32_t pc);
void engine_clear_breakpoint(int32_t handle, int32_t id);
void engine_set_step_over(int32_t handle, int32_t enable);
void engine_set_step_into(int32_t handle, int32_t enable);
const char* engine_get_debug_state(int32_t handle);
void engine_destroy(int32_t handle);
}
