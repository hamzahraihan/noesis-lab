import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { esp32I2cDevice, type Esp32I2cSink } from './i2c';
import { Esp32Backend } from './core';
import { buildEsp32Filesystem } from './image';
import { Simulation } from '@/features/bench/simulations/simulation';
import { STARTER_CIRCUITS } from '@/features/learn/benches';
import { boardOption } from '@/features/learn/boardRegistry';
import { Ssd1306 } from '@/features/parts';

const require = createRequire(import.meta.url);
const FIRMWARE_DIR = 'src/features/simulation/esp32/firmware';

/** The bytes the emulator boots from, read from the pinned artefacts. */
function firmwareBytes(name: string): ArrayBuffer {
  const file = readFileSync(`${FIRMWARE_DIR}/${name}`);
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
}

/** The littlefs wasm the filesystem image is built with. */
function littlefsWasm(): ArrayBuffer {
  const file = readFileSync(require.resolve('littlefs/dist/littlefs.wasm'));
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer;
}

/**
 * The engine's side of the bus, recorded rather than emulated.
 *
 * The bridge's job is the handshake between the chip's controller and the
 * engine's sink; the controller's own register writes are the emulator's
 * business, and the sketch on the bench is the integration test's.
 */
function fakeSink(): {
  sink: Esp32I2cSink;
  writes: { address: number; byte: number; isFirst: boolean }[];
  reads: { address: number; index: number }[];
  writeEnds: number;
} {
  const writes: { address: number; byte: number; isFirst: boolean }[] = [];
  const reads: { address: number; index: number }[] = [];
  const sink: Esp32I2cSink = {
    hasDevice: () => true,
    writeByte: (address, byte, isFirst) => {
      writes.push({ address, byte, isFirst });
      return true;
    },
    readByte: (address, index) => {
      reads.push({ address, index });
      return 0x5a;
    },
    writeEnd: () => {
      sinkWriteEnds += 1;
    },
  };
  let sinkWriteEnds = 0;
  return {
    sink,
    writes,
    reads,
    get writeEnds() {
      return sinkWriteEnds;
    },
  };
}

describe('the emulated ESP32 on the bench bus', () => {
  it('translates the controller calls into the engine bus', () => {
    const fake = fakeSink();
    const device = esp32I2cDevice(fake.sink);

    // The address phase, two data bytes and the end of the transfer.
    expect(device.start(0x3c, false)).toBe(true);
    expect(device.write(0x3c, 0x00)).toBe(true);
    expect(device.write(0x3c, 0xaf)).toBe(true);
    device.stop(0x3c);

    expect(fake.writes).toEqual([
      { address: 0x3c, byte: 0x00, isFirst: true },
      { address: 0x3c, byte: 0xaf, isFirst: false },
    ]);
    expect(fake.writeEnds).toBe(1);
  });

  it('does not acknowledge an address nobody is on', () => {
    const fake = fakeSink();
    fake.sink.hasDevice = () => false;
    const device = esp32I2cDevice(fake.sink);

    expect(device.start(0x3c, false)).toBe(false);
  });

  it('counts the bytes of a read from the start', () => {
    const fake = fakeSink();
    const device = esp32I2cDevice(fake.sink);

    device.start(0x68, true);
    expect(device.read(0x68)).toBe(0x5a);
    expect(device.read(0x68)).toBe(0x5a);

    expect(fake.reads).toEqual([
      { address: 0x68, index: 0 },
      { address: 0x68, index: 1 },
    ]);
    // A read closes no write: the bus log has no transfer to record.
    device.stop(0x68);
    expect(fake.writeEnds).toBe(0);
  });

  it('closes the write a repeated start ends', () => {
    const fake = fakeSink();
    const device = esp32I2cDevice(fake.sink);

    device.start(0x3c, false);
    device.write(0x3c, 0x00);
    // A repeated start: the address phase runs again, for the read.
    device.start(0x3c, true);
    device.read(0x3c);
    device.stop(0x3c);

    expect(fake.writeEnds).toBe(1);
  });

  it('carries a sketch on the emulated chip into the panel on the bench', async () => {
    /*
     * The whole path, and the only test that covers it: a MicroPython sketch
     * runs on the emulated chip, the chip's own I2C controller exchanges bytes
     * with the host, and the host's panel lights up. A seam that is not
     * connected leaves the panel dark while the sketch reports success.
     */
    const simulation = new Simulation(boardOption('esp32').make());
    expect(simulation.loadCircuit(STARTER_CIRCUITS.esp32)).toEqual([]);

    const oled = simulation.bench.parts.find(
      (part) =>
        part.definition.component.kind === 'display' &&
        part.definition.component.controller === 'ssd1306',
    );
    if (!oled) throw new Error('esp32: the starter bench has no I2C panel');
    const panel = simulation.engine.i2cDevice(oled.id);
    if (!(panel instanceof Ssd1306)) throw new Error('esp32: the panel is not an I2C display');
    expect(panel.onBus, 'the panel is not on the board bus').toBe(true);

    const filesystem = await buildEsp32Filesystem(
      [
        {
          name: 'main.py',
          content: [
            'from machine import I2C',
            'import time',
            '',
            /*
             * The firmware's own default pins are GPIO18 and GPIO19, which on
             * this board are the display's clock and data lines. The panel is
             * on the DevKit's own pair, so the sketch asks for it -- the same
             * thing a user of the real board has to write.
             */
            'i2c = I2C(0, sda=21, scl=22)',
            "i2c.writeto(0x3c, b'\\x00\\xaf')",
            "print('NOESIS-ESP32-I2C')",
            'try:',
            "    i2c.writeto(0x50, b'\\x01')",
            "    print('NOESIS-ESP32-I2C-GHOST')",
            'except Exception:',
            "    print('NOESIS-ESP32-I2C-GHOST-REFUSED')",
            '',
            'while True:',
            '    time.sleep_ms(10)',
            '',
          ].join('\n'),
        },
      ],
      littlefsWasm(),
    );

    let serial = '';
    const backend = new Esp32Backend(
      {
        wasm: firmwareBytes('esp32sim.wasm'),
        rom: firmwareBytes('esp32_rev300_rom.elf'),
        image: firmwareBytes('ESP32_GENERIC-20260824-v1.29.0.bin'),
        filesystem,
      },
      {
        mcu: simulation.mcu,
        nowMs: () => simulation.engine.timeMs,
        readPin: (gpio) => simulation.engine.readDigital(gpio),
        onSettle: () => simulation.engine.settle(),
        serial: { serialWrite: (text) => (serial += text) },
        i2c: {
          hasDevice: (address) => simulation.engine.hasI2cDevice(address),
          writeByte: (address, byte, isFirst) => simulation.engine.writeI2C(address, byte, isFirst),
          readByte: (address, index) =>
            simulation.engine.requestI2C(address, index + 1)[index] ?? 0xff,
          writeEnd: () => {},
        },
      },
    );

    await backend.start();
    expect(backend.fault).toBeNull();

    for (let slice = 0; slice < 400 && !serial.includes('GHOST-REFUSED'); slice++) {
      backend.step(40);
      expect(backend.fault).toBeNull();
    }

    expect(serial, 'the sketch never ran on the chip').toContain('NOESIS-ESP32-I2C');
    expect(panel.lit, 'the panel never lit: the chip did not reach the bench bus').toBe(true);
    // Nothing is at 0x50 on this bench, so the master is not acknowledged:
    // a bus that answered anyway would be a bus that invents devices.
    expect(serial, 'an address with no device was acknowledged').toContain(
      'NOESIS-ESP32-I2C-GHOST-REFUSED',
    );
  }, 300_000);
});
