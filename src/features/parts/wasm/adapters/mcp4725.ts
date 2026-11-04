/**
 * MCP4725 adapter for the differential harness.
 *
 * C++: part_create_dac(part_id, address, 12) → MCP4725Context
 * TS:  Mcp4725 class from devices/mcp4725.ts
 */
import { Mcp4725 } from '@/features/parts/devices/mcp4725';
import type { PartAdapter } from '../probe';
import type { PartsModule } from '../parts-module';
import type { Stimulus } from '../probe';
import type { PartStateSnapshot } from '../parts-module';

export const mcp4725Adapter: PartAdapter = {
  kind: 'mcp4725',
  labels: ['code'],

  create(factoryArgs: unknown[], module?: PartsModule): unknown {
    const [part_id, address, bits] = factoryArgs as [number, number, number];
    if (module) {
      return module.part_create_dac(part_id, address, bits);
    } else {
      return new Mcp4725();
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
      }
    } else {
      const dev = instance as Mcp4725;
      if (stimulus.kind === 'i2c-write') {
        stimulus.bytes.forEach((byte: number, idx: number) => dev.receive(byte, idx === 0));
      } else if (stimulus.kind === 'i2c-read') {
        dev.read(stimulus.count);
      }
    }
  },

  readScalars(_instance: unknown, module?: PartsModule): number[] {
    if (module) {
      throw new Error('MCP4725: wasm path should use snapshotToScalars');
    } else {
      const dev = _instance as Mcp4725;
      // Mcp4725 has no public code accessor; the read output is [high_nibble, low_byte]
      // Reconstruct the 12-bit code from the read frame.
      const bytes = dev.read(2);
      return [((bytes[0] & 0x0f) << 8) | bytes[1]];
    }
  },

  snapshotToScalars(snap: PartStateSnapshot): number[] {
    return [snap.mcp4725_value];
  },

  reset(_instance: unknown, module?: PartsModule): void {
    if (module) {
      module.bus_reset();
    }
  },
};
