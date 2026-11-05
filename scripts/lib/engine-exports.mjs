/**
 * Function names the C++ simulation core exports.
 *
 * Two builds compile the same sources: the freestanding clang build used by
 * the parity tests (`npm run build:engine`) and the Emscripten browser module
 * (`npm run build:engine:ffi`). Keeping the list here means adding an export
 * cannot leave one of them behind.
 *
 * Names have no leading underscore; callers prefix `_` where the linker wants
 * the C symbol spelling.
 */
export const ENGINE_EXPORTS = Object.freeze([
  // Shared runtime
  'wasm_alloc',
  'set_profiles',
  // Solver
  'solve',
  'result_voltages',
  'result_source_currents',
  'result_iterations',
  'element_current',
  // Netlist
  'build_netlist',
  'netlist_node_of_terminal',
  'netlist_node_count',
  'netlist_elements',
  'netlist_element_count',
  'netlist_labels',
  'build_elements',
  // AVR core
  'cpu_step',
  'cpu_get_pc',
  'cpu_set_pc',
  'cpu_get_reg',
  'cpu_set_reg',
  'cpu_get_sreg',
  'cpu_set_sreg',
  'cpu_get_sp',
  'cpu_set_sp',
  'cpu_get_cycles',
  'cpu_set_cycles',
  'cpu_get_flash_capacity',
  'cpu_reset',
  'cpu_flash_base',
  'cpu_get_instructions',
  'cpu_write_pin',
  'cpu_pin_level',
  // Firmware VM
  'vm_tokenize',
  'vm_parse',
  'vm_free_program',
  'vm_ast_to_json',
  'vm_create',
  'vm_destroy',
  'vm_load_sketch',
  'vm_run',
  'vm_step',
  'vm_get_debug_state',
  'vm_set_breakpoint',
  'vm_clear_breakpoint',
  'vm_set_step_over',
  'vm_set_step_into',
  'vm_pin_level',
  'vm_set_pin_level',
  'vm_serial_output',
]);
