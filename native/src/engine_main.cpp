/**
 * C++ engine entry point (ticket #56).
 *
 * Wires the freestanding simulation core behind the FFI surface declared in
 * `native/abi/engine-ffi.schema.json`. This commit lands the handle lifecycle,
 * sketch compilation, a minimal JSON reader for the *expanded* netlist shape,
 * netlist construction, element stamping, the MNA solve and voltage/serial
 * output. Part-state snapshots and bench-JSON expansion remain follow-ups.
 *
 * The circuit JSON is the expanded netlist shape (not the raw bench), because
 * the freestanding core has no part-definition expansion. Expected shape:
 *
 *   {
 *     "terminals": [{"x":..,"y":..}, ...],
 *     "parts": [{"kind":..,"first_pin":..,"pin_count":..,"first_knob":..,
 *                "knob_count":..,"flags":..,"params":[4 doubles],"scripted":..}, ...],
 *     "pins": [{"terminal":..,"name_offset":..,"net_offset":..}, ...],
 *     "knobs": [{"value":..,"min":..,"max":..,"name_offset":..}, ...],
 *     "wires": [{"from":..,"to":..,"id_offset":..,"gauge_awg":..,"length_mm":..}, ...],
 *     "groundTerminals": [..],
 *     "keyLabels": [..],
 *     "strings": "<string pool with embedded NULs>",  // offset 0 is ""
 *     "irTransmitting": 0/1,
 *     "redProfile": 0, "greenProfile": 0, "blueProfile": 0
 *   }
 *
 * `sketch_json` is the sketch source text.
 *
 * Freestanding C++20 for wasm32: no libc, no exceptions, no RTTI. Memory comes
 * from `wasm_alloc`; strings are copied by hand.
 */
#include "ffi-generated.h"

#include "engine.h"
#include "firmware.h"

using namespace engine;

#include <stddef.h>
#include <stdint.h>
#include <cstring>

extern "C" {
extern unsigned char __heap_base;
uint32_t wasm_alloc(uint32_t bytes);
void wasm_free(void* ptr);
}

// Arena free-list allocator: a bump allocator with a free list for reuse.
// All allocations are 8-byte aligned. Free blocks are kept in a singly-linked
// list sorted by address for coalescing adjacent free blocks.
namespace {
struct FreeBlock {
  uint32_t next;   // offset of next free block, or 0 if last
  uint32_t size;   // total block size including this header
};

// Heap starts right after __heap_base. We reserve space for the free list head.
static uint32_t g_heap_ptr = 0;        // bump pointer (bytes from __heap_base)
static uint32_t g_free_list = 0;       // offset of first free block, or 0 if none

static uint32_t align8(uint32_t n) {
  return (n + 7) & ~7u;
}






extern "C" {
VM* vm_create(void);
void vm_destroy(VM* vm);
int32_t vm_load_sketch(VM* vm, Program* program);
int32_t vm_run(VM* vm, int32_t milliseconds);
const char* vm_serial_output(VM* vm);
int32_t vm_get_debug_state(VM* vm, char* out, int32_t out_capacity);
typedef int32_t BreakpointId;
BreakpointId vm_set_breakpoint(VM* vm, const char* file, int32_t line);
void vm_clear_breakpoint(VM* vm, BreakpointId id);
void vm_set_step_over(VM* vm, bool enable);
void vm_set_step_into(VM* vm, bool enable);
Program* vm_parse(const char* source, int32_t source_len, const char* file, int32_t file_len);
void vm_free_program(Program* program);
int32_t solve(const ElementIn* elements, int32_t element_count, int32_t node_count,
              double dt, const double* previous, int32_t previous_count,
              int32_t max_iterations, double tolerance);
uint32_t result_voltages(void);
int32_t result_iterations(void);
int32_t build_netlist(const TerminalIn* terminals, int32_t terminal_count,
                      const PartIn* parts, int32_t part_count,
                      const PinIn* pins, int32_t pin_count,
                      const KnobIn* knobs, int32_t knob_count,
                      const WireIn* wires, int32_t wire_count,
                      const uint32_t* ground_terminals, int32_t ground_count,
                      const uint32_t* key_labels, int32_t key_label_count,
                      const char* strings, int32_t strings_bytes,
                      int32_t ir_transmitting, int32_t red_profile, int32_t green_profile,
                      int32_t blue_profile);
uint32_t netlist_node_of_terminal(void);
int32_t netlist_node_count(void);
uint32_t netlist_elements(void);
int32_t netlist_element_count(void);
int32_t build_elements(const BuildElementsInput* input, BuildElementsOutput* output);
}

// ---------------------------------------------------------------------------
// Minimal JSON reader (numbers, strings, arrays, objects, booleans, null).
// ---------------------------------------------------------------------------
namespace {
enum JsonType { J_NULL, J_BOOL, J_NUM, J_STR, J_ARR, J_OBJ };

struct JsonValue {
  JsonType type;
  double num;
  bool boolean;
  char* str;
  int32_t str_len;
  JsonValue** arr;
  int32_t arr_len;
  int32_t arr_cap;
  char** keys;
  JsonValue** vals;
  int32_t obj_len;
  int32_t obj_cap;
};

struct Cursor {
  const char* s;
  int32_t n;
  int32_t i;
};

void skip_ws(Cursor& c) {
  while (c.i < c.n) {
    char ch = c.s[c.i];
    if (ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r') c.i++;
    else break;
  }
}

JsonValue* new_val() {
  JsonValue* v = reinterpret_cast<JsonValue*>(wasm_alloc(sizeof(JsonValue)));
  if (v == nullptr) return nullptr;
  v->type = J_NULL;
  v->num = 0;
  v->boolean = false;
  v->str = nullptr;
  v->str_len = 0;
  v->arr = nullptr;
  v->arr_len = 0;
  v->arr_cap = 0;
  v->keys = nullptr;
  v->vals = nullptr;
  v->obj_len = 0;
  v->obj_cap = 0;
  return v;
}

char* parse_string(Cursor& c, int32_t* out_len) {
  if (c.i >= c.n || c.s[c.i] != '"') return nullptr;
  c.i++;
  // First pass: length.
  int32_t start = c.i;
  int32_t len = 0;
  while (c.i < c.n && c.s[c.i] != '"') {
    if (c.s[c.i] == '\\') {
      c.i++;
      if (c.i >= c.n) return nullptr;
      char e = c.s[c.i];
      if (e == 'u') {
        c.i += 4;
        len += 1;  // assume BMP codepoint -> one byte (ASCII subset used here)
      } else {
        len += 1;
      }
    } else {
      len += 1;
    }
    c.i++;
  }
  if (c.i >= c.n) return nullptr;
  // Allocate and copy.
  char* buf = reinterpret_cast<char*>(wasm_alloc(static_cast<uint32_t>(len + 1)));
  if (buf == nullptr) return nullptr;
  c.i = start;
  int32_t j = 0;
  bool skip_inc = false;
  while (c.i < c.n && c.s[c.i] != '"') {
    skip_inc = false;
    if (c.s[c.i] == '\\') {
      c.i++;
      char e = c.s[c.i];
      if (e == 'n') buf[j++] = '\n';
      else if (e == 't') buf[j++] = '\t';
      else if (e == 'r') buf[j++] = '\r';
      else if (e == '"') buf[j++] = '"';
      else if (e == '\\') buf[j++] = '\\';
      else if (e == '/') buf[j++] = '/';
      else if (e == 'u') {
        // Parse 4 hex digits, emit as a single byte for ASCII range.
        c.i++;
        unsigned int cp = 0;
        for (int k = 0; k < 4; k++) {
          char h = c.s[c.i++];
          cp <<= 4;
          if (h >= '0' && h <= '9') cp |= (h - '0');
          else if (h >= 'a' && h <= 'f') cp |= (h - 'a' + 10);
          else if (h >= 'A' && h <= 'F') cp |= (h - 'A' + 10);
        }
        buf[j++] = static_cast<char>(cp & 0xff);
        skip_inc = true;
      } else {
        buf[j++] = e;
      }
    } else {
      buf[j++] = c.s[c.i];
    }
    if (!skip_inc) c.i++;
  }
  if (c.i >= c.n) return nullptr;
  c.i++;  // closing quote
  buf[j] = '\0';
  if (out_len) *out_len = j;
  return buf;
}

JsonValue* parse_value(Cursor& c);

JsonValue* parse_array(Cursor& c) {
  if (c.i >= c.n || c.s[c.i] != '[') return nullptr;
  c.i++;
  skip_ws(c);
  JsonValue* v = new_val();
  if (v == nullptr) return nullptr;
  v->type = J_ARR;
  if (c.i < c.n && c.s[c.i] == ']') { c.i++; return v; }
  for (;;) {
    skip_ws(c);
    JsonValue* item = parse_value(c);
    if (item == nullptr) return nullptr;
    if (v->arr_len == v->arr_cap) {
      int32_t nc = v->arr_cap == 0 ? 8 : v->arr_cap * 2;
      JsonValue** na = reinterpret_cast<JsonValue**>(
          wasm_alloc(static_cast<uint32_t>(nc) * sizeof(JsonValue*)));
      if (na == nullptr) return nullptr;
      for (int32_t k = 0; k < v->arr_len; k++) na[k] = v->arr[k];
      v->arr = na;
      v->arr_cap = nc;
    }
    v->arr[v->arr_len++] = item;
    skip_ws(c);
    if (c.i < c.n && c.s[c.i] == ',') { c.i++; continue; }
    if (c.i < c.n && c.s[c.i] == ']') { c.i++; break; }
    return nullptr;
  }
  return v;
}

JsonValue* parse_object(Cursor& c) {
  if (c.i >= c.n || c.s[c.i] != '{') return nullptr;
  c.i++;
  skip_ws(c);
  JsonValue* v = new_val();
  if (v == nullptr) return nullptr;
  v->type = J_OBJ;
  if (c.i < c.n && c.s[c.i] == '}') { c.i++; return v; }
  for (;;) {
    skip_ws(c);
    int32_t key_len = 0;
    char* key = parse_string(c, &key_len);
    if (key == nullptr) return nullptr;
    skip_ws(c);
    if (c.i >= c.n || c.s[c.i] != ':') return nullptr;
    c.i++;
    skip_ws(c);
    JsonValue* val = parse_value(c);
    if (val == nullptr) return nullptr;
    if (v->obj_len == v->obj_cap) {
      int32_t nc = v->obj_cap == 0 ? 8 : v->obj_cap * 2;
      char** nk = reinterpret_cast<char**>(wasm_alloc(static_cast<uint32_t>(nc) * sizeof(char*)));
      JsonValue** nv = reinterpret_cast<JsonValue**>(wasm_alloc(static_cast<uint32_t>(nc) * sizeof(JsonValue*)));
      if (nk == nullptr || nv == nullptr) return nullptr;
      for (int32_t k = 0; k < v->obj_len; k++) { nk[k] = v->keys[k]; nv[k] = v->vals[k]; }
      v->keys = nk;
      v->vals = nv;
      v->obj_cap = nc;
    }
    v->keys[v->obj_len] = key;
    v->vals[v->obj_len] = val;
    v->obj_len++;
    skip_ws(c);
    if (c.i < c.n && c.s[c.i] == ',') { c.i++; continue; }
    if (c.i < c.n && c.s[c.i] == '}') { c.i++; break; }
    return nullptr;
  }
  return v;
}

JsonValue* parse_value(Cursor& c) {
  skip_ws(c);
  if (c.i >= c.n) return nullptr;
  if (c.s[c.i] == '{') return parse_object(c);
  if (c.s[c.i] == '[') return parse_array(c);
  if (c.s[c.i] == '"') {
    JsonValue* v = new_val();
    if (v == nullptr) return nullptr;
    v->type = J_STR;
    v->str = parse_string(c, &v->str_len);
    if (v->str == nullptr && v->str_len != 0) return nullptr;
    // empty string is valid; parse_string returns non-null for "".
    if (v->str == nullptr) {
      // distinguish parse failure from empty: empty string allocates a 1-byte buffer.
    }
    return v;
  }
  if (c.s[c.i] == 't' && c.n - c.i >= 4 && c.s[c.i+1]=='r' && c.s[c.i+2]=='u' && c.s[c.i+3]=='e') {
    JsonValue* v = new_val();
    if (v == nullptr) return nullptr;
    v->type = J_BOOL;
    v->boolean = true;
    c.i += 4;
    return v;
  }
  if (c.s[c.i] == 'f' && c.n - c.i >= 5 && c.s[c.i+1]=='a' && c.s[c.i+2]=='l' && c.s[c.i+3]=='s' && c.s[c.i+4]=='e') {
    JsonValue* v = new_val();
    if (v == nullptr) return nullptr;
    v->type = J_BOOL;
    v->boolean = false;
    c.i += 5;
    return v;
  }
  if (c.s[c.i] == 'n' && c.n - c.i >= 4 && c.s[c.i+1]=='u' && c.s[c.i+2]=='l' && c.s[c.i+3]=='l') {
    JsonValue* v = new_val();
    if (v == nullptr) return nullptr;
    v->type = J_NULL;
    c.i += 4;
    return v;
  }
  // number
  int32_t start = c.i;
  while (c.i < c.n) {
    char ch = c.s[c.i];
    if ((ch >= '0' && ch <= '9') || ch == '-' || ch == '+' || ch == '.' || ch == 'e' || ch == 'E') c.i++;
    else break;
  }
  if (c.i == start) return nullptr;
  // parse manually with simple atof-like
  // Copy into a small buffer and use a hand-rolled conversion.
  int32_t len = c.i - start;
  char* buf = reinterpret_cast<char*>(wasm_alloc(static_cast<uint32_t>(len + 1)));
  if (buf == nullptr) return nullptr;
  for (int32_t k = 0; k < len; k++) buf[k] = c.s[start + k];
  buf[len] = '\0';
  // strtod not available; implement minimal.
  double val = 0;
  int32_t idx = 0;
  bool neg = false;
  if (buf[idx] == '-') { neg = true; idx++; }
  else if (buf[idx] == '+') idx++;
  // integer part
  while (idx < len && buf[idx] >= '0' && buf[idx] <= '9') {
    val = val * 10 + (buf[idx] - '0');
    idx++;
  }
  if (idx < len && buf[idx] == '.') {
    idx++;
    double frac = 0, scale = 0.1;
    while (idx < len && buf[idx] >= '0' && buf[idx] <= '9') {
      frac += (buf[idx] - '0') * scale;
      scale *= 0.1;
      idx++;
    }
    val += frac;
  }
  if (idx < len && (buf[idx] == 'e' || buf[idx] == 'E')) {
    idx++;
    bool eneg = false;
    if (idx < len && (buf[idx] == '-' || buf[idx] == '+')) { if (buf[idx] == '-') eneg = true; idx++; }
    int32_t exp = 0;
    while (idx < len && buf[idx] >= '0' && buf[idx] <= '9') { exp = exp * 10 + (buf[idx] - '0'); idx++; }
    double m = 1;
    for (int32_t e = 0; e < exp; e++) m *= eneg ? 0.1 : 10.0;
    val *= m;
  }
  if (neg) val = -val;
  JsonValue* v = new_val();
  if (v == nullptr) return nullptr;
  v->type = J_NUM;
  v->num = val;
  return v;
}

JsonValue* json_get(const JsonValue* obj, const char* key) {
  if (obj == nullptr || obj->type != J_OBJ) return nullptr;
  for (int32_t i = 0; i < obj->obj_len; i++) {
    const char* k = obj->keys[i];
    int32_t j = 0;
    bool same = true;
    while (k[j] != '\0' || key[j] != '\0') {
      if (k[j] != key[j]) { same = false; break; }
      j++;
    }
    if (same) return obj->vals[i];
  }
  return nullptr;
}

int32_t json_int(const JsonValue* v, int32_t defv) {
  if (v == nullptr || v->type != J_NUM) return defv;
  return static_cast<int32_t>(v->num);
}
double json_num(const JsonValue* v, double defv) {
  if (v == nullptr || v->type != J_NUM) return defv;
  return v->num;
}
}  // namespace

// ---------------------------------------------------------------------------
// Engine state
// ---------------------------------------------------------------------------
namespace {
constexpr int32_t MAX_ENGINES = 64;

struct Engine {
  int32_t handle;
  VM* vm;
  Program* program;
  char* sketch;
  const char* serial;
  // Netlist data.
  int32_t terminal_count;
  int32_t* node_of_terminal;
  uint32_t* pin_node;
  int32_t node_count;
  ElementOut* netlist_elements;
  int32_t netlist_element_count;
  // Dynamic state.
  uint32_t* pin_levels;
  int32_t pin_level_count;
  // pinTerminals: parallel arrays, key = "partId:pin".
  char** pin_term_keys;
  int32_t* pin_term_vals;
  int32_t pin_term_count;
  int32_t pin_term_cap;
  // Knobs.
  double* knob_values;
  int32_t knob_count;
  char** knob_keys;
  int32_t* knob_vals;
  int32_t knob_map_count;
  int32_t knob_map_cap;
  // Solve state.
  double* voltages;
  double* previous;
  int32_t previous_count;
  ElementOut* elements;
  int32_t element_count;
  ElementIn* solve_elements;
  int32_t solve_element_count;
  char* debug_state;
  int32_t debug_state_cap;
  // Parts (lightweight registry, no STL dependency).
  struct PartInfo {
    uint32_t part_id;
    uint32_t kind;  // PartKind enum value
  };
  PartInfo* part_infos;
  int32_t part_count;
  bool alive;
};

Engine engines[MAX_ENGINES];
bool engines_inited = false;

void ensure_init() {
  if (engines_inited) return;
  for (int32_t i = 0; i < MAX_ENGINES; i++) {
    engines[i].handle = 0;
    engines[i].vm = nullptr;
    engines[i].program = nullptr;
    engines[i].sketch = nullptr;
    engines[i].serial = "";
    engines[i].terminal_count = 0;
    engines[i].node_of_terminal = nullptr;
    engines[i].pin_node = nullptr;
    engines[i].node_count = 0;
    engines[i].netlist_elements = nullptr;
    engines[i].netlist_element_count = 0;
    engines[i].pin_levels = nullptr;
    engines[i].pin_level_count = 0;
    engines[i].pin_term_keys = nullptr;
    engines[i].pin_term_vals = nullptr;
    engines[i].pin_term_count = 0;
    engines[i].pin_term_cap = 0;
    engines[i].knob_values = nullptr;
    engines[i].knob_count = 0;
    engines[i].knob_keys = nullptr;
    engines[i].knob_vals = nullptr;
    engines[i].knob_map_count = 0;
    engines[i].knob_map_cap = 0;
    engines[i].voltages = nullptr;
    engines[i].previous = nullptr;
    engines[i].previous_count = 0;
    engines[i].elements = nullptr;
    engines[i].element_count = 0;
    engines[i].solve_elements = nullptr;
    engines[i].solve_element_count = 0;
    engines[i].debug_state = nullptr;
    engines[i].debug_state_cap = 0;
    engines[i].alive = false;
  }
  engines_inited = true;
}

int32_t strlen_(const char* s) {
  int32_t n = 0;
  if (s == nullptr) return 0;
  while (s[n] != '\0') n++;
  return n;
}

char* copy_string(const char* src, int32_t len) {
  if (len < 0) len = strlen_(src);
  char* dst = reinterpret_cast<char*>(wasm_alloc(static_cast<uint32_t>(len + 1)));
  if (dst == nullptr) return nullptr;
  for (int32_t i = 0; i < len; i++) dst[i] = src[i];
  dst[len] = '\0';
  return dst;
}

Engine* lookup(int32_t handle) {
  if (handle <= 0 || handle > MAX_ENGINES) return nullptr;
  Engine& e = engines[handle - 1];
  if (!e.alive || e.handle != handle) return nullptr;
  return &e;
}

// Build a NUL-terminated string pool from a JSON array of strings.
// Returns the pool and writes its byte length to *out_bytes. Offset 0 is "".
char* build_string_pool(const JsonValue* arr, int32_t* out_bytes) {
  // First, compute total size: 1 (empty) + sum(len+1).
  int32_t total = 1;
  if (arr != nullptr && arr->type == J_ARR) {
    for (int32_t i = 0; i < arr->arr_len; i++) {
      if (arr->arr[i] != nullptr && arr->arr[i]->type == J_STR) {
        total += arr->arr[i]->str_len + 1;
      } else {
        total += 1;
      }
    }
  }
  char* pool = reinterpret_cast<char*>(wasm_alloc(static_cast<uint32_t>(total)));
  if (pool == nullptr) { if (out_bytes) *out_bytes = 0; return nullptr; }
  pool[0] = '\0';
  int32_t pos = 1;
  // We need offsets per string for the callers, but offsets are stored in the
  // arrays (name_offset/net_offset/id_offset) by the host. So the host must
  // compute offsets against this exact layout. To keep it simple and match the
  // TS oracle, the pool layout is: "" at 0, then each string followed by '\0'.
  // The host is expected to pass offsets consistent with this layout; we do
  // not rewrite them here.
  if (arr != nullptr && arr->type == J_ARR) {
    for (int32_t i = 0; i < arr->arr_len; i++) {
      if (arr->arr[i] != nullptr && arr->arr[i]->type == J_STR) {
        const char* s = arr->arr[i]->str;
        int32_t l = arr->arr[i]->str_len;
        for (int32_t k = 0; k < l; k++) pool[pos + k] = s[k];
        pool[pos + l] = '\0';
        pos += l + 1;
      } else {
        pool[pos] = '\0';
        pos += 1;
      }
    }
  }
  if (out_bytes) *out_bytes = total;
  return pool;
}
}  // namespace

extern "C" int32_t engine_create(const char* circuit_json, const char* sketch_json) {
  ensure_init();

  int32_t slot = -1;
  for (int32_t i = 0; i < MAX_ENGINES; i++) {
    if (!engines[i].alive) { slot = i; break; }
  }
  if (slot < 0) return FFI_HANDLE_NONE;

  Engine& e = engines[slot];
  e.handle = slot + 1;
  e.vm = vm_create();
  if (e.vm == nullptr) { e.handle = 0; return FFI_HANDLE_NONE; }
  e.program = nullptr;
  e.sketch = nullptr;
  e.serial = "";
  e.voltages = nullptr;
  e.node_count = 0;
  e.element_count = 0;
  e.elements = nullptr;
  e.solve_elements = nullptr;
  e.solve_element_count = 0;
  e.previous = nullptr;
  e.previous_count = 0;
  e.alive = true;
  e.debug_state = nullptr;
  e.debug_state_cap = 0;
  e.part_infos = nullptr;
  e.part_count = 0;

  // Sketch.
  if (sketch_json != nullptr) {
    const int32_t len = strlen_(sketch_json);
    e.sketch = copy_string(sketch_json, len);
    if (e.sketch != nullptr) {
      e.program = vm_parse(e.sketch, len, "sketch.cpp", 10);
      if (e.program != nullptr) {
        vm_load_sketch(e.vm, e.program);
      }
    }
  }

  // Circuit.
  if (circuit_json != nullptr) {
    Cursor c;
    c.s = circuit_json;
    c.n = strlen_(circuit_json);
    c.i = 0;
    JsonValue* root = parse_value(c);
    if (root != nullptr && root->type == J_OBJ) {
      const JsonValue* terminals = json_get(root, "terminals");
      const JsonValue* parts = json_get(root, "parts");
      const JsonValue* pins = json_get(root, "pins");
      const JsonValue* knobs = json_get(root, "knobs");
      const JsonValue* wires = json_get(root, "wires");
      const JsonValue* ground = json_get(root, "groundTerminals");
      const JsonValue* keyLabels = json_get(root, "keyLabels");
      const JsonValue* strings = json_get(root, "strings");

      const int32_t tcount = (terminals && terminals->type == J_ARR) ? terminals->arr_len : 0;
      const int32_t pcount = (parts && parts->type == J_ARR) ? parts->arr_len : 0;
      const int32_t pincount = (pins && pins->type == J_ARR) ? pins->arr_len : 0;
      const int32_t kcount = (knobs && knobs->type == J_ARR) ? knobs->arr_len : 0;
      const int32_t wcount = (wires && wires->type == J_ARR) ? wires->arr_len : 0;
      const int32_t gcount = (ground && ground->type == J_ARR) ? ground->arr_len : 0;
      const int32_t klcount = (keyLabels && keyLabels->type == J_ARR) ? keyLabels->arr_len : 0;

      TerminalIn* tarr = reinterpret_cast<TerminalIn*>(
          wasm_alloc(static_cast<uint32_t>(tcount > 0 ? tcount : 1) * sizeof(TerminalIn)));
      PartIn* parr = reinterpret_cast<PartIn*>(
          wasm_alloc(static_cast<uint32_t>(pcount > 0 ? pcount : 1) * sizeof(PartIn)));
      PinIn* pinarr = reinterpret_cast<PinIn*>(
          wasm_alloc(static_cast<uint32_t>(pincount > 0 ? pincount : 1) * sizeof(PinIn)));
      KnobIn* karr = reinterpret_cast<KnobIn*>(
          wasm_alloc(static_cast<uint32_t>(kcount > 0 ? kcount : 1) * sizeof(KnobIn)));
      WireIn* warr = reinterpret_cast<WireIn*>(
          wasm_alloc(static_cast<uint32_t>(wcount > 0 ? wcount : 1) * sizeof(WireIn)));
      uint32_t* garr = gcount > 0
          ? reinterpret_cast<uint32_t*>(wasm_alloc(static_cast<uint32_t>(gcount) * sizeof(uint32_t)))
          : nullptr;
      uint32_t* klarr = klcount > 0
          ? reinterpret_cast<uint32_t*>(wasm_alloc(static_cast<uint32_t>(klcount) * sizeof(uint32_t)))
          : nullptr;

      const JsonValue* pinNode = json_get(root, "pinNode");
      const int32_t pnCount = (pinNode && pinNode->type == J_ARR) ? pinNode->arr_len : 0;
      const int32_t talloc = tcount > 0 ? tcount : 1;
      uint32_t* pnarr = reinterpret_cast<uint32_t*>(
          wasm_alloc(static_cast<uint32_t>(talloc) * sizeof(uint32_t)));
      if (pnarr != nullptr) {
        for (int32_t i = 0; i < talloc; i++) pnarr[i] = 0xFFFFFFFFu;
        for (int32_t i = 0; i < pnCount && i < talloc; i++) {
          int32_t v = json_int(pinNode->arr[i], -1);
          pnarr[i] = (v < 0) ? 0xFFFFFFFFu : static_cast<uint32_t>(v);
        }
      }

      const JsonValue* pinTerminals = json_get(root, "pinTerminals");
      // Count entries.
      int32_t ptCount = (pinTerminals && pinTerminals->type == J_OBJ) ? pinTerminals->obj_len : 0;

      int32_t supplyNode = json_int(json_get(root, "supplyNode"), -1);

      for (int32_t i = 0; i < tcount; i++) {
        const JsonValue* o = terminals->arr[i];
        tarr[i].x = json_num(json_get(o, "x"), 0);
        tarr[i].y = json_num(json_get(o, "y"), 0);
      }
      for (int32_t i = 0; i < pcount; i++) {
        const JsonValue* o = parts->arr[i];
        parr[i].kind = static_cast<uint32_t>(json_int(json_get(o, "kind"), 0));
        parr[i].first_pin = static_cast<uint32_t>(json_int(json_get(o, "first_pin"), 0));
        parr[i].pin_count = static_cast<uint32_t>(json_int(json_get(o, "pin_count"), 0));
        parr[i].first_knob = static_cast<uint32_t>(json_int(json_get(o, "first_knob"), 0));
        parr[i].knob_count = static_cast<uint32_t>(json_int(json_get(o, "knob_count"), 0));
        parr[i].flags = static_cast<uint32_t>(json_int(json_get(o, "flags"), 0));
        const JsonValue* params = json_get(o, "params");
        for (int k = 0; k < 4; k++) {
          parr[i].params[k] = (params && params->type == J_ARR && k < params->arr_len)
              ? json_num(params->arr[k], 0) : 0;
        }
        parr[i].scripted = json_num(json_get(o, "scripted"), 0);
      }

      // Register parts with the C++ parts system so engine_get_state can
      // report per-part snapshots. part_id is a per-engine sequential id.
      e.part_count = pcount;
      if (pcount > 0) {
        e.part_infos = reinterpret_cast<Engine::PartInfo*>(
            wasm_alloc(static_cast<uint32_t>(pcount) * sizeof(Engine::PartInfo)));
        if (e.part_infos != nullptr) {
          for (int32_t i = 0; i < pcount; i++) {
            e.part_infos[i].part_id = static_cast<uint32_t>(i + 1);
            e.part_infos[i].kind = static_cast<uint32_t>(parr[i].kind);
          }
        }
      }

      for (int32_t i = 0; i < pincount; i++) {
        const JsonValue* o = pins->arr[i];
        pinarr[i].terminal = static_cast<uint32_t>(json_int(json_get(o, "terminal"), 0));
        pinarr[i].name_offset = static_cast<uint32_t>(json_int(json_get(o, "name_offset"), 0));
        pinarr[i].net_offset = static_cast<uint32_t>(json_int(json_get(o, "net_offset"), 0));
      }
      for (int32_t i = 0; i < kcount; i++) {
        const JsonValue* o = knobs->arr[i];
        karr[i].value = json_num(json_get(o, "value"), 0);
        karr[i].min = json_num(json_get(o, "min"), 0);
        karr[i].max = json_num(json_get(o, "max"), 0);
        karr[i].name_offset = static_cast<uint32_t>(json_int(json_get(o, "name_offset"), 0));
        karr[i].pad = 0;
      }
      for (int32_t i = 0; i < wcount; i++) {
        const JsonValue* o = wires->arr[i];
        warr[i].from = static_cast<uint32_t>(json_int(json_get(o, "from"), 0));
        warr[i].to = static_cast<uint32_t>(json_int(json_get(o, "to"), 0));
        warr[i].id_offset = static_cast<uint32_t>(json_int(json_get(o, "id_offset"), 0));
        warr[i].pad = 0;
        warr[i].gauge_awg = json_num(json_get(o, "gauge_awg"), 22);
        warr[i].length_mm = json_num(json_get(o, "length_mm"), 0);
      }
      for (int32_t i = 0; i < gcount; i++) {
        garr[i] = static_cast<uint32_t>(json_int(ground->arr[i], 0));
      }
      for (int32_t i = 0; i < klcount; i++) {
        klarr[i] = static_cast<uint32_t>(json_int(keyLabels->arr[i], 0));
      }

      int32_t strings_bytes = 0;
      char* pool = nullptr;
      const JsonValue* stringsVal = json_get(root, "strings");
      if (stringsVal != nullptr && stringsVal->type == J_STR) {
        pool = stringsVal->str;
        strings_bytes = stringsVal->str_len;
      } else if (stringsVal != nullptr && stringsVal->type == J_ARR) {
        // Backwards compat: array of strings -> concatenate.
        pool = build_string_pool(stringsVal, &strings_bytes);
      }

      int32_t ir = json_int(json_get(root, "irTransmitting"), 0);
      int32_t rp = json_int(json_get(root, "redProfile"), 0);
      int32_t gp = json_int(json_get(root, "greenProfile"), 0);
      int32_t bp = json_int(json_get(root, "blueProfile"), 0);

      int32_t rc = build_netlist(
          tcount > 0 ? tarr : nullptr, tcount,
          pcount > 0 ? parr : nullptr, pcount,
          pincount > 0 ? pinarr : nullptr, pincount,
          kcount > 0 ? karr : nullptr, kcount,
          wcount > 0 ? warr : nullptr, wcount,
          gcount > 0 ? garr : nullptr, gcount,
          klcount > 0 ? klarr : nullptr, klcount,
          pool, strings_bytes, ir, rp, gp, bp);

      if (rc == 0) {
        e.terminal_count = tcount;
        e.node_of_terminal = reinterpret_cast<int32_t*>(netlist_node_of_terminal());
        e.pin_node = pnarr;
        e.node_count = netlist_node_count();
        e.netlist_elements = reinterpret_cast<ElementOut*>(netlist_elements());
        e.netlist_element_count = netlist_element_count();
        int32_t n = e.node_count > 0 ? e.node_count : 1;
        e.voltages = reinterpret_cast<double*>(wasm_alloc(static_cast<uint32_t>(n) * sizeof(double)));
        e.previous = reinterpret_cast<double*>(wasm_alloc(static_cast<uint32_t>(n) * sizeof(double)));
        if (e.voltages != nullptr) for (int32_t i = 0; i < n; i++) e.voltages[i] = 0;
        if (e.previous != nullptr) for (int32_t i = 0; i < n; i++) e.previous[i] = 0;
        e.previous_count = n;
        // pin levels + pinTerminals map.
        int32_t talloc2 = tcount > 0 ? tcount : 1;
        e.pin_levels = reinterpret_cast<uint32_t*>(wasm_alloc(static_cast<uint32_t>(talloc2) * sizeof(uint32_t)));
        if (e.pin_levels != nullptr) for (int32_t i = 0; i < talloc2; i++) e.pin_levels[i] = 0;
        e.pin_level_count = talloc2;
        e.pin_term_count = 0;
        e.pin_term_cap = ptCount > 0 ? ptCount : 4;
        e.pin_term_keys = reinterpret_cast<char**>(wasm_alloc(static_cast<uint32_t>(e.pin_term_cap) * sizeof(char*)));
        e.pin_term_vals = reinterpret_cast<int32_t*>(wasm_alloc(static_cast<uint32_t>(e.pin_term_cap) * sizeof(int32_t)));
        if (pinTerminals != nullptr && pinTerminals->type == J_OBJ) {
          for (int32_t i = 0; i < pinTerminals->obj_len; i++) {
            if (e.pin_term_count >= e.pin_term_cap) break;
            e.pin_term_keys[e.pin_term_count] = pinTerminals->keys[i];
            e.pin_term_vals[e.pin_term_count] = json_int(pinTerminals->vals[i], -1);
            e.pin_term_count++;
          }
        }
        (void)supplyNode;
      }
    }
  }

  return e.handle;
}

extern "C" int32_t engine_step(int32_t handle, double dt_ms) {
  Engine* e = lookup(handle);
  if (e == nullptr) return FFI_ERR_INVALID_HANDLE;
  if (e->vm == nullptr) return FFI_ERR_NOT_IMPLEMENTED;

  const int32_t ms = dt_ms < 0 ? 0 : static_cast<int32_t>(dt_ms);
  vm_run(e->vm, ms > 0 ? ms : 1);
  const char* out = vm_serial_output(e->vm);
  e->serial = (out != nullptr) ? out : "";

  // Solve, if a netlist is available.
  if (e->netlist_elements != nullptr) {
    BuildElementsInput in{};
    in.netlist_elements = e->netlist_elements;
    in.netlist_element_count = e->netlist_element_count;
    in.node_count = e->node_count;
    in.node_of_terminal = e->node_of_terminal;
    in.terminal_count = e->terminal_count;
    in.pin_node = e->pin_node;
    in.time_ms = static_cast<double>(/*ms*/ 0);
    in.knob_values = e->knob_values;
    in.knob_count = e->knob_count;
    in.pin_levels = e->pin_levels;
    in.pin_level_count = e->pin_level_count;
    in.supply_net = -1;
    in.supply_node = -1;
    BuildElementsOutput out{};
    if (::build_elements(&in, &out) == 0 && out.elements != nullptr) {
      e->elements = out.elements;
      e->element_count = out.element_count;
    } else {
      e->elements = e->netlist_elements;
      e->element_count = e->netlist_element_count;
    }
    double dt = dt_ms <= 0 ? 1e-5 : dt_ms / 1000.0;
    // Convert ElementOut (with labels) to ElementIn (solver input).
    if (e->solve_elements == nullptr || e->solve_element_count < e->element_count) {
      e->solve_elements = reinterpret_cast<ElementIn*>(
          wasm_alloc(static_cast<uint32_t>(e->element_count > 0 ? e->element_count : 1) * sizeof(ElementIn)));
      e->solve_element_count = e->element_count;
    }
    for (int32_t i = 0; i < e->element_count; i++) {
      e->solve_elements[i].kind = e->elements[i].kind;
      e->solve_elements[i].a = e->elements[i].a;
      e->solve_elements[i].b = e->elements[i].b;
      e->solve_elements[i].profile = e->elements[i].profile;
      e->solve_elements[i].value = e->elements[i].value;
    }
    solve(e->solve_elements, e->element_count, e->node_count, dt,
          e->previous, e->previous_count, 50, 1e-9);
    uint32_t vp = result_voltages();
    if (vp != 0 && e->voltages != nullptr) {
      const double* src = reinterpret_cast<const double*>(vp);
      for (int32_t i = 0; i < e->node_count; i++) e->voltages[i] = src[i];
      if (e->previous != nullptr) {
        for (int32_t i = 0; i < e->node_count; i++) e->previous[i] = src[i];
      }
    }
  }
  return FFI_OK;
}

extern "C" int32_t engine_set_pin(int32_t handle, const char* part_id, const char* pin, int32_t level) {
  Engine* e = lookup(handle);
  if (e == nullptr) return FFI_ERR_INVALID_HANDLE;
  if (part_id == nullptr || pin == nullptr) return FFI_ERR_INVALID_HANDLE;
  // Build key "part_id:pin".
  int32_t a = strlen_(part_id);
  int32_t b = strlen_(pin);
  int32_t keylen = a + 1 + b;
  char* key = reinterpret_cast<char*>(wasm_alloc(static_cast<uint32_t>(keylen + 1)));
  if (key == nullptr) return FFI_ERR_INVALID_HANDLE;
  for (int32_t i = 0; i < a; i++) key[i] = part_id[i];
  key[a] = ':';
  for (int32_t i = 0; i < b; i++) key[a + 1 + i] = pin[i];
  key[keylen] = '\0';
  // Find terminal.
  int32_t terminal = -1;
  for (int32_t i = 0; i < e->pin_term_count; i++) {
    const char* k = e->pin_term_keys[i];
    bool same = true;
    int32_t j = 0;
    while (k[j] != '\0' || key[j] != '\0') {
      if (k[j] != key[j]) { same = false; break; }
      j++;
    }
    if (same) { terminal = e->pin_term_vals[i]; break; }
  }
  if (terminal < 0 || terminal >= e->pin_level_count) {
    wasm_free(key);
    return FFI_ERR_INVALID_HANDLE;
  }
  if (e->pin_levels == nullptr) {
    wasm_free(key);
    return FFI_ERR_INVALID_HANDLE;
  }
  e->pin_levels[terminal] = (level != 0) ? 1u : 0u;
  wasm_free(key);
  return FFI_OK;
}

extern "C" int32_t engine_set_knob(int32_t handle, const char* part_id, const char* knob, double value) {
  Engine* e = lookup(handle);
  if (e == nullptr) return FFI_ERR_INVALID_HANDLE;
  if (part_id == nullptr || knob == nullptr) return FFI_ERR_INVALID_HANDLE;
  int32_t a = strlen_(part_id);
  int32_t b = strlen_(knob);
  int32_t keylen = a + 1 + b;
  char* key = reinterpret_cast<char*>(wasm_alloc(static_cast<uint32_t>(keylen + 1)));
  if (key == nullptr) return FFI_ERR_INVALID_HANDLE;
  for (int32_t i = 0; i < a; i++) key[i] = part_id[i];
  key[a] = ':';
  for (int32_t i = 0; i < b; i++) key[a + 1 + i] = knob[i];
  key[keylen] = ' ';
  for (int32_t i = 0; i < e->knob_map_count; i++) {
    const char* k = e->knob_keys[i];
    bool same = true;
    int32_t j = 0;
    while (k[j] != ' ' || key[j] != ' ') {
      if (k[j] != key[j]) { same = false; break; }
      j++;
    }
    if (same) {
      int32_t idx = e->knob_vals[i];
      if (idx >= 0 && idx < e->knob_count && e->knob_values != nullptr) {
        e->knob_values[idx] = value;
      }
      wasm_free(key);
      return FFI_OK;
    }
  }
  wasm_free(key);
  return FFI_ERR_INVALID_HANDLE;
}

extern "C" const FFIPartStateSnapshot* engine_get_state(int32_t handle, int32_t* out_count) {
  Engine* e = lookup(handle);
  if (e == nullptr || e->part_infos == nullptr || e->part_count == 0) {
    if (out_count != nullptr) *out_count = 0;
    return nullptr;
  }

  // Allocate result array in wasm memory.
  FFIPartStateSnapshot* result = reinterpret_cast<FFIPartStateSnapshot*>(
      wasm_alloc(static_cast<uint32_t>(e->part_count) * sizeof(FFIPartStateSnapshot)));
  if (result == nullptr) {
    if (out_count != nullptr) *out_count = 0;
    return nullptr;
  }

  for (int32_t i = 0; i < e->part_count; i++) {
    memset(&result[i], 0, sizeof(FFIPartStateSnapshot));
    // Write partId as decimal string (truncated to 63 chars + NUL).
    char id_buf[64];
    int32_t id_len = 0;
    uint32_t id = e->part_infos[i].part_id;
    if (id == 0) {
      id_buf[0] = '0';
      id_len = 1;
    } else {
      char tmp[16];
      int32_t tmp_len = 0;
      while (id > 0) {
        tmp[tmp_len++] = static_cast<char>('0' + (id % 10));
        id /= 10;
      }
      while (tmp_len > 0) id_buf[id_len++] = tmp[--tmp_len];
    }
    id_buf[id_len] = '\0';
    int32_t copy_len = id_len < 63 ? id_len : 63;
    memcpy(result[i].part_id, id_buf, copy_len);
    result[i].part_id[copy_len] = '\0';

    // Write kind name. PartKind enum values map to string names.
    const char* kind_name = "unknown";
    switch (e->part_infos[i].kind) {
      case 0:  kind_name = "passive"; break;
      case 1:  kind_name = "mcu"; break;
      case 2:  kind_name = "powerSupply"; break;
      case 3:  kind_name = "relay"; break;
      case 4:  kind_name = "servo"; break;
      case 5:  kind_name = "stepper"; break;
      case 6:  kind_name = "stepperDriver"; break;
      case 7:  kind_name = "shiftRegister"; break;
      case 8:  kind_name = "displayI2C"; break;
      case 9:  kind_name = "displaySPI"; break;
      case 10: kind_name = "display7Seg"; break;
      case 11: kind_name = "displayLCD"; break;
      case 12: kind_name = "i2cExpander"; break;
      case 13: kind_name = "pwmDriver"; break;
      case 14: kind_name = "rtc"; break;
      case 15: kind_name = "sensorI2C"; break;
      case 16: kind_name = "dac"; break;
      case 17: kind_name = "adc"; break;
      case 18: kind_name = "thermocouple"; break;
      case 19: kind_name = "rfid"; break;
      case 20: kind_name = "neopixel"; break;
      case 21: kind_name = "sonar"; break;
      case 22: kind_name = "dht"; break;
      case 23: kind_name = "ds18b20"; break;
      case 24: kind_name = "encoder"; break;
      case 25: kind_name = "button"; break;
      case 26: kind_name = "potentiometer"; break;
      case 27: kind_name = "remote"; break;
      case 28: kind_name = "dialer"; break;
      case 29: kind_name = "sdCard"; break;
      case 30: kind_name = "eeprom"; break;
      case 31: kind_name = "bh1750"; break;
      case 32: kind_name = "bmp180"; break;
      case 33: kind_name = "sht31"; break;
      case 34: kind_name = "tmp102"; break;
      case 35: kind_name = "ina219"; break;
      case 36: kind_name = "scripted"; break;
      default: kind_name = "unknown"; break;
    }
    int32_t kl = static_cast<int32_t>(strlen_(kind_name));
    int32_t kcopy = kl < 31 ? kl : 31;
    memcpy(result[i].kind, kind_name, kcopy);
    result[i].kind[kcopy] = '\0';
    // All numeric state fields remain zeroed (no part context impl yet).
  }

  if (out_count != nullptr) *out_count = e->part_count;
  return result;
}

extern "C" const double* engine_get_voltages(int32_t handle, int32_t* out_count) {
  Engine* e = lookup(handle);
  if (e == nullptr) {
    if (out_count != nullptr) *out_count = 0;
    return nullptr;
  }
  if (out_count != nullptr) *out_count = e->node_count;
  return e->voltages;
}

extern "C" const char* engine_get_serial(int32_t handle) {
  Engine* e = lookup(handle);
  if (e == nullptr) return "";
  return (e->serial != nullptr) ? e->serial : "";
}

extern "C" int32_t engine_set_breakpoint(int32_t handle, int32_t pc) {
  Engine* e = lookup(handle);
  if (e == nullptr || e->vm == nullptr) return FFI_ERR_INVALID_HANDLE;
  vm_set_breakpoint(e->vm, "sketch.cpp", pc);
  return FFI_OK;
}

extern "C" void engine_clear_breakpoint(int32_t handle, int32_t id) {
  Engine* e = lookup(handle);
  if (e == nullptr || e->vm == nullptr) return;
  vm_clear_breakpoint(e->vm, id);
}

extern "C" void engine_set_step_over(int32_t handle, int32_t enable) {
  Engine* e = lookup(handle);
  if (e == nullptr || e->vm == nullptr) return;
  vm_set_step_over(e->vm, enable != 0);
}

extern "C" void engine_set_step_into(int32_t handle, int32_t enable) {
  Engine* e = lookup(handle);
  if (e == nullptr || e->vm == nullptr) return;
  vm_set_step_into(e->vm, enable != 0);
}

extern "C" const char* engine_get_debug_state(int32_t handle) {
  Engine* e = lookup(handle);
  if (e == nullptr || e->vm == nullptr) return "";
  if (e->debug_state == nullptr) {
    e->debug_state_cap = 4096;
    e->debug_state = reinterpret_cast<char*>(wasm_alloc(static_cast<uint32_t>(e->debug_state_cap)));
    if (e->debug_state == nullptr) return "";
  }
  int32_t n = vm_get_debug_state(e->vm, e->debug_state, e->debug_state_cap);
  if (n < 0) return "";
  if (n >= e->debug_state_cap - 1) {
    // Truncated; grow buffer and retry.
    e->debug_state_cap *= 2;
    e->debug_state = reinterpret_cast<char*>(wasm_alloc(static_cast<uint32_t>(e->debug_state_cap)));
    if (e->debug_state == nullptr) return "";
    vm_get_debug_state(e->vm, e->debug_state, e->debug_state_cap);
  }
  return e->debug_state;
}

extern "C" void wasm_free(void* ptr) {
  if (ptr == nullptr) return;
  uint32_t ptr_off = reinterpret_cast<uintptr_t>(ptr) -
                     reinterpret_cast<uintptr_t>(&__heap_base);
  uint32_t block_ptr = ptr_off - 8;
  uint32_t block_size;
  memcpy(&block_size, reinterpret_cast<const uint8_t*>(&__heap_base) + block_ptr + 4, sizeof(uint32_t));

  // Find insertion point to keep list sorted by address.
  uint32_t prev = 0;
  uint32_t curr = g_free_list;
  while (curr != 0 && curr < block_ptr) {
    prev = curr;
    uint32_t next_val;
    memcpy(&next_val, reinterpret_cast<const uint8_t*>(&__heap_base) + curr, sizeof(uint32_t));
    curr = next_val;
  }

  // Coalesce with previous block if adjacent.
  if (prev != 0) {
    uint32_t prev_size;
    memcpy(&prev_size, reinterpret_cast<const uint8_t*>(&__heap_base) + prev + 4, sizeof(uint32_t));
    if (prev + prev_size == block_ptr) {
      prev_size += block_size;
      uint32_t new_size = prev_size;
      memcpy(reinterpret_cast<uint8_t*>(&__heap_base) + prev + 4, &new_size, sizeof(uint32_t));
      block_ptr = prev;
      block_size = prev_size;
    }
  }

  // Coalesce with next block if adjacent.
  if (curr != 0 && block_ptr + block_size == curr) {
    uint32_t curr_size;
    memcpy(&curr_size, reinterpret_cast<const uint8_t*>(&__heap_base) + curr + 4, sizeof(uint32_t));
    block_size += curr_size;
    uint32_t curr_next;
    memcpy(&curr_next, reinterpret_cast<const uint8_t*>(&__heap_base) + curr, sizeof(uint32_t));
    *reinterpret_cast<uint32_t*>(reinterpret_cast<char*>(&__heap_base) + block_ptr) = curr_next;
  } else {
    uint32_t* block_ptr_ptr = reinterpret_cast<uint32_t*>(reinterpret_cast<char*>(&__heap_base) + block_ptr);
    *block_ptr_ptr = curr;
  }

  *reinterpret_cast<uint32_t*>(reinterpret_cast<char*>(&__heap_base) + block_ptr + 4) = block_size;

  // Link block into free list.
  if (prev != 0) {
    uint32_t prev_size_check;
    memcpy(&prev_size_check, reinterpret_cast<const uint8_t*>(&__heap_base) + prev + 4, sizeof(uint32_t));
    if (prev + prev_size_check != block_ptr) {
      *reinterpret_cast<uint32_t*>(reinterpret_cast<char*>(&__heap_base) + prev) = block_ptr;
    }
  } else {
    g_free_list = block_ptr;
  }
}

extern "C" void engine_destroy(int32_t handle) {
  Engine* e = lookup(handle);
  if (e == nullptr) return;
  if (e->vm != nullptr) vm_destroy(e->vm);
  if (e->program != nullptr) vm_free_program(e->program);
  // Free all wasm_alloc'd memory.
  if (e->sketch != nullptr) wasm_free(e->sketch);
  if (e->voltages != nullptr) wasm_free(e->voltages);
  if (e->previous != nullptr) wasm_free(e->previous);
  if (e->pin_levels != nullptr) wasm_free(e->pin_levels);
  if (e->pin_term_keys != nullptr) wasm_free(e->pin_term_keys);
  if (e->pin_term_vals != nullptr) wasm_free(e->pin_term_vals);
  if (e->knob_values != nullptr) wasm_free(e->knob_values);
  if (e->knob_keys != nullptr) wasm_free(e->knob_keys);
  if (e->knob_vals != nullptr) wasm_free(e->knob_vals);
  if (e->elements != nullptr) wasm_free(e->elements);
  if (e->solve_elements != nullptr) wasm_free(e->solve_elements);
  if (e->debug_state != nullptr) wasm_free(e->debug_state);
  if (e->part_infos != nullptr) wasm_free(e->part_infos);
  e->vm = nullptr;
  e->program = nullptr;
  e->sketch = nullptr;
  e->voltages = nullptr;
  e->previous = nullptr;
  e->pin_levels = nullptr;
  e->pin_term_keys = nullptr;
  e->pin_term_vals = nullptr;
  e->knob_values = nullptr;
  e->knob_keys = nullptr;
  e->knob_vals = nullptr;
  e->elements = nullptr;
  e->solve_elements = nullptr;
  e->debug_state = nullptr;
  e->part_infos = nullptr;
  e->part_count = 0;
  e->alive = false;
  e->handle = 0;
}
}