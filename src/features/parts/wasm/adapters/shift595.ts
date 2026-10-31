/**
 * Shift595 (74HC595) adapter for the differential harness.
 *
 * C++: part_create_shift_register(part_id) + SPI bus
 * TS:  new Shift595()
 */
import { Shift595 } from '@/features/parts/devices/shift595';
import type { PartAdapter } from '../probe';
import type { PartsModule } from '../parts-module';
import type { Stimulus } from '../probe';
import type { PartStateSnapshot } from '../parts-module';

declare module '@/features/parts/devices/shift595' {
  interface Shift595 {
    readonly shiftReg: number;
    readonly storageReg: number;
    // enabled getter already exists on the class
  }
}

Object.defineProperty(Shift595.prototype, 'shiftReg', { get() { return (this as any).shift; } });
Object.defineProperty(Shift595.prototype, 'storageReg', { get() { return (this as any).latched; } });

export const shift595Adapter: PartAdapter = {
  kind: 'shift595',
  labels: ['shift_reg', 'storage_reg', 'outputs_enabled'],

  create(factoryArgs: unknown[], module?: PartsModule): unknown {
    const [part_id] = factoryArgs as [number];
    if (module) {
      const handle = module.part_create_shift_register(part_id);
      // Register as SPI device (CS net = 0 for probe; probe uses spi_bus_transfer directly)
      return handle;
    } else {
      return new Shift595();
    }
  },

  apply(instance: unknown, stimulus: Stimulus, module?: PartsModule): void {
    if (module) {
      const handle = instance as number;
      if (stimulus.kind === 'spi-transfer') {
        module.spi_bus_begin();
        module.spi_bus_transfer(stimulus.byte, stimulus.dc ? 1 : 0, stimulus.cs ? 1 : 0);
        module.spi_bus_end();
      } else if (stimulus.kind === 'pin') {
        // Pin mapping: 0=SHCP, 1=STCP, 2=OE, 3=DS
        if (stimulus.index === 1) { // STCP
          module.part_set_pin_level(handle, 1, stimulus.high ? 1 : 0);
        } else if (stimulus.index === 2) { // OE (active low)
          module.part_set_pin_level(handle, 2, stimulus.high ? 0 : 1);
        }
      }
    } else {
      const dev = instance as Shift595;
      if (stimulus.kind === 'spi-transfer') {
        dev.receive(stimulus.byte, stimulus.dc, stimulus.cs);
      } else if (stimulus.kind === 'pin') {
        if (stimulus.index === 1) { // STCP (RCLK)
          dev.setLatchLevel(stimulus.high);
        } else if (stimulus.index === 2) { // OE (active low)
          dev.setEnableLevel(!stimulus.high);
        }
      }
    }
  },

  readScalars(_instance: unknown, module?: PartsModule): number[] {
    if (module) {
      // Wasm path - now uses snapshotToScalars via probe
      throw new Error('Shift595: wasm path should use snapshotToScalars');
    } else {
      const dev = _instance as Shift595;
      return [dev.shiftReg, dev.storageReg, dev.enabled ? 1 : 0];
    }
  },

  snapshotToScalars(snap: PartStateSnapshot): number[] {
    // Shift595: shift_reg, storage_reg, outputs_enabled
    return [
      snap.shift595_shift_reg,
      snap.shift595_storage_reg,
      snap.shift595_outputs_enabled ? 1 : 0,
    ];
  },

  reset(_instance: unknown, module?: PartsModule): void {
    if (module) {
      module.bus_reset();
    }
  },
};