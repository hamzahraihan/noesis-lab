/**
 * ILI9341 adapter for the differential harness.
 *
 * C++: part_create_display_spi(part_id, width, height, true) → ILI9341Context
 * TS:  Ili9341 class from display/ili9341.ts
 */
import type { PartAdapter } from '../probe';
import type { PartsModule } from '../parts-module';
import type { Stimulus } from '../probe';
import type { PartStateSnapshot } from '../parts-module';
import { Ili9341 } from '@/features/parts/display/ili9341';

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

export const ili9341Adapter: PartAdapter = {
  kind: 'ili9341',
  labels: ['width', 'height', 'framebuffer_crc'],

  create(factoryArgs: unknown[], module?: PartsModule): unknown {
    const [part_id, width, height] = factoryArgs as [number, number, number];
    if (module) {
      return module.part_create_display_spi(part_id, width, height, 1);
    } else {
      return new Ili9341(width, height);
    }
  },

  apply(_instance: unknown, stimulus: Stimulus, module?: PartsModule): void {
    if (module) {
      if (stimulus.kind === 'spi-transfer') {
        module.spi_bus_transfer(stimulus.byte, stimulus.dc ? 1 : 0, stimulus.cs ? 1 : 0);
      }
    } else {
      const dev = _instance as Ili9341;
      if (stimulus.kind === 'spi-transfer') {
        dev.receive(stimulus.byte, stimulus.dc, stimulus.cs);
      }
    }
  },

  readScalars(_instance: unknown, module?: PartsModule): number[] {
    if (module) {
      throw new Error('ILI9341: wasm path should use snapshotToScalars');
    } else {
      const dev = _instance as Ili9341;
      const rgba = dev.toRgba();
      // Convert RGBA to raw bytes for CRC
      const bytes = new Uint8Array(rgba.buffer);
      return [dev.width, dev.height, crc32(bytes)];
    }
  },

  snapshotToScalars(snap: PartStateSnapshot): number[] {
    const fb = snap.framebufferData;
    return [snap.width, snap.height, fb ? crc32(fb) : 0];
  },

  reset(_instance: unknown, module?: PartsModule): void {
    if (module) {
      module.bus_reset();
      module.spi_bus_init(0, 0, 0, 0);
    }
  },
};