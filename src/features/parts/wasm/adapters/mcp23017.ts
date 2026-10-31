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
        stimulus.bytes.forEach((byte) => module.i2c_bus_write(byte));
        module.i2c_bus_end_transmission();
      } else if (stimulus.kind === 'i2c-read') {
        module.i2c_bus_request_from(stimulus.address, stimulus.count);
        for (let i = 0; i < stimulus.count; i++) module.i2c_bus_read();
      }
    } else {
      const dev = instance as Mcp23017;
      if (stimulus.kind === 'i2c-write') {
        stimulus.bytes.forEach((byte, idx) => dev.receive(byte, idx === 0));
      } else if (stimulus.kind === 'i2c-read') {
        dev.read(stimulus.count);
      }
    }
  },

  readScalars(instance: unknown, module?: PartsModule): number[] {
    if (module) {
      const handle = instance as number;
      const outPtr = module.wasmMemory.allocDoubles(6);
      const count = module.part_get_scalars(handle, outPtr, 6);
      if (count !== 6) throw new Error(`MCP23017: expected 6 scalars, got ${count}`);
      return module.wasmMemory.readDoubles(outPtr, 6);
    } else {
      const dev = instance as Mcp23017;
      return [dev.iodira, dev.iodirb, dev.gpioa, dev.gpiob, dev.olata, dev.olatb];
    }
  },

  reset(instance: unknown, module?: PartsModule): void {
    if (module) {
      module.bus_reset();
    }
  },
};