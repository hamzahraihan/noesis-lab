/**
 * MicroSD card adapter for the differential harness.
 *
 * C++: part_create_sdcard(part_id) → SDCardContext
 * TS:  SDCardOracle (mirrors C++ present/write/remove model)
 */
import type { PartAdapter } from '../probe';
import type { PartsModule } from '../parts-module';
import type { Stimulus } from '../probe';
import type { PartStateSnapshot } from '../parts-module';

class SDCardOracle {
  present = false;
  last_byte = 0;
  write_count = 0;
  total_bytes = 0;
}

export const sdcardAdapter: PartAdapter = {
  kind: 'sdcard',
  labels: ['sd_present', 'sd_write_count', 'sd_last_byte', 'sd_total_bytes'],

  create(factoryArgs: unknown[], module?: PartsModule): unknown {
    const [part_id] = factoryArgs as [number];
    if (module) {
      return module.part_create_sdcard(part_id);
    } else {
      return new SDCardOracle();
    }
  },

  apply(instance: unknown, stimulus: Stimulus, module?: PartsModule): void {
    if (module) {
      if (stimulus.kind === 'knob') {
        module.part_set_knob(instance as number, stimulus.name, stimulus.value);
      }
    } else {
      const oracle = instance as SDCardOracle;
      if (stimulus.kind === 'knob') {
        if (stimulus.name === 'present') {
          oracle.present = stimulus.value !== 0;
          if (!oracle.present) {
            oracle.write_count = 0;
            oracle.total_bytes = 0;
            oracle.last_byte = 0;
          }
        } else if (stimulus.name === 'write') {
          if (oracle.present) {
            oracle.last_byte = Math.round(stimulus.value) & 0xff;
            oracle.write_count++;
            oracle.total_bytes++;
          }
        } else if (stimulus.name === 'remove') {
          oracle.present = false;
          oracle.write_count = 0;
          oracle.total_bytes = 0;
          oracle.last_byte = 0;
        }
      }
    }
  },

  readScalars(instance: unknown): number[] {
    const oracle = instance as SDCardOracle;
    return [
      oracle.present ? 1 : 0,
      oracle.write_count,
      oracle.last_byte,
      oracle.total_bytes,
    ];
  },

  snapshotToScalars(snap: PartStateSnapshot): number[] {
    return [
      snap.sd_present ? 1 : 0,
      snap.sd_write_count,
      snap.sd_last_byte,
      snap.sd_total_bytes,
    ];
  },

  reset(_instance: unknown, module?: PartsModule): void {
    if (module) {
      module.bus_reset();
    }
  },
};
