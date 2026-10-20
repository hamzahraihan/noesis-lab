/**
 * The emulated ESP32, driven through the esp32sim WebAssembly module.
 *
 * The chip is not modelled here: the emulator is. It boots the real mask ROM
 * and the real second-stage bootloader and runs the real application, so the
 * firmware on the bench is the firmware that would run on the board -- the
 * same arrangement the RP2 path has with rp2040js and a pinned UF2.
 *
 * What the host sees is the chip's console and its pins. The module reports
 * what the firmware printed as JSON envelopes, and what the operator types
 * goes back the other way into UART0; the GPIO words say what the chip
 * drives, and the input setter says what it reads.
 */

import { ESP32_FILESYSTEM_OFFSET } from './image';

/** The bytes the emulator boots from: the module, the mask ROM and the image. */
export interface Esp32Assets {
  /** The emulator's WebAssembly module. */
  readonly wasm: ArrayBuffer;
  /** The chip's mask ROM, as the ELF the ROM boot expects. */
  readonly rom: ArrayBuffer;
  /** The application image, flashed at 0x1000. */
  readonly image: ArrayBuffer;
}

/** The load kinds the module's ABI names. */
const LOAD_ROM = 0;

/** Where the application image goes: the bootloader sits at 0x1000. */
const IMAGE_OFFSET = 0x1000;

/** The board name the module builds the classic ESP32 from. */
const BOARD = 'esp32';

/** Flash size in megabytes, the size the MicroPython image expects. */
const FLASH_MB = 4;

/**
 * The module's exports, as far as the boot and the console need them.
 *
 * The module is a C ABI over the emulator, so the types are the ABI's: a
 * pointer is an index into the module's memory, and every call that takes
 * bytes takes a pointer and a length.
 */
interface Esp32SimExports {
  readonly memory: WebAssembly.Memory;
  esp32sim_alloc(len: number): number;
  esp32sim_free(ptr: number, len: number): void;
  esp32sim_new(board: number, boardLen: number, flashMb: number, psramMb: number): number;
  esp32sim_set_jit?(emu: number, on: number): void;
  esp32sim_load(emu: number, kind: number, ptr: number, len: number): number;
  esp32sim_load_at(emu: number, offset: number, ptr: number, len: number): number;
  esp32sim_boot(emu: number, appDirect: number): number;
  esp32sim_run(emu: number, cycles: number, unixMs: number): number;
  esp32sim_out_take(emu: number): number;
  esp32sim_out_kind(emu: number, index: number): number;
  esp32sim_out_ptr(emu: number, index: number): number;
  esp32sim_out_len(emu: number, index: number): number;
  esp32sim_gpio_out(emu: number): bigint;
  esp32sim_gpio_oe(emu: number): bigint;
  esp32sim_gpio_set_input(emu: number, pin: number, level: number): number;
  esp32sim_cycles(emu: number): number;
  esp32sim_cpu_hz(emu: number): number;
}

/** One message the chip's console produced. */
interface ConsoleEnvelope {
  readonly t?: string;
  readonly src?: string;
  readonly data?: string;
}

/** The emulated chip, once it is running. */
export interface Esp32Emulator {
  /**
   * Runs the chip for at most `cycles` and returns what it printed.
   *
   * The console is a queue: the module hands over everything that was
   * produced since the last call, so a caller that runs the chip in slices
   * sees the firmware's output in the order it wrote it.
   */
  run(cycles: number): string[];
  /**
   * The levels the chip drives on its pads, as a bitmask: bit n is pin n.
   *
   * A pad the chip drives low is not in this word, so the enable word tells
   * "driven low" from "not driven at all".
   */
  readonly gpioOut: bigint;
  /** Which pads the chip drives as outputs, as a bitmask: bit n is pin n. */
  readonly gpioOutEnable: bigint;
  /**
   * Drives an input pad, the way the board around the chip does.
   *
   * This is the level the chip reads there: a button on the bench is a pad
   * the host pulls low, and a sensor's output is a pad the host raises.
   * Answers whether the chip took it.
   */
  setInput(pin: number, level: boolean): boolean;
  /** The emulated cycles since the boot. */
  readonly cycles: number;
  /** The chip's clock, in hertz. */
  readonly cpuHz: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Boots the emulated chip and returns it.
 *
 * The three artefacts are the whole firmware story: the mask ROM is what the
 * chip runs first, the image carries the bootloader and the application, and
 * the module is the machine they run on.
 *
 * `files` is the sketch the chip will run: a filesystem image built by
 * `buildEsp32Filesystem`, which the chip mounts at boot and takes `main.py`
 * from. Without one the chip comes up at its REPL, which is what a bench
 * with nothing to run wants.
 */
export async function bootEsp32(assets: Esp32Assets, files?: Uint8Array): Promise<Esp32Emulator> {
  const module = await WebAssembly.compile(assets.wasm);
  let exports: Esp32SimExports | null = null;
  const instance = await WebAssembly.instantiate(module, {
    env: {
      // The module logs its own diagnostics; the host has no use for them
      // today, and a line that nobody reads is not worth a console.
      host_log: () => {},
      host_jit_compile: () => 0,
      host_jit_release: () => {},
    },
  });
  exports = instance.exports as unknown as Esp32SimExports;

  const memory = (): Uint8Array => new Uint8Array(exports!.memory.buffer);
  const put = (bytes: Uint8Array): number => {
    const pointer = exports!.esp32sim_alloc(bytes.length);
    memory().set(bytes, pointer);
    return pointer;
  };
  const withBytes = <T>(bytes: Uint8Array, call: (pointer: number, length: number) => T): T => {
    const pointer = put(bytes);
    try {
      return call(pointer, bytes.length);
    } finally {
      exports!.esp32sim_free(pointer, bytes.length);
    }
  };

  const emu = withBytes(encoder.encode(BOARD), (pointer, length) =>
    exports!.esp32sim_new(pointer, length, FLASH_MB, 0),
  );
  if (!emu) throw new Error('esp32: the emulator would not start');
  // The block JIT compiles hot code into extra modules; the host has no
  // compiler to give it, and the interpreter runs the same firmware.
  exports.esp32sim_set_jit?.(emu, 0);

  const rom = new Uint8Array(assets.rom);
  if (
    withBytes(rom, (pointer, length) => exports!.esp32sim_load(emu, LOAD_ROM, pointer, length)) !==
    0
  ) {
    throw new Error('esp32: the mask ROM would not load');
  }
  const image = new Uint8Array(assets.image);
  if (
    withBytes(image, (pointer, length) =>
      exports!.esp32sim_load_at(emu, IMAGE_OFFSET, pointer, length),
    ) !== 0
  ) {
    throw new Error('esp32: the application image would not load');
  }
  if (files) {
    const filesystem = new Uint8Array(files);
    if (
      withBytes(filesystem, (pointer, length) =>
        exports!.esp32sim_load_at(emu, ESP32_FILESYSTEM_OFFSET, pointer, length),
      ) !== 0
    ) {
      throw new Error('esp32: the filesystem would not load');
    }
  }
  if (exports.esp32sim_boot(emu, 0) !== 0) throw new Error('esp32: the chip would not boot');

  return {
    run(cycles: number): string[] {
      exports!.esp32sim_run(emu, cycles, Date.now());
      const lines: string[] = [];
      const count = exports!.esp32sim_out_take(emu);
      for (let index = 0; index < count; index++) {
        // Kind 1 is text; the rest are the module's own status and display
        // messages, which the bench has no use for yet.
        if (exports!.esp32sim_out_kind(emu, index) !== 1) continue;
        const pointer = exports!.esp32sim_out_ptr(emu, index);
        const length = exports!.esp32sim_out_len(emu, index);
        const text = decoder.decode(memory().subarray(pointer, pointer + length));
        const envelope = parseEnvelope(text);
        if (envelope?.t === 'serial' && envelope.data !== undefined) lines.push(envelope.data);
      }
      return lines;
    },
    get gpioOut(): bigint {
      return exports!.esp32sim_gpio_out(emu);
    },
    get gpioOutEnable(): bigint {
      return exports!.esp32sim_gpio_oe(emu);
    },
    setInput(pin: number, level: boolean): boolean {
      return exports!.esp32sim_gpio_set_input(emu, pin, level ? 1 : 0) === 0;
    },
    get cycles(): number {
      return exports!.esp32sim_cycles(emu);
    },
    get cpuHz(): number {
      return exports!.esp32sim_cpu_hz(emu);
    },
  };
}

/**
 * Reads one console envelope.
 *
 * The module wraps what the chip said in JSON, the way its page protocol
 * does, so that a display frame and a line of serial can travel the same
 * queue. A line that is not JSON is not a message this host understands.
 */
function parseEnvelope(text: string): ConsoleEnvelope | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    return JSON.parse(trimmed) as ConsoleEnvelope;
  } catch {
    return null;
  }
}
