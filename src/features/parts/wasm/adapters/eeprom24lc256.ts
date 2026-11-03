/**
 * EEPROM 24LC256 adapter for the differential harness.
 *
 * C++: part_create_eeprom(part_id, address) → EEPROM24LC256Context
 * TS:  Eeprom24lc256 class from devices/eeprom24lc256.ts
 */
import type { PartAdapter } from '../probe';
import type { PartsModule } from '../parts-module';
import type { Stimulus } from '../probe';
import type { PartStateSnapshot } from '../parts-module';
import { Eeprom24lc256 } from '@/features/parts/devices/eeprom24lc256';

export const eeprom24lc256Adapter: PartAdapter = {
  kind: 'eeprom24lc256',
  labels: ['read_byte0', 'read_byte1', 'read_byte2', 'read_byte3'],

  create(factoryArgs: unknown[], module?: PartsModule): unknown {
    const [part_id, address] = factoryArgs as [number, number];
    if (module) {
      return module.part_create_eeprom(part_id, address);
    } else {
      return new Eeprom24lc256();
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
      }
    } else {
      const dev = instance as Eeprom24lc256;
      if (stimulus.kind === 'i2c-write') {
        stimulus.bytes.forEach((byte: number) => {
          dev.receive(byte, true);
        });
      } else if (stimulus.kind === 'i2c-read') {
        dev.read(stimulus.count);
      }
    }
  },

  readScalars(_instance: unknown, module?: PartsModule): number[] {
    if (module) {
      throw new Error('EEPROM24LC256: wasm path should use snapshotToScalars');
    } else {
      const dev = _instance as Eeprom24lc256;
      const bytes = dev.read(4);
      return Array.from(bytes);
    }
  },

  snapshotToScalars(_snap: PartStateSnapshot): number[] {
    // EEPROM has no snapshot fields - data is in bus state
    return [0, 0, 0, 0];
  },

  reset(_instance: unknown, module?: PartsModule): void {
    if (module) {
      module.bus_reset();
    }
  },
};