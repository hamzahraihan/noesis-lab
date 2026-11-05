/**
 * Netlist extraction, C++ port of `netlist.ts`.
 *
 * The host uploads a bench snapshot -- terminals with positions, parts with
 * their pins and resolved knobs, jumpers -- and this file returns the terminal
 * to net map plus the element list the solver consumes. The algorithm is the
 * TypeScript one: union-find over internal pin nets, jumpers and coincident
 * contacts; one board ground pin pins the reference; only nets a reading can
 * reach are numbered; element emission is a second pass over the parts.
 *
 * Pins and knobs are looked up by their TypeScript ids through a string blob
 * rather than a generated enum, so a part definition's spelling is the only
 * source of truth and a new pin costs no ABI change. Labels are built into a
 * per-build arena and referenced by offset from each element.
 */

#include "engine.h"

using namespace engine;

namespace {

constexpr double SNAP_DISTANCE_MM = 0.4;
constexpr double SWITCH_OPEN_OHMS = 1e9;
constexpr double SWITCH_CLOSED_OHMS = 0.05;
constexpr double MIN_POT_SEGMENT_OHMS = 0.1;
constexpr double MODULE_DIVIDER_OHMS = 10000;
constexpr double MODULE_PULLUP_OHMS = 10000;
constexpr double OPEN_DRAIN_SINK_OHMS = 1000;
constexpr double SENSOR_IDLE_OHMS = 1e6;
constexpr double SENSOR_FULL_SCALE_OHMS = 10000;
constexpr double LDR_DARK_OHMS = 50000;
constexpr double LDR_BRIGHT_OHMS = 3500;
constexpr double NTC_OHMS_AT_25C = 10000;
constexpr double NTC_BETA_K = 3950;
constexpr double KELVIN_AT_25C = 273.15 + 25;
constexpr double JOYSTICK_AXIS_OHMS = 10000;
constexpr double PIEZO_FARADS = 100e-9;
constexpr double PIEZO_LEAKAGE_OHMS = 1e6;
constexpr double RELAY_COIL_OHMS = 70;
constexpr double WINDING_OHMS = 50;
constexpr double COPPER_RESISTIVITY = 1.68e-8;
constexpr double PI = 3.14159265358979323846;
constexpr int32_t LED_BAR_GRAPH_SEGMENTS = 10;
constexpr int32_t KEYPAD_COLUMNS = 4;

constexpr int64_t CELL_EMPTY = INT64_MIN;

inline double maxd(double a, double b) { return a > b ? a : b; }
inline double clampd(double value, double low, double high) {
  return value < low ? low : (value > high ? high : value);
}

int32_t write_int(char* out, int32_t value) {
  if (value == 0) {
    out[0] = '0';
    out[1] = '\0';
    return 1;
  }
  char tmp[12];
  int32_t digits = 0;
  const bool negative = value < 0;
  uint32_t magnitude = negative ? static_cast<uint32_t>(-(value + 1)) + 1u
                                : static_cast<uint32_t>(value);
  while (magnitude > 0) {
    tmp[digits++] = static_cast<char>('0' + (magnitude % 10));
    magnitude /= 10;
  }
  int32_t index = 0;
  if (negative) out[index++] = '-';
  for (int32_t i = digits - 1; i >= 0; i--) out[index++] = tmp[i];
  out[index] = '\0';
  return index;
}

void copy_text(char* out, const char* text) {
  while ((*out++ = *text++) != '\0') {
  }
}

// ---------------------------------------------------------------------------
// Union-find
// ---------------------------------------------------------------------------

struct DisjointSet {
  int32_t size;
  int32_t* parent;
  uint8_t* rank;
};

bool disjoint_set_init(DisjointSet& sets, int32_t size) {
  sets.size = size;
  sets.parent = reinterpret_cast<int32_t*>(
      alloc_bytes(static_cast<uint32_t>(size) * sizeof(int32_t)));
  sets.rank = reinterpret_cast<uint8_t*>(alloc_bytes(static_cast<uint32_t>(size)));
  if (size > 0 && (sets.parent == nullptr || sets.rank == nullptr)) return false;
  for (int32_t i = 0; i < size; i++) {
    sets.parent[i] = i;
    sets.rank[i] = 0;
  }
  return true;
}

int32_t disjoint_set_find(DisjointSet& sets, int32_t node) {
  int32_t root = node;
  while (sets.parent[root] != root) root = sets.parent[root];
  int32_t walker = node;
  while (sets.parent[walker] != root) {
    const int32_t next = sets.parent[walker];
    sets.parent[walker] = root;
    walker = next;
  }
  return root;
}

void disjoint_set_union(DisjointSet& sets, int32_t a, int32_t b) {
  int32_t root_a = disjoint_set_find(sets, a);
  int32_t root_b = disjoint_set_find(sets, b);
  if (root_a == root_b) return;
  if (sets.rank[root_a] < sets.rank[root_b]) {
    const int32_t swap = root_a;
    root_a = root_b;
    root_b = swap;
  }
  sets.parent[root_b] = root_a;
  if (sets.rank[root_a] == sets.rank[root_b]) sets.rank[root_a]++;
}

// ---------------------------------------------------------------------------
// Spatial hash for coincident contacts
// ---------------------------------------------------------------------------

struct CellMap {
  int64_t* keys;
  int32_t* heads;
  int32_t* next;
  int32_t capacity;
  int32_t mask;
};

int64_t cell_key(int32_t x, int32_t y) {
  return static_cast<int64_t>((static_cast<uint64_t>(static_cast<uint32_t>(x)) << 32) |
                              static_cast<uint32_t>(y));
}

uint32_t hash_cell(int64_t key) {
  uint64_t value = static_cast<uint64_t>(key);
  value ^= value >> 33;
  value *= 0xff51afd7ed558ccdULL;
  value ^= value >> 33;
  value *= 0xc4ceb9fe1a85ec53ULL;
  value ^= value >> 33;
  return static_cast<uint32_t>(value);
}

int32_t cell_slot(CellMap& map, int64_t key, bool create) {
  uint32_t slot = hash_cell(key) & static_cast<uint32_t>(map.mask);
  for (;;) {
    if (map.keys[slot] == CELL_EMPTY) {
      if (!create) return -1;
      map.keys[slot] = key;
      map.heads[slot] = -1;
      return static_cast<int32_t>(slot);
    }
    if (map.keys[slot] == key) return static_cast<int32_t>(slot);
    slot = (slot + 1u) & static_cast<uint32_t>(map.mask);
  }
}

bool cell_map_init(CellMap& map, int32_t terminal_count) {
  int32_t capacity = 1;
  while (capacity < terminal_count * 2 + 1) capacity <<= 1;
  map.capacity = capacity;
  map.mask = capacity - 1;
  map.keys = reinterpret_cast<int64_t*>(
      alloc_bytes(static_cast<uint32_t>(capacity) * sizeof(int64_t)));
  map.heads = reinterpret_cast<int32_t*>(
      alloc_bytes(static_cast<uint32_t>(capacity) * sizeof(int32_t)));
  map.next = reinterpret_cast<int32_t*>(
      alloc_bytes(static_cast<uint32_t>(terminal_count) * sizeof(int32_t)));
  if (map.keys == nullptr || map.heads == nullptr ||
      (terminal_count > 0 && map.next == nullptr)) {
    return false;
  }
  for (int32_t i = 0; i < capacity; i++) {
    map.keys[i] = CELL_EMPTY;
    map.heads[i] = -1;
  }
  for (int32_t i = 0; i < terminal_count; i++) map.next[i] = -1;
  return true;
}

// ---------------------------------------------------------------------------
// Build context and lookups
// ---------------------------------------------------------------------------

struct BuildContext {
  const TerminalIn* terminals;
  int32_t terminal_count;
  const PartIn* parts;
  int32_t part_count;
  const PinIn* pins;
  int32_t pin_count;
  const KnobIn* knobs;
  int32_t knob_count;
  const WireIn* wires;
  int32_t wire_count;
  const uint32_t* ground_terminals;
  int32_t ground_count;
  const uint32_t* key_labels;
  int32_t key_label_count;
  const char* strings;
  int32_t strings_bytes;
  int32_t ir_transmitting;
  int32_t red_profile;
  int32_t green_profile;
  int32_t blue_profile;

  const int32_t* node_of_terminal;
  ElementOut* elements;
  int32_t element_capacity;
  int32_t element_count;
  bool overflow;
};

const char* pin_name(const BuildContext& ctx, const PinIn& pin) {
  return string_at(ctx.strings, ctx.strings_bytes, pin.name_offset);
}

const PinIn* find_pin(const BuildContext& ctx, const PartIn& part, const char* name) {
  for (uint32_t i = 0; i < part.pin_count; i++) {
    const PinIn& pin = ctx.pins[part.first_pin + i];
    if (streq(pin_name(ctx, pin), name)) return &pin;
  }
  return nullptr;
}

bool has_pin(const BuildContext& ctx, const PartIn& part, const char* name) {
  return find_pin(ctx, part, name) != nullptr;
}

int32_t node_at(const BuildContext& ctx, const PartIn& part, const char* name) {
  const PinIn* pin = find_pin(ctx, part, name);
  return pin == nullptr ? -1 : ctx.node_of_terminal[pin->terminal];
}

const KnobIn* find_knob(const BuildContext& ctx, const PartIn& part, const char* name) {
  for (uint32_t i = 0; i < part.knob_count; i++) {
    const KnobIn& knob = ctx.knobs[part.first_knob + i];
    if (streq(string_at(ctx.strings, ctx.strings_bytes, knob.name_offset), name)) return &knob;
  }
  return nullptr;
}

double knob_value(const BuildContext& ctx, const PartIn& part, const char* name, double fallback) {
  const KnobIn* knob = find_knob(ctx, part, name);
  return knob == nullptr ? fallback : knob->value;
}

double knob_max(const BuildContext& ctx, const PartIn& part, const char* name, double fallback) {
  const KnobIn* knob = find_knob(ctx, part, name);
  return knob == nullptr ? fallback : knob->max;
}

// ---------------------------------------------------------------------------
// Label arena
// ---------------------------------------------------------------------------

char* label_buffer = nullptr;
uint32_t label_capacity = 0;
uint32_t label_top = 0;
bool label_overflow = false;

bool labels_begin(uint32_t bytes) {
  if (bytes < 2) bytes = 2;
  if (label_capacity < bytes) {
    char* next = reinterpret_cast<char*>(alloc_bytes(bytes));
    if (next == nullptr) return false;
    label_buffer = next;
    label_capacity = bytes;
  }
  label_top = 1;
  label_buffer[0] = '\0';
  label_overflow = false;
  return true;
}

void label_char(char value) {
  if (label_top + 1 >= label_capacity) {
    label_overflow = true;
    return;
  }
  label_buffer[label_top++] = value;
}

void label_text(const char* text) {
  while (*text != '\0') label_char(*text++);
}

void label_int(int32_t value) {
  char buffer[12];
  write_int(buffer, value);
  label_text(buffer);
}

uint32_t label_begin() { return label_top; }

uint32_t label_end(uint32_t start) {
  label_char('\0');
  return label_overflow ? 0 : start;
}

uint32_t label_copy(const char* text) {
  const uint32_t start = label_begin();
  label_text(text);
  return label_end(start);
}

// ---------------------------------------------------------------------------
// Element emission helpers
// ---------------------------------------------------------------------------

void push_element(
    BuildContext& ctx,
    int32_t kind,
    int32_t a,
    int32_t b,
    int32_t profile,
    double value,
    uint32_t label_offset) {
  if (kind != KIND_GROUND && a == b) return;
  if (ctx.element_count >= ctx.element_capacity) {
    ctx.overflow = true;
    return;
  }
  ElementOut& out = ctx.elements[ctx.element_count++];
  out.kind = kind;
  out.a = a;
  out.b = b;
  out.profile = profile;
  out.value = value;
  out.label_offset = label_offset;
  out.pad = 0;
}

void emit_pot_legs(
    BuildContext& ctx,
    const PartIn& part,
    const char* end_a,
    const char* wiper,
    const char* end_b,
    double ohms,
    double turn) {
  push_element(
      ctx,
      KIND_RESISTOR,
      node_at(ctx, part, end_a),
      node_at(ctx, part, wiper),
      -1,
      maxd(MIN_POT_SEGMENT_OHMS, ohms * turn),
      0);
  push_element(
      ctx,
      KIND_RESISTOR,
      node_at(ctx, part, wiper),
      node_at(ctx, part, end_b),
      -1,
      maxd(MIN_POT_SEGMENT_OHMS, ohms * (1 - turn)),
      0);
}

void emit_open_drain(BuildContext& ctx, const PartIn& part, const char* pin, bool sinking) {
  push_element(
      ctx,
      KIND_RESISTOR,
      node_at(ctx, part, pin),
      node_at(ctx, part, "GND"),
      -1,
      sinking ? SWITCH_CLOSED_OHMS : SWITCH_OPEN_OHMS,
      label_copy(sinking ? "closed" : "open"));
  push_element(
      ctx,
      KIND_RESISTOR,
      node_at(ctx, part, pin),
      node_at(ctx, part, "VCC"),
      -1,
      MODULE_PULLUP_OHMS,
      label_copy("pull-up"));
}

void make_pin_id(char* out, char prefix, int32_t number) {
  out[0] = prefix;
  write_int(out + 1, number);
}

void make_prefixed_id(char* out, const char* prefix, int32_t number) {
  copy_text(out, prefix);
  int32_t length = 0;
  while (out[length] != '\0') length++;
  write_int(out + length, number);
}

double wire_resistance(double gauge_awg, double length_mm) {
  const double diameter_mm = 0.127 * js_pow(92, (36 - gauge_awg) / 39);
  const double area_mm2 = (PI / 4) * diameter_mm * diameter_mm;
  const double length_m = length_mm / 1000;
  const double area_m2 = area_mm2 * 1e-6;
  return (COPPER_RESISTIVITY * length_m) / area_m2;
}

const char* stimulus_knob(uint32_t variant) {
  switch (variant) {
    case SENSOR_PIR:
      return "motion";
    case SENSOR_SOUND:
    case SENSOR_SOUND_SMALL:
      return "sound";
    case SENSOR_HEARTBEAT:
      return "beat";
    case SENSOR_GAS:
      return "gas";
    case SENSOR_FLAME:
      return "flame";
    default:
      return "motion";
  }
}

double stimulus_default(uint32_t variant) {
  switch (variant) {
    case SENSOR_SOUND:
    case SENSOR_SOUND_SMALL:
      return 20;
    case SENSOR_GAS:
      return 10;
    default:
      return 0;
  }
}

double stimulus_max(uint32_t variant) {
  switch (variant) {
    case SENSOR_SOUND:
    case SENSOR_SOUND_SMALL:
    case SENSOR_GAS:
      return 100;
    default:
      return 1;
  }
}

void emit_relay_pole(
    BuildContext& ctx,
    const PartIn& part,
    const char* pole,
    const char* normally_open,
    const char* normally_closed,
    bool energized) {
  const char* closed = energized ? normally_open : normally_closed;
  const char* open = energized ? normally_closed : normally_open;

  const uint32_t start = label_begin();
  label_text(pole);
  label_char('-');
  label_text(closed);
  label_text(" closed");
  const uint32_t closed_label = label_end(start);

  push_element(
      ctx,
      KIND_RESISTOR,
      node_at(ctx, part, pole),
      node_at(ctx, part, closed),
      -1,
      SWITCH_CLOSED_OHMS,
      closed_label);
  push_element(
      ctx,
      KIND_RESISTOR,
      node_at(ctx, part, pole),
      node_at(ctx, part, open),
      -1,
      SWITCH_OPEN_OHMS,
      label_copy("open"));
}

void emit_part(BuildContext& ctx, const PartIn& part) {
  const double p0 = part.params[0];

  switch (part.kind) {
    case COMP_RESISTOR:
      push_element(ctx, KIND_RESISTOR, node_at(ctx, part, "a"), node_at(ctx, part, "b"), -1, p0, 0);
      return;

    case COMP_LED:
      push_element(
          ctx,
          KIND_DIODE,
          node_at(ctx, part, "anode"),
          node_at(ctx, part, "cathode"),
          static_cast<int32_t>(p0),
          0,
          0);
      return;

    case COMP_CAPACITOR:
      push_element(
          ctx,
          KIND_CAPACITOR,
          node_at(ctx, part, "positive"),
          node_at(ctx, part, "negative"),
          -1,
          p0,
          0);
      return;

    case COMP_BUTTON: {
      const bool closed = (part.flags & PART_PRESSED) != 0;
      push_element(
          ctx,
          KIND_RESISTOR,
          node_at(ctx, part, "a"),
          node_at(ctx, part, "b"),
          -1,
          closed ? SWITCH_CLOSED_OHMS : SWITCH_OPEN_OHMS,
          label_copy(closed ? "closed" : "open"));
      return;
    }

    case COMP_POTENTIOMETER:
      emit_pot_legs(
          ctx, part, "endA", "wiper", "endB", p0, knob_value(ctx, part, "turn", 0.5));
      return;

    case COMP_SLIDE_POTENTIOMETER:
      emit_pot_legs(
          ctx, part, "endA", "wiper", "endB", p0, knob_value(ctx, part, "turn", 0.5));
      return;

    case COMP_SCRIPTED: {
      const double fraction = clampd(part.scripted, 0, 1);
      if (static_cast<uint32_t>(p0) == SCRIPTED_DIGITAL) {
        push_element(
            ctx,
            KIND_RESISTOR,
            node_at(ctx, part, "DOUT"),
            fraction >= 0.5 ? node_at(ctx, part, "VCC") : node_at(ctx, part, "GND"),
            -1,
            1000,
            label_copy("scripted level"));
        return;
      }
      const double top = 10000;
      const double bottom = fraction <= 0.001
                                ? 1e-3
                                : fraction >= 0.999 ? 1e9 : (top * fraction) / (1 - fraction);
      push_element(
          ctx,
          KIND_RESISTOR,
          node_at(ctx, part, "VCC"),
          node_at(ctx, part, "AOUT"),
          -1,
          top,
          label_copy("sensor"));
      push_element(
          ctx,
          KIND_RESISTOR,
          node_at(ctx, part, "AOUT"),
          node_at(ctx, part, "GND"),
          -1,
          bottom,
          label_copy("divider"));
      return;
    }

    case COMP_PHOTORESISTOR: {
      const double light = knob_value(ctx, part, "light", 100) / knob_max(ctx, part, "light", 1000);
      const double sensor_ohms = LDR_DARK_OHMS * js_pow(LDR_BRIGHT_OHMS / LDR_DARK_OHMS, light);
      const double divider_fraction = sensor_ohms / (sensor_ohms + MODULE_DIVIDER_OHMS);
      push_element(
          ctx,
          KIND_RESISTOR,
          node_at(ctx, part, "VCC"),
          node_at(ctx, part, "AO"),
          -1,
          sensor_ohms,
          label_copy("sensor"));
      push_element(
          ctx,
          KIND_RESISTOR,
          node_at(ctx, part, "AO"),
          node_at(ctx, part, "GND"),
          -1,
          MODULE_DIVIDER_OHMS,
          label_copy("divider"));
      push_element(
          ctx,
          KIND_RESISTOR,
          node_at(ctx, part, "DO"),
          node_at(ctx, part, "VCC"),
          -1,
          MODULE_PULLUP_OHMS,
          label_copy("pull-up"));
      if (divider_fraction > knob_value(ctx, part, "threshold", 50) /
                                  knob_max(ctx, part, "threshold", 100)) {
        push_element(
            ctx,
            KIND_RESISTOR,
            node_at(ctx, part, "DO"),
            node_at(ctx, part, "GND"),
            -1,
            OPEN_DRAIN_SINK_OHMS,
            label_copy("comparator"));
      }
      return;
    }

    case COMP_THERMISTOR: {
      const double celsius = knob_value(ctx, part, "temperature", 25);
      const double kelvin = KELVIN_AT_25C + (celsius - 25);
      const double ohms =
          NTC_OHMS_AT_25C * js_exp(NTC_BETA_K * (1 / kelvin - 1 / KELVIN_AT_25C));
      push_element(
          ctx,
          KIND_RESISTOR,
          node_at(ctx, part, "VCC"),
          node_at(ctx, part, "OUT"),
          -1,
          ohms,
          label_copy("thermistor"));
      push_element(
          ctx,
          KIND_RESISTOR,
          node_at(ctx, part, "OUT"),
          node_at(ctx, part, "GND"),
          -1,
          MODULE_DIVIDER_OHMS,
          label_copy("divider"));
      return;
    }

    case COMP_TILT_SWITCH:
      emit_open_drain(ctx, part, "OUT", knob_value(ctx, part, "tilted", 0) >= 0.5);
      return;

    case COMP_IR_RECEIVER:
      emit_open_drain(
          ctx,
          part,
          "DAT",
          knob_value(ctx, part, "code", 0) >= 0.5 || ctx.ir_transmitting != 0);
      return;

    case COMP_SLIDE_SWITCH: {
      const bool thrown = knob_value(ctx, part, "closed", 0) >= 0.5;
      const char* closed_to = thrown ? "1" : "3";
      const char* open_to = thrown ? "3" : "1";
      push_element(
          ctx,
          KIND_RESISTOR,
          node_at(ctx, part, "2"),
          node_at(ctx, part, closed_to),
          -1,
          SWITCH_CLOSED_OHMS,
          label_copy("closed"));
      push_element(
          ctx,
          KIND_RESISTOR,
          node_at(ctx, part, "2"),
          node_at(ctx, part, open_to),
          -1,
          SWITCH_OPEN_OHMS,
          label_copy("open"));
      return;
    }

    case COMP_JOYSTICK: {
      const bool held = (part.flags & PART_PRESSED) != 0;
      emit_pot_legs(
          ctx, part, "GND", "HORZ", "VCC", JOYSTICK_AXIS_OHMS,
          knob_value(ctx, part, "horizontal", 0.5));
      emit_pot_legs(
          ctx, part, "GND", "VERT", "VCC", JOYSTICK_AXIS_OHMS,
          knob_value(ctx, part, "vertical", 0.5));
      push_element(
          ctx,
          KIND_RESISTOR,
          node_at(ctx, part, "SEL"),
          node_at(ctx, part, "GND"),
          -1,
          held ? SWITCH_CLOSED_OHMS : SWITCH_OPEN_OHMS,
          label_copy(held ? "closed" : "open"));
      push_element(
          ctx,
          KIND_RESISTOR,
          node_at(ctx, part, "SEL"),
          node_at(ctx, part, "VCC"),
          -1,
          MODULE_PULLUP_OHMS,
          label_copy("pull-up"));
      return;
    }

    case COMP_RGB_LED:
      push_element(
          ctx, KIND_DIODE, node_at(ctx, part, "red"), node_at(ctx, part, "common"), ctx.red_profile,
          0, 0);
      push_element(
          ctx, KIND_DIODE, node_at(ctx, part, "green"), node_at(ctx, part, "common"),
          ctx.green_profile, 0, 0);
      push_element(
          ctx, KIND_DIODE, node_at(ctx, part, "blue"), node_at(ctx, part, "common"),
          ctx.blue_profile, 0, 0);
      return;

    case COMP_LED_BAR_GRAPH:
      for (int32_t segment = 1; segment <= LED_BAR_GRAPH_SEGMENTS; segment++) {
        char anode[8];
        char cathode[8];
        make_pin_id(anode, 'A', segment);
        make_pin_id(cathode, 'C', segment);
        push_element(
            ctx,
            KIND_DIODE,
            node_at(ctx, part, anode),
            node_at(ctx, part, cathode),
            ctx.red_profile,
            0,
            0);
      }
      return;

    case COMP_SEVEN_SEGMENT: {
      int32_t digits = static_cast<int32_t>(p0);
      if (digits < 1) digits = 1;
      if (digits > 4) digits = 4;
      static const char* const segments[8] = {"A", "B", "C", "D", "E", "F", "G", "DP"};
      if (digits > 1) {
        for (int32_t digit = 1; digit <= digits; digit++) {
          char common[8];
          make_prefixed_id(common, "DIG", digit);
          for (int32_t segment = 0; segment < 8; segment++) {
            push_element(
                ctx,
                KIND_DIODE,
                node_at(ctx, part, common),
                node_at(ctx, part, segments[segment]),
                ctx.red_profile,
                0,
                0);
          }
        }
      } else {
        for (int32_t segment = 0; segment < 8; segment++) {
          push_element(
              ctx,
              KIND_DIODE,
              node_at(ctx, part, "COM.1"),
              node_at(ctx, part, segments[segment]),
              ctx.red_profile,
              0,
              0);
        }
      }
      if (digits == 4) {
        push_element(
            ctx,
            KIND_DIODE,
            node_at(ctx, part, "COM"),
            node_at(ctx, part, "CLN"),
            ctx.red_profile,
            0,
            0);
      }
      return;
    }

    case COMP_BUZZER:
      push_element(
          ctx,
          KIND_CAPACITOR,
          node_at(ctx, part, "positive"),
          node_at(ctx, part, "negative"),
          -1,
          PIEZO_FARADS,
          0);
      push_element(
          ctx,
          KIND_RESISTOR,
          node_at(ctx, part, "positive"),
          node_at(ctx, part, "negative"),
          -1,
          PIEZO_LEAKAGE_OHMS,
          label_copy("leakage"));
      return;

    case COMP_SENSOR_MODULE: {
      const uint32_t variant = static_cast<uint32_t>(p0);
      const char* stimulus = stimulus_knob(variant);
      const double level = knob_value(ctx, part, stimulus, stimulus_default(variant)) /
                           knob_max(ctx, part, stimulus, stimulus_max(variant));
      if (has_pin(ctx, part, "AOUT")) {
        const double sensor_ohms =
            SENSOR_IDLE_OHMS * js_pow(SENSOR_FULL_SCALE_OHMS / SENSOR_IDLE_OHMS, level);
        push_element(
            ctx,
            KIND_RESISTOR,
            node_at(ctx, part, "VCC"),
            node_at(ctx, part, "AOUT"),
            -1,
            sensor_ohms,
            label_copy("sensor"));
        push_element(
            ctx,
            KIND_RESISTOR,
            node_at(ctx, part, "AOUT"),
            node_at(ctx, part, "GND"),
            -1,
            MODULE_DIVIDER_OHMS,
            label_copy("divider"));
      }
      push_element(
          ctx,
          KIND_RESISTOR,
          node_at(ctx, part, "DOUT"),
          node_at(ctx, part, "VCC"),
          -1,
          MODULE_PULLUP_OHMS,
          label_copy("pull-up"));
      if (level > knob_value(ctx, part, "threshold", 50) /
                      knob_max(ctx, part, "threshold", 100)) {
        push_element(
            ctx,
            KIND_RESISTOR,
            node_at(ctx, part, "DOUT"),
            node_at(ctx, part, "GND"),
            -1,
            OPEN_DRAIN_SINK_OHMS,
            label_copy("comparator"));
      }
      return;
    }

    case COMP_DIP_SWITCH: {
      int32_t ways = static_cast<int32_t>(p0);
      if (ways > 8) ways = 8;
      for (int32_t index = 0; index < ways; index++) {
        const int32_t way = index + 1;
        char knob_id[8];
        make_prefixed_id(knob_id, "dip", way);
        const bool closed = knob_value(ctx, part, knob_id, 0) >= 0.5;
        char pin_a[8];
        char pin_b[8];
        int32_t length = write_int(pin_a, way);
        pin_a[length] = 'a';
        pin_a[length + 1] = '\0';
        length = write_int(pin_b, way);
        pin_b[length] = 'b';
        pin_b[length + 1] = '\0';

        const uint32_t start = label_begin();
        label_text("way ");
        label_int(way);
        label_text(closed ? " closed" : " open");
        const uint32_t label = label_end(start);

        push_element(
            ctx,
            KIND_RESISTOR,
            node_at(ctx, part, pin_a),
            node_at(ctx, part, pin_b),
            -1,
            closed ? SWITCH_CLOSED_OHMS : SWITCH_OPEN_OHMS,
            label);
      }
      return;
    }

    case COMP_KEYPAD: {
      for (int32_t index = 0; index < 16; index++) {
        const int32_t row = index / KEYPAD_COLUMNS + 1;
        const int32_t column = index % KEYPAD_COLUMNS + 1;
        char knob_id[8];
        make_prefixed_id(knob_id, "key", index + 1);
        const bool pressed = knob_value(ctx, part, knob_id, 0) >= 0.5;

        char row_pin[8];
        char column_pin[8];
        make_pin_id(row_pin, 'R', row);
        make_pin_id(column_pin, 'C', column);

        const char* key_text =
            index < ctx.key_label_count
                ? string_at(ctx.strings, ctx.strings_bytes, ctx.key_labels[index])
                : "";
        const uint32_t start = label_begin();
        label_text(key_text);
        label_text(pressed ? " closed" : " open");
        const uint32_t label = label_end(start);

        push_element(
            ctx,
            KIND_RESISTOR,
            node_at(ctx, part, row_pin),
            node_at(ctx, part, column_pin),
            -1,
            pressed ? SWITCH_CLOSED_OHMS : SWITCH_OPEN_OHMS,
            label);
      }
      return;
    }

    case COMP_RELAY: {
      const bool energized = (part.flags & PART_RELAY_ENERGIZED) != 0;
      push_element(
          ctx,
          KIND_RESISTOR,
          node_at(ctx, part, "COIL+"),
          node_at(ctx, part, "COIL-"),
          -1,
          RELAY_COIL_OHMS,
          label_copy("coil"));
      emit_relay_pole(ctx, part, "P1", "NO1", "NC1", energized);
      emit_relay_pole(ctx, part, "P2", "NO2", "NC2", energized);
      return;
    }

    case COMP_STEPPER:
      push_element(
          ctx, KIND_RESISTOR, node_at(ctx, part, "A+"), node_at(ctx, part, "A-"), -1,
          WINDING_OHMS, label_copy("winding A"));
      push_element(
          ctx, KIND_RESISTOR, node_at(ctx, part, "B+"), node_at(ctx, part, "B-"), -1,
          WINDING_OHMS, label_copy("winding B"));
      return;

    case COMP_BIAXIAL_STEPPER:
      push_element(
          ctx, KIND_RESISTOR, node_at(ctx, part, "A1+"), node_at(ctx, part, "A1-"), -1,
          WINDING_OHMS, label_copy("winding A1"));
      push_element(
          ctx, KIND_RESISTOR, node_at(ctx, part, "B1+"), node_at(ctx, part, "B1-"), -1,
          WINDING_OHMS, label_copy("winding B1"));
      push_element(
          ctx, KIND_RESISTOR, node_at(ctx, part, "A2+"), node_at(ctx, part, "A2-"), -1,
          WINDING_OHMS, label_copy("winding A2"));
      push_element(
          ctx, KIND_RESISTOR, node_at(ctx, part, "B2+"), node_at(ctx, part, "B2-"), -1,
          WINDING_OHMS, label_copy("winding B2"));
      return;

    case COMP_ROTARY_ENCODER: {
      const double detents = knob_value(ctx, part, "detent", 0);
      int32_t rounded = static_cast<int32_t>(__builtin_floor(detents + 0.5));
      int32_t index = rounded % 4;
      if (index < 0) index += 4;
      static const int32_t QUADRATURE[4][2] = {{1, 1}, {0, 1}, {0, 0}, {1, 0}};
      const bool clk_low = QUADRATURE[index][0] == 0;
      const bool dt_low = QUADRATURE[index][1] == 0;
      const bool pressed = (part.flags & PART_PRESSED) != 0;

      push_element(
          ctx, KIND_RESISTOR, node_at(ctx, part, "CLK"), node_at(ctx, part, "GND"), -1,
          clk_low ? SWITCH_CLOSED_OHMS : SWITCH_OPEN_OHMS,
          label_copy(clk_low ? "closed" : "open"));
      push_element(
          ctx, KIND_RESISTOR, node_at(ctx, part, "CLK"), node_at(ctx, part, "VCC"), -1,
          MODULE_PULLUP_OHMS, label_copy("pull-up"));
      push_element(
          ctx, KIND_RESISTOR, node_at(ctx, part, "DT"), node_at(ctx, part, "GND"), -1,
          dt_low ? SWITCH_CLOSED_OHMS : SWITCH_OPEN_OHMS,
          label_copy(dt_low ? "closed" : "open"));
      push_element(
          ctx, KIND_RESISTOR, node_at(ctx, part, "DT"), node_at(ctx, part, "VCC"), -1,
          MODULE_PULLUP_OHMS, label_copy("pull-up"));
      push_element(
          ctx, KIND_RESISTOR, node_at(ctx, part, "SW"), node_at(ctx, part, "GND"), -1,
          pressed ? SWITCH_CLOSED_OHMS : SWITCH_OPEN_OHMS,
          label_copy(pressed ? "closed" : "open"));
      push_element(
          ctx, KIND_RESISTOR, node_at(ctx, part, "SW"), node_at(ctx, part, "VCC"), -1,
          MODULE_PULLUP_OHMS, label_copy("pull-up"));
      return;
    }

    case COMP_SONAR: {
      const bool measuring = (part.flags & PART_SONAR_MEASURING) != 0;
      push_element(
          ctx, KIND_RESISTOR, node_at(ctx, part, "ECHO"), node_at(ctx, part, "GND"), -1,
          measuring ? SWITCH_OPEN_OHMS : SWITCH_CLOSED_OHMS,
          label_copy(measuring ? "open" : "closed"));
      push_element(
          ctx, KIND_RESISTOR, node_at(ctx, part, "ECHO"), node_at(ctx, part, "VCC"), -1,
          MODULE_PULLUP_OHMS, label_copy("pull-up"));
      return;
    }

    case COMP_DHT:
      push_element(
          ctx, KIND_RESISTOR, node_at(ctx, part, "SDA"), node_at(ctx, part, "VCC"), -1,
          MODULE_PULLUP_OHMS, label_copy("pull-up"));
      return;

    case COMP_DS18B20:
      push_element(
          ctx, KIND_RESISTOR, node_at(ctx, part, "DQ"), node_at(ctx, part, "VCC"), -1,
          MODULE_PULLUP_OHMS, label_copy("pull-up"));
      return;

    default:
      // Every other component contributes topology only; the engine stamps its
      // pins when firmware state says what to drive.
      return;
  }
}

// ---------------------------------------------------------------------------
// Output state
// ---------------------------------------------------------------------------

int32_t* out_node_of_terminal = nullptr;
int32_t out_node_count = 0;
ElementOut* out_elements = nullptr;
int32_t out_element_count = 0;

bool validate_input(
    const TerminalIn* terminals,
    int32_t terminal_count,
    const PartIn* parts,
    int32_t part_count,
    const PinIn* pins,
    int32_t pin_count,
    const KnobIn* knobs,
    int32_t knob_count,
    const WireIn* wires,
    int32_t wire_count) {
  if (terminal_count < 0 || part_count < 0 || pin_count < 0 || knob_count < 0 || wire_count < 0) {
    return false;
  }
  if (terminal_count > 0 && terminals == nullptr) return false;
  if (part_count > 0 && parts == nullptr) return false;
  if (pin_count > 0 && pins == nullptr) return false;
  if (knob_count > 0 && knobs == nullptr) return false;
  if (wire_count > 0 && wires == nullptr) return false;

  for (int32_t i = 0; i < part_count; i++) {
    const PartIn& part = parts[i];
    if (part.first_pin > static_cast<uint32_t>(pin_count) ||
        part.pin_count > static_cast<uint32_t>(pin_count) - part.first_pin) {
      return false;
    }
    if (part.first_knob > static_cast<uint32_t>(knob_count) ||
        part.knob_count > static_cast<uint32_t>(knob_count) - part.first_knob) {
      return false;
    }
  }
  for (int32_t i = 0; i < pin_count; i++) {
    if (pins[i].terminal >= static_cast<uint32_t>(terminal_count)) return false;
  }
  for (int32_t i = 0; i < wire_count; i++) {
    if (wires[i].from >= static_cast<uint32_t>(terminal_count) ||
        wires[i].to >= static_cast<uint32_t>(terminal_count)) {
      return false;
    }
  }
  return true;
}

}  // namespace

extern "C" int32_t build_netlist(
    const TerminalIn* terminals,
    int32_t terminal_count,
    const PartIn* parts,
    int32_t part_count,
    const PinIn* pins,
    int32_t pin_count,
    const KnobIn* knobs,
    int32_t knob_count,
    const WireIn* wires,
    int32_t wire_count,
    const uint32_t* ground_terminals,
    int32_t ground_count,
    const uint32_t* key_labels,
    int32_t key_label_count,
    const char* strings,
    int32_t strings_bytes,
    int32_t ir_transmitting,
    int32_t red_profile,
    int32_t green_profile,
    int32_t blue_profile) {
  out_node_of_terminal = nullptr;
  out_node_count = 0;
  out_elements = nullptr;
  out_element_count = 0;

  if (!validate_input(
          terminals, terminal_count, parts, part_count, pins, pin_count, knobs, knob_count, wires,
          wire_count)) {
    return -2;
  }
  if (ground_count > 0 && ground_terminals == nullptr) return -2;
  for (int32_t i = 0; i < ground_count; i++) {
    if (ground_terminals[i] >= static_cast<uint32_t>(terminal_count)) return -2;
  }

  int32_t* node_of_terminal = reinterpret_cast<int32_t*>(
      alloc_bytes(static_cast<uint32_t>(terminal_count) * sizeof(int32_t)));
  if (terminal_count > 0 && node_of_terminal == nullptr) return -2;
  for (int32_t i = 0; i < terminal_count; i++) node_of_terminal[i] = -1;

  DisjointSet sets;
  if (!disjoint_set_init(sets, terminal_count)) return -2;

  // Internal part connections: pins sharing a net name are one conductor.
  for (int32_t pi = 0; pi < part_count; pi++) {
    const PartIn& part = parts[pi];
    for (uint32_t i = 0; i < part.pin_count; i++) {
      const PinIn& pin = pins[part.first_pin + i];
      const char* net =
          pin.net_offset == 0 ? "" : string_at(strings, strings_bytes, pin.net_offset);
      if (net[0] == '\0') continue;
      for (uint32_t j = 0; j < i; j++) {
        const PinIn& earlier = pins[part.first_pin + j];
        const char* earlier_net =
            earlier.net_offset == 0 ? "" : string_at(strings, strings_bytes, earlier.net_offset);
        if (streq(earlier_net, net)) {
          disjoint_set_union(sets, earlier.terminal, pin.terminal);
          break;
        }
      }
    }
  }

  for (int32_t i = 0; i < wire_count; i++) {
    disjoint_set_union(sets, static_cast<int32_t>(wires[i].from), static_cast<int32_t>(wires[i].to));
  }

  CellMap cells;
  if (!cell_map_init(cells, terminal_count)) return -2;
  const double snap_squared = SNAP_DISTANCE_MM * SNAP_DISTANCE_MM;
  for (int32_t id = 0; id < terminal_count; id++) {
    const double x = terminals[id].x;
    const double y = terminals[id].y;
    const int32_t cell_x = static_cast<int32_t>(__builtin_floor(x / SNAP_DISTANCE_MM));
    const int32_t cell_y = static_cast<int32_t>(__builtin_floor(y / SNAP_DISTANCE_MM));
    for (int32_t dx = -1; dx <= 1; dx++) {
      for (int32_t dy = -1; dy <= 1; dy++) {
        const int32_t slot = cell_slot(cells, cell_key(cell_x + dx, cell_y + dy), false);
        if (slot < 0) continue;
        for (int32_t other = cells.heads[slot]; other >= 0; other = cells.next[other]) {
          const double gap_x = terminals[other].x - x;
          const double gap_y = terminals[other].y - y;
          if (gap_x * gap_x + gap_y * gap_y <= snap_squared) {
            disjoint_set_union(sets, other, id);
          }
        }
      }
    }
    const int32_t slot = cell_slot(cells, cell_key(cell_x, cell_y), true);
    if (slot < 0) return -2;
    cells.next[id] = cells.heads[slot];
    cells.heads[slot] = id;
  }

  int32_t ground_root = -1;
  for (int32_t i = 0; i < ground_count; i++) {
    ground_root = disjoint_set_find(sets, static_cast<int32_t>(ground_terminals[i]));
    break;
  }

  // Only nets a reading can reach are numbered. A breadboard's bare holes are
  // topology, not nodes; a wire dropped on one re-enables its whole root.
  uint8_t* signal = reinterpret_cast<uint8_t*>(alloc_bytes(static_cast<uint32_t>(terminal_count)));
  if (terminal_count > 0 && signal == nullptr) return -2;
  for (int32_t i = 0; i < terminal_count; i++) signal[i] = 1;
  for (int32_t pi = 0; pi < part_count; pi++) {
    const PartIn& part = parts[pi];
    if (part.kind != COMP_BREADBOARD) continue;
    for (uint32_t i = 0; i < part.pin_count; i++) {
      signal[pins[part.first_pin + i].terminal] = 0;
    }
  }
  for (int32_t i = 0; i < wire_count; i++) {
    signal[wires[i].from] = 1;
    signal[wires[i].to] = 1;
  }

  uint8_t* live = reinterpret_cast<uint8_t*>(alloc_bytes(static_cast<uint32_t>(terminal_count)));
  int32_t* node_of_root = reinterpret_cast<int32_t*>(
      alloc_bytes(static_cast<uint32_t>(terminal_count) * sizeof(int32_t)));
  if (terminal_count > 0 && (live == nullptr || node_of_root == nullptr)) return -2;
  for (int32_t i = 0; i < terminal_count; i++) {
    live[i] = 0;
    node_of_root[i] = -1;
  }

  for (int32_t id = 0; id < terminal_count; id++) {
    if (signal[id] == 0) continue;
    const int32_t root = disjoint_set_find(sets, id);
    if (root != ground_root) live[root] = 1;
  }

  int32_t node_count = 0;
  for (int32_t id = 0; id < terminal_count; id++) {
    const int32_t root = disjoint_set_find(sets, id);
    if (root == ground_root || live[root] == 0) continue;
    if (node_of_root[root] < 0) node_of_root[root] = node_count++;
  }
  for (int32_t id = 0; id < terminal_count; id++) {
    const int32_t root = disjoint_set_find(sets, id);
    node_of_terminal[id] = (root == ground_root || live[root] == 0) ? -1 : node_of_root[root];
  }

  // Elements: at most 33 from a four-digit display, so 40 per part is a safe
  // upper bound; the push helper flags an overflow rather than writing past it.
  const int64_t element_bound =
      static_cast<int64_t>(part_count) * 40 + static_cast<int64_t>(wire_count) + 8;
  if (element_bound > 0x7fffffffLL) return -2;
  const int32_t element_capacity = static_cast<int32_t>(element_bound);
  ElementOut* elements = reinterpret_cast<ElementOut*>(
      alloc_bytes(static_cast<uint32_t>(element_capacity) * sizeof(ElementOut)));
  if (elements == nullptr) return -2;

  const uint64_t label_bytes =
      64u + static_cast<uint64_t>(part_count) * 512u + static_cast<uint64_t>(wire_count) * 128u;
  if (label_bytes > 0xffffffffULL) return -2;
  if (!labels_begin(static_cast<uint32_t>(label_bytes))) return -2;

  BuildContext ctx;
  ctx.terminals = terminals;
  ctx.terminal_count = terminal_count;
  ctx.parts = parts;
  ctx.part_count = part_count;
  ctx.pins = pins;
  ctx.pin_count = pin_count;
  ctx.knobs = knobs;
  ctx.knob_count = knob_count;
  ctx.wires = wires;
  ctx.wire_count = wire_count;
  ctx.ground_terminals = ground_terminals;
  ctx.ground_count = ground_count;
  ctx.key_labels = key_labels;
  ctx.key_label_count = key_label_count;
  ctx.strings = strings;
  ctx.strings_bytes = strings_bytes;
  ctx.ir_transmitting = ir_transmitting;
  ctx.red_profile = red_profile;
  ctx.green_profile = green_profile;
  ctx.blue_profile = blue_profile;
  ctx.node_of_terminal = node_of_terminal;
  ctx.elements = elements;
  ctx.element_capacity = element_capacity;
  ctx.element_count = 0;
  ctx.overflow = false;

  for (int32_t pi = 0; pi < part_count; pi++) emit_part(ctx, parts[pi]);

  for (int32_t i = 0; i < wire_count; i++) {
    const WireIn& wire = wires[i];
    const int32_t a = node_of_terminal[wire.from];
    const int32_t b = node_of_terminal[wire.to];
    if (a == b) continue;
    const char* id = string_at(strings, strings_bytes, wire.id_offset);
    const uint32_t start = label_begin();
    label_text("wire ");
    label_text(id);
    const uint32_t label = label_end(start);
    push_element(
        ctx,
        KIND_RESISTOR,
        a,
        b,
        -1,
        wire_resistance(wire.gauge_awg, wire.length_mm),
        label);
  }

  if (ctx.overflow || label_overflow) return -2;

  out_node_of_terminal = node_of_terminal;
  out_node_count = node_count;
  out_elements = elements;
  out_element_count = ctx.element_count;
  return 0;
}

extern "C" uint32_t netlist_node_of_terminal() {
  return reinterpret_cast<uint32_t>(out_node_of_terminal);
}

extern "C" int32_t netlist_node_count() { return out_node_count; }

extern "C" uint32_t netlist_elements() { return reinterpret_cast<uint32_t>(out_elements); }

extern "C" int32_t netlist_element_count() { return out_element_count; }

extern "C" uint32_t netlist_labels() { return reinterpret_cast<uint32_t>(label_buffer); }

extern "C" int32_t build_elements(
    const BuildElementsInput* input,
    BuildElementsOutput* output) {
  // Early validation
  if (!input || !output) return -1;
  if (!input->netlist_elements && input->netlist_element_count > 0) return -2;
  if (!input->node_of_terminal && input->terminal_count > 0) return -2;
  if (!input->pin_node && input->terminal_count > 0) return -2;

  // Count driven pins (those with a valid node and an explicit level).
  int32_t extra = 0;
  if (input->pin_levels != nullptr && input->pin_node != nullptr) {
    for (int32_t t = 0; t < input->terminal_count; t++) {
      if (input->pin_node[t] == 0xFFFFFFFFu) continue;
      if (t >= input->pin_level_count) continue;
      uint32_t lvl = input->pin_levels[t];
      if (lvl == 0 || lvl == 1) extra++;
    }
  }

  const int32_t total = input->netlist_element_count + extra;
  if (total > 0) {
    output->elements = reinterpret_cast<ElementOut*>(
        alloc_bytes(static_cast<uint32_t>(total) * sizeof(ElementOut)));
    if (!output->elements) return -2;
  } else {
    output->elements = nullptr;
  }
  for (int32_t i = 0; i < input->netlist_element_count; i++) {
    output->elements[i] = input->netlist_elements[i];
  }
  int32_t idx = input->netlist_element_count;
  if (input->pin_levels != nullptr && input->pin_node != nullptr) {
    for (int32_t t = 0; t < input->terminal_count; t++) {
      if (input->pin_node[t] == 0xFFFFFFFFu) continue;
      if (t >= input->pin_level_count) continue;
      uint32_t lvl = input->pin_levels[t];
      if (lvl != 0 && lvl != 1) continue;
      ElementOut& el = output->elements[idx++];
      el.kind = KIND_VOLTAGE_SOURCE;
      el.a = static_cast<int32_t>(input->pin_node[t]);
      el.b = -1;  // reference node handled by solver's ground convention
      el.profile = -1;
      el.label_offset = 0;
      el.pad = 0;
      el.value = (lvl == 1) ? 5.0 : 0.0;
    }
  }
  output->element_count = idx;
  return 0;
}
