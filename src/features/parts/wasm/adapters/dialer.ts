/**
 * Dialer adapter for the differential harness.
 *
 * C++: part_create_dialer(part_id) → DialerContext
 * TS:  DialerOracle (mirrors C++ digit knob)
 */
import type { PartAdapter } from '../probe';
import type { PartsModule } from '../parts-module';
import type { Stimulus } from '../probe';
import type { PartStateSnapshot } from '../parts-module';

class DialerOracle {
  digit = 0;
}

export const dialerAdapter: PartAdapter = {
  kind: 'dialer',
  labels: ['dialer_digit'],

  create(factoryArgs: unknown[], module?: PartsModule): unknown {
    const [part_id] = factoryArgs as [number];
    if (module) {
      return module.part_create_dialer(part_id);
    } else {
      return new DialerOracle();
    }
  },

  apply(instance: unknown, stimulus: Stimulus, module?: PartsModule): void {
    if (module) {
      if (stimulus.kind === 'knob' && stimulus.name === 'digit') {
        module.part_set_knob(instance as number, stimulus.name, stimulus.value);
      }
    } else {
      const oracle = instance as DialerOracle;
      if (stimulus.kind === 'knob' && stimulus.name === 'digit') {
        oracle.digit = Math.round(stimulus.value);
        if (oracle.digit < 0) oracle.digit = 0;
        if (oracle.digit > 9) oracle.digit = 9;
      }
    }
  },

  readScalars(instance: unknown): number[] {
    const oracle = instance as DialerOracle;
    return [oracle.digit];
  },

  snapshotToScalars(snap: PartStateSnapshot): number[] {
    return [snap.dialer_digit];
  },

  reset(_instance: unknown, module?: PartsModule): void {
    if (module) {
      module.bus_reset();
    }
  },
};
