/**
 * Stepper adapter for the differential harness.
 *
 * C++: part_create_stepper(part_id, step_angle_deg) → StepperContext
 * TS:  stepper.ts windingPolarity / stepTransition / STEP_DEGREES
 *      (local StepperOracle; no TS Stepper device class exists in devices/)
 *
 * Adapter parity note: there is no TS Stepper device class —
 * src/features/parts/stepper.ts exports utility functions
 * (stepTransition, windingPolarity, windingAngle, shortestAngleDelta) but no
 * class with a pin-level interface. The local StepperOracle mirrors the C++
 * Gray-cycle edge decoding exactly, which is what the gate compares.
 */
import type { PartAdapter } from '../probe';
import type { PartsModule } from '../parts-module';
import type { Stimulus } from '../probe';
import type { PartStateSnapshot } from '../parts-module';

const STEP_DEGREES = 7.5;
const WINDING_DEADBAND_VOLTS = 0.2;

type WindingPolarity = -1 | 0 | 1;

const GRAY_ORDER: ReadonlyArray<readonly [WindingPolarity, WindingPolarity]> = [
  [1, 1],
  [-1, 1],
  [-1, -1],
  [1, -1],
];

function stepTransition(
  prev: readonly [WindingPolarity, WindingPolarity],
  next: readonly [WindingPolarity, WindingPolarity],
): -1 | 0 | 1 {
  if (prev[0] === 0 || prev[1] === 0 || next[0] === 0 || next[1] === 0) return 0;
  const from = GRAY_ORDER.findIndex(([a, b]) => a === prev[0] && b === prev[1]);
  const to = GRAY_ORDER.findIndex(([a, b]) => a === next[0] && b === next[1]);
  if (from < 0 || to < 0) return 0;
  if (to === (from + 1) % 4) return 1;
  if (from === (to + 1) % 4) return -1;
  return 0;
}

function windingPolarity(plusVolts: number, minusVolts: number): WindingPolarity {
  const across = plusVolts - minusVolts;
  if (across > WINDING_DEADBAND_VOLTS) return 1;
  if (across < -WINDING_DEADBAND_VOLTS) return -1;
  return 0;
}

/** TS oracle that mirrors engine.ts stepperState logic. */
class StepperOracle {
  // Pin state: 0=A+, 1=A-, 2=B+, 3=B-
  pinState = [false, false, false, false];
  prevA: WindingPolarity = 0;
  prevB: WindingPolarity = 0;
  angleDeg = 0;

  applyStimulus(stimulus: Stimulus): void {
    if (stimulus.kind === 'pin' && stimulus.index >= 0 && stimulus.index <= 3) {
      this.pinState[stimulus.index] = stimulus.high;

      // Compute polarities: A+ vs A-, B+ vs B-
      const aPlus = this.pinState[0] ? 1 : 0;
      const aMinus = this.pinState[1] ? 1 : 0;
      const bPlus = this.pinState[2] ? 1 : 0;
      const bMinus = this.pinState[3] ? 1 : 0;

      const nextA = windingPolarity(aPlus, aMinus);
      const nextB = windingPolarity(bPlus, bMinus);

      // First sighting arms the tracker
      if (this.prevA === 0 && this.prevB === 0 && nextA === 0 && nextB === 0) return;
      if (this.prevA === 0 && this.prevB === 0) {
        this.prevA = nextA;
        this.prevB = nextB;
        return;
      }

      const delta = stepTransition(
        [this.prevA as WindingPolarity, this.prevB as WindingPolarity],
        [nextA, nextB],
      );
      this.angleDeg += delta * STEP_DEGREES;

      this.prevA = nextA;
      this.prevB = nextB;
    }
    // time stimulus handled by WasmPartProbe
  }

  readScalars(): number[] {
    return [Math.round(this.angleDeg * 10)]; // deci-degrees
  }
}

export const stepperAdapter: PartAdapter = {
  kind: 'stepper',
  labels: ['angle_deci_deg'],

  create(factoryArgs: unknown[], module?: PartsModule): unknown {
    const [part_id, step_angle_deg = 7.5] = factoryArgs as [number, number?];
    if (module) {
      return module.part_create_stepper(part_id, step_angle_deg);
    } else {
      return new StepperOracle();
    }
  },

  apply(instance: unknown, stimulus: Stimulus, module?: PartsModule): void {
    if (module) {
      const handle = instance as number;
      if (stimulus.kind === 'pin' && stimulus.index >= 0 && stimulus.index <= 3) {
        module.part_set_pin_level(handle, stimulus.index, stimulus.high ? 1 : 0);
      }
    } else {
      (instance as StepperOracle).applyStimulus(stimulus);
    }
  },

  readScalars(instance: unknown, module?: PartsModule): number[] {
    if (module) {
      throw new Error('Stepper: wasm path should use snapshotToScalars');
    } else {
      return (instance as StepperOracle).readScalars();
    }
  },

  snapshotToScalars(snap: PartStateSnapshot): number[] {
    return [snap.stepper_angle_deci_deg];
  },

  reset(_instance: unknown, module?: PartsModule): void {
    if (module) {
      module.bus_reset();
    }
  },
};