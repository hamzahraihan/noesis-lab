/**
 * PCD8544 (Nokia 5110) adapter for the differential harness.
 *
 * C++: part_create_display_pcd8544(part_id) → PCD8544Context
 * TS:  new Pcd8544()
 */
import { Pcd8544 } from '@/features/parts/display/pcd8544';
import type { PartAdapter } from '../probe';
import type { PartsModule } from '../parts-module';
import { readPartStateSnapshot, type PartStateSnapshot } from '../parts-module';

export const pcd8544Adapter: PartAdapter = {
  kind: 'pcd8544',
  labels: ['x', 'y', 'vertical', 'extended', 'powerDown', 'blanked', 'inverse', 'vop', 'framebuffer_0', 'framebuffer_1', 'framebuffer_2'],

  create(factoryArgs: unknown[], module?: PartsModule): unknown {
    const [part_id] = factoryArgs as [number];
    if (module) {
      return module.part_create_display_pcd8544(part_id);
    } else {
      return new Pcd8544();
    }
  },

  apply(instance: unknown, stimulus: { kind: 'spi-transfer'; byte: number; dc: boolean; cs: boolean }, module?: PartsModule): void {
    if (module) {
      if (stimulus.kind === 'spi-transfer') {
        module.spi_bus_begin();
        module.spi_bus_transfer(stimulus.byte, stimulus.dc ? 1 : 0, stimulus.cs ? 1 : 0);
        module.spi_bus_end();
      }
    } else {
      const dev = instance as Pcd8544;
      dev.receive(stimulus.byte, stimulus.dc, stimulus.cs);
    }
  },

  readScalars(instance: unknown, module?: PartsModule): number[] {
    if (module) {
      const handle = instance as number;
      const snapPtr = module.part_get_state(handle);
      const snap = readPartStateSnapshot(module.wasmMemory, snapPtr);
      return this.snapshotToScalars(snap);
    } else {
      const dev = instance as Pcd8544;
      const fb = dev.ram;
      return [
        dev.x, dev.y, dev.vertical ? 1 : 0, dev.extended ? 1 : 0,
        dev.powerDown ? 1 : 0, dev.blanked ? 1 : 0, dev.inverse ? 1 : 0, dev.vop,
        fb[0] ?? 0, fb[1] ?? 0, fb[2] ?? 0
      ];
    }
  },

  reset(instance: unknown, module?: PartsModule): void {
    if (module) {
      module.bus_reset();
    } else {
      const dev = instance as Pcd8544;
      dev.reset();
    }
  },

  snapshotToScalars(snap: PartStateSnapshot): number[] {
    const fb = snap.framebufferData || new Uint8Array(0);
    return [
      snap.pcd8544_x, snap.pcd8544_y, snap.pcd8544_vertical ? 1 : 0, snap.pcd8544_extended ? 1 : 0,
      snap.pcd8544_powerDown ? 1 : 0, snap.pcd8544_blanked ? 1 : 0, snap.pcd8544_inverse ? 1 : 0, snap.pcd8544_vop,
      fb[0] ?? 0, fb[1] ?? 0, fb[2] ?? 0
    ];
  },
};

export type Stimulus =
  | { kind: 'i2c-write'; address: number; bytes: number[] }
  | { kind: 'i2c-read'; address: number; count: number }
  | { kind: 'spi-transfer'; byte: number; dc: boolean; cs: boolean }
  | { kind: 'pin'; index: number; high: boolean }
  | { kind: 'knob'; name: string; value: number };