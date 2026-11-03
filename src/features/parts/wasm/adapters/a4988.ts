/**
 * A4988 adapter for the differential harness.
 *
 * C++: part_create_stepper_driver(part_id, output_ohms) → StepperDriverContext
 * TS:  A4988 class from a4988.ts
 */
import type { PartAdapter } from '../probe';
import type { PartsModule } from '../parts-module';
import type { Stimulus } from '../probe';
import type { PartStateSnapshot } from '../parts-module';
import { A4988, type A4988OutputPin } from '@/features/parts/a4988';

type A4988Inputs = {
  step: boolean;
  dir: boolean;
  enable: boolean;
  reset: boolean;
  sleep: boolean;
  ms1?: boolean;
  ms2?: boolean;
  ms3?: boolean;
};

const A4988_PINS: readonly string[] = ['STEP', 'DIR', 'ENABLE', 'RESET', 'SLEEP', 'MS1', 'MS2', 'MS3'];

export const a4988Adapter: PartAdapter = {
  kind: 'a4988',
  labels: ['1A', '1B', '2A', '2B'],

  create(factoryArgs: unknown[], module?: PartsModule): unknown {
    const [part_id, output_ohms = 0.32] = factoryArgs as [number, number?];
    if (module) {
      return module.part_create_stepper_driver(part_id, output_ohms);
    } else {
      return new A4988();
    }
  },

  apply(instance: unknown, stimulus: Stimulus, module?: PartsModule): void {
    if (module) {
      const handle = instance as number;
      if (stimulus.kind === 'pin' && stimulus.index >= 0 && stimulus.index <= 7) {
        module.part_set_pin_level(handle, stimulus.index, stimulus.high ? 1 : 0);
      }
    } else {
      const driver = instance as A4988 & { _pinState?: A4988Inputs };
      if (!driver._pinState) {
        driver._pinState = {
          step: false, dir: false, enable: true, reset: true, sleep: true,
          ms1: false, ms2: false, ms3: false,
        };
      }
      if (stimulus.kind === 'pin' && stimulus.index >= 0 && stimulus.index <= 7) {
        const pin = A4988_PINS[stimulus.index];
        if (pin === 'STEP') driver._pinState.step = stimulus.high;
        else if (pin === 'DIR') driver._pinState.dir = stimulus.high;
        else if (pin === 'ENABLE') driver._pinState.enable = stimulus.high;
        else if (pin === 'RESET') driver._pinState.reset = stimulus.high;
        else if (pin === 'SLEEP') driver._pinState.sleep = stimulus.high;
        else if (pin === 'MS1') driver._pinState.ms1 = stimulus.high;
        else if (pin === 'MS2') driver._pinState.ms2 = stimulus.high;
        else if (pin === 'MS3') driver._pinState.ms3 = stimulus.high;
      }
      driver.setInputs(driver._pinState);
    }
  },

  readScalars(instance: unknown, module?: PartsModule): number[] {
    if (module) {
      throw new Error('A4988: wasm path should use snapshotToScalars');
    } else {
      const driver = instance as A4988;
      return A4988_OUTPUT_PINS.map((pin) => driver.output(pin) ? 1 : 0);
    }
  },

  snapshotToScalars(snap: PartStateSnapshot): number[] {
    return [
      snap.stepper_driver_outputs[0],
      snap.stepper_driver_outputs[1],
      snap.stepper_driver_outputs[2],
      snap.stepper_driver_outputs[3],
    ];
  },

  reset(_instance: unknown, module?: PartsModule): void {
    if (module) {
      module.bus_reset();
    } else {
      const driver = _instance as A4988 & { _pinState?: A4988Inputs };
      if (driver._pinState) {
        driver._pinState = {
          step: false, dir: false, enable: true, reset: true, sleep: true,
          ms1: false, ms2: false, ms3: false,
        };
      }
    }
  },
};

const A4988_OUTPUT_PINS: readonly A4988OutputPin[] = ['1A', '1B', '2A', '2B'];