/**
 * Dialer adapter for the differential harness.
 *
 * C++: part_create_dialer(part_id) → DialerContext
 * TS:  DialerOracle (mirrors C++ digit knob; TS has no standalone device class)
 *
 * Adapter parity note: the TS dialer (parts/dialer.ts) is just a definition +
 * knob spec — no runtime device class. The local DialerOracle mirrors the C++
 * DialerContext digit field exactly, which is what the gate compares.
 */
import type { PartAdapter } from '../probe';
import type { PartsModule } from '../parts-module';
import type { Stimulus } from '../probe';
import type { PartStateSnapshot } from '../parts-module';

class DialerOracle {
  digit = 0; // Finger hole the dial stopped at (0-9)
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
        oracle.digit = Math.round(stimulus.value) & 0xff;
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
