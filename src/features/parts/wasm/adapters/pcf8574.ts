/**
 * PCF8574 adapter for the differential harness.
 *
 * C++: part_create_i2c_expander(part_id, 8, address) → PCF8574Context
 * TS:  new Pcf8574()
 */
import { Pcf8574 } from '@/features/parts/devices/pcf8574';
import type { PartAdapter } from '../probe';
import type { PartsModule } from '../parts-module';
import type { Stimulus } from '../probe';
import type { PartStateSnapshot } from '../parts-module';

/** Read-only accessors added to Pcf8574 for probe visibility. */
declare module '@/features/parts/devices/pcf8574' {
  interface Pcf8574 {
    readonly outputReg: number;
    readonly inputReg: number;
  }
}

// Add accessors at runtime (no behavior change)
Object.defineProperty(Pcf8574.prototype, 'outputReg', {
  get() { return (this as any).latch; },
});
Object.defineProperty(Pcf8574.prototype, 'inputReg', {
  get() { return (this as any).input_reg; },
});

export const pcf8574Adapter: PartAdapter = {
  kind: 'pcf8574',
  labels: ['output_reg', 'input_reg'],

  create(factoryArgs: unknown[], module?: PartsModule): unknown {
    const [part_id, address] = factoryArgs as [number, number];
    if (module) {
      // Wasm path
      return module.part_create_i2c_expander(part_id, 8, address);
    } else {
      // TS oracle path
      const dev = new Pcf8574();
      return dev;
    }
  },

  apply(instance: unknown, stimulus: Stimulus, module?: PartsModule): void {
    if (module) {
      // Wasm path: instance is a handle (number) - unused for I2C expanders
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
      // TS oracle path: instance is a Pcf8574
      const dev = instance as Pcf8574;
      if (stimulus.kind === 'i2c-write') {
        stimulus.bytes.forEach((byte: number, idx: number) => {
          dev.receive(byte, idx === 0);
        });
      } else if (stimulus.kind === 'i2c-read') {
        dev.read(stimulus.count);
      }
    }
  },

  readScalars(_instance: unknown, module?: PartsModule): number[] {
    if (module) {
      // Wasm path - now uses snapshotToScalars via probe
      throw new Error('PCF8574: wasm path should use snapshotToScalars');
    } else {
      // TS oracle path: PCF8574 has no separate input register in the model
      const dev = _instance as Pcf8574;
      return [dev.outputReg, dev.outputReg];
    }
  },

  snapshotToScalars(snap: PartStateSnapshot): number[] {
    // PCF8574: output_reg, input_reg
    return [snap.pcf8574_output_reg, snap.pcf8574_input_reg];
  },

  reset(_instance: unknown, module?: PartsModule): void {
    if (module) {
      module.bus_reset();
    } else {
      // TS oracle: create fresh instance (handled by probe reset)
    }
  },
};