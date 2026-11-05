/**
 * PCA9685 adapter for the differential harness.
 *
 * C++: part_create_pwm_driver(part_id, 16) → PCA9685Context
 * TS:  Pca9685 class from devices/pca9685.ts
 */
import { Pca9685 } from '@/features/parts/devices/pca9685';
import type { PartAdapter } from '../probe';
import type { PartsModule } from '../parts-module';
import type { Stimulus } from '../probe';
import type { PartStateSnapshot } from '../parts-module';

export const pca9685Adapter: PartAdapter = {
  kind: 'pca9685',
  labels: ['duty0', 'duty1', 'duty2', 'duty3'],

  create(factoryArgs: unknown[], module?: PartsModule): unknown {
    const [part_id, channels] = factoryArgs as [number, number];
    if (module) {
      return module.part_create_pwm_driver(part_id, channels);
    } else {
      return new Pca9685();
    }
  },

  apply(instance: unknown, stimulus: Stimulus, module?: PartsModule): void {
    if (module) {
      if (stimulus.kind === 'i2c-write') {
        module.i2c_bus_begin_transmission(stimulus.address);
        stimulus.bytes.forEach((byte: number) => module.i2c_bus_write(byte));
        module.i2c_bus_end_transmission();
      } else if (stimulus.kind === 'i2c-read') {
        module.i2c_bus_request_from(stimulus.address, stimulus.count);
        for (let i = 0; i < stimulus.count; i++) module.i2c_bus_read();
      } else if (stimulus.kind === 'knob' && stimulus.name === 'oe') {
        module.part_set_knob(instance as number, stimulus.name, stimulus.value);
      }
    } else {
      const dev = instance as Pca9685;
      if (stimulus.kind === 'i2c-write') {
        stimulus.bytes.forEach((byte: number, idx: number) => dev.receive(byte, idx === 0));
      } else if (stimulus.kind === 'i2c-read') {
        dev.read(stimulus.count);
      } else if (stimulus.kind === 'knob' && stimulus.name === 'oe') {
        dev.setOE(stimulus.value !== 0);
      }
    }
  },

  readScalars(_instance: unknown, module?: PartsModule): number[] {
    if (module) {
      throw new Error('PCA9685: wasm path should use snapshotToScalars');
    } else {
      const dev = _instance as Pca9685;
      // duty() returns a fraction; scale to counts for exact integer compare
      // (float compare in the harness is exact equality, so fraction vs scaled
      // counts needed care — the wasm side emits counts, see snapshotToScalars)
      return [
        Math.round(dev.duty(0) * 4096),
        Math.round(dev.duty(1) * 4096),
        Math.round(dev.duty(2) * 4096),
        Math.round(dev.duty(3) * 4096),
      ];
    }
  },

  snapshotToScalars(snap: PartStateSnapshot): number[] {
    return [
      snap.pca9685_duty[0],
      snap.pca9685_duty[1],
      snap.pca9685_duty[2],
      snap.pca9685_duty[3],
    ];
  },

  reset(_instance: unknown, module?: PartsModule): void {
    if (module) {
      module.bus_reset();
    }
  },
};
