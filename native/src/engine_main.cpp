/**
 * C++ engine entry point (ticket #56).
 *
 * Wires the freestanding simulation core (AVR CPU + firmware VM) behind the
 * FFI surface declared in `native/abi/engine-ffi.schema.json`. The netlist /
 * solver / part-model wiring is intentionally incremental: this commit lands
 * the handle lifecycle, sketch compilation and the VM step loop, which is the
 * part the AVR side needs to run end to end. Netlist construction from the
 * circuit JSON, element stamping and the MNA solve follow in the next pass;
 * until then `engine_get_voltages` reports zero nodes honestly rather than
 * pretending to have solved anything.
 *
 * The entry point is freestanding C++20 for wasm32: no libc, no exceptions,
 * no RTTI. Memory comes from `wasm_alloc` (the shared bump allocator) and
 * strings are copied by hand.
 */
#include "ffi-generated.h"

#include "engine.h"
#include "firmware.h"

#include <stddef.h>
#include <stdint.h>

extern "C" {
extern unsigned char __heap_base;
uint32_t wasm_alloc(uint32_t bytes);
}

extern "C" {
VM* vm_create(void);
void vm_destroy(VM* vm);
int32_t vm_load_sketch(VM* vm, Program* program);
int32_t vm_run(VM* vm, int32_t milliseconds);
const char* vm_serial_output(VM* vm);
Program* vm_parse(const char* source, int32_t source_len, const char* file, int32_t file_len);
void vm_free_program(Program* program);
}

namespace {
constexpr int32_t MAX_ENGINES = 64;

struct Engine {
  int32_t handle;
  VM* vm;
  Program* program;
  // Owned copy of the sketch source (vm_parse reads it; keep it alive).
  char* sketch;
  int32_t sketch_len;
  // Serial output captured after the last step (points into wasm memory).
  const char* serial;
  // Voltages for the last solve; empty until the netlist path lands.
  double* voltages;
  int32_t node_count;
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
    engines[i].sketch_len = 0;
    engines[i].serial = "";
    engines[i].voltages = nullptr;
    engines[i].node_count = 0;
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
}  // namespace

extern "C" int32_t engine_create(const char* circuit_json, const char* sketch_json) {
  (void)circuit_json;
  ensure_init();

  int32_t slot = -1;
  for (int32_t i = 0; i < MAX_ENGINES; i++) {
    if (!engines[i].alive) {
      slot = i;
      break;
    }
  }
  if (slot < 0) return FFI_HANDLE_NONE;

  Engine& e = engines[slot];
  e.handle = slot + 1;
  e.vm = vm_create();
  if (e.vm == nullptr) {
    e.handle = 0;
    return FFI_HANDLE_NONE;
  }
  e.program = nullptr;
  e.sketch = nullptr;
  e.sketch_len = 0;
  e.serial = "";
  e.voltages = nullptr;
  e.node_count = 0;
  e.alive = true;

  if (sketch_json != nullptr) {
    const int32_t len = strlen_(sketch_json);
    e.sketch = copy_string(sketch_json, len);
    e.sketch_len = len;
    if (e.sketch != nullptr) {
      e.program = vm_parse(e.sketch, len, "sketch.cpp", 10);
      if (e.program != nullptr) {
        if (vm_load_sketch(e.vm, e.program) != 0) {
          // Keep the program around for debugging; a failed load leaves the VM empty.
        }
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
  return FFI_OK;
}

extern "C" int32_t engine_set_pin(int32_t handle, const char* part_id, const char* pin, int32_t level) {
  (void)handle;
  (void)part_id;
  (void)pin;
  (void)level;
  return FFI_ERR_NOT_IMPLEMENTED;
}

extern "C" int32_t engine_set_knob(int32_t handle, const char* part_id, const char* knob, double value) {
  (void)handle;
  (void)part_id;
  (void)knob;
  (void)value;
  return FFI_ERR_NOT_IMPLEMENTED;
}

extern "C" const FFIPartStateSnapshot* engine_get_state(int32_t handle, int32_t* out_count) {
  (void)handle;
  if (out_count != nullptr) *out_count = 0;
  return nullptr;
}

extern "C" const double* engine_get_voltages(int32_t handle, int32_t* out_count) {
  Engine* e = lookup(handle);
  if (e == nullptr) {
    if (out_count != nullptr) *out_count = 0;
    return nullptr;
  }
  if (out_count != nullptr) *out_count = e->node_count;
  // Until the netlist/solver path lands, no nodes are solved.
  if (e->voltages == nullptr && e->node_count > 0) {
    e->voltages = reinterpret_cast<double*>(
        wasm_alloc(static_cast<uint32_t>(e->node_count) * sizeof(double)));
    if (e->voltages != nullptr) {
      for (int32_t i = 0; i < e->node_count; i++) e->voltages[i] = 0.0;
    }
  }
  return e->voltages;
}

extern "C" const char* engine_get_serial(int32_t handle) {
  Engine* e = lookup(handle);
  if (e == nullptr) return "";
  return (e->serial != nullptr) ? e->serial : "";
}

extern "C" void engine_destroy(int32_t handle) {
  Engine* e = lookup(handle);
  if (e == nullptr) return;
  if (e->vm != nullptr) vm_destroy(e->vm);
  if (e->program != nullptr) vm_free_program(e->program);
  e->vm = nullptr;
  e->program = nullptr;
  e->sketch = nullptr;
  e->alive = false;
  e->handle = 0;
}
