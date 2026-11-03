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


export const ili9341Adapter: PartAdapter = {
  kind: 'ili9341',
  labels: ['width', 'height'],

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
        module.spi_bus_begin();
        module.spi_bus_transfer(stimulus.byte, stimulus.dc ? 1 : 0, stimulus.cs ? 1 : 0);
        module.spi_bus_end();
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
      return [dev.width, dev.height];
    }
  },

  snapshotToScalars(snap: PartStateSnapshot): number[] {
    return [snap.width, snap.height];
  },

  reset(_instance: unknown, module?: PartsModule): void {
    if (module) {
      module.bus_reset();
      module.spi_bus_init(0, 0, 0, 0);
    }
  },
};