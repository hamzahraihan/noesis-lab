/**
 * DS18B20 adapter for the differential harness.
 *
 * C++: part_create_ds18b20(part_id) → DS18B20Context
 * TS: DS18B20 knob oracle (one-wire timing not modelled; knob-driven)
 */
import type { PartAdapter } from '../probe';
import type { PartsModule } from '../parts-module';
import type { Stimulus } from '../probe';
import type { PartStateSnapshot } from '../parts-module';

class DS18B20Oracle {
  temp_milli_c = 22000;
}

export const ds18b20Adapter: PartAdapter = {
  kind: 'ds18b20',
  labels: ['temp_milli_c'],

  create(factoryArgs: unknown[], module?: PartsModule): unknown {
    const [part_id] = factoryArgs as [number];
    if (module) {
      return module.part_create_ds18b20(part_id);
    } else {
      return new DS18B20Oracle();
    }
  },

  apply(instance: unknown, stimulus: Stimulus, module?: PartsModule): void {
    if (module) {
      if (stimulus.kind === 'knob') {
        module.part_set_knob(instance as number, stimulus.name, stimulus.value);
      }
    } else {
      const oracle = instance as DS18B20Oracle;
      if (stimulus.kind === 'knob' && stimulus.name === 'temperature') {
        oracle.temp_milli_c = Math.round(stimulus.value * 1000);
      }
    }
  },

  readScalars(instance: unknown): number[] {
    return [(instance as DS18B20Oracle).temp_milli_c];
  },

  snapshotToScalars(snap: PartStateSnapshot): number[] {
    return [snap.sensor_temp_milli_c];
  },
};
