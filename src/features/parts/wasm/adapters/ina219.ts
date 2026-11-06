/**
 * INA219 adapter for the differential harness.
 *
 * C++: part_create_sensor_i2c(part_id, 5, address) → INA219Context
 * TS:  knob-driven oracle (INA219 device is register-driven; the harness
 *      compares snapshot scalars vs knob-derived values)
 */
import type { PartAdapter } from '../probe';
import type { PartsModule } from '../parts-module';
import type { Stimulus } from '../probe';
import type { PartStateSnapshot } from '../parts-module';

class Ina219Oracle {
  bus_milli_v = 5000;     // 5V default
  shunt_micro_v = 10000;  // 100mA * 0.1 ohm = 10mV = 10000 uV
  current_milli_a = 100;  // 100mA default
  power_milli_w = 500;    // 5V * 100mA = 500mW
}

export const ina219Adapter: PartAdapter = {
  kind: 'ina219',
  labels: ['bus_milli_v', 'shunt_micro_v', 'current_milli_a', 'power_milli_w'],

  create(factoryArgs: unknown[], module?: PartsModule): unknown {
    const [part_id, type, address] = factoryArgs as [number, number, number];
    if (module) {
      return module.part_create_sensor_i2c(part_id, type, address);
    } else {
      return new Ina219Oracle();
    }
  },

  apply(instance: unknown, stimulus: Stimulus, module?: PartsModule): void {
    if (module) {
      if (stimulus.kind === 'i2c-write') {
        module.i2c_bus_begin_transmission(stimulus.address);
        stimulus.bytes.forEach((byte: number) => {
          module.i2c_bus_write(byte);
        });
        module.i2c_bus_end_transmission();
      } else if (stimulus.kind === 'i2c-read') {
        module.i2c_bus_request_from(stimulus.address, stimulus.count);
        for (let i = 0; i < stimulus.count; i++) {
          module.i2c_bus_read();
        }
      } else if (stimulus.kind === 'knob') {
        module.part_set_knob(instance as number, stimulus.name, stimulus.value);
      }
    } else {
      const oracle = instance as Ina219Oracle;
      if (stimulus.kind === 'knob') {
        if (stimulus.name === 'bus') {
          const busVolts = Math.max(0, Math.min(36, stimulus.value));
          oracle.bus_milli_v = Math.round(busVolts * 1000);
          oracle.power_milli_w = Math.round(busVolts * (oracle.current_milli_a / 1000) * 1000);
        } else if (stimulus.name === 'current') {
          const amps = Math.max(0, Math.min(3.2, stimulus.value / 1000));
          const shuntVolts = amps * 0.1;
          oracle.current_milli_a = Math.round(amps * 1000);
          oracle.shunt_micro_v = Math.round(shuntVolts * 1e6);
          oracle.power_milli_w = Math.round((oracle.bus_milli_v / 1000) * amps * 1000);
        }
      }
    }
  },

  readScalars(instance: unknown): number[] {
    const oracle = instance as Ina219Oracle;
    return [oracle.bus_milli_v, oracle.shunt_micro_v, oracle.current_milli_a, oracle.power_milli_w];
  },

  snapshotToScalars(snap: PartStateSnapshot): number[] {
    return [
      snap.ina219_bus_milli_v,
      snap.ina219_shunt_micro_v,
      snap.ina219_current_milli_a,
      snap.ina219_power_milli_w,
    ];
  },

  reset(_instance: unknown, module?: PartsModule): void {
    if (module) {
      module.bus_reset();
    }
  },
};
