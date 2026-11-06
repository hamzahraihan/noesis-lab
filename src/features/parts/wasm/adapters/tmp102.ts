/**
 * TMP102 adapter for the differential harness.
 *
 * C++: part_create_sensor_i2c(part_id, 4, address) → TMP102Context
 * TS:  knob-driven oracle (Tmp102 device is register-driven; the harness
 *      compares snapshot temp_milli_c vs the knob value at 1/16 C resolution)
 */
import type { PartAdapter } from '../probe';
import type { PartsModule } from '../parts-module';
import type { Stimulus } from '../probe';
import type { PartStateSnapshot } from '../parts-module';

class Tmp102Oracle {
  temp_milli_c = 21000; // 21 C default
}

export const tmp102Adapter: PartAdapter = {
  kind: 'tmp102',
  labels: ['temp_milli_c'],

  create(factoryArgs: unknown[], module?: PartsModule): unknown {
    const [part_id, type, address] = factoryArgs as [number, number, number];
    if (module) {
      return module.part_create_sensor_i2c(part_id, type, address);
    } else {
      return new Tmp102Oracle();
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
      const oracle = instance as Tmp102Oracle;
      if (stimulus.kind === 'knob' && stimulus.name === 'temperature') {
        // Round to the chip's 1/16 C resolution (0.0625 C)
        // 1 count = 1/16 C = 62.5 milli-C
        oracle.temp_milli_c = Math.round(stimulus.value / 0.0625) * 62.5;
      }
    }
  },

  readScalars(instance: unknown): number[] {
    const oracle = instance as Tmp102Oracle;
    return [oracle.temp_milli_c];
  },

  snapshotToScalars(snap: PartStateSnapshot): number[] {
    return [snap.sensor_temp_milli_c];
  },

  reset(_instance: unknown, module?: PartsModule): void {
    if (module) {
      module.bus_reset();
    }
  },
};
