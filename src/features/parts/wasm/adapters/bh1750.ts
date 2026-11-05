/**
 * BH1750 adapter for the differential harness.
 *
 * C++: part_create_sensor_i2c(part_id, 1, address) → BH1750Context
 * TS:  Bh1750 class from devices/bh1750.ts
 */
import type { PartAdapter } from '../probe';
import type { PartsModule } from '../parts-module';
import type { Stimulus } from '../probe';
import type { PartStateSnapshot } from '../parts-module';
import { Bh1750 } from '@/features/parts/devices/bh1750';

export const bh1750Adapter: PartAdapter = {
  kind: 'bh1750',
  labels: ['lux'],

  create(factoryArgs: unknown[], module?: PartsModule): unknown {
    const [part_id, type, address] = factoryArgs as [number, number, number];
    if (module) {
      return module.part_create_sensor_i2c(part_id, type, address);
    } else {
      return new Bh1750();
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
      } else if (stimulus.kind === 'knob') {
        module.part_set_knob(instance as number, stimulus.name, stimulus.value);
      }
    } else {
      const dev = instance as Bh1750;
      if (stimulus.kind === 'i2c-write') {
        stimulus.bytes.forEach((byte: number) => {
          dev.receive(byte, true);
        });
      } else if (stimulus.kind === 'i2c-read') {
        dev.read(stimulus.count);
      } else if (stimulus.kind === 'knob' && stimulus.name === 'light') {
        dev.setLightSource(() => stimulus.value);
      }
    }
  },

  readScalars(instance: unknown): number[] {
    const dev = instance as Bh1750;
    // Trigger a measurement for continuous mode, then read counts
    dev.read(2);
    return [dev.getLux()];
  },

  snapshotToScalars(snap: PartStateSnapshot): number[] {
    return [snap.sensor_lux];
  },

  reset(_instance: unknown, module?: PartsModule): void {
    if (module) {
      module.bus_reset();
    }
  },
};