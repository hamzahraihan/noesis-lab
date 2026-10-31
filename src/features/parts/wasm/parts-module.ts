/**
 * Hand-written WebAssembly loader for the parts probe module.
 *
 * Loads the committed `parts.wasm` artifact (built by `scripts/build-parts-probe.mjs`),
 * instantiates it with the three required imports, and exposes a typed wrapper
 * around all exported C ABI functions.
 *
 * No emcc-generated JS glue is used; this module is the only thing that knows
 * the wasm import/export surface.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = join(__dirname, 'parts.wasm');

/** Memory view helpers for reading/writing wasm linear memory. */
class WasmMemory {
  constructor(public readonly memory: WebAssembly.Memory) {}

  getF64(ptr: number): number {
    return new DataView(this.memory.buffer).getFloat64(ptr, true);
  }

  setF64(ptr: number, value: number): void {
    new DataView(this.memory.buffer).setFloat64(ptr, value, true);
  }

  getU32(ptr: number): number {
    return new DataView(this.memory.buffer).getUint32(ptr, true);
  }

  setU32(ptr: number, value: number): void {
    new DataView(this.memory.buffer).setUint32(ptr, value, true);
  }

  getU8(ptr: number): number {
    return new Uint8Array(this.memory.buffer)[ptr];
  }

  setU8(ptr: number, value: number): void {
    new Uint8Array(this.memory.buffer)[ptr] = value;
  }

  /** Allocates `count` bytes in wasm memory and returns the pointer (byte-aligned). */
  allocBytes(count: number): number {
    const ptr = this.heapPtr;
    this.heapPtr += count;
    return ptr;
  }

  /** Allocates `count` doubles in wasm memory and returns the pointer (8-byte aligned). */
  allocDoubles(count: number): number {
    // Align to 8 bytes
    this.heapPtr = (this.heapPtr + 7) & ~7;
    const ptr = this.heapPtr;
    this.heapPtr += count * 8;
    return ptr;
  }

  /** Reads `count` doubles from `ptr` into a JS array. */
  readDoubles(ptr: number, count: number): number[] {
    const view = new Float64Array(this.memory.buffer, ptr, count);
    return Array.from(view);
  }

  /** Allocates and writes a null-terminated UTF-8 string, returns the pointer. */
  allocString(str: string): number {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(str);
    const ptr = this.allocBytes(bytes.length + 1);
    const view = new Uint8Array(this.memory.buffer, ptr, bytes.length + 1);
    view.set(bytes);
    view[bytes.length] = 0; // Null terminator
    return ptr;
  }

  private heapPtr = 1024 * 1024; // Start after 1MB (initial memory)
}

/** Part state snapshot matching the C++ PartStateSnapshot struct layout (packed, no padding). */
export interface PartStateSnapshot {
  framebuffer: number;
  framebuffer_size: number;
  width: number;
  height: number;
  servo_angle: number;
  stepper_angle_deci_deg: number;
  stepper_driver_outputs: number[];
  seven_seg_digits: number[];
  seven_seg_colon: number;
  lcd_chars: number[];
  lcd_rows: number;
  lcd_cols: number;
  shift_register_outputs: number[];
  relay_contacts_closed: boolean;
  button_pressed: boolean;
  pot_wiper: number;
  rfid_card_present: boolean;
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
}

/** Reads a PartStateSnapshot from wasm memory at the given pointer. */
export function readPartStateSnapshot(wasmMemory: WasmMemory, ptr: number): PartStateSnapshot {
  const view = new DataView(wasmMemory.memory.buffer, ptr);
  let offset = 0;
  const rU32 = () => { const v = view.getUint32(offset, true); offset += 4; return v; };
  const rU16 = () => { const v = view.getUint16(offset, true); offset += 2; return v; };
  const rU8 = () => { const v = view.getUint8(offset); offset += 1; return v; };
  const rI16 = () => { const v = view.getInt16(offset, true); offset += 2; return v; };
  const rF64 = () => { const v = view.getFloat64(offset, true); offset += 8; return v; };
  const rArr8 = (len: number) => { const arr = new Uint8Array(wasmMemory.memory.buffer, ptr + offset, len); offset += len; return Array.from(arr); };
  const rArr16 = (len: number) => { const arr = new Uint16Array(wasmMemory.memory.buffer, ptr + offset, len); offset += len * 2; return Array.from(arr); };
  const snap = {
    framebuffer: rU32(),
    framebuffer_size: rU32(),
    width: rU16(),
    height: rU16(),
    servo_angle: rU8(),
    stepper_angle_deci_deg: rI16(),
    stepper_driver_outputs: rArr8(4),
    seven_seg_digits: rArr8(8),
    seven_seg_colon: rU8(),
    lcd_chars: rArr8(80),
    lcd_rows: rU8(),
    lcd_cols: rU8(),
    shift_register_outputs: rArr8(8),
    relay_contacts_closed: rU8() !== 0,
    button_pressed: rU8() !== 0,
    pot_wiper: rF64(),
    rfid_card_present: rU8() !== 0,
    thermocouple_temp_quarter_deg: rI16(),

    // PCF8574 I2C expander state
    pcf8574_output_reg: rU8(),
    pcf8574_input_reg: rU8(),

    // MCP23017 I2C expander state
    mcp23017_iodira: rU8(),
    mcp23017_iodirb: rU8(),
    mcp23017_gpioa: rU8(),
    mcp23017_gpiob: rU8(),
    mcp23017_olata: rU8(),
    mcp23017_olatb: rU8(),

    // ADS1115 ADC state
    ads1115_config: rU16(),
    ads1115_conversion: rI16(),
    ads1115_conversion_ready: rU8() !== 0,

    // Shift register (74HC595) state
    shift595_shift_reg: rU8(),
    shift595_storage_reg: rU8(),
    shift595_outputs_enabled: rU8() !== 0,
  };
  return snap;
}

/** Typed wrapper around all exported C ABI functions. */
export interface PartsModule {
  memory: WebAssembly.Memory;
  wasmMemory: WasmMemory;

  // Part factories
  part_create_relay(part_id: number, coil_ohms: number, contact_ohms: number): number;
  part_create_servo(part_id: number): number;
  part_create_stepper(part_id: number, step_angle_deg: number): number;
  part_create_stepper_driver(part_id: number, output_ohms: number): number;
  part_create_shift_register(part_id: number): number;
  part_create_display_i2c(part_id: number, address: number, width: number, height: number): number;
  part_create_display_spi(part_id: number, width: number, height: number, has_dc: number): number;
  part_create_7segment(part_id: number, digits: number): number;
  part_create_lcd(part_id: number, cols: number, rows: number): number;
  part_create_i2c_expander(part_id: number, ports: number, address: number): number;
  part_create_pwm_driver(part_id: number, channels: number): number;
  part_create_rtc(part_id: number, is_ds3231: number): number;
  part_create_sensor_i2c(part_id: number, type: number, address: number): number;
  part_create_dac(part_id: number, address: number, bits: number): number;
  part_create_adc(part_id: number, address: number, channels: number): number;
  part_create_thermocouple(part_id: number): number;
  part_create_rfid(part_id: number, address: number): number;
  part_create_neopixel(part_id: number, count: number): number;
  part_create_sonar(part_id: number): number;
  part_create_button(part_id: number): number;
  part_create_potentiometer(part_id: number, max_ohms: number): number;
  part_create_power_supply(part_id: number, initial_volts: number): number;

  // I2C bus
  i2c_bus_init(sda_net: number, scl_net: number): void;
  i2c_bus_begin(sda: number, scl: number): void;
  i2c_bus_begin_transmission(address: number): void;
  i2c_bus_write(byte: number): void;
  i2c_bus_end_transmission(): number; // bool -> 0/1
  i2c_bus_request_from(address: number, count: number): number;
  i2c_bus_read(): number;
  i2c_bus_available(): number;
  i2c_bus_register_device(address: number, part_id: number): number;
  i2c_device_receive(handle: number, byte: number, is_control_byte: number): number; // bool -> 0/1
  i2c_device_read(handle: number, buffer: number, count: number): number;

  // SPI bus
  spi_bus_init(cs_net: number, mosi_net: number, miso_net: number, sck_net: number): void;
  spi_bus_begin(): void;
  spi_bus_end(): void;
  spi_bus_transfer(byte: number, data_select: number, chip_selected: number): number;

  // Part runtime
  part_register(part_id: number, kind: number, definition_json: string): number;
  part_stamp(handle: number, solution: number, time_ms: number): void;
  part_get_state(handle: number): number; // Returns pointer to PartStateSnapshot in wasm memory
  part_set_knob(handle: number, knob_name: string, value: number): void;
  part_set_pin_level(handle: number, pin_index: number, high: number): void;
  part_set_i2c_address(handle: number, address: number): void;

  // Bus state
  bus_get_state(out: number): void;
  bus_reset(): void;
  // Global initialization
  init_globals(): void;
}

/** Loads and instantiates the parts.wasm module. */
export async function loadPartsModule(wasmBytes: () => Promise<ArrayBuffer>): Promise<PartsModule> {
  const bytes = await wasmBytes();

  // The module imports three stubs:
  // - env._abort_js: called on fatal errors (we throw)
  // - env.emscripten_resize_heap: called when memory grows (noop)
  // - env.emscripten_notify_memory_growth: called after memory growth (noop)
  // - wasi_snapshot_preview1.fd_write: wasi stub (noop)
  // - wasi_snapshot_preview1.fd_close: wasi stub (noop)
  // - wasi_snapshot_preview1.fd_seek: wasi stub (noop)
  const imports = {
    env: {
      _abort_js: () => { throw new Error('wasm abort'); },
      emscripten_resize_heap: () => 0,
      emscripten_notify_memory_growth: () => {},
    },
    wasi_snapshot_preview1: {
      fd_write: () => 0,
      fd_close: () => 0,
      fd_seek: () => 0,
    },
  };

  const { instance } = await WebAssembly.instantiate(bytes, imports);
  const memory = instance.exports.memory as WebAssembly.Memory;
  if (!memory) throw new Error('wasm module does not export memory');

  const wasmMemory = new WasmMemory(memory);
  const exp = instance.exports;

  // Initialize global STL containers (required with -Wl,--no-entry)
  (exp.init_globals as () => void)();

  // Wrap all exports with proper types
  const module: PartsModule = {
    memory,
    wasmMemory,

    // Part factories
    part_create_relay: exp.part_create_relay as (part_id: number, coil_ohms: number, contact_ohms: number) => number,
    part_create_servo: exp.part_create_servo as (part_id: number) => number,
    part_create_stepper: exp.part_create_stepper as (part_id: number, step_angle_deg: number) => number,
    part_create_stepper_driver: exp.part_create_stepper_driver as (part_id: number, output_ohms: number) => number,
    part_create_shift_register: exp.part_create_shift_register as (part_id: number) => number,
    part_create_display_i2c: exp.part_create_display_i2c as (part_id: number, address: number, width: number, height: number) => number,
    part_create_display_spi: exp.part_create_display_spi as (part_id: number, width: number, height: number, has_dc: number) => number,
    part_create_7segment: exp.part_create_7segment as (part_id: number, digits: number) => number,
    part_create_lcd: exp.part_create_lcd as (part_id: number, cols: number, rows: number) => number,
    part_create_i2c_expander: exp.part_create_i2c_expander as (part_id: number, ports: number, address: number) => number,
    part_create_pwm_driver: exp.part_create_pwm_driver as (part_id: number, channels: number) => number,
    part_create_rtc: exp.part_create_rtc as (part_id: number, is_ds3231: number) => number,
    part_create_sensor_i2c: exp.part_create_sensor_i2c as (part_id: number, type: number, address: number) => number,
    part_create_dac: exp.part_create_dac as (part_id: number, address: number, bits: number) => number,
    part_create_adc: exp.part_create_adc as (part_id: number, address: number, channels: number) => number,
    part_create_thermocouple: exp.part_create_thermocouple as (part_id: number) => number,
    part_create_rfid: exp.part_create_rfid as (part_id: number, address: number) => number,
    part_create_neopixel: exp.part_create_neopixel as (part_id: number, count: number) => number,
    part_create_sonar: exp.part_create_sonar as (part_id: number) => number,
    part_create_button: exp.part_create_button as (part_id: number) => number,
    part_create_potentiometer: exp.part_create_potentiometer as (part_id: number, max_ohms: number) => number,
    part_create_power_supply: exp.part_create_power_supply as (part_id: number, initial_volts: number) => number,

    // I2C bus
    i2c_bus_init: exp.i2c_bus_init as (sda_net: number, scl_net: number) => void,
    i2c_bus_begin: exp.i2c_bus_begin as (sda: number, scl: number) => void,
    i2c_bus_begin_transmission: exp.i2c_bus_begin_transmission as (address: number) => void,
    i2c_bus_write: exp.i2c_bus_write as (byte: number) => void,
    i2c_bus_end_transmission: exp.i2c_bus_end_transmission as () => number,
    i2c_bus_request_from: exp.i2c_bus_request_from as (address: number, count: number) => number,
    i2c_bus_read: exp.i2c_bus_read as () => number,
    i2c_bus_available: exp.i2c_bus_available as () => number,
    i2c_bus_register_device: exp.i2c_bus_register_device as (address: number, part_id: number) => number,
    i2c_device_receive: exp.i2c_device_receive as (handle: number, byte: number, is_control_byte: number) => number,
    i2c_device_read: exp.i2c_device_read as (handle: number, buffer: number, count: number) => number,

    // SPI bus
    spi_bus_init: exp.spi_bus_init as (cs_net: number, mosi_net: number, miso_net: number, sck_net: number) => void,
    spi_bus_begin: exp.spi_bus_begin as () => void,
    spi_bus_end: exp.spi_bus_end as () => void,
    spi_bus_transfer: exp.spi_bus_transfer as (byte: number, data_select: number, chip_selected: number) => number,

    // Part runtime
    part_register: (part_id: number, kind: number, definition_json: string) => {
      const ptr = wasmMemory.allocString(definition_json);
      (exp.part_register as (part_id: number, kind: number, definition_json: number) => number)(part_id, kind, ptr);
    },
    part_stamp: exp.part_stamp as (handle: number, solution: number, time_ms: number) => void,
    part_get_state: exp.part_get_state as (handle: number) => number,
    part_set_knob: (handle: number, knob_name: string, value: number) => {
      const ptr = wasmMemory.allocString(knob_name);
      (exp.part_set_knob as (handle: number, knob_name: number, value: number) => void)(handle, ptr, value);
    },
    part_set_pin_level: exp.part_set_pin_level as (handle: number, pin_index: number, high: number) => void,
    part_set_i2c_address: exp.part_set_i2c_address as (handle: number, address: number) => void,

    // Bus state
    bus_get_state: exp.bus_get_state as (out: number) => void,
    bus_reset: exp.bus_reset as () => void,
    // Global initialization
    init_globals: exp.init_globals as () => void,
  };

  return module;
}

/** Convenience: loads the committed parts.wasm from disk. */
export async function loadCommittedPartsModule(): Promise<PartsModule> {
  const buffer = readFileSync(WASM_PATH);
  const bytes = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  return loadPartsModule(async () => bytes);
}