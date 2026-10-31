/**
 * MCP23017 adapter for the differential harness.
 *
 * C++: part_create_i2c_expander(part_id, 16, address) → MCP23017Context
 * TS:  new Mcp23017()
 */
import { Mcp23017 } from '@/features/parts/devices/mcp23017';
import type { PartAdapter } from './probe';
import type { PartsModule } from './parts-module';
import type { Stimulus } from './probe';
import type { PartStateSnapshot } from './parts-module';

declare module '@/features/parts/devices/mcp23017' {
  interface Mcp23017 {
    readonly iodira: number;
    readonly iodirb: number;
    readonly gpioa: number;
    readonly gpiob: number;
    readonly olata: number;
    readonly olatb: number;
  }
}

Object.defineProperty(Mcp23017.prototype, 'iodira', { get() { return (this as any).registers[0x00]; } });
Object.defineProperty(Mcp23017.prototype, 'iodirb', { get() { return (this as any).registers[0x01]; } });
Object.defineProperty(Mcp23017.prototype, 'gpioa', { get() { return (this as any).registers[0x12]; } });
Object.defineProperty(Mcp23017.prototype, 'gpiob', { get() { return (this as any).registers[0x13]; } });
Object.defineProperty(Mcp23017.prototype, 'olata', { get() { return (this as any).registers[0x14]; } });
Object.defineProperty(Mcp23017.prototype, 'olatb', { get() { return (this as any).registers[0x15]; } });

export const mcp23017Adapter: PartAdapter = {
  kind: 'mcp23017',
  labels: ['iodira', 'iodirb', 'gpioa', 'gpiob', 'olata', 'olatb'],

  create(factoryArgs: unknown[], module?: PartsModule): unknown {
    const [part_id, address] = factoryArgs as [number, number];
    if (module) {
      return module.part_create_i2c_expander(part_id, 16, address);
    } else {
      return new Mcp23017();
    }
  },

  apply(instance: unknown, stimulus: Stimulus, module?: PartsModule): void {
    if (module) {
      const handle = instance as number;
      if (stimulus.kind === 'i2c-write') {
        module.i2c_bus_begin_transmission(stimulus.address);
        stimulus.bytes.forEach((byte: number) => module.i2c_bus_write(byte));
        module.i2c_bus_end_transmission();
      } else if (stimulus.kind === 'i2c-read') {
        module.i2c_bus_request_from(stimulus.address, stimulus.count);
        for (let i = 0; i < stimulus.count; i++) module.i2c_bus_read();
      }
    } else {
      const dev = instance as Mcp23017;
      if (stimulus.kind === 'i2c-write') {
        stimulus.bytes.forEach((byte: number, idx: number) => dev.receive(byte, idx === 0));
      } else if (stimulus.kind === 'i2c-read') {
        dev.read(stimulus.count);
      }
    }
  },

  readScalars(_instance: unknown, module?: PartsModule): number[] {
    if (module) {
      // Wasm path - now uses snapshotToScalars via probe
      throw new Error('MCP23017: wasm path should use snapshotToScalars');
    } else {
      const dev = _instance as Mcp23017;
      return [dev.iodira, dev.iodirb, dev.gpioa, dev.gpiob, dev.olata, dev.olatb];
    }
  },

  snapshotToScalars(snap: PartStateSnapshot): number[] {
    // MCP23017: iodira, iodirb, gpioa, gpiob, olata, olatb
    return [
      snap.mcp23017_iodira,
      snap.mcp23017_iodirb,
      snap.mcp23017_gpioa,
      snap.mcp23017_gpiob,
      snap.mcp23017_olata,
      snap.mcp23017_olatb,
    ];
  },

  reset(_instance: unknown, module?: PartsModule): void {
    if (module) {
      module.bus_reset();
    }
  },
};