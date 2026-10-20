import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { bootEsp32, type Esp32Assets } from './emulator';
import { buildEsp32Filesystem } from './image';

const require = createRequire(import.meta.url);
const DIR = 'src/features/simulation/esp32/firmware';

function assets(): Esp32Assets {
  const bytes = (name: string): ArrayBuffer => {
    const file = readFileSync(`${DIR}/${name}`);
    return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
  };
  return {
    wasm: bytes('esp32sim.wasm'),
    rom: bytes('esp32_rev300_rom.elf'),
    image: bytes('ESP32_GENERIC-20260824-v1.29.0.bin'),
  };
}

/** The littlefs wasm the filesystem image is built with. */
function littlefsWasm(): ArrayBuffer {
  const file = readFileSync(require.resolve('littlefs/dist/littlefs.wasm'));
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
}

/**
 * A sketch written on the bench, running on the chip.
 *
 * The chip mounts a filesystem the host built, and takes `main.py` from it --
 * so this is the whole code path: the file the operator wrote is the program
 * the chip runs, and the pin it drives is a pin the host can see.
 */
describe('a sketch on the emulated ESP32', () => {
  it('runs main.py out of the filesystem the host built', async () => {
    const filesystem = await buildEsp32Filesystem(
      [
        {
          name: 'main.py',
          content: [
            'from machine import Pin',
            'import time',
            '',
            "print('bench sketch running')",
            '',
            'led = Pin(2, Pin.OUT)',
            'while True:',
            '    led.value(1)',
            '    time.sleep(0.25)',
            '    led.value(0)',
            '    time.sleep(0.25)',
            '',
          ].join('\n'),
        },
      ],
      littlefsWasm(),
    );

    const chip = await bootEsp32(assets(), filesystem);

    const printed: string[] = [];
    let pinDriven = false;
    for (let slice = 0; slice < 200; slice++) {
      printed.push(...chip.run(4_000_000));
      // GPIO2 is the pin the sketch drives; the enable word says it is an
      // output, the level word says it is high.
      if ((chip.gpioOutEnable & 0x4n) !== 0n && (chip.gpioOut & 0x4n) !== 0n) {
        pinDriven = true;
        break;
      }
    }

    expect(printed.join('')).toContain('bench sketch running');
    expect(pinDriven, 'the sketch never drove GPIO2').toBe(true);
  }, 180_000);
});
