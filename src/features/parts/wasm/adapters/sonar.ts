/**
 * HC-SR04 sonar adapter for the differential harness.
 *
 * C++: part_create_sonar(part_id) → SonarContext
 * TS:  HC-SR04 echo width oracle (echo_us = distance_cm * 58)
 */
import type { PartAdapter } from '../probe';
import type { PartsModule } from '../parts-module';
import type { Stimulus } from '../probe';
import type { PartStateSnapshot } from '../parts-module';

class SonarOracle {
  distance_cm = 100;
  echo_us = 5800;

  applyStimulus(stimulus: Stimulus): void {
    if (stimulus.kind === 'knob' && stimulus.name === 'distance') {
      this.distance_cm = Math.min(400, Math.max(2, stimulus.value));
      this.echo_us = Math.round(this.distance_cm * 58);
    }
  }

  readScalars(): number[] {
    return [this.echo_us];
  }
}

export const sonarAdapter: PartAdapter = {
  kind: 'sonar',
  labels: ['echo_us'],

  create(factoryArgs: unknown[], module?: PartsModule): unknown {
    const [part_id] = factoryArgs as [number];
    if (module) {
      return module.part_create_sonar(part_id);
    } else {
      return new SonarOracle();
    }
  },

  apply(instance: unknown, stimulus: Stimulus, module?: PartsModule): void {
    if (module) {
      if (stimulus.kind === 'knob') {
        module.part_set_knob(instance as number, stimulus.name, stimulus.value);
      }
    } else {
      (instance as SonarOracle).applyStimulus(stimulus);
    }
  },

  readScalars(instance: unknown, _module?: PartsModule): number[] {
    return (instance as SonarOracle).readScalars();
  },

  snapshotToScalars(snap: PartStateSnapshot): number[] {
    return [snap.sonar_echo_us];
  },
};
