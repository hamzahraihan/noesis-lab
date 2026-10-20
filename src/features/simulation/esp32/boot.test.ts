import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bootEsp32, type Esp32Assets } from './emulator';

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

/**
 * The emulated chip, booting.
 *
 * This is the whole point of the machine path: the firmware that runs is the
 * firmware that would run on the board, from the chip's own mask ROM through
 * the second-stage bootloader into the application. The banner is the proof
 * that the chain ran, not that a model of it did.
 */
describe('the emulated ESP32', () => {
  it('boots its mask ROM and runs MicroPython', async () => {
    const chip = await bootEsp32(assets());

    const printed: string[] = [];
    for (let slice = 0; slice < 120 && printed.length < 6; slice++) {
      printed.push(...chip.run(4_000_000));
    }
    const console = printed.join('');

    expect(console).toContain('rst:0x1 (POWERON_RESET)');
    expect(console).toContain('MicroPython v1.29.0');
    expect(console).toContain('>>>');
    expect(chip.cpuHz).toBe(240_000_000);
  }, 120_000);

  it('hands the chip pins to the host', async () => {
    const chip = await bootEsp32(assets());
    for (let slice = 0; slice < 20; slice++) chip.run(4_000_000);

    /*
     * The seam a bench needs: what the chip drives, and what it reads. The
     * chip drives its flash pins while it boots, so the words are not empty --
     * the host is reading the chip's own pins rather than a fixed zero -- and
     * the host can drive a pad the chip then reads.
     */
    expect(typeof chip.gpioOut).toBe('bigint');
    expect(chip.gpioOutEnable).toBeGreaterThan(0n);
    expect(chip.setInput(4, true)).toBe(true);
  }, 120_000);
});
