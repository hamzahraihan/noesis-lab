/**
 * Placeholder engine entry points for the Phase 6 browser module.
 *
 * Ticket #56 replaces this file with `native/src/engine_main.cpp`, which wires
 * the solver, netlist, AVR core, firmware VM and part models together. The
 * build script prefers that file when it exists, so this stub keeps the full
 * export surface buildable and testable until the wiring lands.
 *
 * Every entry point returns a status instead of pretending to simulate: a
 * loadable module that silently reports success would be worse than an honest
 * "not implemented" while the integration work is in progress.
 */

#include "ffi-generated.h"

extern "C" {

int32_t engine_create(const char* circuit_json, const char* sketch_json) {
    (void)circuit_json;
    (void)sketch_json;
    return FFI_HANDLE_NONE;
}

int32_t engine_step(int32_t handle, double dt_ms) {
    (void)handle;
    (void)dt_ms;
    return FFI_ERR_NOT_IMPLEMENTED;
}

int32_t engine_set_pin(int32_t handle, const char* part_id, const char* pin, int32_t level) {
    (void)handle;
    (void)part_id;
    (void)pin;
    (void)level;
    return FFI_ERR_NOT_IMPLEMENTED;
}

int32_t engine_set_knob(int32_t handle, const char* part_id, const char* knob, double value) {
    (void)handle;
    (void)part_id;
    (void)knob;
    (void)value;
    return FFI_ERR_NOT_IMPLEMENTED;
}

const FFIPartStateSnapshot* engine_get_state(int32_t handle, int32_t* out_count) {
    (void)handle;
    if (out_count != nullptr) *out_count = 0;
    return nullptr;
}

const double* engine_get_voltages(int32_t handle, int32_t* out_count) {
    (void)handle;
    if (out_count != nullptr) *out_count = 0;
    return nullptr;
}

const char* engine_get_serial(int32_t handle) {
    (void)handle;
    return "";
}

void engine_destroy(int32_t handle) { (void)handle; }

}  // extern "C"
