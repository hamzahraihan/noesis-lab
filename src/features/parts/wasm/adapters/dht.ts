/**
 * DHT22 adapter for the differential harness.
 *
 * C++: part_create_dht(part_id) → DHTContext
 * TS: DHT22 knob oracle (one-wire timing not modelled; knob-driven)
 */
import type { PartAdapter } from '../probe';
import type { PartsModule } from '../parts-module';
import type { Stimulus } from '../probe';
import type { PartStateSnapshot } from '../parts-module';

class DHTOracle {
  temp_milli_c = 25000;
  humidity_milli_pct = 50000;
}

export const dhtAdapter: PartAdapter = {
  kind: 'dht',
  labels: ['temp_milli_c', 'humidity_milli_pct'],

  create(factoryArgs: unknown[], module?: PartsModule): unknown {
    const [part_id] = factoryArgs as [number];
    if (module) {
      return module.part_create_dht(part_id);
    } else {
      return new DHTOracle();
    }
  },

  apply(instance: unknown, stimulus: Stimulus, module?: PartsModule): void {
    if (module) {
      if (stimulus.kind === 'knob') {
        module.part_set_knob(instance as number, stimulus.name, stimulus.value);
      }
    } else {
      const oracle = instance as DHTOracle;
      if (stimulus.kind === 'knob') {
        if (stimulus.name === 'temperature') oracle.temp_milli_c = Math.round(stimulus.value * 1000);
        else if (stimulus.name === 'humidity') oracle.humidity_milli_pct = Math.round(stimulus.value * 1000);
      }
    }
  },

  readScalars(instance: unknown): number[] {
    const o = instance as DHTOracle;
    return [o.temp_milli_c, o.humidity_milli_pct];
  },

  snapshotToScalars(snap: PartStateSnapshot): number[] {
    return [snap.sensor_temp_milli_c, snap.sensor_humidity_milli_pct];
  },
};
