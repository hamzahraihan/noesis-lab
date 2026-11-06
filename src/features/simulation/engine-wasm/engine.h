/**
 * Shared ABI and freestanding runtime for the C++ simulation core.
 *
 * `engine.cpp` owns the wasm heap, the diode profile table and the string
 * helpers; `solver.cpp` and `netlist.cpp` are the two exports built on top of
 * them. Every struct here is mirrored by the TypeScript bridges beside it; the
 * asserts below are the guard against a layout drifting between the two.
 *
 * The core is freestanding C++20 for wasm32: no libc, no exceptions, no RTTI.
 * The only imports are the host's `js_exp`, `js_log1p` and `js_pow`, which are
 * the exact V8 functions the TypeScript parity oracle calls.
 */

#pragma once

#include <stddef.h>
#include <stdint.h>

extern "C" {
double js_exp(double);
double js_log1p(double);
double js_pow(double base, double exponent);
}

namespace engine {

constexpr double THERMAL_VOLTAGE = 0.025852;
constexpr double GMIN = 1e-12;
constexpr double JUNCTION_LIMIT_STEP_VOLTS = 3.5;
constexpr int32_t CURVE_POINTS = 13;

/** Solver element kinds, in the order `Element['kind']` lists them. */
enum ElementKind : int32_t {
  KIND_RESISTOR = 0,
  KIND_VOLTAGE_SOURCE = 1,
  KIND_CURRENT_SOURCE = 2,
  KIND_CAPACITOR = 3,
  KIND_DIODE = 4,
  KIND_GROUND = 5,
};

/** Component kinds, in the order `ComponentSpec` lists them in catalog.ts. */
enum ComponentKind : uint32_t {
  COMP_RESISTOR = 0,
  COMP_LED = 1,
  COMP_CAPACITOR = 2,
  COMP_BUTTON = 3,
  COMP_POTENTIOMETER = 4,
  COMP_MCU = 5,
  COMP_BREADBOARD = 6,
  COMP_DISPLAY = 7,
  COMP_PHOTORESISTOR = 8,
  COMP_THERMISTOR = 9,
  COMP_TILT_SWITCH = 10,
  COMP_SLIDE_SWITCH = 11,
  COMP_RELAY = 12,
  COMP_ROTARY_ENCODER = 13,
  COMP_SONAR = 14,
  COMP_STEPPER = 15,
  COMP_BIAXIAL_STEPPER = 16,
  COMP_DHT = 17,
  COMP_DS18B20 = 18,
  COMP_RC522 = 19,
  COMP_TM1637 = 20,
  COMP_A4988 = 21,
  COMP_NEOPIXEL = 22,
  COMP_NEOPIXEL_MATRIX = 23,
  COMP_LED_RING = 24,
  COMP_IR_REMOTE = 25,
  COMP_ROTARY_DIALER = 26,
  COMP_MICROSD = 27,
  COMP_JOYSTICK = 28,
  COMP_RGB_LED = 29,
  COMP_BUZZER = 30,
  COMP_SENSOR_MODULE = 31,
  COMP_DIP_SWITCH = 32,
  COMP_SLIDE_POTENTIOMETER = 33,
  COMP_LED_BAR_GRAPH = 34,
  COMP_IR_RECEIVER = 35,
  COMP_KEYPAD = 36,
  COMP_I2C_SENSOR = 37,
  COMP_I2C_EXPANDER = 38,
  COMP_MCP23017 = 39,
  COMP_PCA9685 = 40,
  COMP_THERMOCOUPLE = 41,
  COMP_DAC = 42,
  COMP_POWER_SUPPLY = 43,
  COMP_EEPROM = 44,
  COMP_SHIFT_REGISTER = 45,
  COMP_LCD = 46,
  COMP_SERVO = 47,
  COMP_SCRIPTED = 48,
  COMP_SEVEN_SEGMENT = 49,
};

/** Sensor-module variants, in `SensorVariant` order. */
enum SensorVariant : uint32_t {
  SENSOR_PIR = 0,
  SENSOR_SOUND = 1,
  SENSOR_SOUND_SMALL = 2,
  SENSOR_HEARTBEAT = 3,
  SENSOR_GAS = 4,
  SENSOR_FLAME = 5,
};

/** Scripted-part buses. `i2c` is modelled like the analog answer here. */
enum ScriptedBus : uint32_t {
  SCRIPTED_ANALOG = 0,
  SCRIPTED_DIGITAL = 1,
  SCRIPTED_I2C = 2,
};

/** One solver element, as the solver's `solve` consumes it. */
struct ElementIn {
  int32_t kind;
  int32_t a;
  int32_t b;
  int32_t profile;
  double value;
};
static_assert(sizeof(ElementIn) == 24, "ElementIn ABI changed; update solver.ts");

/** Seven doubles in DiodeProfile order. */
struct ProfileIn {
  double values[7];
};
static_assert(sizeof(ProfileIn) == 56, "ProfileIn ABI changed; update solver.ts");

struct CurvePoint {
  double volts;
  double amps;
};

struct Linear {
  double amps;
  double siemens;
};

/** A terminal's bench position; the index in the array is the terminal id. */
struct TerminalIn {
  double x;
  double y;
};
static_assert(sizeof(TerminalIn) == 16, "TerminalIn ABI changed; update netlist.ts");

/** A part pin: its terminal, its id string, and its internal-net string. */
struct PinIn {
  uint32_t terminal;
  uint32_t name_offset;
  uint32_t net_offset;
};
static_assert(sizeof(PinIn) == 12, "PinIn ABI changed; update netlist.ts");

/** One knob of a part, already resolved and clamped by the host. */
struct KnobIn {
  double value;
  double min;
  double max;
  uint32_t name_offset;
  uint32_t pad;
};
static_assert(sizeof(KnobIn) == 32, "KnobIn ABI changed; update netlist.ts");

/** Part flags. */
constexpr uint32_t PART_PRESSED = 1u;
constexpr uint32_t PART_RELAY_ENERGIZED = 2u;
constexpr uint32_t PART_SONAR_MEASURING = 4u;

/**
 * A part: its component kind, its pin and knob slices, and the few parameters
 * the element emission reads. `params` is interpreted per kind; see netlist.cpp.
 */
struct PartIn {
  uint32_t kind;
  uint32_t first_pin;
  uint32_t pin_count;
  uint32_t first_knob;
  uint32_t knob_count;
  uint32_t flags;
  double params[4];
  double scripted;
};
static_assert(sizeof(PartIn) == 64, "PartIn ABI changed; update netlist.ts");

/** A jumper: its two terminals, its id string, and its physical dimensions. */
struct WireIn {
  uint32_t from;
  uint32_t to;
  uint32_t id_offset;
  uint32_t pad;
  double gauge_awg;
  double length_mm;
};
static_assert(sizeof(WireIn) == 32, "WireIn ABI changed; update netlist.ts");

/** One element emitted by the netlist, with a label offset into the arena. */
struct ElementOut {
  int32_t kind;
  int32_t a;
  int32_t b;
  int32_t profile;
  uint32_t label_offset;
  uint32_t pad;
  double value;
};
static_assert(sizeof(ElementOut) == 32, "ElementOut ABI changed; update netlist.ts");

/** Allocates `bytes` from the wasm heap, growing linear memory as needed. */
uint32_t alloc_bytes(uint32_t bytes);

/** Resolves a string from the host-provided blob; offset 0 is the empty string. */
const char* string_at(const char* strings, int32_t strings_bytes, uint32_t offset);

bool streq(const char* a, const char* b);

/** Installs the diode profile table, rebuilding curves only when bytes changed. */
bool set_profiles_impl(const double* values, int32_t count);

Linear linearise_diode(double voltage_across, int32_t profile_index);

// Phase 2: buildElements
// Input: existing netlist elements + node mapping + timeMs + dynamic state
// Output: full element list including dynamic parts
struct BuildElementsInput {
  const ElementOut* netlist_elements;
  int32_t netlist_element_count;
  int32_t node_count;
  const int32_t* node_of_terminal;
  int32_t terminal_count;
  const uint32_t* pin_node;  // size: terminal_count, maps terminal -> node (or UINT32_MAX)
  double time_ms;
  // Dynamic state (optional, can be nullptr)
  const double* knob_values;  // size: total_knobs
  int32_t knob_count;
  const uint32_t* pin_levels;  // size: terminal_count, 0/1
  int32_t pin_level_count;
  int32_t supply_net;
  int32_t supply_node;
};

struct BuildElementsOutput {
  ElementOut* elements;
  int32_t element_count;
};

}  // namespace engine
