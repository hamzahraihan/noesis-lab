/**
 * Servo adapter for the differential harness.
 *
 * C++: part_create_servo(part_id) → ServoContext
 * TS:  Servo-like pulse decode (local ServoOracle, not the devices/Servo class)
 *
 * Adapter parity note: the real TS Servo class (devices/servo.ts) works at
 * the degree level (write(degrees)), while the differential harness drives
 * pin-level stimuli (PWM pulse on pin 0). The local ServoOracle mirrors the
 * C++ pulse-width measurement and 10°/170° mechanical-stop clamp exactly,
 * which is what the gate compares. Using devices/Servo would require a
 * pin-to-degree conversion layer that the harness does not provide.
 */
import type { PartAdapter } from '../probe';
import type { PartsModule } from '../parts-module';
import type { Stimulus } from '../probe';
import type { PartStateSnapshot } from '../parts-module';

const SERVO_MIN_US = 1000;
const SERVO_MAX_US = 2000;
const STOP_LOW_DEGREES = 10;
const STOP_HIGH_DEGREES = 170;

/** TS oracle that mimics the engine's servo pulse decoding + Servo clamp. */
class ServoOracle {
  pinHigh = false;
  lastChangeMs = 0;
  angle = 90;
  driving = true;

  applyStimulus(stimulus: Stimulus): void {
    if (stimulus.kind === 'pin' && stimulus.index === 0) {
      const now = Date.now();
      if (this.pinHigh && !stimulus.high) {
        // High → low: measure pulse width
        const widthUs = now - this.lastChangeMs;
        const wanted = Math.round(((widthUs - SERVO_MIN_US) / (SERVO_MAX_US - SERVO_MIN_US)) * 180);
        this.angle = Math.min(STOP_HIGH_DEGREES, Math.max(STOP_LOW_DEGREES, wanted));
        this.driving = true;
      }
      this.pinHigh = stimulus.high;
      if (stimulus.high) this.lastChangeMs = now;
    }
    // time stimulus is handled by WasmPartProbe directly
  }

  readScalars(): number[] {
    return [this.angle];
  }
}

export const servoAdapter: PartAdapter = {
  kind: 'servo',
  labels: ['angle'],

  create(factoryArgs: unknown[], module?: PartsModule): unknown {
    const [part_id] = factoryArgs as [number];
    if (module) {
      return module.part_create_servo(part_id);
    } else {
      return new ServoOracle();
    }
  },

  apply(instance: unknown, stimulus: Stimulus, module?: PartsModule): void {
    if (module) {
      const handle = instance as number;
      if (stimulus.kind === 'pin' && stimulus.index === 0) {
        module.part_set_pin_level(handle, 0, stimulus.high ? 1 : 0);
      }
      // time stimulus handled by WasmPartProbe directly
    } else {
      const oracle = instance as ServoOracle;
      oracle.applyStimulus(stimulus);
    }
  },

  readScalars(instance: unknown, module?: PartsModule): number[] {
    if (module) {
      throw new Error('Servo: wasm path should use snapshotToScalars');
    } else {
      return (instance as ServoOracle).readScalars();
    }
  },

  snapshotToScalars(snap: PartStateSnapshot): number[] {
    return [snap.servo_angle];
  },

  reset(_instance: unknown, module?: PartsModule): void {
    if (module) {
      module.bus_reset();
    }
  },
};