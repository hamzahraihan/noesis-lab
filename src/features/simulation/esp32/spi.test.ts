import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { esp32SpiDevice, type Esp32SpiSink } from './spi';
import { Esp32Backend } from './core';
import { buildEsp32Filesystem } from './image';
import { Simulation } from '@/features/bench/simulations/simulation';
import { STARTER_CIRCUITS } from '@/features/learn/benches';
import { boardOption } from '@/features/learn/boardRegistry';
import { SpiBus } from '@/features/simulation/bus/spi';
import { Ili9341 } from '@/features/parts';

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
 * The bridge's job is the translation of the chip's bytes into the bench's
 * bus; what a display does with them is the engine's business, and the
 * sketch on the bench is the integration test's.
 */
function fakeSink(): {
  sink: Esp32SpiSink;
  bytes: { byte: number; data: boolean; selected: boolean }[];
  begins: number;
  ends: number;
} {
  const bytes: { byte: number; data: boolean; selected: boolean }[] = [];
  let begins = 0;
  let ends = 0;
  const sink: Esp32SpiSink = {
    begin: () => {
      begins += 1;
    },
    transfer: (byte, data, selected) => {
      bytes.push({ byte, data, selected });
      return 0;
    },
    end: () => {
      ends += 1;
    },
  };
  return {
    sink,
    bytes,
    get begins() {
      return begins;
    },
    get ends() {
      return ends;
    },
  };
}

describe('the emulated ESP32 on the bench SPI bus', () => {
  it('carries the chip bytes to the bench bus with the D/C level', () => {
    const fake = fakeSink();
    const device = esp32SpiDevice(fake.sink);

    device.begin();
    expect(device.byte(0x29, false, true)).toBe(0);
    expect(device.byte(0x00, true, true)).toBe(0);
    device.end();

    expect(fake.bytes).toEqual([
      { byte: 0x29, data: false, selected: true },
      { byte: 0x00, data: true, selected: true },
    ]);
    expect(fake.begins).toBe(1);
    expect(fake.ends).toBe(1);
  });

  it('tells the bus when chip-select has risen', () => {
    const fake = fakeSink();
    const device = esp32SpiDevice(fake.sink);

    device.begin();
    device.byte(0x11, false, false);
    device.end();

    expect(fake.bytes).toEqual([{ byte: 0x11, data: false, selected: false }]);
  });

  it('answers with the byte the bus shifted back', () => {
    const fake = fakeSink();
    fake.sink.transfer = () => 0x5a;
    const device = esp32SpiDevice(fake.sink);

    expect(device.byte(0x00, false, true)).toBe(0x5a);
  });

  it('carries a sketch on the emulated chip into the panel on the bench', async () => {
    /*
     * The whole path, and the only test that covers it: a MicroPython sketch
     * runs on the emulated chip, the chip's own SPI master shifts bytes out
     * to the host, and the display on the bench takes them. A seam that is
     * not connected leaves the panel dark while the sketch reports success.
     */
    const simulation = new Simulation(boardOption('esp32').make());
    expect(simulation.loadCircuit(STARTER_CIRCUITS.esp32)).toEqual([]);

    const panelPart = simulation.bench.parts.find(
      (part) =>
        part.definition.component.kind === 'display' &&
        part.definition.component.controller === 'ili9341',
    );
    if (!panelPart) throw new Error('esp32: the starter bench has no SPI panel');
    const panel = simulation.engine.displayController(panelPart.id);
    if (!(panel instanceof Ili9341)) throw new Error('esp32: the panel is not the colour TFT');

    const bus = new SpiBus((byte, dataSelect, chipSelected) =>
      simulation.engine.deliverSpi(byte, dataSelect, chipSelected),
    );

    const filesystem = await buildEsp32Filesystem(
      [
        {
          name: 'main.py',
          content: [
            'from machine import Pin, SPI',
            'import time',
            '',
            /*
             * The bench wires the panel to the board\'s own SPI pins: chip
             * select on GPIO5, data/command on GPIO15, clock on GPIO18 and
             * MOSI on GPIO23. VSPI is the master on those pins, and the
             * sketch drives the two lines that are not the bus itself.
             */
            'cs = Pin(5, Pin.OUT)',
            'dc = Pin(15, Pin.OUT)',
            'spi = SPI(2, baudrate=1000000)',
            'cs.value(0)',
            'dc.value(0)',
            "spi.write(b'\\x29')",
            /*
             * The address commands and their arguments, then the pixels. A
             * command byte comes with the D/C line low and its arguments
             * with it high, so a seam that lost the line would put the
             * window somewhere else.
             */
            "spi.write(b'\\x2a')",
            'dc.value(1)',
            "spi.write(b'\\x00\\x00\\x00\\xef')",
            'dc.value(0)',
            "spi.write(b'\\x2b')",
            'dc.value(1)',
            "spi.write(b'\\x00\\x00\\x00\\x07')",
            'dc.value(0)',
            "spi.write(b'\\x2c')",
            'dc.value(1)',
            "spi.write(b'\\xf8\\x1f\\xf8\\x1f')",
            'cs.value(1)',
            "print('NOESIS-ESP32-SPI')",
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
        spi: {
          begin: () => bus.begin(),
          transfer: (byte, dataSelect, chipSelected) => bus.transfer(byte, dataSelect, chipSelected),
          end: () => {
            bus.end();
          },
        },
      },
    );

    await backend.start();
    expect(backend.fault).toBeNull();

    for (let slice = 0; slice < 400 && !serial.includes('NOESIS-ESP32-SPI'); slice++) {
      backend.step(40);
      expect(backend.fault).toBeNull();
    }

    expect(serial, 'the sketch never ran on the chip').toContain('NOESIS-ESP32-SPI');
    expect(panel.isOn(), 'the panel never lit: the chip did not reach the bench bus').toBe(true);
    // The pixels the sketch wrote, with the D/C line high: a seam that lost
    // the line would have put them somewhere else.
    expect(panel.pixelAt(0, 0), 'the panel never took the pixels').toBe(0xf81f);
    expect(panel.pixelAt(1, 0), 'the panel took only the first pixel').toBe(0xf81f);
  }, 300_000);
});
