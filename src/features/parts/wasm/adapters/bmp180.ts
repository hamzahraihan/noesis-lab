/**
 * BMP180 adapter for the differential harness.
 *
 * C++: part_create_sensor_i2c(part_id, 2, address) → BMP180Context
 * TS:  Bmp180 class from devices/bmp180.ts
 */
import type { PartAdapter } from '../probe';
import type { PartsModule } from '../parts-module';
import type { Stimulus } from '../probe';
import type { PartStateSnapshot } from '../parts-module';
import { Bmp180 } from '@/features/parts/devices/bmp180';

export const bmp180Adapter: PartAdapter = {
  kind: 'bmp180',
  labels: ['temp_milli_c', 'pressure_pa'],

  create(factoryArgs: unknown[], module?: PartsModule): unknown {
    const [part_id, type, address] = factoryArgs as [number, number, number];
    if (module) {
      return module.part_create_sensor_i2c(part_id, type, address);
    } else {
      const dev = new Bmp180();
      // Track conditions for knobs
      const conditions = { celsius: 20, pascals: 101325 };
      dev.setConditionsSource(() => conditions);
      return { dev, conditions };
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
      const { dev, conditions } = instance as { dev: Bmp180; conditions: { celsius: number; pascals: number } };
      if (stimulus.kind === 'i2c-write') {
        stimulus.bytes.forEach((byte: number) => {
          dev.receive(byte, true);
        });
      } else if (stimulus.kind === 'i2c-read') {
        dev.read(stimulus.count);
      } else if (stimulus.kind === 'knob') {
        if (stimulus.name === 'temperature') {
          conditions.celsius = stimulus.value;
        } else if (stimulus.name === 'pressure') {
          conditions.pascals = stimulus.value * 100;
        }
      }
    }
  },

  readScalars(instance: unknown, module?: PartsModule): number[] {
    if (module) {
      throw new Error('BMP180: wasm path should use snapshotToScalars');
    } else {
      const { dev } = instance as { dev: Bmp180; conditions: { celsius: number; pascals: number } };
      return [dev.getTemperatureMilliC(), dev.getPressurePa()];
    }
  },

  snapshotToScalars(snap: PartStateSnapshot): number[] {
    return [snap.sensor_temp_milli_c, snap.sensor_pressure_pa];
  },

  reset(_instance: unknown, module?: PartsModule): void {
    if (module) {
      module.bus_reset();
    }
  },
};