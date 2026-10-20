import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import { createSimCore } from './core';
import { serialRing, tftView } from './protocol';
import { boardOption } from '@/features/learn/boardRegistry';
import { STARTER_CIRCUITS } from '@/features/learn/benches';
import { Simulation } from '@/features/bench/simulations/simulation';
import type { Esp32Assets } from '../esp32/assets';

const FIRMWARE_DIR = 'src/features/simulation/esp32/firmware';
const haveFirmware = existsSync(`${FIRMWARE_DIR}/esp32sim.wasm`);

const require = createRequire(import.meta.url);
const littlefsPath = require.resolve('littlefs/dist/littlefs.wasm');

function bytesOf(path: string): ArrayBuffer {
  const buf = readFileSync(path);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

function realAssets(): Promise<Esp32Assets> {
  return Promise.resolve({
    wasm: bytesOf(`${FIRMWARE_DIR}/esp32sim.wasm`),
    rom: bytesOf(`${FIRMWARE_DIR}/esp32_rev300_rom.elf`),
    image: bytesOf(`${FIRMWARE_DIR}/ESP32_GENERIC-20260824-v1.29.0.bin`),
    littlefsWasm: bytesOf(littlefsPath),
  });
}

const MAIN_PY = `import time
print('NOESIS-ESP32-WORKER')
while True:
    time.sleep_ms(10)
`;

function pythonProject(content = MAIN_PY): never {
  return {
    language: 'python',
    activeName: 'main.py',
    files: [{ name: 'main.py', content }],
  } as never;
}

const EMPTY_BENCH = { parts: [], wires: [], terminals: [] } as never;

/**
 * A sketch that drives the bench's colour panel over the board's own SPI
 * pins: chip select on GPIO5, data/command on GPIO15, the VSPI clock on
 * GPIO18 and MOSI on GPIO23.
 */
const SPI_MAIN_PY = `from machine import Pin, SPI
cs = Pin(5, Pin.OUT)
dc = Pin(15, Pin.OUT)
spi = SPI(2, baudrate=1000000)
cs.value(0)
dc.value(0)
spi.write(b'\\x2a')
dc.value(1)
spi.write(b'\\x00\\x00\\x00\\xef')
dc.value(0)
spi.write(b'\\x2b')
dc.value(1)
spi.write(b'\\x00\\x00\\x00\\x07')
dc.value(0)
spi.write(b'\\x2c')
dc.value(1)
spi.write(b'\\xf8\\x1f')
cs.value(1)
print('NOESIS-ESP32-SPI-WORKER')
`;

function textOf(value: number[]): string {
  return new TextDecoder().decode(new Uint8Array(value));
}

/**
 * The emulated ESP32, in the worker.
 *
 * The bench runs the chip where the RP2 engine runs: in the simulation
 * worker, because the emulator is a WebAssembly module and the main thread
 * has none. So this is the whole path a bench takes -- artefacts fetched, the
 * filesystem built, the chip booted from its mask ROM, and the firmware's own
 * output reaching the serial monitor.
 */
describe.skipIf(!haveFirmware)('esp32 attach', () => {
  it('boots the chip and prints from the mounted main.py', async () => {
    const core = createSimCore(boardOption('esp32').make());
    core.rebuild(
      EMPTY_BENCH,
      pythonProject(),
      'esp32',
      false,
      undefined,
      undefined,
      realAssets,
    );
    await vi.waitFor(() => expect(core.esp32Attached).toBe(true), { timeout: 60_000 });

    let serial = '';
    for (let frame = 0; frame < 60 && !serial.includes('NOESIS-ESP32-WORKER'); frame++) {
      core.step(16);
      serial += textOf(serialRing(core.snapshot()).drain());
    }

    expect(serial).toContain('NOESIS-ESP32-WORKER');
    expect(core.fault).toBeNull();
  }, 180_000);

  it('carries a sketch on the chip into the panel on the bench', async () => {
    /*
     * The worker's own path: the chip's SPI master shifts bytes out, the
     * worker's sink puts them on the bench's bus, and the panel's pixels
     * reach the page in the snapshot. A seam that is not connected leaves
     * the panel dark while the sketch reports success.
     */
    const simulation = new Simulation(boardOption('esp32').make());
    expect(simulation.loadCircuit(STARTER_CIRCUITS.esp32)).toEqual([]);

    const core = createSimCore(boardOption('esp32').make());
    core.rebuild(
      simulation.bench,
      pythonProject(SPI_MAIN_PY),
      'esp32',
      false,
      undefined,
      undefined,
      realAssets,
    );
    await vi.waitFor(() => expect(core.esp32Attached).toBe(true), { timeout: 60_000 });

    let serial = '';
    for (let frame = 0; frame < 60 && !serial.includes('NOESIS-ESP32-SPI-WORKER'); frame++) {
      core.step(16);
      serial += textOf(serialRing(core.snapshot()).drain());
    }
    expect(serial).toContain('NOESIS-ESP32-SPI-WORKER');

    const picture = tftView(core.snapshot()).readFrame();
    expect(picture.width, 'the panel did not reach the snapshot').toBe(320);
    expect(picture.rgb565[0], 'the panel never took the pixel').toBe(0xf8);
    expect(picture.rgb565[1], 'the panel never took the pixel').toBe(0x1f);
  }, 180_000);

  it('runs nothing until the chip has booted', async () => {
    let release!: (assets: Esp32Assets) => void;
    const gate = new Promise<Esp32Assets>((resolve) => {
      release = resolve;
    });
    const core = createSimCore(boardOption('esp32').make());
    core.rebuild(EMPTY_BENCH, pythonProject(), 'esp32', false, undefined, undefined, () => gate);

    // Frames before the boot lands advance the clock but execute nothing:
    // running the interpreter first would be a second program on the bench,
    // and its output would vanish the moment the chip attached.
    for (let frame = 0; frame < 10; frame++) core.step(16);
    expect(core.esp32Attached).toBe(false);
    expect(textOf(serialRing(core.snapshot()).drain())).toBe('');

    release(await realAssets());
    await vi.waitFor(() => expect(core.esp32Attached).toBe(true), { timeout: 60_000 });
    let serial = '';
    for (let frame = 0; frame < 60 && !serial.includes('NOESIS-ESP32-WORKER'); frame++) {
      core.step(16);
      serial += textOf(serialRing(core.snapshot()).drain());
    }
    expect(serial).toContain('NOESIS-ESP32-WORKER');
  }, 180_000);

  it('refuses to run on a board it does not emulate', async () => {
    const core = createSimCore(boardOption('uno').make());
    core.rebuild(
      EMPTY_BENCH,
      pythonProject(),
      'esp32',
      false,
      undefined,
      undefined,
      realAssets,
    );
    // The Uno is not an ESP32, so the chip never attaches and nothing runs.
    for (let frame = 0; frame < 10; frame++) core.step(16);
    expect(core.esp32Attached).toBe(false);
  }, 60_000);
});
