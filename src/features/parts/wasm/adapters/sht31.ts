/**
 * SHT31 adapter for the differential harness.
 *
 * C++: part_create_sensor_i2c(part_id, 3, address) → SHT31Context
 * TS:  Sht31 class from devices/sht31.ts
 */
import type { PartAdapter } from '../probe';
import type { PartsModule } from '../parts-module';
import type { Stimulus } from '../probe';
import type { PartStateSnapshot } from '../parts-module';
import { Sht31 } from '@/features/parts/devices/sht31';

export const sht31Adapter: PartAdapter = {
  kind: 'sht31',
  labels: ['temp_milli_c', 'humidity_milli_pct'],

  create(factoryArgs: unknown[], module?: PartsModule): unknown {
    const [part_id, type, address] = factoryArgs as [number, number, number];
    if (module) {
      return module.part_create_sensor_i2c(part_id, type, address);
    } else {
      return new Sht31();
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
      const dev = instance as Sht31;
      if (stimulus.kind === 'i2c-write') {
        if (stimulus.bytes.length === 2) {
          const cmd = (stimulus.bytes[0] << 8) | stimulus.bytes[1];
          dev.receive(cmd >> 8, true);  // high byte
          dev.receive(cmd & 0xFF, false);  // low byte
        }
      } else if (stimulus.kind === 'i2c-read') {
        dev.read(stimulus.count);
      } else if (stimulus.kind === 'knob') {
        // Directly update internal state instead of replacing world callback
        if (stimulus.name === 'temperature') {
          (dev as any).celsius = stimulus.value;
        } else if (stimulus.name === 'humidity') {
          (dev as any).humidity = stimulus.value;
        }
      }
    }
  },

  readScalars(_instance: unknown, module?: PartsModule): number[] {
    if (module) {
      throw new Error('SHT31: wasm path should use snapshotToScalars');
    } else {
      const dev = _instance as Sht31;
      return [dev.getTemperatureMilliC(), dev.getHumidityMilliPct()];
    }
  },

  snapshotToScalars(snap: PartStateSnapshot): number[] {
    return [snap.sensor_temp_milli_c, snap.sensor_humidity_milli_pct];
  },

  reset(_instance: unknown, module?: PartsModule): void {
    if (module) {
      module.bus_reset();
    }
  },
};