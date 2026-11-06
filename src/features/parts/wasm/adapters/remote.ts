/**
 * IR remote adapter for the differential harness.
 *
 * C++: part_create_remote(part_id) → RemoteContext
 * TS:  RemoteOracle (mirrors C++ key + pressed state)
 */
import type { PartAdapter } from '../probe';
import type { PartsModule } from '../parts-module';
import type { Stimulus } from '../probe';
import type { PartStateSnapshot } from '../parts-module';

// NEC codes for the 20 remote keys, matching remote.ts NEC_CODES table
const NEC_CODES: ReadonlyArray<number> = [
  0xa2, 0xe2, 0x22, 0x02, 0xc2, 0xe0, 0xa8, 0x90, 0x68, 0x98,
  0xb0, 0x30, 0x18, 0x7a, 0x10, 0x38, 0x5a, 0x42, 0x4a, 0x52,
];

class RemoteOracle {
  key = 0;
  pressed = false;
}

export const remoteAdapter: PartAdapter = {
  kind: 'remote',
  labels: ['ir_code'],

  create(factoryArgs: unknown[], module?: PartsModule): unknown {
    const [part_id] = factoryArgs as [number];
    if (module) {
      return module.part_create_remote(part_id);
    } else {
      return new RemoteOracle();
    }
  },

  apply(instance: unknown, stimulus: Stimulus, module?: PartsModule): void {
    if (module) {
      if (stimulus.kind === 'knob') {
        module.part_set_knob(instance as number, stimulus.name, stimulus.value);
      }
    } else {
      const oracle = instance as RemoteOracle;
      if (stimulus.kind === 'knob') {
        if (stimulus.name === 'key') {
          oracle.key = Math.round(stimulus.value);
          if (oracle.key < 0) oracle.key = 0;
          if (oracle.key > 19) oracle.key = 19;
        } else if (stimulus.name === 'pressed') {
          oracle.pressed = stimulus.value !== 0;
        }
      }
    }
  },

  readScalars(instance: unknown): number[] {
    const oracle = instance as RemoteOracle;
    return [oracle.pressed ? NEC_CODES[oracle.key] : 0];
  },

  snapshotToScalars(snap: PartStateSnapshot): number[] {
    return [snap.ir_code];
  },

  reset(_instance: unknown, module?: PartsModule): void {
    if (module) {
      module.bus_reset();
    }
  },
};
