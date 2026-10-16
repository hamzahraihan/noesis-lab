import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { McuRuntime } from '@/features/simulation/mcu';
import { nanoRp2040Connect } from '@/features/parts';
import { Rp2040Backend, type Rp2040Firmware } from './core';
import { buildLittlefsImage, type ImageFile } from './image';

const FIRMWARE_PATH = 'src/features/simulation/rp2040/firmware/RPI_PICO-20260824-v1.29.0.uf2';
const haveFirmware = existsSync(FIRMWARE_PATH);

const require = createRequire(import.meta.url);
const littlefsWasm = readFileSync(require.resolve('littlefs/dist/littlefs.wasm'));

const BLINK = `from machine import Pin
import time

p = Pin(13, Pin.OUT)

while True:
    p.toggle()
    time.sleep_ms(10)
`;

const EARLY = `from machine import Pin
import helper
import time

print('NOESIS-EARLY-' + helper.TAG)
p = Pin(13, Pin.OUT)

while True:
    p.toggle()
    time.sleep_ms(10)
`;

interface Harness {
  backend: Rp2040Backend;
  edges: Array<{ gpio: number; high: boolean }>;
  serial: string[];
}

async function harness(files: readonly ImageFile[]): Promise<Harness> {
  const image = await buildLittlefsImage(files, littlefsWasm);
  const firmware: Rp2040Firmware = { uf2: readFileSync(FIRMWARE_PATH), image };
  const edges: Array<{ gpio: number; high: boolean }> = [];
  const serial: string[] = [];
  const backend = new Rp2040Backend(firmware, {
    mcu: new McuRuntime(nanoRp2040Connect()),
    nowMs: () => 0,
    readPin: () => false,
    onSettle: () => {},
    onEdge: (gpio, _cycles, high) => edges.push({ gpio, high }),
    serial: { serialWrite: (text) => serial.push(text) },
  });
  return { backend, edges, serial };
}

function pump(backend: Rp2040Backend, done: () => boolean, maxFrames = 24): void {
  // Same contract as the sim worker's step: 16 ms frames, settle after each.
  for (let frame = 0; frame < maxFrames && !done(); frame += 1) backend.step(16);
}

describe.skipIf(!haveFirmware)('rp2040 firmware legs', () => {
  it('drives GPIO 13 edges from main.py under the engine pump', async () => {
    const { backend, edges } = await harness([{ name: 'main.py', content: BLINK }]);
    pump(backend, () => edges.length >= 6);
    expect(backend.fault).toBeNull();
    const pin = edges.filter((edge) => edge.gpio === 13);
    expect(pin.length).toBeGreaterThanOrEqual(6);
    expect(pin[0].high).toBe(true);
    expect(pin.every((edge, i) => edge.high === (i % 2 === 0))).toBe(true);
    console.log(`leg=rp2040-blink edges=${pin.length}`);
  }, 120000);

  it('delivers a print made before the USB host attached', async () => {
    const { backend, serial } = await harness([
      { name: 'main.py', content: EARLY },
      { name: 'helper.py', content: "TAG = 'MOUNTED'\n" },
    ]);
    pump(backend, () => serial.join('').includes('NOESIS-EARLY-MOUNTED'));
    expect(backend.fault).toBeNull();
    expect(serial.join('')).toContain('NOESIS-EARLY-MOUNTED');
    console.log(`leg=rp2040-early-print serial=${JSON.stringify(serial.join(''))}`);
  }, 120000);

  it('starts a REPL and prints the banner when no main.py exists', async () => {
    const { backend, serial } = await harness([]);
    pump(backend, () => serial.join('').includes('MicroPython v1.29.0'));
    expect(backend.fault).toBeNull();
    expect(serial.join('')).toContain('MicroPython v1.29.0');
    console.log(`leg=rp2040-boot serial=${JSON.stringify(serial.join(''))}`);
  }, 120000);

  it('restarts the firmware cleanly on reset', async () => {
    const { backend, edges } = await harness([{ name: 'main.py', content: BLINK }]);
    pump(backend, () => edges.filter((edge) => edge.gpio === 13).length >= 2);
    const before = edges.filter((edge) => edge.gpio === 13).length;
    expect(before).toBeGreaterThanOrEqual(2);
    backend.reset();
    pump(backend, () => edges.filter((edge) => edge.gpio === 13).length >= before + 4);
    expect(backend.fault).toBeNull();
    expect(edges.filter((edge) => edge.gpio === 13).length).toBeGreaterThanOrEqual(before + 4);
    console.log(`leg=rp2040-reset edges=${before}->${edges.filter((e) => e.gpio === 13).length}`);
  }, 120000);
});
