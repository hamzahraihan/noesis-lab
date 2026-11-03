/**
 * SSD1306 adapter for the differential harness.
 *
 * C++: part_create_display_i2c(part_id, address, width, height) → SSD1306Context
 * TS:  Ssd1306 class from display/ssd1306.ts
 */
import type { PartAdapter } from '../probe';
import type { PartsModule } from '../parts-module';
import type { Stimulus } from '../probe';
import type { PartStateSnapshot } from '../parts-module';
import { Ssd1306, SSD1306_WIDTH, SSD1306_HEIGHT } from '@/features/parts/display/ssd1306';

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export const ssd1306Adapter: PartAdapter = {
  kind: 'ssd1306',
  labels: ['width', 'height', 'framebuffer_crc'],

  create(factoryArgs: unknown[], module?: PartsModule): unknown {
    const [part_id, address, width, height] = factoryArgs as [number, number, number, number];
    if (module) {
      return module.part_create_display_i2c(part_id, address, width, height);
    } else {
      return new Ssd1306(address);
    }
  },

  apply(instance: unknown, stimulus: Stimulus, module?: PartsModule): void {
    if (module) {
      if (stimulus.kind === 'i2c-write') {
        module.i2c_bus_begin_transmission(stimulus.address);
        stimulus.bytes.forEach((byte: number) => {
          module.i2c_bus_write(byte);
        });
        module.i2c_bus_end_transmission();
      } else if (stimulus.kind === 'i2c-read') {
        module.i2c_bus_request_from(stimulus.address, stimulus.count);
        for (let i = 0; i < stimulus.count; i++) {
          module.i2c_bus_read();
        }
      }
    } else {
      const dev = instance as Ssd1306;
      if (stimulus.kind === 'i2c-write') {
        stimulus.bytes.forEach((byte: number) => {
          dev.receive(byte, true);
        });
      } else if (stimulus.kind === 'i2c-read') {
        dev.read();
      }
    }
  },

  readScalars(_instance: unknown, module?: PartsModule): number[] {
    if (module) {
      throw new Error('SSD1306: wasm path should use snapshotToScalars');
    } else {
      const dev = _instance as Ssd1306;
      const fb = dev.frame(); // raw framebuffer (1 byte per column per page)
      return [SSD1306_WIDTH, SSD1306_HEIGHT, crc32(fb)];
    }
  },

  snapshotToScalars(snap: PartStateSnapshot): number[] {
    const fb = snap.framebufferData;
    return [snap.width, snap.height, fb ? crc32(fb) : 0];
  },

  reset(_instance: unknown, module?: PartsModule): void {
    if (module) {
      module.bus_reset();
    }
  },
};